// Tính tiền của form trả hàng. Cùng công thức với máy chủ (orders/service.js: returnLineValue, createReturn) để số hiện ra
// trước khi bấm ghi nhận đúng bằng số được ghi.

const toInt = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Giá trị hàng của một lần trả = luỹ kế sau lần này − tổng đã trả trước đó (làm tròn luỹ kế, không làm tròn riêng từng lần) */
export function lineReturnValue(line, qty) {
  if (!qty) return 0;
  const net = line.line_total - (line.allocated_order_discount || 0);
  const done = line.returned_value || 0;
  const cum = (line.returned_qty || 0) + qty >= line.qty ? net : Math.round((net * ((line.returned_qty || 0) + qty)) / line.qty);
  return cum - done;
}

/**
 * order: đơn đã tải (lines, shipping_fee, returned_shipping_amount, paid_amount, is_marketplace)
 * form: { lines: {id: {qty, restock}}, shipOn, shipRefund, fee, shipCost, refund } — refund = null nghĩa là chưa sửa tay → dùng mặc định
 */
export function computeReturn(order, form) {
  const marketplace = !!order.is_marketplace;
  const lines = order.lines.map((l) => {
    const qty = Math.min(l.qty - l.returned_qty, toInt(form.lines?.[l.id]?.qty));
    return { id: l.id, qty, value: lineReturnValue(l, qty) };
  });
  const goods = lines.reduce((a, l) => a + l.value, 0);
  const shipLeft = Math.max(0, order.shipping_fee - (order.returned_shipping_amount || 0));
  const shipRefund = marketplace || !form.shipOn ? 0 : Math.min(shipLeft, toInt(form.shipRefund));
  const fee = marketplace ? 0 : Math.min(goods + shipRefund, toInt(form.fee));
  const shipCost = toInt(form.shipCost);
  const due = marketplace ? 0 : goods + shipRefund - fee; // cần trả khách
  const paid = order.paid_amount || 0;
  const maxRefund = Math.min(due, paid);
  const defaultRefund = maxRefund; // đơn đã thu thì mặc định trả đủ; đơn chưa thu (COD) thì paid = 0 → 0
  const refund = marketplace ? 0 : form.refund == null ? defaultRefund : Math.min(maxRefund, toInt(form.refund));
  return { lines, goods, shipLeft, shipRefund, fee, shipCost, due, maxRefund, refund, owedAfter: Math.max(0, due - refund) };
}

/** Câu giải thích kết quả, hiện dưới form */
export function returnSummary(r, fmt, marketplace) {
  if (!r.goods) return '';
  const parts = [];
  if (marketplace) parts.push(`Sàn tự hoàn tiền cho người mua; khoản phải thu từ sàn giảm ${fmt(r.goods)}.`);
  else if (r.owedAfter > 0) parts.push(`Shop còn nợ khách ${fmt(r.owedAfter)}, hoàn sau ở mục Thanh toán.`);
  else if (r.due > 0) parts.push('Hoàn đủ cho khách.');
  else parts.push('Shop giữ lại toàn bộ số tiền khách đã trả cho phần hàng này.');
  parts.push(`Doanh thu hàng giảm ${fmt(r.goods)}${r.fee ? `, phí trả hàng thu được ${fmt(r.fee)}` : ''}${r.shipRefund ? `, doanh thu phí ship giảm ${fmt(r.shipRefund)}` : ''}.`);
  if (r.shipCost) parts.push(`Phí ship chiều về ${fmt(r.shipCost)} tính vào chi phí.`);
  return parts.join(' ');
}

/** Nút nhanh "Khách không nhận hàng (COD)": trả toàn bộ, nhập lại kho, hoàn toàn bộ ship, không trả tiền */
export function codRefusedForm(order, base = {}) {
  const lines = {};
  for (const l of order.lines) if (l.qty - l.returned_qty > 0) lines[l.id] = { qty: l.qty - l.returned_qty, restock: true };
  const shipLeft = Math.max(0, order.shipping_fee - (order.returned_shipping_amount || 0));
  return { ...base, lines, shipOn: shipLeft > 0, shipRefund: String(shipLeft), fee: '', refund: '0', reason: base.reason || '', reasonCode: base.reasonCode || 'customer_refused', awaitingGoods: true };
}
