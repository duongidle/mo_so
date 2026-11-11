import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, toIso } from '../../lib/time.js';
import { notFound, badRequest } from '../../lib/errors.js';
import { emit, audit } from '../../lib/events.js';
import { recordPayment } from '../payments/service.js';
import { addOrderPayment, updateOrder } from '../orders/service.js';
import { getSetting } from '../settings/service.js';
import { payoutMethodOf } from '../../lib/platforms.js';
import { assertUnlocked } from '../../lib/period.js';

const db = () => getDb();

export function listCategories() {
  return db().prepare('SELECT * FROM expense_categories WHERE archived_at IS NULL ORDER BY sort_order, name').all();
}

export function createCategory({ name }) {
  const id = newId('ecat');
  db().prepare('INSERT INTO expense_categories (id, name, sort_order) VALUES (?,?,5)').run(id, name);
  return db().prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
}

export function getExpense(id) {
  const e = db()
    .prepare(
      `SELECT e.*, c.name AS category_name, s.name AS shop_name FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id LEFT JOIN shops s ON s.id = e.shop_id WHERE e.id = ?`,
    )
    .get(id);
  if (!e) throw notFound('Chi phí');
  return e;
}

export function listExpenses({ shopIds, categoryId, from, to, includeVoided = false, includeShared = true, limit = 100, cursor }) {
  const where = [];
  const params = [];
  if (!includeVoided) where.push('e.voided_at IS NULL');
  if (shopIds?.length) {
    // Chi phí chung (không thuộc shop nào) vẫn hiện khi xem theo shop, vì nó được phân bổ vào shop trong báo cáo
    where.push(`(e.shop_id IN (${shopIds.map(() => '?').join(',')})${includeShared ? ' OR e.shop_id IS NULL' : ''})`);
    params.push(...shopIds);
  }
  if (categoryId) (where.push('e.category_id = ?'), params.push(categoryId));
  if (from) (where.push('e.expense_date >= ?'), params.push(from));
  if (to) (where.push('e.expense_date <= ?'), params.push(to));
  if (cursor) (where.push('e.id < ?'), params.push(cursor));
  const rows = db()
    .prepare(
      `SELECT e.*, c.name AS category_name, s.name AS shop_name FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id LEFT JOIN shops s ON s.id = e.shop_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

export function createExpense(input, actor) {
  if (!db().prepare('SELECT 1 FROM expense_categories WHERE id = ?').get(input.category_id)) throw notFound('Danh mục chi phí');
  if (input.shop_id && !db().prepare('SELECT 1 FROM shops WHERE id = ?').get(input.shop_id)) throw notFound('Shop');
  const id = newId('exp');
  const at = nowIso();
  const date = input.expense_date || businessDate(at);
  assertUnlocked(date, 'Chi phí');
  db()
    .prepare(
      `INSERT INTO expenses (id, category_id, shop_id, channel_id, amount, expense_date, payee, method, note, actor_id, created_at, updated_at, recurring_id, period_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.category_id, input.shop_id ?? null, input.channel_id ?? null, input.amount, date, input.payee ?? null, input.method ?? 'cash', input.note ?? null, actor?.id ?? null, at, at, input.recurring_id ?? null, input.period_key ?? null);
  const e = getExpense(id);
  emit('expense.created', { entityType: 'expense', entityId: id, shopId: e.shop_id, data: e });
  audit(actor, 'expense.created', 'expense', id, null, e);
  return e;
}

export function updateExpense(id, input, actor) {
  const before = getExpense(id);
  if (before.voided_at) throw badRequest('EXPENSE_VOIDED', 'Chi phí đã bị huỷ, không sửa được');
  const m = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  assertUnlocked([before.expense_date, m.expense_date], 'Chi phí');
  db()
    .prepare('UPDATE expenses SET category_id=?, shop_id=?, channel_id=?, amount=?, expense_date=?, payee=?, method=?, note=?, updated_at=? WHERE id=?')
    .run(m.category_id, m.shop_id ?? null, m.channel_id ?? null, m.amount, m.expense_date, m.payee ?? null, m.method, m.note ?? null, nowIso(), id);
  const after = getExpense(id);
  audit(actor, 'expense.updated', 'expense', id, before, after);
  return after;
}

/** Không xoá cứng: đánh dấu huỷ */
export function voidExpense(id, actor) {
  const before = getExpense(id);
  assertUnlocked(before.expense_date, 'Chi phí');
  db().prepare('UPDATE expenses SET voided_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  audit(actor, 'expense.voided', 'expense', id, before, null);
  return getExpense(id);
}

// ---------- Đối soát tiền sàn (đơn sàn đã hoàn thành nhưng chưa ghi nhận tiền về) ----------
const PENDING_SQL = `
  SELECT o.id, o.code, o.external_id, o.shop_id, s.name AS shop_name, o.channel_id, o.customer_name, o.status,
         o.completed_at, o.business_date, o.net_amount, o.returned_amount, o.paid_amount,
         (o.net_amount - o.returned_amount - o.paid_amount) AS pending_amount,
         CAST(julianday('now') - julianday(o.completed_at) AS INTEGER) AS days_pending
  FROM orders o JOIN shops s ON s.id = o.shop_id JOIN channels ch ON ch.id = o.channel_id
  WHERE ch.is_marketplace = 1 AND o.status = 'completed' AND (o.net_amount - o.returned_amount - o.paid_amount) > 0`;

export function pendingPayouts({ shopIds, channel, from, to } = {}) {
  const where = [];
  const params = [];
  if (shopIds?.length) (where.push(`o.shop_id IN (${shopIds.map(() => '?').join(',')})`), params.push(...shopIds));
  if (channel) (where.push('o.channel_id = ?'), params.push(channel));
  if (from) (where.push('o.business_date >= ?'), params.push(from));
  if (to) (where.push('o.business_date <= ?'), params.push(to));
  const rows = db()
    .prepare(`${PENDING_SQL} ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY o.completed_at`)
    .all(...params);
  // Đơn giao xong quá N ngày mà sàn chưa trả: nên khiếu nại với sàn (Shopee: đơn giao hơn 7 ngày chưa thanh toán)
  const overdueDays = getSetting('payout_overdue_days') || 0;
  const data = rows.map((r) => ({ ...r, overdue: overdueDays > 0 && r.days_pending >= overdueDays }));
  const late = data.filter((r) => r.overdue);
  return { data, total_pending: rows.reduce((a, r) => a + r.pending_amount, 0), count: rows.length, overdue_days: overdueDays, overdue_count: late.length, overdue_amount: late.reduce((a, r) => a + r.pending_amount, 0) };
}

/**
 * Ghi nhận tiền sàn trả về cho nhiều đơn.
 * items: [{ order_id?, external_id?, amount? }] — bỏ amount = nhận đủ số còn treo.
 * Đơn không tìm thấy hoặc không còn treo được báo lại, không bỏ qua im lặng.
 */
export function recordPayouts({ items, method, channelId, paidAt, note, shopId, settleDifference = false }, actor) {
  const results = [];
  for (const it of items) {
    let o = null;
    if (it.order_id) o = db().prepare('SELECT * FROM orders WHERE id = ?').get(it.order_id);
    else if (it.external_id) {
      o = db()
        .prepare(`SELECT * FROM orders WHERE external_id = ? ${shopId ? 'AND shop_id = ?' : ''}`)
        .get(...(shopId ? [it.external_id, shopId] : [it.external_id]));
    }
    if (!o) {
      results.push({ ...it, ok: false, error: 'Không tìm thấy đơn' });
      continue;
    }
    const pending = db().prepare(`${PENDING_SQL} AND o.id = ?`).get(o.id);
    if (pending && channelId && pending.channel_id !== channelId) {
      results.push({ ...it, order_id: o.id, code: o.code, ok: false, error: 'Đơn thuộc kênh khác' });
      continue;
    }
    if (!pending) {
      results.push({ ...it, order_id: o.id, code: o.code, ok: false, error: 'Đơn không còn tiền treo' });
      continue;
    }
    const amount = it.amount ?? pending.pending_amount;
    if (amount <= 0) {
      results.push({ ...it, order_id: o.id, code: o.code, ok: false, error: 'Số tiền phải > 0' });
      continue;
    }
    // Không chỉ định: dùng phương thức tiền về của nền tảng đang đối soát (shopee_payout, tiktok_payout…), kênh khác = chuyển khoản
    addOrderPayment(o.id, { amount, method: method ?? payoutMethodOf(channelId ?? o.channel_id), paidAt, note: note ?? 'Đối soát payout' }, actor);
    // Sàn trả khác kỳ vọng và chủ shop xác nhận đó là phí/phạt/hoàn phí thật: cộng phần lệch vào phí sàn của đơn để đơn hết treo và lãi đúng
    let feeDelta = 0;
    if (settleDifference && amount !== pending.pending_amount) {
      feeDelta = pending.pending_amount - amount; // trả thiếu → phí sàn tăng; trả dư → phí sàn giảm (không âm)
      const fee = o.platform_fee_amount ?? 0;
      const floor = o.platform_fee_refunded_amount ?? 0; // phí sàn không xuống dưới phần sàn đã hoàn
      if (fee + feeDelta < floor) feeDelta = floor - fee;
      updateOrder(o.id, { platform_fee_amount: fee + feeDelta }, actor);
      db().prepare('INSERT INTO payout_adjustments (id, order_id, shop_id, channel_id, expected_amount, received_amount, fee_delta, note, business_date, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(newId('pad'), o.id, o.shop_id, o.channel_id, pending.pending_amount, amount, feeDelta, note ?? null, businessDate(toIso(paidAt) || nowIso()), actor?.id ?? null, nowIso());
    }
    results.push({ order_id: o.id, code: o.code, ok: true, amount, fee_delta: feeDelta, still_pending: Math.max(0, pending.pending_amount - amount - feeDelta) });
  }
  return { results, recorded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

/** Các lần đối soát lệch (phần phí sàn tăng/giảm thêm theo từng đơn) */
export function listPayoutAdjustments({ shopIds, from, to, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (shopIds?.length) (where.push(`a.shop_id IN (${shopIds.map(() => '?').join(',')})`), params.push(...shopIds));
  if (from) (where.push('a.business_date >= ?'), params.push(from));
  if (to) (where.push('a.business_date <= ?'), params.push(to));
  const rows = db().prepare(`SELECT a.*, o.code AS order_code, o.external_id FROM payout_adjustments a JOIN orders o ON o.id = a.order_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT ?`).all(...params, limit);
  return { data: rows, total_fee_delta: rows.reduce((a, r) => a + r.fee_delta, 0) };
}

export function listPayments({ direction, refType, method, from, to, shopIds, limit = 100, cursor }) {
  const where = ['p.voided_at IS NULL'];
  const params = [];
  if (direction) (where.push('p.direction = ?'), params.push(direction));
  if (refType) (where.push('p.ref_type = ?'), params.push(refType));
  if (method) (where.push('p.method = ?'), params.push(method));
  if (from) (where.push('p.business_date >= ?'), params.push(from));
  if (to) (where.push('p.business_date <= ?'), params.push(to));
  if (shopIds?.length) (where.push(`p.shop_id IN (${shopIds.map(() => '?').join(',')})`), params.push(...shopIds));
  if (cursor) (where.push('p.id < ?'), params.push(cursor));
  const rows = db().prepare(`SELECT p.* FROM payments p WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

export { recordPayment };
