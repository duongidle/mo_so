// Huỷ đơn còn tiền khách đã thu (đơn ngoài sàn): bắt buộc chọn hoàn lại khách hoặc giữ cọc. Logic thuần để test.

/** Đơn có cần hỏi hoàn/giữ cọc khi huỷ không */
export function needsPaidChoice(order) {
  return !order.is_marketplace && order.paid_amount > 0 && order.status !== 'cancelled';
}

/** Giá trị ban đầu của hộp thoại huỷ */
export const emptyCancelForm = (order) => ({ note: '', paid_action: '', forfeit: order.paid_amount, refund_now: false, method: 'cash' });

/** Lỗi nhập (chuỗi) hoặc null nếu hợp lệ */
export function cancelError(order, f) {
  if (!needsPaidChoice(order)) return null;
  if (!f.paid_action) return 'Chọn hoàn lại khách hoặc giữ cọc.';
  if (f.paid_action === 'forfeit') {
    const x = Number(f.forfeit);
    if (!(x > 0)) return 'Nhập số tiền giữ lại lớn hơn 0.';
    if (x > order.paid_amount) return 'Số giữ lại không được lớn hơn số khách đã thu.';
  }
  return null;
}

/** Thân yêu cầu POST /orders/:id/status khi huỷ */
export function cancelBody(order, f) {
  const body = { status: 'cancelled', note: f.note || undefined };
  if (!needsPaidChoice(order)) return body;
  body.paid_action = f.paid_action;
  const forfeit = f.paid_action === 'forfeit' ? Number(f.forfeit) : 0;
  if (f.paid_action === 'forfeit') body.forfeit_amount = forfeit;
  if (f.refund_now && order.paid_amount - forfeit > 0) body.refund = f.method === 'customer_credit' ? { method: 'cash', to_credit: true } : { method: f.method };
  return body;
}
