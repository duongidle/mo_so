import { conflict } from './errors.js';
import { getSetting } from '../modules/settings/service.js';

/** Ngày khoá sổ (null = chưa khoá). Mọi chứng từ có ngày ≤ ngày này không tạo/sửa/huỷ được. */
export const lockDate = () => getSetting('accounting_lock_date') || null;

/**
 * Chặn thao tác lên kỳ đã khoá sổ. Truyền mọi ngày liên quan (ngày cũ và ngày mới khi sửa).
 * Đơn bán và phiếu nhập KHÔNG qua đây: đơn sàn import muộn là chuyện bình thường, chỉ cảnh báo ở trang tổng quan kế toán.
 */
export function assertUnlocked(dates, what = 'Chứng từ') {
  const lock = lockDate();
  if (!lock) return;
  for (const d of [].concat(dates).filter(Boolean)) {
    if (d <= lock) throw conflict('PERIOD_LOCKED', `${what} ngày ${d} thuộc kỳ đã khoá sổ (đến ${lock}). Mở khoá ở Sổ kế toán → Khoá sổ nếu cần sửa.`, { lock_date: lock, date: d });
  }
}
