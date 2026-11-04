import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { componentsOf, setComponents, availableBundles, assertKindChangeAllowed } from './bundles.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { categoryWithDescendants, categoryClause } from '../../lib/categories.js';
import { applyMovement } from '../inventory/service.js';
import { setValues } from '../custom/service.js';

const db = () => getDb();
const json = (v) => (v == null ? null : JSON.stringify(v));
const parseJson = (v) => (v ? JSON.parse(v) : []);

// ---------- Danh mục ----------
export function listCategories() {
  return db().prepare('SELECT * FROM categories WHERE archived_at IS NULL ORDER BY sort_order, name').all();
}

function assertParentOk(id, parentId) {
  if (!parentId) return;
  const parent = db().prepare('SELECT id, archived_at FROM categories WHERE id = ?').get(parentId);
  if (!parent) throw notFound('Danh mục cha');
  if (parent.archived_at) throw badRequest('CATEGORY_PARENT_ARCHIVED', 'Danh mục cha đã lưu trữ');
  if (id && categoryWithDescendants(id).includes(parentId)) throw conflict('CATEGORY_CYCLE', 'Không đặt danh mục con (hoặc chính nó) làm cha của nó');
}

export function createCategory(input, actor) {
  assertParentOk(null, input.parent_id);
  const id = newId('cat');
  const at = nowIso();
  db()
    .prepare('INSERT INTO categories (id, parent_id, name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, input.parent_id ?? null, input.name, input.sort_order ?? 0, at, at);
  audit(actor, 'category.created', 'category', id, null, input);
  return db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

/** Danh mục kèm số sản phẩm (trực tiếp và gồm con cháu) để vẽ cây quản lý */
export function listCategoryTree({ includeArchived = false } = {}) {
  const rows = db().prepare(`SELECT * FROM categories ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort_order, name`).all();
  const direct = new Map(db().prepare('SELECT category_id AS id, COUNT(*) AS n FROM products WHERE archived_at IS NULL AND category_id IS NOT NULL GROUP BY category_id').all().map((r) => [r.id, r.n]));
  return rows.map((c) => ({
    ...c,
    product_count: direct.get(c.id) ?? 0,
    product_count_total: categoryWithDescendants(c.id).reduce((a, id) => a + (direct.get(id) ?? 0), 0),
  }));
}

/**
 * Sửa danh mục. Đổi cha không được tạo vòng lặp (CATEGORY_CYCLE).
 * Lưu trữ danh mục còn sản phẩm đang dùng thì chặn (CATEGORY_IN_USE) trừ khi chỉ định `move_products_to`.
 */
export function updateCategory(id, input, actor) {
  const before = db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!before) throw notFound('Danh mục');
  if (input.parent_id !== undefined) assertParentOk(id, input.parent_id);
  const { move_products_to: moveTo, ...rest } = input;
  const n = { ...before, ...rest, updated_at: nowIso() };
  if (n.archived_at && !before.archived_at) {
    const ids = categoryWithDescendants(id);
    const used = db().prepare(`SELECT COUNT(*) AS n FROM products WHERE archived_at IS NULL AND category_id IN (${ids.map(() => '?').join(',')})`).get(...ids).n;
    const kids = db().prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ? AND archived_at IS NULL').get(id).n;
    if (kids) throw conflict('CATEGORY_HAS_CHILDREN', 'Danh mục còn danh mục con. Lưu trữ hoặc chuyển các danh mục con trước.');
    if (used) {
      if (!moveTo) throw conflict('CATEGORY_IN_USE', `Còn ${used} sản phẩm trong danh mục này. Chuyển sang danh mục khác trước khi lưu trữ.`, { product_count: used });
      if (ids.includes(moveTo)) throw badRequest('CATEGORY_MOVE_INVALID', 'Không chuyển sản phẩm vào chính danh mục đang lưu trữ');
      if (!db().prepare('SELECT 1 FROM categories WHERE id = ? AND archived_at IS NULL').get(moveTo)) throw notFound('Danh mục đích');
      db().prepare(`UPDATE products SET category_id = ?, updated_at = ? WHERE category_id IN (${ids.map(() => '?').join(',')})`).run(moveTo, nowIso(), ...ids);
    }
  }
  db()
    .prepare('UPDATE categories SET parent_id=?, name=?, sort_order=?, archived_at=?, updated_at=? WHERE id=?')
    .run(n.parent_id, n.name, n.sort_order, n.archived_at, n.updated_at, id);
  audit(actor, 'category.updated', 'category', id, before, n);
  return db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

// ---------- Sản phẩm ----------
export const imageUrl = (id) => `/api/v1/files/images/${id}`;

function hydrateProduct(p) {
  if (!p) return null;
  const variants = db()
    .prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY created_at, rowid')
    .all(p.id);
  const listings = db()
    .prepare(
      `SELECT l.* FROM shop_listings l JOIN variants v ON v.id = l.variant_id WHERE v.product_id = ? ORDER BY l.created_at`,
    )
    .all(p.id);
  const stock = db()
    .prepare(
      `SELECT s.variant_id, s.warehouse_id, s.on_hand, s.avg_cost FROM stock_levels s
       JOIN variants v ON v.id = s.variant_id WHERE v.product_id = ?`,
    )
    .all(p.id);
  const images = db()
    .prepare('SELECT id, sort_order, width, height FROM product_images WHERE product_id = ? AND archived_at IS NULL ORDER BY sort_order, created_at')
    .all(p.id)
    .map((i) => ({ ...i, url: imageUrl(i.id) }));
  const { elements: _legacy, ...rest } = p; // cột elements cũ không còn dùng (ngũ hành là trường sản phẩm theo shop)
  return {
    ...rest,
    options: parseJson(p.options),
    tags: parseJson(p.tags),
    images,
    variants: variants.map((v) => ({
      ...v,
      option_values: v.option_values ? JSON.parse(v.option_values) : null,
      image_url: v.image_id ? imageUrl(v.image_id) : null,
      ...(v.kind === 'bundle' ? { components: componentsOf(v.id), available: availableBundles(v.id), est_cost: componentsOf(v.id).reduce((a, c) => a + c.qty * costOf(c.component_variant_id, null), 0) } : {}),
      listings: listings.filter((l) => l.variant_id === v.id),
      stock: stock.filter((s) => s.variant_id === v.id),
      on_hand_total: stock.filter((s) => s.variant_id === v.id).reduce((a, s) => a + s.on_hand, 0),
    })),
  };
}

export function getProduct(id) {
  const p = db().prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) throw notFound('Sản phẩm');
  return hydrateProduct(p);
}

/**
 * Danh sách sản phẩm. Nếu có shopId: chỉ sản phẩm có niêm yết ở shop đó (trừ khi includeUnlisted).
 * categoryId lọc cả danh mục con cháu. type: 'combo' (có biến thể combo) | 'single' (không có).
 */
export function listProducts({ shopId, q, categoryId, type, includeArchived, includeUnlisted, limit = 50, cursor }) {
  const where = [];
  const params = [];
  if (!includeArchived) where.push('p.archived_at IS NULL');
  const cat = categoryClause(categoryId);
  if (cat.sql) {
    where.push(cat.sql.slice(5));
    params.push(...cat.params);
  }
  if (type === 'combo') where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.kind = 'bundle')`);
  if (type === 'single') where.push(`NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.kind = 'bundle')`);
  if (q) {
    where.push(`(p.name LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND (v.sku LIKE ? OR v.name LIKE ? OR v.barcode = ?)))`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (shopId && !includeUnlisted) {
    where.push(`EXISTS (SELECT 1 FROM variants v JOIN shop_listings l ON l.variant_id = v.id WHERE v.product_id = p.id AND l.shop_id = ?)`);
    params.push(shopId);
  }
  if (cursor) {
    where.push('p.id < ?');
    params.push(cursor);
  }
  const rows = db()
    .prepare(`SELECT p.* FROM products p ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT ?`)
    .all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows).map(hydrateProduct);
  if (shopId && data.length) {
    // Ngũ hành của sản phẩm theo shop đang xem (trường vai trò element của shop đó), chỉ để hiển thị ở danh sách
    const ev = db()
      .prepare(`SELECT v.entity_id AS id, v.value_text FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
                WHERE v.entity_type = 'product' AND f.role = 'element' AND f.shop_id = ? AND f.archived_at IS NULL AND v.entity_id IN (${data.map(() => '?').join(',')})`)
      .all(shopId, ...data.map((d) => d.id));
    const m = new Map(ev.map((r) => [r.id, r.value_text ? JSON.parse(r.value_text) : []]));
    for (const d of data) d.elements = m.get(d.id) ?? [];
  }
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

// ---------- Thuộc tính & biến thể ----------
/** Kiểm tra bộ thuộc tính: tối đa 3, tên và giá trị không rỗng, không trùng (không phân biệt hoa thường) */
function normalizeOptions(options) {
  if (!options) return [];
  if (options.length > 3) throw badRequest('TOO_MANY_OPTIONS', 'Tối đa 3 thuộc tính biến thể (vd Mùi, Size, Màu)');
  const names = new Set();
  return options.map((o) => {
    const name = o.name.trim();
    if (!name) throw badRequest('OPTION_NAME', 'Tên thuộc tính không được để trống');
    if (names.has(name.toLowerCase())) throw badRequest('OPTION_DUPLICATE', `Thuộc tính "${name}" bị trùng`);
    names.add(name.toLowerCase());
    const seen = new Set();
    const values = [];
    for (const raw of o.values) {
      const v = raw.trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      values.push(v);
    }
    if (!values.length) throw badRequest('OPTION_VALUES', `Thuộc tính "${name}" cần ít nhất 1 giá trị`);
    return { name, values };
  });
}

function checkOptionValues(options, ov, index) {
  if (!ov) return;
  for (const [k, v] of Object.entries(ov)) {
    const o = options.find((x) => x.name === k);
    if (!o || !o.values.includes(v)) throw badRequest('OPTION_VALUE_INVALID', `Dòng ${index + 1}: "${k}: ${v}" không nằm trong thuộc tính của sản phẩm`, { index });
  }
}

/** Kiểm tra SKU trùng trong cả lô và với dữ liệu đã có, báo đúng dòng bị trùng */
function assertSkusFree(list, productId) {
  const seen = new Map();
  list.forEach((v, index) => {
    if (!v) return;
    const sku = v.sku.trim().toUpperCase();
    if (seen.has(sku)) throw badRequest('DUPLICATE_SKU', `SKU ${sku} bị trùng ở dòng ${seen.get(sku) + 1} và dòng ${index + 1}`, { index, sku });
    seen.set(sku, index);
    const hit = db().prepare('SELECT id, product_id FROM variants WHERE sku = ?').get(sku);
    if (hit && (!v.id || hit.id !== v.id)) throw conflict('DUPLICATE_SKU', `SKU ${sku} đã có ở một sản phẩm khác`, { index, sku });
  });
}

const autoName = (ov) => (ov && Object.keys(ov).length ? Object.values(ov).join(' / ') : null);

function insertVariant(productId, v, at) {
  const id = newId('var');
  const name = v.name ?? autoName(v.option_values);
  db()
    .prepare(
      `INSERT INTO variants (id, product_id, sku, name, barcode, default_price, min_stock, weight_gram, kind, option_values, archived_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, productId, v.sku.trim().toUpperCase(), name, v.barcode ?? null, v.default_price ?? 0, v.min_stock ?? 0, v.weight_gram ?? null, v.kind === 'bundle' ? 'bundle' : 'single', v.option_values ? JSON.stringify(v.option_values) : null, v.active === false ? at : null, at, at);
  if (v.kind === 'bundle') setComponents(id, v.components);
  else if (v.components?.length) throw badRequest('NOT_BUNDLE', 'Chỉ combo mới có thành phần');
  return id;
}

