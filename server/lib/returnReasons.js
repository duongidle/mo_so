/** Lý do trả hàng có mã, để thống kê. Ô ghi chú tự do (`reason`) vẫn giữ cho chi tiết. */
export const RETURN_REASONS = [
  { code: 'customer_refused', label: 'Khách không nhận hàng' },
  { code: 'changed_mind', label: 'Khách đổi ý' },
  { code: 'wrong_item', label: 'Giao sai hàng' },
  { code: 'defective', label: 'Hàng lỗi / hỏng' },
  { code: 'damaged_in_transit', label: 'Hỏng khi vận chuyển' },
  { code: 'not_as_described', label: 'Không đúng mô tả' },
  { code: 'other', label: 'Lý do khác' },
];
export const RETURN_REASON_CODES = RETURN_REASONS.map((r) => r.code);
