import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { componentsOf, setComponents, availableBundles, assertKindChangeAllowed } from './bundles.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { categoryWithDescendants, categoryClause } from '../../lib/categories.js';
import { applyMovement } from '../inventory/service.js';
import { setValues } from '../custom/service.js';
import { shopWarehouseIds } from '../orders/allocation.js';

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
    item_type: p.is_service ? 'service' : p.item_type, // dịch vụ lưu item_type = 'product' + is_service = 1, API trả 'service'
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
export function listProducts({ shopId, q, categoryId, type, itemType, includeArchived, archivedOnly, includeUnlisted, unlistedOnly, limit = 50, cursor }) {
  const where = [];
  const params = [];
  if (archivedOnly) where.push('p.archived_at IS NOT NULL');
  else if (!includeArchived) where.push('p.archived_at IS NULL');
  if (itemType === 'service') where.push('p.is_service = 1');
  else if (itemType === 'product') where.push("p.item_type = 'product' AND p.is_service = 0");
  else if (itemType) { where.push('p.item_type = ?'); params.push(itemType); }
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
  // Sản phẩm chưa gắn vào shop nào (ví dụ vật tư, hàng mới tạo): không hiện khi lọc theo shop nên cần một đường riêng để tìm, sửa, xoá chúng
  if (unlistedOnly) where.push('NOT EXISTS (SELECT 1 FROM variants v JOIN shop_listings l ON l.variant_id = v.id WHERE v.product_id = p.id)');
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
  if (data.length) {
    // Tồn tổng (mọi kho) và số biến thể dưới mức tối thiểu, chỉ để hiển thị ở danh sách. Combo không có tồn riêng nên bỏ qua.
    const ph = data.map(() => '?').join(',');
    const st = db()
      .prepare(`SELECT v.product_id AS id, COALESCE(SUM(sl.on_hand), 0) AS stock_total,
                       SUM(CASE WHEN v.min_stock > 0 AND COALESCE((SELECT SUM(x.on_hand) FROM stock_levels x WHERE x.variant_id = v.id), 0) < v.min_stock THEN 1 ELSE 0 END) AS low_count
                FROM variants v LEFT JOIN stock_levels sl ON sl.variant_id = v.id
                WHERE v.kind != 'bundle' AND v.archived_at IS NULL AND v.product_id IN (${ph}) GROUP BY v.product_id`)
      .all(...data.map((d) => d.id));
    const sm = new Map(st.map((r) => [r.id, r]));
    for (const d of data) { d.stock_total = d.is_service ? null : sm.get(d.id)?.stock_total ?? null; d.low_stock_count = d.is_service ? 0 : sm.get(d.id)?.low_count ?? 0; }
  }
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
  if (options.length > 3) throw badRequest('TOO_MANY_OPTIONS', 'Tối đa 3 thuộc tính biến thể (ví dụ Mùi, Size, Màu)');
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

/** Đổi nhãn thuộc tính/giá trị cho MỌI biến thể của sản phẩm (kể cả đã lưu trữ), giữ nguyên id. Tên tự đặt đi theo nhãn mới. */
function relabelVariants(productId, renames, at) {
  const byFrom = new Map(renames.map((r) => [r.from, r]));
  for (const v of db().prepare('SELECT id, name, option_values FROM variants WHERE product_id = ? AND option_values IS NOT NULL').all(productId)) {
    const old = JSON.parse(v.option_values);
    const now = {};
    for (const [k, val] of Object.entries(old)) {
      const r = byFrom.get(k);
      now[r ? r.to : k] = r?.values?.[val] ?? val;
    }
    if (JSON.stringify(now) === v.option_values) continue;
    const name = v.name === null || v.name === autoName(old) ? autoName(now) : v.name;
    db().prepare('UPDATE variants SET option_values = ?, name = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(now), name, at, v.id);
  }
}

/** Sau khi sửa thuộc tính: bỏ khoá của thuộc tính đã xoá khỏi mọi biến thể, rồi kiểm ánh xạ biến thể → tổ hợp phải 1-1 */
function settleOptions(productId, options) {
  if (!options.length) return;
  const names = new Set(options.map((o) => o.name));
  const rows = db().prepare('SELECT id, sku, option_values, archived_at FROM variants WHERE product_id = ?').all(productId);
  const seen = new Map();
  for (const v of rows) {
    let ov = v.option_values ? JSON.parse(v.option_values) : null;
    if (ov && Object.keys(ov).some((k) => !names.has(k))) {
      ov = Object.fromEntries(Object.entries(ov).filter(([k]) => names.has(k)));
      db().prepare('UPDATE variants SET option_values = ? WHERE id = ?').run(Object.keys(ov).length ? JSON.stringify(ov) : null, v.id);
    }
    if (v.archived_at) continue;
    const bad = options.find((o) => !ov || !o.values.includes(ov[o.name]));
    if (bad) throw badRequest('OPTION_INCOMPLETE', `Biến thể ${v.sku} chưa có giá trị hợp lệ cho thuộc tính "${bad.name}"`, { sku: v.sku, option: bad.name });
    const key = options.map((o) => ov[o.name]).join('\u0001');
    if (seen.has(key)) throw conflict('OPTIONS_CONFLICT', `Hai biến thể ${seen.get(key)} và ${v.sku} có cùng giá trị thuộc tính (${options.map((o) => ov[o.name]).join(' / ')})`, { skus: [seen.get(key), v.sku] });
    seen.set(key, v.sku);
  }
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
  if (input.item_type === 'service') throw badRequest('SERVICE_NO_STOCK', 'Dịch vụ không có tồn kho nên không có tồn đầu kỳ', { index });
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

/** Xem trước: mỗi biến thể bỏ đi sẽ bị xoá hẳn hay lưu trữ (không ghi gì) */
export function previewVariantRemoval(productId, variantIds) {
  const out = [];
  for (const id of variantIds) {
    const v = db().prepare('SELECT id, sku, name, option_values FROM variants WHERE id = ? AND product_id = ?').get(id, productId);
    if (!v) continue;
    out.push({ id: v.id, sku: v.sku, name: v.name, option_values: v.option_values ? JSON.parse(v.option_values) : {}, outcome: variantHasHistory(v.id) ? 'archived' : 'deleted' });
  }
  return out;
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
  const sellable = db().prepare("SELECT p.item_type FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?").get(variantId);
  if (sellable && sellable.item_type !== 'product') throw badRequest('MATERIAL_NOT_SELLABLE', 'Vật tư không thể niêm yết để bán');
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
  const isService = input.item_type === 'service';
  if (input.item_type && input.item_type !== 'product' && !isService && input.shop_ids?.length) throw badRequest('MATERIAL_NOT_SELLABLE', 'Vật tư không thể gán vào shop bán hàng');
  if (input.default_supplier_id && !db().prepare('SELECT 1 FROM suppliers WHERE id=? AND archived_at IS NULL').get(input.default_supplier_id)) throw notFound('Nhà cung cấp');
  if (!input.variants?.length) throw badRequest('NO_VARIANT', 'Sản phẩm cần ít nhất 1 biến thể (SKU)');
  const options = normalizeOptions(input.options);
  assertSkusFree(input.variants, null);
  input.variants.forEach((v, i) => checkOptionValues(options, v.option_values, i));
  if (input.category_id && !db().prepare('SELECT 1 FROM categories WHERE id = ? AND archived_at IS NULL').get(input.category_id)) throw notFound('Danh mục');
  const id = newId('prd');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO products (id, name, description, category_id, unit, image_url, brand, consumption_days, options, tags, item_type, default_supplier_id, created_at, updated_at, warranty_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.name, input.description ?? null, input.category_id ?? null, input.unit ?? 'cái', input.image_url ?? null, input.brand ?? null, input.consumption_days ?? null, options.length ? json(options) : null, json(input.tags ?? []), isService ? 'product' : input.item_type ?? 'product', input.default_supplier_id ?? null, at, at, input.warranty_days ?? null);
  if (isService) db().prepare('UPDATE products SET is_service = 1 WHERE id = ?').run(id);
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

const PRODUCT_FIELDS = ['name', 'description', 'category_id', 'unit', 'image_url', 'brand', 'consumption_days', 'warranty_days', 'options', 'tags', 'archived_at', 'item_type', 'default_supplier_id'];

export function updateProduct(id, input, actor) {
  const before = getProduct(id);
  if (input.default_supplier_id && !db().prepare('SELECT 1 FROM suppliers WHERE id=? AND archived_at IS NULL').get(input.default_supplier_id)) throw notFound('Nhà cung cấp');
  const wantService = input.item_type === undefined ? !!before.is_service : input.item_type === 'service';
  if (wantService !== !!before.is_service && before.variants.some((v) => variantHasHistory(v.id))) throw conflict('SERVICE_TYPE_LOCKED', 'Sản phẩm đã có lịch sử kho, đơn hoặc phiếu nhập nên không đổi giữa hàng hoá và dịch vụ được.');
  if (input.item_type && input.item_type !== 'product' && input.item_type !== 'service' && before.variants.some((v) => v.listings?.some((l) => l.active))) throw conflict('MATERIAL_HAS_LISTINGS', 'Gỡ niêm yết ở các shop trước khi đổi thành vật tư');
  const at = nowIso();
  const next = { ...before };
  for (const f of PRODUCT_FIELDS) if (input[f] !== undefined) next[f] = input[f];
  if (next.item_type === 'service') next.item_type = 'product'; // cột item_type có CHECK; dịch vụ dùng is_service
  if (input.options !== undefined) next.options = normalizeOptions(input.options);
  if (input.category_id && !db().prepare('SELECT 1 FROM categories WHERE id = ? AND archived_at IS NULL').get(input.category_id)) throw notFound('Danh mục');
  const optionsNow = next.options ?? [];
  const optionsTouched = input.options !== undefined || !!input.option_renames?.length;
  if (input.option_renames?.length) relabelVariants(id, input.option_renames, at);
  // SKU: mọi biến thể sẽ còn lại sau lần sửa này phải khác nhau
  const skuView = (input.variants ?? []).filter((v) => !v.remove && (v.sku !== undefined));
  assertSkusFree(skuView, id);
  (input.variants ?? []).forEach((v, i) => !v.remove && checkOptionValues(optionsNow, v.option_values, i));
  db()
    .prepare(`UPDATE products SET ${PRODUCT_FIELDS.map((f) => `${f}=?`).join(', ')}, updated_at=? WHERE id=?`)
    .run(...PRODUCT_FIELDS.map((f) => (f === 'options' ? (next.options?.length ? json(next.options) : null) : f === 'tags' ? json(next.tags) : next[f])), at, id);
  db().prepare('UPDATE products SET is_service = ? WHERE id = ?').run(wantService ? 1 : 0, id);

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
      // Biến thể được gán giá trị thuộc tính: tên tự đặt theo giá trị mới (tên người dùng đặt tay giữ nguyên)
      if (v.option_values !== undefined && v.name === undefined && (cur.name === null || cur.name === autoName(cur.option_values ? JSON.parse(cur.option_values) : null))) n.name = autoName(v.option_values);
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
  if (optionsTouched || input.variants?.length) settleOptions(id, optionsNow);
  if (input.images) setProductImages(id, input.images);
  setVariantImages(id, variantImages);
  if (input.custom && Object.keys(input.custom).length) setValues('product', id, input.custom, { shopId: input.custom_shop_id ?? null });
  const after = getProduct(id);
  audit(actor, 'product.updated', 'product', id, before, { ...after, removed_variants: removed, option_renames: input.option_renames ?? [], options_before: before.options });
  emit('product.updated', { entityType: 'product', entityId: id, data: after });
  return after;
}

// ---------- Giá theo kênh ----------
/** items: [{ shop_id, channel_id, variant_id, price }]; price = null xoá giá riêng (về giá niêm yết của shop) */
export function setChannelPrices(items, actor) {
  const at = nowIso();
  for (const it of items) {
    if (!db().prepare('SELECT 1 FROM variants WHERE id = ?').get(it.variant_id)) throw notFound(`Biến thể ${it.variant_id}`);
    if (!db().prepare('SELECT 1 FROM shops WHERE id = ?').get(it.shop_id)) throw notFound('Shop');
    if (!db().prepare('SELECT 1 FROM channels WHERE id = ?').get(it.channel_id)) throw badRequest('INVALID_CHANNEL', `Kênh ${it.channel_id} không tồn tại`);
    if (it.price === null) db().prepare('DELETE FROM channel_prices WHERE shop_id = ? AND channel_id = ? AND variant_id = ?').run(it.shop_id, it.channel_id, it.variant_id);
    else db().prepare('INSERT INTO channel_prices (variant_id, shop_id, channel_id, price, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(shop_id, channel_id, variant_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at').run(it.variant_id, it.shop_id, it.channel_id, it.price, at);
  }
  audit(actor, 'channel_prices.set', 'variant', items[0]?.variant_id ?? null, null, { count: items.length });
  return items.length;
}

export function listChannelPrices({ productId, variantId, shopId } = {}) {
  const where = [];
  const params = [];
  if (productId) (where.push('v.product_id = ?'), params.push(productId));
  if (variantId) (where.push('c.variant_id = ?'), params.push(variantId));
  if (shopId) (where.push('c.shop_id = ?'), params.push(shopId));
  return db().prepare(`SELECT c.* FROM channel_prices c JOIN variants v ON v.id = c.variant_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.shop_id, c.channel_id`).all(...params);
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
/**
 * Tìm biến thể để bán. Tồn tính theo phạm vi: `warehouse_id` nếu có; không thì mọi kho của shop (shop_id) — đúng với những kho
 * đơn có thể lấy hàng; không có cả hai thì mọi kho. Biến thể đơn và combo dùng cùng một phạm vi.
 * `on_hand_total` = tồn trên phạm vi shop/mọi kho (không phụ thuộc warehouse_id); `stock_by_warehouse` = từng kho của shop.
 */
export function searchVariants({ shopId, warehouseId, q, categoryId, limit = 30, onlyListed = true, channelId = null }) {
  const params = [shopId ?? null];
  const where = ["v.archived_at IS NULL", "p.archived_at IS NULL", "p.item_type = 'product'"];
  if (q) {
    where.push('(v.sku LIKE ? OR v.name LIKE ? OR p.name LIKE ? OR v.barcode = ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (shopId && onlyListed) where.push('l.id IS NOT NULL AND l.active = 1');
  const cat = categoryClause(categoryId);
  if (cat.sql) where.push(cat.sql.slice(5));
  const shopWh = shopId ? shopWarehouseIds(shopId) : null; // null = mọi kho
  const allWh = db().prepare('SELECT id, name FROM warehouses WHERE archived_at IS NULL ORDER BY name').all();
  const whNames = new Map(allWh.map((w) => [w.id, w.name]));
  const listed = shopWh ?? allWh.map((w) => w.id);
  const scope = warehouseId ? [warehouseId] : shopWh; // null = mọi kho
  const levels = db().prepare('SELECT warehouse_id, on_hand, avg_cost FROM stock_levels WHERE variant_id = ?');
  const sumOn = (variantId, ids) => levels.all(variantId).filter((x) => !ids || ids.includes(x.warehouse_id)).reduce((a, x) => a + x.on_hand, 0);
  // Giá vốn bình quân gia quyền các kho còn hàng; hết hàng thì lấy giá vốn lớn nhất đã biết
  const avgCost = (variantId, ids) => {
    const rows = levels.all(variantId).filter((x) => !ids || ids.includes(x.warehouse_id));
    const pos = rows.filter((x) => x.on_hand > 0);
    const n = pos.reduce((a, x) => a + x.on_hand, 0);
    return n > 0 ? Math.round(pos.reduce((a, x) => a + x.on_hand * x.avg_cost, 0) / n) : Math.max(0, ...rows.map((x) => x.avg_cost));
  };
  const onHandOf = (r, ids) => (r.kind === 'bundle' ? availableBundles(r.id, ids ?? undefined) : sumOn(r.id, ids));
  return db()
    .prepare(
      `SELECT v.id, v.sku, v.kind, v.name AS variant_name, v.barcode, v.default_price, v.min_stock,
              p.id AS product_id, p.name AS product_name, p.unit, p.is_service, COALESCE('/api/v1/files/images/' || v.image_id, p.image_url) AS image_url, v.option_values,
              COALESCE(l.price, v.default_price) AS price, l.active AS listed
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN shop_listings l ON l.variant_id = v.id AND l.shop_id = ?
       WHERE ${where.join(' AND ')}
       ORDER BY p.name, v.sku LIMIT ?`,
    )
    .all(...params, ...cat.params, limit)
    .map((r) => {
      const comps = r.kind === 'bundle' ? componentsOf(r.id) : null;
      // Giá riêng theo kênh (nếu có) thay giá niêm yết của shop
      const cp = channelId && shopId ? db().prepare('SELECT price FROM channel_prices WHERE shop_id = ? AND channel_id = ? AND variant_id = ?').get(shopId, channelId, r.id) : null;
      return {
        ...r,
        ...(cp ? { price: cp.price, price_source: 'channel' } : { price_source: 'shop' }),
        option_values: r.option_values ? JSON.parse(r.option_values) : null,
        on_hand: onHandOf(r, scope),
        on_hand_total: onHandOf(r, shopWh),
        avg_cost: comps ? comps.reduce((a, c) => a + c.qty * avgCost(c.component_variant_id, scope), 0) : avgCost(r.id, scope),
        stock_by_warehouse: listed.map((w) => ({ warehouse_id: w, warehouse_name: whNames.get(w), on_hand: onHandOf(r, [w]) })),
      };
    });
}

function costOf(variantId, warehouseId) {
  return db().prepare(`SELECT COALESCE(${warehouseId ? 'avg_cost' : 'MAX(avg_cost)'},0) AS c FROM stock_levels WHERE variant_id = ? ${warehouseId ? 'AND warehouse_id = ?' : ''}`).get(...(warehouseId ? [variantId, warehouseId] : [variantId]))?.c ?? 0;
}
