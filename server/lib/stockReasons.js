/** Lý do giảm kho (điều chỉnh giảm, hàng hỏng, xuất huỷ lô) có mã, để thống kê hao hụt. Ô ghi chú tự do vẫn giữ. Phiếu cũ không có mã = 'other'. */
export const STOCK_REASONS = [
  { code: 'damaged', label: 'Hỏng, vỡ' },
  { code: 'expired', label: 'Hết hạn' },
  { code: 'weight_loss', label: 'Hao hụt cân' },
  { code: 'lost', label: 'Mất' },
  { code: 'other', label: 'Khác' },
];
export const STOCK_REASON_CODES = STOCK_REASONS.map((r) => r.code);
