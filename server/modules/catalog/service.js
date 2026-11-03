import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { componentsOf, setComponents, availableBundles, assertKindChangeAllowed } from './bundles.js';
import { badRequest, notFound } from '../../lib/errors.js';

const db = () => getDb();
const json = (v) => (v == null ? null : JSON.stringify(v));
const parseJson = (v) => (v ? JSON.parse(v) : []);

// ---------- Danh mục ----------
export function listCategories() {
  return db().prepare('SELECT * FROM categories WHERE archived_at IS NULL ORDER BY sort_order, name').all();
}

export function createCategory(input, actor) {
  const id = newId('cat');
  const at = nowIso();
  db()
    .prepare('INSERT INTO categories (id, parent_id, name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, input.parent_id ?? null, input.name, input.sort_order ?? 0, at, at);
  audit(actor, 'category.created', 'category', id, null, input);
  return db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

export function updateCategory(id, input, actor) {
  const before = db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!before) throw notFound('Danh mục');
  const n = { ...before, ...input, updated_at: nowIso() };
  db()
    .prepare('UPDATE categories SET parent_id=?, name=?, sort_order=?, archived_at=?, updated_at=? WHERE id=?')
    .run(n.parent_id, n.name, n.sort_order, n.archived_at, n.updated_at, id);
  audit(actor, 'category.updated', 'category', id, before, n);
  return db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

// ---------- Sản phẩm ----------
function hydrateProduct(p) {
  if (!p) return null;
  const variants = db()
    .prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY created_at')
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
  return {
    ...p,
    elements: parseJson(p.elements),
    tags: parseJson(p.tags),
    variants: variants.map((v) => ({
      ...v,
      ...(v.kind === 'bundle' ? { components: componentsOf(v.id), available: availableBundles(v.id) } : {}),
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

/** Danh sách sản phẩm. Nếu có shopId: chỉ sản phẩm có niêm yết ở shop đó (trừ khi includeUnlisted). */
export function listProducts({ shopId, q, categoryId, includeArchived, includeUnlisted, limit = 50, cursor }) {
  const where = [];
  const params = [];
  if (!includeArchived) where.push('p.archived_at IS NULL');
  if (categoryId) {
    where.push('p.category_id = ?');
    params.push(categoryId);
  }
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
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

function insertVariant(productId, v, at) {
  const id = newId('var');
  db()
    .prepare(
      `INSERT INTO variants (id, product_id, sku, name, barcode, default_price, min_stock, weight_gram, kind, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, productId, v.sku.trim().toUpperCase(), v.name ?? null, v.barcode ?? null, v.default_price ?? 0, v.min_stock ?? 0, v.weight_gram ?? null, v.kind === 'bundle' ? 'bundle' : 'single', at, at);
  if (v.kind === 'bundle') setComponents(id, v.components);
  else if (v.components?.length) throw badRequest('NOT_BUNDLE', 'Chỉ combo mới có thành phần');
  return id;
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
  const id = newId('prd');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO products (id, name, description, category_id, unit, image_url, brand, consumption_days, elements, tags, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.name, input.description ?? null, input.category_id ?? null, input.unit ?? 'cái', input.image_url ?? null, input.brand ?? null, input.consumption_days ?? null, json(input.elements ?? []), json(input.tags ?? []), at, at);
  for (const v of input.variants) {
    const vid = insertVariant(id, v, at);
    for (const shopId of input.shop_ids ?? []) upsertListing(shopId, vid, v.default_price ?? 0);
  }
  const p = getProduct(id);
  audit(actor, 'product.created', 'product', id, null, p);
  emit('product.created', { entityType: 'product', entityId: id, data: p });
  return p;
}

const PRODUCT_FIELDS = ['name', 'description', 'category_id', 'unit', 'image_url', 'brand', 'consumption_days', 'elements', 'tags', 'archived_at'];

export function updateProduct(id, input, actor) {
  const before = getProduct(id);
  const at = nowIso();
  const next = { ...before };
  for (const f of PRODUCT_FIELDS) if (input[f] !== undefined) next[f] = input[f];
  db()
    .prepare(`UPDATE products SET ${PRODUCT_FIELDS.map((f) => `${f}=?`).join(', ')}, updated_at=? WHERE id=?`)
    .run(...PRODUCT_FIELDS.map((f) => (f === 'elements' || f === 'tags' ? json(next[f]) : next[f])), at, id);

  // Biến thể: có id = cập nhật, không id = thêm mới. Không xoá biến thể (chỉ lưu trữ).
  for (const v of input.variants ?? []) {
    if (v.id) {
      const cur = db().prepare('SELECT * FROM variants WHERE id = ? AND product_id = ?').get(v.id, id);
      if (!cur) throw notFound('Biến thể');
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
      db()
        .prepare('UPDATE variants SET sku=?, name=?, barcode=?, default_price=?, min_stock=?, weight_gram=?, archived_at=?, updated_at=? WHERE id=?')
        .run(n.sku, n.name, n.barcode, n.default_price, n.min_stock, n.weight_gram, n.archived_at ?? null, at, v.id);
    } else {
      insertVariant(id, v, at);
    }
  }
  const after = getProduct(id);
  audit(actor, 'product.updated', 'product', id, before, after);
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
export function searchVariants({ shopId, warehouseId, q, limit = 30, onlyListed = true }) {
  const params = [shopId ?? null, warehouseId ?? null];
  const where = ['v.archived_at IS NULL', 'p.archived_at IS NULL'];
  if (q) {
    where.push('(v.sku LIKE ? OR v.name LIKE ? OR p.name LIKE ? OR v.barcode = ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (shopId && onlyListed) where.push('l.id IS NOT NULL AND l.active = 1');
  return db()
    .prepare(
      `SELECT v.id, v.sku, v.kind, v.name AS variant_name, v.barcode, v.default_price, v.min_stock,
              p.id AS product_id, p.name AS product_name, p.unit, p.image_url,
              COALESCE(l.price, v.default_price) AS price, l.active AS listed,
              COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.avg_cost, 0) AS avg_cost
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN shop_listings l ON l.variant_id = v.id AND l.shop_id = ?
       LEFT JOIN stock_levels s ON s.variant_id = v.id AND s.warehouse_id = ?
       WHERE ${where.join(' AND ')}
       ORDER BY p.name, v.sku LIMIT ?`,
    )
    .all(...params, limit)
    .map((r) => (r.kind === 'bundle' ? { ...r, on_hand: availableBundles(r.id, warehouseId), avg_cost: componentsOf(r.id).reduce((a, c) => a + c.qty * (costOf(c.component_variant_id, warehouseId)), 0) } : r));
}

function costOf(variantId, warehouseId) {
  return db().prepare(`SELECT COALESCE(${warehouseId ? 'avg_cost' : 'MAX(avg_cost)'},0) AS c FROM stock_levels WHERE variant_id = ? ${warehouseId ? 'AND warehouse_id = ?' : ''}`).get(...(warehouseId ? [variantId, warehouseId] : [variantId]))?.c ?? 0;
}
