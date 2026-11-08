// Giữ khớp với server/lib/returnReasons.js (có test đối chiếu)
export const RETURN_REASONS = [
  ['customer_refused', 'Khách không nhận hàng'],
  ['changed_mind', 'Khách đổi ý'],
  ['wrong_item', 'Giao sai hàng'],
  ['defective', 'Hàng lỗi / hỏng'],
  ['damaged_in_transit', 'Hỏng khi vận chuyển'],
  ['not_as_described', 'Không đúng mô tả'],
  ['other', 'Lý do khác'],
];
export const reasonLabel = (code) => (code ? RETURN_REASONS.find(([k]) => k === code)?.[1] || code : 'Chưa chọn lý do');
