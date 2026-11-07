import { getDb } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';

const db = () => getDb();

/** Số dư tiền khách gửi theo hồ sơ chung nhưng hạch toán trong phạm vi shop. */
export function customerCreditBalance(customerId, shopId) {
  if (!customerId || !shopId) return 0;
  return db().prepare(`SELECT COALESCE(SUM(CASE WHEN p.direction='out' THEN p.amount ELSE -p.amount END),0) AS balance
    FROM payments p JOIN orders o ON o.id = p.ref_id
    WHERE p.ref_type='order' AND p.method='customer_credit' AND p.voided_at IS NULL
      AND o.customer_id=? AND o.shop_id=?`).get(customerId, shopId).balance;
}

export function assertCustomerCredit(customerId, shopId, amount) {
  const available = customerCreditBalance(customerId, shopId);
  if (!customerId) throw badRequest('CUSTOMER_CREDIT_CUSTOMER_REQUIRED', 'Cần gắn đơn với hồ sơ khách để dùng tiền khách gửi');
  if (amount > available) throw badRequest('CUSTOMER_CREDIT_INSUFFICIENT', `Tiền khách gửi còn ${available}; không đủ ${amount}`, { available, requested: amount });
}
