import { getDb } from '../../db/index.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { getSetting } from '../settings/service.js';

const db = () => getDb();
const daysBetween = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);

/**
 * Khách còn nợ đơn đã hoàn thành (đơn ngoài sàn). Hạn = hạn đã đặt trên đơn, hoặc ngày đơn + số ngày công nợ mặc định (cài đặt).
 * Nhóm: quá hạn, sắp đến hạn (trong `lookahead` ngày), chưa có hạn (đơn đã hoàn thành từ 3 ngày trước mà chưa thu đủ).
 * Đơn đã nhắc/hoãn thì ẩn tới ngày `debt_remind_after`.
 */
export function customerDebts({ shopId, lookahead = 3, today = businessDate(nowIso()) } = {}) {
  const terms = getSetting('payment_terms_days') || 0;
  const rows = db()
    .prepare(
      `SELECT o.id, o.code, o.shop_id, s.name AS shop_name, o.customer_id, o.customer_name, o.customer_phone, o.business_date, o.due_date, o.debt_remind_after,
              (o.total_amount - o.returned_amount - o.paid_amount) AS debt
       FROM orders o JOIN channels ch ON ch.id = o.channel_id JOIN shops s ON s.id = o.shop_id
       WHERE ch.is_marketplace = 0 AND o.status = 'completed' AND (o.total_amount - o.returned_amount - o.paid_amount) > 0 ${shopId ? 'AND o.shop_id = ?' : ''}`,
    )
    .all(...(shopId ? [shopId] : []));
  const out = [];
  for (const r of rows) {
    if (r.debt_remind_after && r.debt_remind_after > today) continue;
    const due = r.due_date || (terms > 0 ? addDays(r.business_date, terms) : null);
    let bucket;
    let daysOverdue = null;
    if (due) {
      daysOverdue = daysBetween(today, due);
      if (daysOverdue > 0) bucket = 'overdue';
      else if (daysOverdue >= -lookahead) bucket = 'due_soon';
      else continue;
    } else {
      if (daysBetween(today, r.business_date) < 3) continue;
      bucket = 'no_due';
    }
    out.push({ ...r, due_date: due, bucket, days_overdue: daysOverdue });
  }
  const rank = { overdue: 0, due_soon: 1, no_due: 2 };
  out.sort((a, b) => rank[a.bucket] - rank[b.bucket] || (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
  return { data: out, total: out.reduce((a, r) => a + r.debt, 0), overdue_count: out.filter((r) => r.bucket === 'overdue').length };
}

/** Phiếu nhập đã nhận mà còn nợ nhà cung cấp, có hạn trả trong `lookahead` ngày tới hoặc đã quá hạn. */
export function supplierPayables({ lookahead = 3, today = businessDate(nowIso()) } = {}) {
  const rows = db()
    .prepare(
      `SELECT p.id, p.code, p.shop_id, p.supplier_id, su.name AS supplier_name, p.due_date, p.total_amount, p.paid_amount, (p.total_amount - p.paid_amount) AS debt
       FROM purchases p LEFT JOIN suppliers su ON su.id = p.supplier_id
       WHERE p.status = 'received' AND p.due_date IS NOT NULL AND (p.total_amount - p.paid_amount) > 0 AND p.due_date <= ? ORDER BY p.due_date`,
    )
    .all(addDays(today, lookahead));
  const data = rows.map((r) => ({ ...r, days_overdue: daysBetween(today, r.due_date), bucket: daysBetween(today, r.due_date) > 0 ? 'overdue' : 'due_soon' }));
  return { data, total: data.reduce((a, r) => a + r.debt, 0), overdue_count: data.filter((r) => r.bucket === 'overdue').length };
}

/** Đã nhắc hoặc hoãn một khoản nợ: ẩn khỏi danh sách tới ngày hẹn nhắc lại. */
export function actOnDebt(orderId, { days = 3 }, actor) {
  const o = db().prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  if (!o) throw notFound('Đơn hàng');
  const until = addDays(businessDate(nowIso()), days);
  db().prepare('UPDATE orders SET debt_remind_after = ?, updated_at = ? WHERE id = ?').run(until, nowIso(), orderId);
  audit(actor, 'order.debt_reminded', 'order', orderId, null, { remind_after: until });
  return { order_id: orderId, remind_after: until };
}
