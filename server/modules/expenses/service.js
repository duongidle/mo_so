import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { notFound, badRequest } from '../../lib/errors.js';
import { emit, audit } from '../../lib/events.js';
import { recordPayment } from '../payments/service.js';
import { addOrderPayment } from '../orders/service.js';

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

export function listExpenses({ shopIds, categoryId, from, to, includeVoided = false, limit = 100, cursor }) {
  const where = [];
  const params = [];
  if (!includeVoided) where.push('e.voided_at IS NULL');
  if (shopIds?.length) {
    where.push(`(e.shop_id IN (${shopIds.map(() => '?').join(',')}))`);
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
  db()
    .prepare(
      `INSERT INTO expenses (id, category_id, shop_id, channel_id, amount, expense_date, payee, method, note, actor_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.category_id, input.shop_id ?? null, input.channel_id ?? null, input.amount, input.expense_date || businessDate(at), input.payee ?? null, input.method ?? 'cash', input.note ?? null, actor?.id ?? null, at, at);
  const e = getExpense(id);
  emit('expense.created', { entityType: 'expense', entityId: id, shopId: e.shop_id, data: e });
  audit(actor, 'expense.created', 'expense', id, null, e);
  return e;
}

export function updateExpense(id, input, actor) {
  const before = getExpense(id);
  if (before.voided_at) throw badRequest('EXPENSE_VOIDED', 'Chi phí đã bị huỷ, không sửa được');
  const m = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
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
  db().prepare('UPDATE expenses SET voided_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  audit(actor, 'expense.voided', 'expense', id, before, null);
  return getExpense(id);
}

// ---------- Đối soát Shopee (đơn sàn đã hoàn thành nhưng chưa ghi nhận tiền về) ----------
const PENDING_SQL = `
  SELECT o.id, o.code, o.external_id, o.shop_id, s.name AS shop_name, o.channel_id, o.customer_name, o.status,
         o.completed_at, o.business_date, o.net_amount, o.returned_amount, o.paid_amount,
         (o.net_amount - o.returned_amount - o.paid_amount) AS pending_amount
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
  return { data: rows, total_pending: rows.reduce((a, r) => a + r.pending_amount, 0), count: rows.length };
}

/**
 * Ghi nhận tiền sàn trả về cho nhiều đơn.
 * items: [{ order_id?, external_id?, amount? }] — bỏ amount = nhận đủ số còn treo.
 * Đơn không tìm thấy hoặc không còn treo được báo lại, không bỏ qua im lặng.
 */
export function recordPayouts({ items, method = 'shopee_payout', paidAt, note, shopId }, actor) {
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
    if (!pending) {
      results.push({ ...it, order_id: o.id, code: o.code, ok: false, error: 'Đơn không còn tiền treo' });
      continue;
    }
    const amount = it.amount ?? pending.pending_amount;
    if (amount <= 0) {
      results.push({ ...it, order_id: o.id, code: o.code, ok: false, error: 'Số tiền phải > 0' });
      continue;
    }
    addOrderPayment(o.id, { amount, method, paidAt, note: note ?? 'Đối soát payout' }, actor);
    results.push({ order_id: o.id, code: o.code, ok: true, amount, still_pending: Math.max(0, pending.pending_amount - amount) });
  }
  return { results, recorded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
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
