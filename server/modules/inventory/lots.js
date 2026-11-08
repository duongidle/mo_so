import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { getSetting } from '../settings/service.js';

const db = () => getDb();
const r3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

export function addLot({ warehouseId, variantId, qty, lotNo, expiryDate, receivedAt, refType, refId, refLineId }) {
  if (!(qty > EPS) || (!lotNo && !expiryDate)) return;
  db()
    .prepare('INSERT INTO stock_lots (id, warehouse_id, variant_id, lot_no, expiry_date, qty, received_at, ref_type, ref_id, ref_line_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(newId('lot'), warehouseId, variantId, lotNo ?? null, expiryDate ?? null, r3(qty), receivedAt ?? nowIso(), refType ?? null, refId ?? null, refLineId ?? null);
}

/**
 * Xuất `qty` từ các lô: lô hết hạn sớm nhất trước (FEFO); lô không ghi hạn sau cùng. `firstRef` = lô của một phiếu nhập cụ thể được lấy trước (huỷ phiếu).
 * Phần không thuộc lô nào (hàng nhập không ghi lô, tồn đầu kỳ…) bỏ qua: sổ lô chỉ là sổ phụ.
 */
export function consumeLots(warehouseId, variantId, qty, firstRef) {
  const lots = db()
    .prepare('SELECT * FROM stock_lots WHERE warehouse_id = ? AND variant_id = ? AND qty > 0 ORDER BY expiry_date IS NULL, expiry_date, received_at, rowid')
    .all(warehouseId, variantId);
  if (firstRef) lots.sort((a, b) => Number(b.ref_id === firstRef.refId && b.ref_line_id === firstRef.refLineId) - Number(a.ref_id === firstRef.refId && a.ref_line_id === firstRef.refLineId));
  const out = [];
  let need = r3(qty);
  for (const l of lots) {
    if (need <= EPS) break;
    const take = Math.min(need, l.qty);
    out.push({ lot_no: l.lot_no, expiry_date: l.expiry_date, qty: r3(take), received_at: l.received_at });
    const left = r3(l.qty - take);
    if (left <= EPS) db().prepare('DELETE FROM stock_lots WHERE id = ?').run(l.id);
    else db().prepare('UPDATE stock_lots SET qty = ? WHERE id = ?').run(left, l.id);
    need = r3(need - take);
  }
  return out;
}

/** Danh sách lô còn hàng. withinDays: chỉ lô hết hạn trong N ngày tới (kèm lô đã quá hạn). */
export function listLots({ warehouseId, variantId, withinDays, shopWarehouseIds, limit = 300 } = {}) {
  const where = ['l.qty > 0'];
  const params = [];
  if (warehouseId) (where.push('l.warehouse_id = ?'), params.push(warehouseId));
  if (variantId) (where.push('l.variant_id = ?'), params.push(variantId));
  if (shopWarehouseIds?.length) (where.push(`l.warehouse_id IN (${shopWarehouseIds.map(() => '?').join(',')})`), params.push(...shopWarehouseIds));
  const today = businessDate(nowIso());
  if (withinDays != null) (where.push('l.expiry_date IS NOT NULL AND l.expiry_date <= ?'), params.push(addDays(today, withinDays)));
  const warn = getSetting('expiry_warn_days') || 30;
  return db()
    .prepare(
      `SELECT l.*, v.sku, v.name AS variant_name, p.name AS product_name, w.name AS warehouse_name,
              COALESCE((SELECT avg_cost FROM stock_levels s WHERE s.warehouse_id = l.warehouse_id AND s.variant_id = l.variant_id), 0) AS avg_cost
       FROM stock_lots l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id JOIN warehouses w ON w.id = l.warehouse_id
       WHERE ${where.join(' AND ')} ORDER BY l.expiry_date IS NULL, l.expiry_date, l.received_at LIMIT ?`,
    )
    .all(...params, limit)
    .map((l) => {
      const days = l.expiry_date ? Math.round((new Date(`${l.expiry_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null;
      return { ...l, days_left: days, status: days === null ? 'no_expiry' : days < 0 ? 'expired' : days <= warn ? 'expiring' : 'ok', value: Math.round(l.qty * l.avg_cost) };
    });
}

export function lotSummary({ shopWarehouseIds } = {}) {
  const lots = listLots({ shopWarehouseIds, limit: 5000 });
  const sum = (s) => lots.filter((l) => l.status === s).reduce((a, l) => ({ lots: a.lots + 1, qty: a.qty + l.qty, value: a.value + l.value }), { lots: 0, qty: 0, value: 0 });
  return { expired: sum('expired'), expiring: sum('expiring'), warn_days: getSetting('expiry_warn_days') || 30 };
}

/** Đối chiếu: Σ lô của một (kho, biến thể) không được vượt tồn */
export function verifyLots() {
  return db()
    .prepare(
      `SELECT l.warehouse_id, l.variant_id, ROUND(SUM(l.qty),3) AS lots, COALESCE(s.on_hand,0) AS on_hand FROM stock_lots l
       LEFT JOIN stock_levels s ON s.warehouse_id = l.warehouse_id AND s.variant_id = l.variant_id GROUP BY 1,2 HAVING lots > on_hand + 0.0005`,
    )
    .all()
    .map((r) => ({ kind: 'stock_lots_exceed', ...r }));
}
