/** Tổng Nợ / Có của các dòng bút toán đang nhập và độ lệch (dùng cho kiểm tra cân ngay trên form). */
export function balanceOfLines(lines) {
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  const debit = lines.reduce((a, l) => a + num(l.debit), 0);
  const credit = lines.reduce((a, l) => a + num(l.credit), 0);
  return { debit, credit, diff: debit - credit, balanced: debit === credit && debit > 0 };
}

/** Mỗi dòng chỉ có Nợ hoặc Có (> 0), và đã chọn tài khoản */
export function lineProblems(lines) {
  const num = (v) => Math.round(Number(v) || 0);
  const p = [];
  lines.forEach((l, i) => {
    if (!l.account_code) p.push(`Dòng ${i + 1}: chọn tài khoản`);
    else if ((num(l.debit) > 0) === (num(l.credit) > 0)) p.push(`Dòng ${i + 1}: nhập số tiền ở Nợ hoặc ở Có (không cả hai, không để trống)`);
  });
  return p;
}

/** Lọc tài khoản theo mã hoặc tên (không phân biệt hoa thường/dấu), bỏ tài khoản tổng và đã lưu trữ */
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
export function searchAccounts(accounts, text, { postableOnly = true } = {}) {
  const t = fold(text.trim());
  return accounts.filter((a) => !a.archived_at && (!postableOnly || !['111', '112', '1131'].includes(a.code)) && (!t || fold(`${a.code} ${a.name}`).includes(t)));
}

/** Gợi ý tài khoản đối ứng mặc định cho phiếu thu/chi */
export const RECEIPT_ACCOUNTS = [['411', 'Vốn góp'], ['711', 'Thu nhập khác'], ['131', 'Thu nợ khách'], ['3388', 'Khoản phải trả khác']];
export const PAYMENT_ACCOUNTS = [['811', 'Tiền phạt, chi khác'], ['411', 'Rút vốn'], ['331', 'Trả nợ người bán'], ['3388', 'Trả khoản phải trả khác']];
