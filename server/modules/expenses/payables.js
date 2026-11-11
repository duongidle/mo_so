import { getDb } from '../../db/index.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { listRecurring } from './recurring.js';

const db = () => getDb();
const daysBetween = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);

export const PAYABLE_KINDS = {
  supplier: 'Nhà cung cấp',
  purchase_ship: 'Ship nhập (hãng vận chuyển)',
  order_ship: 'Ship đơn (hãng vận chuyển)',
  refund: 'Hoàn tiền khách',
  supplier_refund: 'NCC còn nợ shop (phải thu)',
  recurring: 'Chi phí định kỳ sắp tới',
};

const bucketOf = (due, today, lookahead) => {
  if (!due) return { bucket: 'no_due', days_overdue: null };
  const d = daysBetween(today, due);
  return { bucket: d > 0 ? 'overdue' : d >= -lookahead ? 'due_soon' : 'later', days_overdue: d };
};

/** Phiếu nhập đã nhận mà còn nợ nhà cung cấp, có hạn trả trong `lookahead` ngày tới hoặc đã quá hạn (dùng cho thông báo). */
export function supplierPayables({ lookahead = 3, today = businessDate(nowIso()) } = {}) {
  const all = payables({ lookahead, today }).data.filter((r) => r.kind === 'supplier' && (r.bucket === 'overdue' || r.bucket === 'due_soon'));
  return { data: all, total: all.reduce((a, r) => a + r.amount, 0), overdue_count: all.filter((r) => r.bucket === 'overdue').length };
}

/**
 * Mọi khoản shop phải trả hoặc sắp phải chi, gom một chỗ:
 *  - nợ nhà cung cấp (phiếu nhập đã nhận còn nợ, có hoặc chưa có hạn),
 *  - tiền ship nhập còn nợ hãng vận chuyển, tiền ship đơn shop chịu chưa trả hãng,
 *  - tiền shop còn nợ khách (khách trả dư sau khi trả hàng),
 *  - kỳ sắp tới của chi phí định kỳ (chỉ nhắc, chưa phải nợ).
 * Sắp theo mức gấp: quá hạn, sắp đến hạn, chưa hạn, chưa đặt hạn.
 */
