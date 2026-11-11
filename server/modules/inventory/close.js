import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { today as clockToday } from '../../lib/clock.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, emit } from '../../lib/events.js';
import { writeSetting } from '../settings/service.js';
import { stockLockDate } from '../../lib/stockperiod.js';

const db = () => getDb();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());

/** Tồn và giá trị từng kho × biến thể đến hết ngày `date`, tính lại từ sổ kho (không phụ thuộc thứ tự ghi). */
export function balancesAt(date) {
  return db()
    .prepare(
      `SELECT warehouse_id, variant_id, ROUND(SUM(qty), 3) AS qty, CAST(SUM(ROUND(ROUND(qty * 1000) * unit_cost / 1000.0)) AS INTEGER) AS value
       FROM stock_movements WHERE business_date <= ?
       GROUP BY warehouse_id, variant_id HAVING qty != 0 OR value != 0
       ORDER BY warehouse_id, variant_id`,
    )
    .all(date);
}

const hashOf = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.warehouse_id, r.variant_id, r.qty, r.value]))).digest('hex');
const totalsOf = (rows) => ({ line_count: rows.length, total_qty: Math.round(rows.reduce((a, r) => a + r.qty, 0) * 1000) / 1000, total_value: rows.reduce((a, r) => a + r.value, 0) });

/** Lần chốt đang có hiệu lực: bản ghi mới nhất chưa bị mở lại */
function activeClose() {
  return db().prepare('SELECT * FROM stock_closes WHERE reopened_at IS NULL ORDER BY close_date DESC, taken_at DESC LIMIT 1').get() || null;
}

/** Xem trước một ngày chốt: danh sách việc phải xong (chặn) và việc nên xem (cảnh báo), cùng số tồn sẽ chụp */
export function previewClose(date) {
  if (!validDate(date)) throw badRequest('INVALID_DATE', 'Ngày chốt kho phải là YYYY-MM-DD');
  const today = clockToday();
  const lock = stockLockDate();
  const problems = [];
  if (date >= today) problems.push({ code: 'DATE_NOT_PAST', message: 'Chỉ chốt đến hết ngày hôm qua trở về trước (hôm nay còn đang bán).' });
  if (lock && date <= lock) problems.push({ code: 'ALREADY_CLOSED', message: `Kho đã chốt đến hết ngày ${lock}. Chọn ngày sau đó, hoặc mở lại kỳ nếu muốn lùi.` });

  const counts = db().prepare("SELECT code, warehouse_id FROM stock_counts WHERE status = 'draft' ORDER BY created_at").all();
  const blockers = [...problems];
  if (counts.length) blockers.push({ code: 'COUNT_OPEN', message: `Còn ${counts.length} phiếu kiểm kê chưa hoàn tất (${counts.slice(0, 3).map((c) => c.code).join(', ')}${counts.length > 3 ? '…' : ''}). Hoàn tất hoặc huỷ trước khi chốt.`, items: counts });

  const rows = balancesAt(date);
  const warnings = [];
  const draftPurchases = db().prepare("SELECT code FROM purchases WHERE status = 'draft' AND substr(ordered_at, 1, 10) <= ?").all(date);
  if (draftPurchases.length) warnings.push({ code: 'DRAFT_PURCHASES', message: `${draftPurchases.length} phiếu nhập nháp có ngày đến hết ${date}. Nhận hàng sau khi chốt sẽ ghi vào kỳ mở.`, items: draftPurchases.slice(0, 20) });
  const draftOrders = db().prepare("SELECT code FROM orders WHERE status = 'draft' AND business_date <= ?").all(date);
  if (draftOrders.length) warnings.push({ code: 'DRAFT_ORDERS', message: `${draftOrders.length} đơn nháp có ngày đến hết ${date}. Xác nhận sau khi chốt sẽ trừ kho vào ngày đầu của kỳ mở.`, items: draftOrders.slice(0, 20) });
  const neg = rows.filter((r) => r.qty < 0);
  if (neg.length) warnings.push({ code: 'NEGATIVE_STOCK', message: `${neg.length} dòng đang âm kho tại ngày chốt (thường do đơn trừ kho trước khi nhập hàng). Số âm sẽ bị chụp nguyên như vậy.`, items: neg.slice(0, 20) });
  const unreceivedShipping = db().prepare("SELECT COUNT(*) AS n FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE r.goods_received_at IS NULL AND o.business_date <= ?").get(date);
  if (unreceivedShipping?.n) warnings.push({ code: 'RETURNS_PENDING', message: `${unreceivedShipping.n} phiếu trả hàng sàn đang chờ nhận hàng về.` });

  const byWarehouse = db().prepare('SELECT id, name FROM warehouses').all().map((w) => {
    const rs = rows.filter((r) => r.warehouse_id === w.id);
    return { warehouse_id: w.id, name: w.name, ...totalsOf(rs) };
  }).filter((w) => w.line_count > 0);
  return { date, can_close: blockers.length === 0, blockers, warnings, ...totalsOf(rows), by_warehouse: byWarehouse };
}

