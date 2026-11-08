import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, toIso } from '../../lib/time.js';
import { notFound, conflict } from '../../lib/errors.js';

import { paymentMethods } from '../../lib/platforms.js';
import { assertUnlocked } from '../../lib/period.js';

/** Phương thức thanh toán hợp lệ: gốc + payout của các nền tảng (danh mục ở lib/platforms.js) */
export { paymentMethods };
export const PAYMENT_METHODS = paymentMethods();

export function recordPayment({ direction, refType, refId, shopId, amount, method = 'cash', paidAt, note }, actor) {
  const id = newId('pay');
  const at = toIso(paidAt) || nowIso();
  assertUnlocked(businessDate(at), 'Thanh toán');
  getDb()
    .prepare(
      `INSERT INTO payments (id, direction, ref_type, ref_id, shop_id, amount, method, paid_at, business_date, note, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, direction, refType, refId ?? null, shopId ?? null, amount, method, at, businessDate(at), note ?? null, actor?.id ?? null, nowIso());
  return getDb().prepare('SELECT * FROM payments WHERE id = ?').get(id);
}

/** Đánh dấu huỷ một dòng thanh toán (không xoá). Chặn khi ngày của khoản đó đã khoá sổ. */
export function voidPaymentRow(p, at = nowIso()) {
  if (p.voided_at) throw conflict('ALREADY_VOIDED', 'Khoản thanh toán này đã huỷ');
  assertUnlocked(p.business_date, 'Thanh toán');
  getDb().prepare('UPDATE payments SET voided_at = ? WHERE id = ? AND voided_at IS NULL').run(at, p.id);
}

export function getPayment(id) {
  const p = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) throw notFound('Thanh toán');
  return p;
}

/** Tổng tiền thực đã thu/chi cho chứng từ (thu − hoàn) */
export function netPaid(refType, refId) {
  const r = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net
       FROM payments WHERE ref_type = ? AND ref_id = ? AND voided_at IS NULL`,
    )
    .get(refType, refId);
  return r.net;
}

export function listPaymentsFor(refType, refId) {
  return getDb().prepare('SELECT * FROM payments WHERE ref_type = ? AND ref_id = ? ORDER BY paid_at').all(refType, refId);
}