/** Kho ghi tồn đầu kỳ: kho chọn trên dòng, rồi kho chung của sản phẩm, rồi kho mặc định của shop niêm yết đầu tiên */
function openingWarehouse(v, input) {
  const wid = v.opening_warehouse_id ?? input.opening_warehouse_id ?? (input.shop_ids ?? []).map((sid) => db().prepare('SELECT default_warehouse_id AS w FROM shops WHERE id = ?').get(sid)?.w).find(Boolean);
  if (!wid) throw badRequest('WAREHOUSE_REQUIRED', 'Cần chọn kho để ghi tồn đầu kỳ');
  if (!db().prepare('SELECT 1 FROM warehouses WHERE id = ?').get(wid)) throw notFound('Kho');
  return wid;
}

function recordOpening(variantId, v, input, actor, index) {
  if (!v.opening_qty || v.opening_qty <= 0) return;
  if (v.kind === 'bundle') throw badRequest('BUNDLE_NO_STOCK', 'Combo không có tồn đầu kỳ riêng', { index });
  applyMovement({ warehouseId: openingWarehouse(v, input), variantId, type: 'opening', qty: v.opening_qty, unitCost: v.opening_cost ?? 0, refType: 'product', note: 'Tồn đầu kỳ khi tạo sản phẩm', actorId: actor?.id });
}

