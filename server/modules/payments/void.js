import { getPayment } from './service.js';
import { conflict } from '../../lib/errors.js';
import { voidOrderPayment } from '../orders/service.js';
import { voidPurchasePayment } from '../purchases/service.js';

/** Đối soát hãng vận chuyển và tiền khách gửi gắn với phiếu/số dư riêng, không huỷ lẻ ở đây được. Tiền sàn trả (đối soát sàn) huỷ được. */
const AUTO = (m) => m === 'customer_credit' || m === 'carrier_payout';

/** Huỷ một khoản thanh toán ghi nhầm của đơn bán hoặc phiếu nhập. Trả về chứng từ sau khi cập nhật. */
export function voidPaymentById(id, { reason } = {}, actor) {
  const p = getPayment(id);
  if (p.voided_at) throw conflict('ALREADY_VOIDED', 'Khoản thanh toán này đã huỷ');
  if (p.method === 'carrier_payout') throw conflict('PAYMENT_NOT_VOIDABLE', 'Khoản này do phiếu đối soát hãng vận chuyển tạo ra. Huỷ cả phiếu đối soát ở Chi phí & quỹ → Vận chuyển.');
  if (AUTO(p.method)) throw conflict('PAYMENT_NOT_VOIDABLE', 'Khoản này do tiền khách gửi tạo ra, không huỷ riêng được.');
  if (p.ref_type === 'order' || p.ref_type === 'order_seller_shipping') return { kind: 'order', data: voidOrderPayment(p, reason, actor) };
  if (p.ref_type === 'purchase' || p.ref_type === 'purchase_carrier') return { kind: 'purchase', data: voidPurchasePayment(p, reason, actor) };
  throw conflict('PAYMENT_NOT_VOIDABLE', 'Loại thanh toán này chưa huỷ được ở đây.');
}
