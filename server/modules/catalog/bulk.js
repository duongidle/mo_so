import { getDb } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { createProduct, createCategory } from './service.js';

const db = () => getDb();
const norm = (s) => String(s ?? '').trim().toLowerCase();
const ITEM_TYPES = { 'dịch vụ': 'service', 'dich vu': 'service', service: 'service', 'hàng bán': 'product', 'hang ban': 'product', product: 'product', 'đóng gói': 'packaging', 'dong goi': 'packaging', packaging: 'packaging', 'vận hành': 'supply', 'van hanh': 'supply', supply: 'supply' };
const MAX_ROWS = 2000;
const int = (v) => (v === '' || v == null ? null : Number(v));

/**
 * Chuẩn hoá các dòng file thành nhóm sản phẩm. Các dòng cùng tên sản phẩm là các biến thể của một sản phẩm.
 * row: { name, sku, variant_name, price, cost, qty, warehouse, category, brand, unit, barcode, min_stock, warranty_days, description, item_type }
 */
export function planImport(rows, { warehouseId, shopIds = [] } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw badRequest('NO_ROWS', 'File không có dòng nào');
  if (rows.length > MAX_ROWS) throw badRequest('TOO_MANY_ROWS', `Tối đa ${MAX_ROWS} dòng mỗi lần nhập. Vui lòng chia file.`);
  const warehouses = db().prepare('SELECT id, name, code FROM warehouses WHERE archived_at IS NULL').all();
  const cats = db().prepare('SELECT id, name FROM categories WHERE archived_at IS NULL').all();
  const existingSku = new Set(db().prepare('SELECT sku FROM variants').all().map((r) => r.sku));
  const defaultWh = warehouseId ? warehouses.find((w) => w.id === warehouseId) : null;
  const groups = new Map();
  const errors = [];
  const seenSku = new Map();
  rows.forEach((raw, i) => {
    const line = i + 2; // dòng trong file (dòng 1 là tiêu đề)
    const bad = (message) => errors.push({ line, message });
    const name = String(raw.name ?? '').trim();
    const sku = String(raw.sku ?? '').trim().toUpperCase();
    if (!name && !sku) return; // dòng trống
    if (!name) return bad('Thiếu tên sản phẩm');
    if (!sku) return bad(`“${name}”: thiếu SKU`);
    if (seenSku.has(sku)) return bad(`SKU ${sku} bị trùng với dòng ${seenSku.get(sku)} trong file`);
    seenSku.set(sku, line);
    if (existingSku.has(sku)) return bad(`SKU ${sku} đã có trong hệ thống`);
    const price = int(raw.price) ?? 0;
    const cost = int(raw.cost);
    const qty = int(raw.qty) ?? 0;
    const minStock = int(raw.min_stock) ?? 0;
    if (![price, qty, minStock].every((n) => Number.isFinite(n) && n >= 0)) return bad(`SKU ${sku}: giá bán, tồn đầu kỳ, tồn tối thiểu phải là số không âm`);
    if (cost != null && !(Number.isFinite(cost) && cost >= 0)) return bad(`SKU ${sku}: giá vốn phải là số không âm`);
    const itemType = raw.item_type ? ITEM_TYPES[norm(raw.item_type)] : 'product';
    if (!itemType) return bad(`SKU ${sku}: loại “${raw.item_type}” không hợp lệ (Hàng bán, Dịch vụ, Đóng gói hoặc Vận hành)`);
    let wh = null;
    if (itemType === 'service' && qty > 0) return bad(`SKU ${sku}: dịch vụ không có tồn kho nên không có tồn đầu kỳ`);
    if (qty > 0) {
      wh = raw.warehouse ? warehouses.find((w) => norm(w.name) === norm(raw.warehouse) || norm(w.code) === norm(raw.warehouse)) : defaultWh;
      if (!wh) return bad(`SKU ${sku}: có tồn đầu kỳ ${qty} nhưng ${raw.warehouse ? `không có kho “${raw.warehouse}”` : 'chưa chọn kho nhận hàng'}`);
      if (cost == null) return bad(`SKU ${sku}: có tồn đầu kỳ thì cần nhập giá vốn`);
    }
    const key = norm(name);
    let g = groups.get(key);
    if (!g) {
      g = { name, item_type: itemType, category: String(raw.category ?? '').trim() || null, brand: String(raw.brand ?? '').trim() || null, unit: String(raw.unit ?? '').trim() || 'cái', description: String(raw.description ?? '').trim() || null, warranty_days: int(raw.warranty_days) || null, variants: [], first_line: line };
      groups.set(key, g);
    }
    g.variants.push({ line, sku, name: String(raw.variant_name ?? '').trim() || null, barcode: String(raw.barcode ?? '').trim() || null, default_price: price, min_stock: minStock, opening_qty: qty, opening_cost: cost ?? 0, opening_warehouse_id: wh?.id });
  });
  const list = [...groups.values()];
  const newCategories = [...new Set(list.map((g) => g.category).filter((c) => c && !cats.some((x) => norm(x.name) === norm(c))))];
  return { products: list, errors, new_categories: newCategories, shop_ids: shopIds, summary: { products: list.length, variants: list.reduce((a, g) => a + g.variants.length, 0), errors: errors.length, new_categories: newCategories.length } };
}

/** Tạo các sản phẩm hợp lệ. Mỗi sản phẩm là một điểm lưu riêng: một sản phẩm lỗi không làm hỏng các sản phẩm khác. */
export function runImport(rows, opts, actor) {
  const plan = planImport(rows, opts);
  const catId = new Map(db().prepare('SELECT id, name FROM categories WHERE archived_at IS NULL').all().map((c) => [norm(c.name), c.id]));
  const created = [];
  const failed = [];
  for (const g of plan.products) {
    try {
      db().transaction(() => {
        let category_id = null;
        if (g.category) {
          category_id = catId.get(norm(g.category)) ?? null;
          if (!category_id) { category_id = createCategory({ name: g.category }, actor).id; catId.set(norm(g.category), category_id); }
        }
        const p = createProduct({
          name: g.name, description: g.description, category_id, unit: g.unit, brand: g.brand, warranty_days: g.item_type === 'product' || g.item_type === 'service' ? g.warranty_days : null, item_type: g.item_type,
          shop_ids: g.item_type === 'product' || g.item_type === 'service' ? opts.shopIds ?? [] : [],
          variants: g.variants.map(({ line, ...v }) => ({ ...v, opening_qty: v.opening_qty || undefined, opening_cost: v.opening_qty ? v.opening_cost : undefined })),
        }, actor);
        created.push({ id: p.id, name: g.name, variants: g.variants.length });
      })();
    } catch (e) {
      failed.push({ line: g.first_line, name: g.name, message: e.message });
    }
  }
  return { created, failed, skipped: plan.errors, summary: { created: created.length, variants: created.reduce((a, c) => a + c.variants, 0), failed: failed.length, skipped: plan.errors.length } };
}
