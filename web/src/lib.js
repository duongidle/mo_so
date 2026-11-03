import { solarToLunar, elementOfLunarYear } from '../../server/lib/lunar.js';

export const vnd = (n) => (n === null || n === undefined ? '—' : `${new Intl.NumberFormat('vi-VN').format(Math.round(n))} ₫`);
export const num = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('vi-VN').format(n));
export const pct = (n) => (n === null || n === undefined ? '—' : `${String(n).replace('.', ',')}%`);

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', ...(iso.length > 10 ? { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' } : {}) }).format(d);
}

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
export const monthStart = () => `${today().slice(0, 7)}-01`;
export const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const STATUS = { draft: 'Nháp', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Hoàn thành', cancelled: 'Đã huỷ', returned: 'Đã trả hàng' };
export const PAY_STATUS = { unpaid: 'Chưa thu', partial: 'Thu một phần', paid: 'Đã thu', refunded: 'Đã hoàn' };
export const METHODS = { cash: 'Tiền mặt', bank: 'Chuyển khoản', shopee_payout: 'Shopee payout', cod: 'COD', card: 'Thẻ', ewallet: 'Ví điện tử', other: 'Khác' };
export const MOVE_TYPES = {
  purchase_in: 'Nhập hàng', sale_out: 'Bán hàng', sale_cancel_in: 'Huỷ đơn', sale_return_in: 'Khách trả', adjust_in: 'Điều chỉnh +',
  adjust_out: 'Điều chỉnh −', transfer_out: 'Chuyển đi', transfer_in: 'Chuyển đến', opening: 'Tồn đầu', damage_out: 'Hư hỏng',
};

export function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Âm lịch (dùng chung thuật toán Hồ Ngọc Đức với server, chạy ngay trên trình duyệt) ----
const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
function julianDay(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}
/** Ngày âm, can chi của ngày và của năm, cho một ngày dương 'YYYY-MM-DD' (mặc định hôm nay giờ VN) */
export function lunarInfo(date = today()) {
  const [y, m, d] = date.split('-').map(Number);
  const l = solarToLunar(d, m, y);
  const jd = julianDay(y, m, d);
  return {
    day: l.day, month: l.month, leap: l.leap, year: l.year,
    dayCanChi: `${CAN[(jd + 9) % 10]} ${CHI[(jd + 1) % 12]}`,
    ...(() => { const e = elementOfLunarYear(l.year); return { yearCanChi: e.can_chi, yearElement: e.element, napAm: e.nap_am }; })(),
  };
}

/**
 * Tham số xuất đơn từ bộ lọc đang xem ở trang Đơn hàng (cùng tên tham số với danh sách để file khớp danh sách).
 * Bỏ các giá trị rỗng.
 */
export function exportQuery(filters, { layout = 'orders', format = 'csv' } = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, layout, format })) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}