/** Biến thể đã có lịch sử kho/đơn/nhập thì chỉ được lưu trữ, không xoá */
function variantHasHistory(variantId) {
  return !!(
    db().prepare('SELECT 1 FROM stock_movements WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM order_lines WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM purchase_lines WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM stock_count_lines WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM bundle_components WHERE component_variant_id = ? LIMIT 1').get(variantId)
  );
}

/** Bỏ một biến thể khỏi sản phẩm: chưa từng dùng thì xoá hẳn (dữ liệu nháp, quy ước 6), đã có lịch sử thì lưu trữ */
function removeVariant(variantId, at) {
  if (variantHasHistory(variantId)) {
    db().prepare('UPDATE variants SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?').run(at, at, variantId);
    return 'archived';
  }
  db().prepare('DELETE FROM shop_listings WHERE variant_id = ?').run(variantId);
  db().prepare('DELETE FROM bundle_components WHERE bundle_variant_id = ?').run(variantId);
  db().prepare('DELETE FROM stock_levels WHERE variant_id = ? AND on_hand = 0').run(variantId);
  db().prepare('DELETE FROM variants WHERE id = ?').run(variantId);
  return 'deleted';
}

// ---------- Ảnh ----------
function mirrorFirstImage(productId) {
  const first = db().prepare('SELECT id FROM product_images WHERE product_id = ? AND archived_at IS NULL ORDER BY sort_order, created_at LIMIT 1').get(productId);
  db().prepare('UPDATE products SET image_url = ? WHERE id = ?').run(first ? imageUrl(first.id) : null, productId);
}

