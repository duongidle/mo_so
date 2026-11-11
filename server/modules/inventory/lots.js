import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { getSetting } from '../settings/service.js';
import { lineAmount } from '../../lib/money.js';

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
export function consumeLots(warehouseId, variantId, qty, firstRef, onlyLotId = null) {
  let lots = db()
    .prepare('SELECT * FROM stock_lots WHERE warehouse_id = ? AND variant_id = ? AND qty > 0 ORDER BY expiry_date IS NULL, expiry_date, received_at, rowid')
    .all(warehouseId, variantId);
  if (onlyLotId) lots = lots.filter((l) => l.id === onlyLotId); // xuất huỷ đúng một lô, không theo FEFO
  if (firstRef) lots.sort((a, b) => Number(b.ref_id === firstRef.refId && b.ref_line_id === firstRef.refLineId) - Number(a.ref_id === firstRef.refId && a.ref_line_id === firstRef.refLineId));
  const out = [];
  let need = r3(qty);
  for (const l of lots) {
    if (need <= EPS) break;
    const take = Math.min(need, l.qty);
    out.push({ lot_no: l.lot_no, expiry_date: l.expiry_date, qty: r3(take), received_at: l.received_at, ref_type: l.ref_type, ref_id: l.ref_id, ref_line_id: l.ref_line_id });
    const left = r3(l.qty - take);
    if (left <= EPS) db().prepare('DELETE FROM stock_lots WHERE id = ?').run(l.id);
    else db().prepare('UPDATE stock_lots SET qty = ? WHERE id = ?').run(left, l.id);
    need = r3(need - take);
  }
  return out;
}

/**
 * Xem trước các lô mà một danh sách lần xuất [{ warehouse_id, variant_id, sku?, qty }] sẽ lấy theo FEFO (đúng thứ tự consumeLots), KHÔNG ghi gì.
 * Hai dòng cùng (kho, biến thể) lấy tiếp từ phần còn lại của dòng trước. Mỗi phần tử: { warehouse_id, variant_id, sku, lot_id, lot_no, expiry_date, qty, days_left,
 * status: 'expired' | 'expiring' | 'ok' }; expired = hạn < hôm nay giờ VN, expiring = còn ≤ expiry_warn_days ngày. Lô không ghi hạn luôn 'ok'.
 */