export function closeStock(date, note, actor) {
  const pv = previewClose(date);
  if (!pv.can_close) throw conflict('CLOSE_BLOCKED', pv.blockers.map((b) => b.message).join(' '), { blockers: pv.blockers });
  const rows = balancesAt(date);
  const id = newId('scl');
  const t = totalsOf(rows);
  db().prepare('INSERT INTO stock_closes (id, close_date, taken_at, actor_id, note, line_count, total_qty, total_value, hash) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, date, nowIso(), actor?.id ?? null, note ?? null, t.line_count, t.total_qty, t.total_value, hashOf(rows));
  const ins = db().prepare('INSERT INTO stock_close_lines (close_id, warehouse_id, variant_id, qty, value) VALUES (?,?,?,?,?)');
  for (const r of rows) ins.run(id, r.warehouse_id, r.variant_id, r.qty, r.value);
  const before = stockLockDate();
  writeSetting('stock_lock_date', date);
  audit(actor, 'stock.closed', 'stock_close', id, { stock_lock_date: before }, { stock_lock_date: date, ...t });
  emit('stock.closed', { entityType: 'stock_close', entityId: id, data: { close_date: date, ...t } });
  return getClose(id);
}

/** Mở lại: lùi ngày chốt về `toDate` (phải trước ngày chốt hiện tại) hoặc null = bỏ chốt hẳn. Cần lý do. */
export function reopenStock(toDate, reason, actor) {
  const lock = stockLockDate();
  if (!lock) throw conflict('NOT_CLOSED', 'Kho chưa chốt kỳ nào');
  if (!reason || !String(reason).trim()) throw badRequest('REASON_REQUIRED', 'Cần ghi lý do mở lại kỳ kho');
  if (toDate !== null) {
    if (!validDate(toDate)) throw badRequest('INVALID_DATE', 'Ngày phải là YYYY-MM-DD hoặc null');
    if (toDate >= lock) throw badRequest('INVALID_DATE', `Mở lại phải lùi về trước ngày chốt hiện tại (${lock})`);
  }
  const at = nowIso();
  // Các lần chốt có ngày chốt sau mốc mới không còn hiệu lực
  db().prepare('UPDATE stock_closes SET reopened_at = ?, reopen_reason = ? WHERE reopened_at IS NULL AND close_date > ?').run(at, String(reason).trim(), toDate ?? '0000-00-00');
  writeSetting('stock_lock_date', toDate);
  audit(actor, 'stock.reopened', 'settings', 'stock_lock_date', { stock_lock_date: lock }, { stock_lock_date: toDate, reason });
  emit('stock.reopened', { entityType: 'settings', entityId: 'stock_lock_date', data: { from: lock, to: toDate } });
  return closeStatus();
}

export function getClose(id) {
  const c = db().prepare('SELECT * FROM stock_closes WHERE id = ?').get(id);
  if (!c) throw notFound('Lần chốt kho');
  c.lines = db().prepare(
    `SELECT l.warehouse_id, w.name AS warehouse_name, l.variant_id, v.sku, p.name AS product_name, p.unit, l.qty, l.value
     FROM stock_close_lines l JOIN warehouses w ON w.id = l.warehouse_id JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
     WHERE l.close_id = ? ORDER BY w.name, p.name, v.sku`,
  ).all(id);
  return c;
}

export function listCloses() {
  return db().prepare('SELECT * FROM stock_closes ORDER BY close_date DESC, taken_at DESC LIMIT 100').all();
}

/** Trạng thái chốt + so lại sổ kho hiện tại với ảnh chụp để phát hiện thay đổi trong kỳ đã chốt (không nên có). */
export function closeStatus() {
  const lock = stockLockDate();
  if (!lock) return { lock_date: null, active: null, changed: false, changes: [] };
  const active = activeClose();
  if (!active) return { lock_date: lock, active: null, changed: false, changes: [] };
  const snap = new Map(db().prepare('SELECT warehouse_id, variant_id, qty, value FROM stock_close_lines WHERE close_id = ?').all(active.id).map((r) => [`${r.warehouse_id}|${r.variant_id}`, r]));
  const now = balancesAt(active.close_date);
  const changes = [];
  const seen = new Set();
  for (const r of now) {
    const k = `${r.warehouse_id}|${r.variant_id}`;
    seen.add(k);
    const old = snap.get(k);
    if (!old || old.qty !== r.qty || old.value !== r.value) changes.push({ warehouse_id: r.warehouse_id, variant_id: r.variant_id, was_qty: old?.qty ?? 0, now_qty: r.qty, was_value: old?.value ?? 0, now_value: r.value });
  }
  for (const [k, old] of snap) if (!seen.has(k)) changes.push({ warehouse_id: old.warehouse_id, variant_id: old.variant_id, was_qty: old.qty, now_qty: 0, was_value: old.value, now_value: 0 });
  return { lock_date: lock, active: { id: active.id, close_date: active.close_date, taken_at: active.taken_at, note: active.note, line_count: active.line_count, total_qty: active.total_qty, total_value: active.total_value }, changed: changes.length > 0, changes: changes.slice(0, 50) };
}

/** Ngày đầu tiên còn mở (để giao diện gợi ý) */
export const firstOpenDate = () => { const l = stockLockDate(); return l ? addDays(l, 1) : null; };
export { businessDate };
