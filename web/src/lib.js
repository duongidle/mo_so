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