export function fefoPreview(items) {
  const today = businessDate(nowIso());
  const warn = getSetting('expiry_warn_days') || 30;
  const left = new Map(); // lot_id → còn lại sau các lần xuất ảo trước
  const out = [];
  const sel = db().prepare('SELECT * FROM stock_lots WHERE warehouse_id = ? AND variant_id = ? AND qty > 0 ORDER BY expiry_date IS NULL, expiry_date, received_at, rowid');
  const skus = new Map();
  for (const it of items) {
    if (!skus.has(it.variant_id)) skus.set(it.variant_id, it.sku ?? db().prepare('SELECT sku FROM variants WHERE id = ?').get(it.variant_id)?.sku);
    let need = r3(it.qty);
    for (const l of sel.all(it.warehouse_id, it.variant_id)) {
      if (need <= EPS) break;
      const have = left.has(l.id) ? left.get(l.id) : l.qty;
      if (have <= EPS) continue;
      const take = Math.min(need, have);
      left.set(l.id, r3(have - take));
      need = r3(need - take);
      const days = l.expiry_date ? Math.round((new Date(`${l.expiry_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null;
      out.push({ warehouse_id: it.warehouse_id, variant_id: it.variant_id, sku: skus.get(it.variant_id), lot_id: l.id, lot_no: l.lot_no, expiry_date: l.expiry_date, qty: r3(take), days_left: days, status: days === null ? 'ok' : days < 0 ? 'expired' : days <= warn ? 'expiring' : 'ok' });
    }
  }
  return out;
}

/**
 * Ghi lại các lô một lần xuất kho cho dòng đơn đã lấy (kết quả của consumeLots), để nhập lại đúng lô.
 */
export function recordOrderLots({ orderLineId, variantId, warehouseId, lots }) {
  const ins = db().prepare('INSERT INTO order_line_lots (id, order_line_id, variant_id, warehouse_id, lot_no, expiry_date, received_at, ref_type, ref_id, ref_line_id, qty, restocked_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)');
  for (const l of lots ?? []) ins.run(newId('oll'), orderLineId, variantId, warehouseId, l.lot_no ?? null, l.expiry_date ?? null, l.received_at ?? nowIso(), l.ref_type ?? null, l.ref_id ?? null, l.ref_line_id ?? null, l.qty);
}

/** Xoá dấu vết lô của các dòng đơn (khi dòng bị thay thế lúc sửa đơn đã xác nhận, sau khi hàng đã nhập lại). */
export function forgetOrderLots(orderLineId) {
  db().prepare('DELETE FROM order_line_lots WHERE order_line_id = ?').run(orderLineId);
}

/**
 * Nhập lại `qty` của một dòng đơn vào các lô nó đã lấy. QUY TẮC: lô lấy SAU CÙNG được trả trước (LIFO, cùng chiều với việc
 * nhập lại phân bổ giá vốn). Vì xuất theo FEFO nên lô lấy sau cùng là lô hạn xa nhất.
 * Hàng cộng vào kho `destWarehouseId` (kho nhận có thể khác kho đã xuất). Gọi SAU khi tồn đã được cộng: phần cộng vào lô không bao giờ
 * vượt tồn còn trống lô (đang âm kho thì phần bù chỗ âm không thuộc lô nào). Đơn cũ không có dấu vết lô: không làm gì.
 * Trả về số lượng đã đưa lại vào lô.
 */
export function restoreOrderLots({ orderLineId, variantId, srcWarehouseId, destWarehouseId, qty }) {
  const rows = db()
    .prepare('SELECT * FROM order_line_lots WHERE order_line_id = ? AND variant_id = ? AND warehouse_id = ? AND qty - restocked_qty > ? ORDER BY rowid DESC')
    .all(orderLineId, variantId, srcWarehouseId, EPS);
  if (!rows.length) return 0;
  const onHand = db().prepare('SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(destWarehouseId, variantId)?.on_hand ?? 0;
  const inLots = db().prepare('SELECT COALESCE(SUM(qty),0) AS n FROM stock_lots WHERE warehouse_id = ? AND variant_id = ?').get(destWarehouseId, variantId).n;
  let room = r3(Math.max(0, onHand - inLots));
  let need = r3(qty);
  let done = 0;
  for (const r of rows) {
    if (need <= EPS || room <= EPS) break;
    const t = Math.min(need, r3(r.qty - r.restocked_qty), room);
    const ex = db()
      .prepare('SELECT * FROM stock_lots WHERE warehouse_id = ? AND variant_id = ? AND lot_no IS ? AND expiry_date IS ? ORDER BY rowid LIMIT 1')
      .get(destWarehouseId, variantId, r.lot_no, r.expiry_date);
    if (ex) db().prepare('UPDATE stock_lots SET qty = ? WHERE id = ?').run(r3(ex.qty + t), ex.id);
    else {
      db()
        .prepare('INSERT INTO stock_lots (id, warehouse_id, variant_id, lot_no, expiry_date, qty, received_at, ref_type, ref_id, ref_line_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(newId('lot'), destWarehouseId, variantId, r.lot_no, r.expiry_date, r3(t), r.received_at, r.ref_type, r.ref_id, r.ref_line_id);
    }
    db().prepare('UPDATE order_line_lots SET restocked_qty = ? WHERE id = ?').run(r3(r.restocked_qty + t), r.id);
    need = r3(need - t);
    room = r3(room - t);
    done = r3(done + t);
  }
  return done;
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
      return { ...l, days_left: days, status: days === null ? 'no_expiry' : days < 0 ? 'expired' : days <= warn ? 'expiring' : 'ok', value: lineAmount(l.qty, l.avg_cost) };
    });
}

export function lotSummary({ shopWarehouseIds } = {}) {
  const lots = listLots({ shopWarehouseIds, limit: 5000 });
  const sum = (s) => lots.filter((l) => l.status === s).reduce((a, l) => ({ lots: a.lots + 1, qty: r3(a.qty + l.qty), value: a.value + l.value }), { lots: 0, qty: 0, value: 0 });
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
