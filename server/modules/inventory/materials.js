import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { runningCode } from '../../lib/codes.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { applyMovement } from './service.js';
import { listStock } from './service.js';

const db = () => getDb();

function assertMaterial(variantId, requiredType) {
  const row = db().prepare('SELECT v.id, v.sku, p.item_type, p.unit, p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.archived_at IS NULL AND p.archived_at IS NULL').get(variantId);
  if (!row) throw notFound('Mặt hàng');
  if (!['packaging', 'supply'].includes(row.item_type) || (requiredType && row.item_type !== requiredType)) throw badRequest('NOT_MATERIAL', 'Chỉ chọn vật liệu đóng gói hoặc vật tư vận hành');
  if (db().prepare("SELECT 1 FROM variants WHERE id=? AND kind='bundle'").get(variantId)) throw badRequest('BUNDLE_NO_STOCK', 'Combo không thể là vật tư tiêu hao');
  return row;
}

export function savePackagingSpec(productId, lines, actor) {
  const product = db().prepare("SELECT id FROM products WHERE id=? AND item_type='product' AND archived_at IS NULL").get(productId);
  if (!product) throw notFound('Sản phẩm bán');
  const unique = new Set();
  for (const l of lines) {
    if (unique.has(l.material_variant_id)) throw badRequest('DUPLICATE_MATERIAL', 'Vật tư bị lặp trong định mức');
    unique.add(l.material_variant_id);
    assertMaterial(l.material_variant_id, 'packaging');
    if (!Number.isFinite(l.qty) || l.qty <= 0 || Math.abs(l.qty * 1000 - Math.round(l.qty * 1000)) > 1e-7) throw badRequest('INVALID_QTY', 'Định mức phải dương, tối đa 3 chữ số thập phân');
  }
  db().prepare('DELETE FROM packaging_specs WHERE product_id=?').run(productId);
  const at = nowIso();
  const ins = db().prepare('INSERT INTO packaging_specs (id, product_id, material_variant_id, qty, created_at, updated_at) VALUES (?,?,?,?,?,?)');
  for (const l of lines) ins.run(newId('pspec'), productId, l.material_variant_id, l.qty, at, at);
  audit(actor, 'inventory.packaging_spec.updated', 'product', productId, null, { lines });
  return getPackagingSpec(productId);
}

export function getPackagingSpec(productId) {
  return db().prepare(`SELECT s.*, v.sku, v.name AS variant_name, p.name AS material_name, p.unit
    FROM packaging_specs s JOIN variants v ON v.id=s.material_variant_id JOIN products p ON p.id=v.product_id
    WHERE s.product_id=? ORDER BY p.name,v.sku`).all(productId);
}

export function packagingPlan(orderId) {
  const order = db().prepare('SELECT id, code, status FROM orders WHERE id=?').get(orderId);
  if (!order) throw notFound('Đơn hàng');
  const lines = db().prepare(`SELECT ol.variant_id, ol.qty, p.id AS product_id, p.name AS product_name
    FROM order_lines ol JOIN variants v ON v.id=ol.variant_id JOIN products p ON p.id=v.product_id WHERE ol.order_id=?`).all(orderId);
  const agg = new Map();
  for (const line of lines) for (const spec of getPackagingSpec(line.product_id)) {
    const x = agg.get(spec.material_variant_id) || { variant_id: spec.material_variant_id, sku: spec.sku, name: spec.material_name, unit: spec.unit, qty: 0 };
    x.qty += spec.qty * line.qty;
    agg.set(spec.material_variant_id, x);
  }
  const confirmed = db().prepare('SELECT id, created_at FROM packaging_runs WHERE order_id=?').get(orderId) || null;
  return { order, lines: [...agg.values()], confirmed };
}

export function confirmPackaging({ orderId, warehouseId, shopId, lines, note }, actor) {
  const existing = db().prepare('SELECT * FROM packaging_runs WHERE order_id=?').get(orderId);
  if (existing) return { ...existing, replayed: true };
  const order = db().prepare('SELECT id, code, status, shop_id FROM orders WHERE id=?').get(orderId);
  if (!order) throw notFound('Đơn hàng');
  if (!['confirmed', 'shipping', 'completed', 'returned'].includes(order.status)) throw conflict('ORDER_NOT_READY', 'Chỉ xác nhận tiêu hao cho đơn đã xác nhận');
  if (!db().prepare('SELECT 1 FROM warehouses WHERE id=? AND archived_at IS NULL').get(warehouseId)) throw notFound('Kho');
  if (!lines.length) throw badRequest('EMPTY_PACKAGING', 'Cần có ít nhất một vật tư đã sử dụng');
  const runId = newId('packrun');
  const at = nowIso();
  db().prepare('INSERT INTO packaging_runs (id, order_id, warehouse_id, shop_id, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?)').run(runId, orderId, warehouseId, shopId ?? order.shop_id ?? null, note ?? null, actor?.id ?? null, at);
  for (const [i, line] of lines.entries()) {
    assertMaterial(line.variant_id, 'packaging');
    if (!Number.isFinite(line.qty) || line.qty <= 0 || Math.abs(line.qty * 1000 - Math.round(line.qty * 1000)) > 1e-7) throw badRequest('INVALID_QTY', 'Số lượng phải dương, tối đa 3 chữ số thập phân');
    applyMovement({ warehouseId, variantId: line.variant_id, type: 'adjust_out', qty: line.qty, refType: 'packaging_run', refId: runId, refLineId: `${i + 1}`, shopId: shopId ?? order.shop_id ?? null, note: `Đóng gói đơn ${order.code}${note ? ` · ${note}` : ''}`, actorId: actor?.id, at, expenseAccountCode: '6414' });
  }
  audit(actor, 'inventory.packaging.confirmed', 'packaging_run', runId, null, { order_id: orderId, lines });
  return { ...db().prepare('SELECT * FROM packaging_runs WHERE id=?').get(runId), replayed: false };
}