export function payables({ shopId, lookahead = 7, today = businessDate(nowIso()) } = {}) {
  const sf = (col) => (shopId ? ` AND ${col} = ?` : '');
  const sfp = (col) => (shopId ? ` AND (${col} = ? OR ${col} IS NULL)` : ''); // phiếu nhập có thể chưa gắn shop: vẫn hiện khi xem một shop
  const sp = shopId ? [shopId] : [];
  const out = [];

  for (const p of db()
    .prepare(
      `SELECT p.id, p.code, p.shop_id, su.name AS party, p.due_date, (p.total_amount - p.returned_amount - p.allowance_amount - p.paid_amount) AS amount, p.total_amount
       FROM purchases p LEFT JOIN suppliers su ON su.id = p.supplier_id
       WHERE p.status = 'received' AND (p.total_amount - p.returned_amount - p.allowance_amount - p.paid_amount) > 0${sfp('p.shop_id')}`,
    )
    .all(...sp)) out.push({ kind: 'supplier', ref_id: p.id, code: p.code, shop_id: p.shop_id, party: p.party || 'Không có nhà cung cấp', due_date: p.due_date, amount: p.amount, total: p.total_amount, link: `/purchases/${p.id}` });

  for (const p of db()
    .prepare(
      `SELECT id, code, shop_id, (carrier_amount - carrier_paid_amount) AS amount, carrier_amount AS total
       FROM purchases WHERE status = 'received' AND (carrier_amount - carrier_paid_amount) > 0${sfp('shop_id')}`,
    )
    .all(...sp)) out.push({ kind: 'purchase_ship', ref_id: p.id, code: p.code, shop_id: p.shop_id, party: 'Bên vận chuyển', due_date: null, amount: p.amount, total: p.total, link: `/purchases/${p.id}` });

  const paidShip = "(SELECT COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE -amount END),0) FROM payments WHERE ref_type='order_seller_shipping' AND ref_id=o.id AND voided_at IS NULL)";
  for (const o of db()
    .prepare(
      `SELECT o.id, o.code, o.shop_id, (o.seller_shipping_amount - ${paidShip}) AS amount, o.seller_shipping_amount AS total
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 0 AND o.status IN ('confirmed','shipping','completed','returned') AND o.seller_shipping_amount > 0 AND (o.seller_shipping_amount - ${paidShip}) > 0${sf('o.shop_id')}`,
    )
    .all(...sp)) out.push({ kind: 'order_ship', ref_id: o.id, code: o.code, shop_id: o.shop_id, party: 'Bên vận chuyển', due_date: null, amount: o.amount, total: o.total, link: `/orders/${o.id}` });

  for (const o of db()
    .prepare(
      `SELECT o.id, o.code, o.shop_id, COALESCE(NULLIF(o.customer_name,''), 'Khách lẻ') AS party, o.refund_owed_amount AS amount, o.paid_amount AS total
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 0 AND o.status <> 'draft' AND o.refund_owed_amount > 0${sf('o.shop_id')}`,
    )
    .all(...sp)) out.push({ kind: 'refund', ref_id: o.id, code: o.code, shop_id: o.shop_id, party: o.party, due_date: null, amount: o.amount, total: o.total, link: `/orders/${o.id}` });

  // NCC còn nợ shop: đã trả nhiều hơn số phải trả sau khi trừ hàng trả / giảm giá. Là khoản phải thu, không cộng vào tổng phải trả.
  for (const p of db()
    .prepare(
      `SELECT p.id, p.code, p.shop_id, su.name AS party, (p.paid_amount - (p.total_amount - p.returned_amount - p.allowance_amount)) AS amount, p.paid_amount AS total
       FROM purchases p LEFT JOIN suppliers su ON su.id = p.supplier_id
       WHERE p.status = 'received' AND p.paid_amount > (p.total_amount - p.returned_amount - p.allowance_amount)${sfp('p.shop_id')}`,
    )
    .all(...sp)) out.push({ kind: 'supplier_refund', ref_id: p.id, code: p.code, shop_id: p.shop_id, party: p.party || 'Không có nhà cung cấp', due_date: null, amount: p.amount, total: p.total, link: `/purchases/${p.id}` });

  const horizon = addDays(today, lookahead);
  for (const r of listRecurring()) {
    if (r.paused_at || !r.next_run_date || r.next_run_date > horizon || (shopId && r.shop_id && r.shop_id !== shopId)) continue;
    out.push({ kind: 'recurring', ref_id: r.id, code: r.name, shop_id: r.shop_id, party: r.category_name, due_date: r.next_run_date, amount: r.amount, total: r.amount, link: '/expenses?tab=recurring' });
  }

  const rank = { overdue: 0, due_soon: 1, later: 2, no_due: 3 };
  const data = out.map((r) => ({ ...r, ...bucketOf(r.due_date, today, lookahead) }));
  data.sort((a, b) => rank[a.bucket] - rank[b.bucket] || (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.amount - a.amount);

  // chi phí định kỳ chưa phải nợ nên không cộng vào tổng phải trả
  const debts = data.filter((r) => r.kind !== 'recurring' && r.kind !== 'supplier_refund');
  const sum = (rows) => rows.reduce((a, r) => a + r.amount, 0);
  return {
    data,
    total: sum(debts),
    overdue: { count: debts.filter((r) => r.bucket === 'overdue').length, amount: sum(debts.filter((r) => r.bucket === 'overdue')) },
    due_soon: { count: data.filter((r) => r.bucket === 'due_soon').length, amount: sum(data.filter((r) => r.bucket === 'due_soon')) },
    by_kind: Object.fromEntries(Object.keys(PAYABLE_KINDS).map((k) => [k, sum(data.filter((r) => r.kind === k))])),
    kinds: PAYABLE_KINDS,
    receivable_total: data.filter((r) => r.kind === 'supplier_refund').reduce((a, r) => a + r.amount, 0), // NCC còn nợ shop
    lookahead,
  };
}