/**
 * Đặt danh sách ảnh của sản phẩm theo đúng thứ tự `items` = [{id, variant_id?}].
 * Ảnh không còn trong danh sách bị lưu trữ (file vẫn giữ). `variant_id` chọn ảnh đó làm ảnh của biến thể.
 * Ảnh đầu tiên được ghi vào products.image_url để code cũ vẫn chạy.
 */
export function setProductImages(productId, items, resolveVariant = (it) => it.variant_id) {
  if (!db().prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw notFound('Sản phẩm');
  const ids = new Set();
  items.forEach((it) => {
    if (ids.has(it.id)) throw badRequest('IMAGE_DUPLICATE', 'Một ảnh chỉ xuất hiện một lần');
    ids.add(it.id);
    const img = db().prepare('SELECT * FROM product_images WHERE id = ?').get(it.id);
    if (!img || img.archived_at) throw notFound('Ảnh');
    if (img.product_id && img.product_id !== productId) throw conflict('IMAGE_IN_USE', 'Ảnh này đã gắn vào sản phẩm khác');
  });
  const old = db().prepare('SELECT id FROM product_images WHERE product_id = ? AND archived_at IS NULL').all(productId).map((r) => r.id);
  const at = nowIso();
  for (const oid of old) {
    if (ids.has(oid)) continue;
    db().prepare('UPDATE product_images SET archived_at = ? WHERE id = ?').run(at, oid);
    db().prepare('UPDATE variants SET image_id = NULL WHERE image_id = ?').run(oid);
  }
  items.forEach((it, i) => {
    db().prepare('UPDATE product_images SET product_id = ?, sort_order = ? WHERE id = ?').run(productId, i, it.id);
    const vid = resolveVariant(it);
    if (vid) {
      const v = db().prepare('SELECT 1 FROM variants WHERE id = ? AND product_id = ?').get(vid, productId);
      if (!v) throw notFound('Biến thể');
      db().prepare('UPDATE variants SET image_id = ? WHERE id = ?').run(it.id, vid);
    }
  });
  mirrorFirstImage(productId);
}

/** Gắn ảnh cho từng biến thể (variants[].image_id). Ảnh phải thuộc sản phẩm. */
function setVariantImages(productId, pairs) {
  for (const [variantId, imageId] of pairs) {
    if (imageId) {
      const img = db().prepare('SELECT 1 FROM product_images WHERE id = ? AND product_id = ? AND archived_at IS NULL').get(imageId, productId);
      if (!img) throw badRequest('IMAGE_NOT_IN_PRODUCT', 'Ảnh của biến thể phải nằm trong ảnh của sản phẩm');
    }
    db().prepare('UPDATE variants SET image_id = ? WHERE id = ?').run(imageId ?? null, variantId);
  }
}

export function upsertListing(shopId, variantId, price, active = true) {
  const at = nowIso();
  const existing = db().prepare('SELECT * FROM shop_listings WHERE shop_id = ? AND variant_id = ?').get(shopId, variantId);
  if (existing) {
    db().prepare('UPDATE shop_listings SET price = ?, active = ?, updated_at = ? WHERE id = ?').run(price, active ? 1 : 0, at, existing.id);
    return { id: existing.id, created: false };
  }
  const id = newId('lst');
  db()
    .prepare('INSERT INTO shop_listings (id, shop_id, variant_id, price, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, shopId, variantId, price, active ? 1 : 0, at, at);
  return { id, created: true };
}

export function createProduct(input, actor) {
  if (!input.variants?.length) throw badRequest('NO_VARIANT', 'Sản phẩm cần ít nhất 1 biến thể (SKU)');
  const options = normalizeOptions(input.options);
  assertSkusFree(input.variants, null);
  input.variants.forEach((v, i) => checkOptionValues(options, v.option_values, i));
  if (input.category_id && !db().prepare('SELECT 1 FROM categories WHERE id = ? AND archived_at IS NULL').get(input.category_id)) throw notFound('Danh mục');
  const id = newId('prd');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO products (id, name, description, category_id, unit, image_url, brand, consumption_days, options, tags, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.name, input.description ?? null, input.category_id ?? null, input.unit ?? 'cái', input.image_url ?? null, input.brand ?? null, input.consumption_days ?? null, options.length ? json(options) : null, json(input.tags ?? []), at, at);
  const variantImages = [];
  const bySku = new Map();
  input.variants.forEach((v, i) => {
    const vid = insertVariant(id, v, at);
    bySku.set(v.sku.trim().toUpperCase(), vid);
    if (v.image_id) variantImages.push([vid, v.image_id]);
    if (v.active !== false) for (const shopId of input.shop_ids ?? []) upsertListing(shopId, vid, v.default_price ?? 0);
    recordOpening(vid, v, input, actor, i);
  });
  if (input.images?.length) {
    setProductImages(id, input.images, (it) => it.variant_id ?? (it.variant_sku ? bySku.get(it.variant_sku.trim().toUpperCase()) : null));
  }
  setVariantImages(id, variantImages);
  if (input.custom && Object.keys(input.custom).length) setValues('product', id, input.custom, { shopId: input.custom_shop_id ?? input.shop_ids?.[0] ?? null });
  const p = getProduct(id);
  audit(actor, 'product.created', 'product', id, null, p);
  emit('product.created', { entityType: 'product', entityId: id, data: p });
  return p;
}

const PRODUCT_FIELDS = ['name', 'description', 'category_id', 'unit', 'image_url', 'brand', 'consumption_days', 'options', 'tags', 'archived_at'];

export function updateProduct(id, input, actor) {
  const before = getProduct(id);
  const at = nowIso();
  const next = { ...before };
  for (const f of PRODUCT_FIELDS) if (input[f] !== undefined) next[f] = input[f];
  if (input.options !== undefined) next.options = normalizeOptions(input.options);
  if (input.category_id && !db().prepare('SELECT 1 FROM categories WHERE id = ? AND archived_at IS NULL').get(input.category_id)) throw notFound('Danh mục');
  const optionsNow = next.options ?? [];
  // SKU: mọi biến thể sẽ còn lại sau lần sửa này phải khác nhau
  const skuView = (input.variants ?? []).filter((v) => !v.remove && (v.sku !== undefined));
  assertSkusFree(skuView, id);
  (input.variants ?? []).forEach((v, i) => !v.remove && checkOptionValues(optionsNow, v.option_values, i));
  db()
    .prepare(`UPDATE products SET ${PRODUCT_FIELDS.map((f) => `${f}=?`).join(', ')}, updated_at=? WHERE id=?`)
    .run(...PRODUCT_FIELDS.map((f) => (f === 'options' ? (next.options?.length ? json(next.options) : null) : f === 'tags' ? json(next.tags) : next[f])), at, id);

  // Biến thể: có id = cập nhật, không id = thêm mới, remove = bỏ (xoá nếu chưa dùng, không thì lưu trữ).
  const shopsOfProduct = [...new Set(before.variants.flatMap((v) => v.listings.map((l) => l.shop_id)))];
  const variantImages = [];
  const removed = [];
  for (const [i, v] of (input.variants ?? []).entries()) {
    if (v.id) {
      const cur = db().prepare('SELECT * FROM variants WHERE id = ? AND product_id = ?').get(v.id, id);
      if (!cur) throw notFound('Biến thể');
      if (v.remove) {
        removed.push({ id: v.id, sku: cur.sku, result: removeVariant(v.id, at) });
        continue;
      }
      const n = { ...cur, ...v, sku: (v.sku ?? cur.sku).trim().toUpperCase() };
      if (v.kind && v.kind !== cur.kind) {
        assertKindChangeAllowed(cur.id);
        db().prepare('UPDATE variants SET kind = ? WHERE id = ?').run(v.kind, cur.id);
        if (v.kind === 'single') db().prepare('DELETE FROM bundle_components WHERE bundle_variant_id = ?').run(cur.id);
      }
      if ((v.kind ?? cur.kind) === 'bundle') {
        if (v.components) setComponents(cur.id, v.components);
        else if (cur.kind !== 'bundle') throw badRequest('BUNDLE_EMPTY', 'Combo cần ít nhất 1 thành phần');
      }
      const archivedAt = v.active === undefined ? (v.archived_at === undefined ? cur.archived_at : v.archived_at) : v.active ? null : cur.archived_at ?? at;
      const ov = v.option_values === undefined ? cur.option_values : v.option_values ? JSON.stringify(v.option_values) : null;
      db()
        .prepare('UPDATE variants SET sku=?, name=?, barcode=?, default_price=?, min_stock=?, weight_gram=?, option_values=?, archived_at=?, updated_at=? WHERE id=?')
        .run(n.sku, n.name, n.barcode, n.default_price, n.min_stock, n.weight_gram, ov, archivedAt ?? null, at, v.id);
      if (v.image_id !== undefined) variantImages.push([v.id, v.image_id]);
    } else {
      if (v.remove) continue;
      const vid = insertVariant(id, v, at);
      if (v.image_id) variantImages.push([vid, v.image_id]);
      if (v.active !== false) for (const shopId of shopsOfProduct) upsertListing(shopId, vid, v.default_price ?? 0);
      recordOpening(vid, v, { ...input, shop_ids: input.shop_ids ?? shopsOfProduct }, actor, i);
    }
  }
  if (input.images) setProductImages(id, input.images);
  setVariantImages(id, variantImages);
  if (input.custom && Object.keys(input.custom).length) setValues('product', id, input.custom, { shopId: input.custom_shop_id ?? null });
  const after = getProduct(id);
  audit(actor, 'product.updated', 'product', id, before, { ...after, removed_variants: removed });
  emit('product.updated', { entityType: 'product', entityId: id, data: after });
  return after;
}

// ---------- Niêm yết & đồng bộ ----------
export function setListings(items, actor) {
  const results = items.map((it) => {
    const v = db().prepare('SELECT id FROM variants WHERE id = ?').get(it.variant_id);
    if (!v) throw notFound(`Biến thể ${it.variant_id}`);
    return { ...it, ...upsertListing(it.shop_id, it.variant_id, it.price, it.active ?? true) };
  });
  audit(actor, 'listing.set', 'shop_listing', 'bulk', null, items);
  return results;
}

/**
 * Đồng bộ niêm yết từ shop nguồn sang shop đích.
 * variantIds = null → toàn bộ. overwritePrice = true → ghi đè giá nếu shop đích đã có.
 */
export function syncListings({ fromShopId, toShopId, variantIds = null, productIds = null, overwritePrice = false }, actor) {
  if (fromShopId === toShopId) throw badRequest('SAME_SHOP', 'Shop nguồn và đích phải khác nhau');
  let sql = `SELECT l.* FROM shop_listings l JOIN variants v ON v.id = l.variant_id WHERE l.shop_id = ? AND v.archived_at IS NULL`;
  const params = [fromShopId];
  if (variantIds?.length) {
    sql += ` AND l.variant_id IN (${variantIds.map(() => '?').join(',')})`;
    params.push(...variantIds);
  }
  if (productIds?.length) {
    sql += ` AND v.product_id IN (${productIds.map(() => '?').join(',')})`;
    params.push(...productIds);
  }
  const src = db().prepare(sql).all(...params);
  const summary = { created: 0, updated: 0, skipped: 0 };
  for (const l of src) {
    const existing = db().prepare('SELECT * FROM shop_listings WHERE shop_id = ? AND variant_id = ?').get(toShopId, l.variant_id);
    if (existing && !overwritePrice) {
      summary.skipped++;
      continue;
    }
    const res = upsertListing(toShopId, l.variant_id, l.price, existing ? !!existing.active : true);
    res.created ? summary.created++ : summary.updated++;
  }
  audit(actor, 'listing.synced', 'shop', toShopId, null, { fromShopId, toShopId, ...summary });
  emit('listing.synced', { entityType: 'shop', entityId: toShopId, shopId: toShopId, data: { from_shop_id: fromShopId, ...summary } });
  return summary;
}

/**
 * Tìm biến thể để bán (POS, tạo đơn): kèm giá theo shop và tồn ở kho chỉ định.
 */
export function searchVariants({ shopId, warehouseId, q, categoryId, limit = 30, onlyListed = true }) {
  const params = [shopId ?? null, warehouseId ?? null];
  const where = ['v.archived_at IS NULL', 'p.archived_at IS NULL'];
  if (q) {
    where.push('(v.sku LIKE ? OR v.name LIKE ? OR p.name LIKE ? OR v.barcode = ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (shopId && onlyListed) where.push('l.id IS NOT NULL AND l.active = 1');
  const cat = categoryClause(categoryId);
  if (cat.sql) where.push(cat.sql.slice(5));
  return db()
    .prepare(
      `SELECT v.id, v.sku, v.kind, v.name AS variant_name, v.barcode, v.default_price, v.min_stock,
              p.id AS product_id, p.name AS product_name, p.unit, COALESCE('/api/v1/files/images/' || v.image_id, p.image_url) AS image_url, v.option_values,
              COALESCE(l.price, v.default_price) AS price, l.active AS listed,
              COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.avg_cost, 0) AS avg_cost
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN shop_listings l ON l.variant_id = v.id AND l.shop_id = ?
       LEFT JOIN stock_levels s ON s.variant_id = v.id AND s.warehouse_id = ?
       WHERE ${where.join(' AND ')}
       ORDER BY p.name, v.sku LIMIT ?`,
    )
    .all(...params, ...cat.params, limit)
    .map((r) => ({ ...r, option_values: r.option_values ? JSON.parse(r.option_values) : null }))
    .map((r) => (r.kind === 'bundle' ? { ...r, on_hand: availableBundles(r.id, warehouseId), avg_cost: componentsOf(r.id).reduce((a, c) => a + c.qty * (costOf(c.component_variant_id, warehouseId)), 0) } : r));
}

function costOf(variantId, warehouseId) {
  return db().prepare(`SELECT COALESCE(${warehouseId ? 'avg_cost' : 'MAX(avg_cost)'},0) AS c FROM stock_levels WHERE variant_id = ? ${warehouseId ? 'AND warehouse_id = ?' : ''}`).get(...(warehouseId ? [variantId, warehouseId] : [variantId]))?.c ?? 0;
}
