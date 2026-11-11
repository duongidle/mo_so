// Tính tiền của form "Giảm giá sau bán / bồi thường". Cùng công thức với máy chủ (orders/service.js: remainingGoodsValue, createAllowance).
const toInt = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Tiền hàng thực còn lại của đơn = Σ (tiền dòng − giảm giá đơn phân bổ − đã trả/đã giảm). Là mức giảm tối đa. */
export function remainingGoods(order) {
  return order.lines.reduce((a, l) => a + Math.max(0, l.line_total - (l.allocated_order_discount || 0) - (l.returned_value || 0)), 0);
}

/**
 * form: { amount, refund } — refund = null nghĩa là chưa sửa tay → mặc định trả đủ phần shop nợ khách sau khoản giảm.
 * Đơn sàn không có tiền trả khách (sàn tự hoàn cho người mua).
 */
export function computeAllowance(order, form) {
  const max = remainingGoods(order);
  const amount = Math.min(max, toInt(form.amount));
  const marketplace = !!order.is_marketplace;
  // Phải thu mới = tổng − (đã giảm trước đó + khoản này); phần đã thu vượt quá số đó là shop nợ khách
  const dueAfter = Math.max(0, (marketplace ? order.net_amount : order.total_amount) - (order.returned_amount || 0) - amount);
  const owed = marketplace ? 0 : Math.max(0, (order.paid_amount || 0) - dueAfter);
  const maxRefund = Math.min(amount, owed);
  const refund = marketplace ? 0 : form.refund == null ? maxRefund : Math.min(maxRefund, toInt(form.refund));
  return { max, amount, owed, maxRefund, refund, stillOwed: Math.max(0, owed - refund), debtAfter: Math.max(0, dueAfter - (order.paid_amount || 0)), marketplace };
}

export function allowanceSummary(r, fmt) {
  if (!r.amount) return '';
  if (r.marketplace) return `Khoản phải thu từ sàn giảm ${fmt(r.amount)}. Phí sàn không được hoàn. Không đụng kho.`;
  const parts = [`Doanh thu hàng giảm ${fmt(r.amount)}, khách giữ hàng, kho và giá vốn không đổi.`];
  if (r.stillOwed > 0) parts.push(`Shop còn nợ khách ${fmt(r.stillOwed)}, hoàn sau ở mục “Hoàn tiền”.`);
  else if (r.owed > 0) parts.push('Hoàn đủ cho khách.');
  else if (r.debtAfter >= 0) parts.push(`Khách chưa trả đủ nên khoản giảm chỉ bớt công nợ${r.debtAfter ? `, khách còn nợ ${fmt(r.debtAfter)}` : ''}.`);
  return parts.join(' ');
}