export function issueMaterials({ warehouseId, purpose, accountCode = '6428', shopId, lines }, actor) {
  if (!db().prepare('SELECT 1 FROM warehouses WHERE id=? AND archived_at IS NULL').get(warehouseId)) throw notFound('Kho');
  if (!['6414', '6418', '6428', '6422'].includes(accountCode)) throw badRequest('INVALID_EXPENSE_ACCOUNT', 'Tài khoản chi phí vật tư không hợp lệ');
  if (!lines.length) throw badRequest('EMPTY_ISSUE', 'Cần ít nhất một dòng vật tư');
  const id = newId('matissue');
  const code = runningCode('MI');
  const at = nowIso();
  db().prepare('INSERT INTO material_issues (id, code, warehouse_id, purpose, expense_account_code, shop_id, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, code, warehouseId, purpose, accountCode, shopId ?? null, actor?.id ?? null, at);
  for (const [i, l] of lines.entries()) {
    assertMaterial(l.variant_id);
    if (!Number.isFinite(l.qty) || l.qty <= 0 || Math.abs(l.qty * 1000 - Math.round(l.qty * 1000)) > 1e-7) throw badRequest('INVALID_QTY', 'Số lượng phải dương, tối đa 3 chữ số thập phân');
    applyMovement({ warehouseId, variantId: l.variant_id, type: 'adjust_out', qty: l.qty, refType: 'material_issue', refId: id, refLineId: `${i + 1}`, shopId: shopId ?? null, note: purpose, actorId: actor?.id, at, expenseAccountCode: accountCode });
  }
  audit(actor, 'inventory.material_issued', 'material_issue', id, null, { code, purpose, lines });
  return db().prepare('SELECT * FROM material_issues WHERE id=?').get(id);
}

export function materialConsumption({ from, to, warehouseId } = {}) {
  const where = ["m.type='adjust_out'", "m.ref_type IN ('packaging_run','material_issue')"];
  const params = [];
  if (from) { where.push('m.business_date >= ?'); params.push(from); }
  if (to) { where.push('m.business_date <= ?'); params.push(to); }
  if (warehouseId) { where.push('m.warehouse_id = ?'); params.push(warehouseId); }
  return db().prepare(`SELECT m.business_date, m.ref_type, m.ref_id, m.shop_id, m.qty, m.unit_cost,
    ABS(m.qty)*m.unit_cost AS amount, m.expense_account_code, v.sku, v.name AS variant_name,
    p.name AS product_name, p.unit, pr.code AS order_code, mi.code AS issue_code, mi.purpose
    FROM stock_movements m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id
    LEFT JOIN packaging_runs r ON r.id=m.ref_id AND m.ref_type='packaging_run'
    LEFT JOIN orders pr ON pr.id=r.order_id
    LEFT JOIN material_issues mi ON mi.id=m.ref_id AND m.ref_type='material_issue'
    WHERE ${where.join(' AND ')} ORDER BY m.business_date DESC,m.id DESC LIMIT 2000`).all(...params);
}

export function inventoryReport({ from, to, warehouseId } = {}) {
  const items = listStock({ warehouseId, limit: 5000 });
  const period = db().prepare(`SELECT variant_id,
      SUM(CASE WHEN ? IS NOT NULL AND business_date < ? THEN qty ELSE 0 END) AS opening_qty,
      SUM(CASE WHEN (? IS NULL OR business_date >= ?) AND (? IS NULL OR business_date <= ?) AND qty>0 THEN qty ELSE 0 END) AS in_qty,
      -SUM(CASE WHEN (? IS NULL OR business_date >= ?) AND (? IS NULL OR business_date <= ?) AND qty<0 THEN qty ELSE 0 END) AS out_qty,
      SUM(CASE WHEN ? IS NULL OR business_date <= ? THEN qty ELSE 0 END) AS ending_qty
    FROM stock_movements WHERE (? IS NULL OR warehouse_id=?) GROUP BY variant_id`).all(
      from ?? null, from ?? null, from ?? null, from ?? null, to ?? null, to ?? null,
      from ?? null, from ?? null, to ?? null, to ?? null, to ?? null, to ?? null,
      warehouseId ?? null, warehouseId ?? null,
    );
  const periodMap = new Map(period.map((x) => [x.variant_id, x]));
  const selected = items.map((x) => {
    const p = periodMap.get(x.variant_id) || { in_qty: 0, out_qty: 0 };
    return { ...x, opening_qty: p.opening_qty ?? 0, ending_qty: to ? p.ending_qty ?? 0 : x.on_hand, in_qty: p.in_qty ?? 0, out_qty: p.out_qty ?? 0, low: x.on_hand <= x.min_stock };
  });
  const ledger = db().prepare("SELECT COALESCE(SUM(debit-credit),0) AS value FROM journal_lines WHERE account_code='156'").get().value;
  const inventoryValue = selected.reduce((sum, x) => sum + x.stock_value, 0);
  return { items: selected, summary: { item_count: selected.length, on_hand_qty: selected.reduce((s,x)=>s+x.on_hand,0), inventory_value: inventoryValue, low_stock_count: selected.filter(x=>x.low).length, ledger_156_value: ledger, valuation_difference: inventoryValue-ledger }, aging_available: false, aging_reason: 'Chưa theo dõi tồn theo lô nhập; không gán ngày nhập suy đoán.', valuation_as_of: 'today', period: { from: from ?? null, to: to ?? null } };
}
