/** Ô nhập tiền: hiển thị 1.250.000, giữ giá trị số nguyên. */

/** Chuỗi gõ vào → chuỗi chỉ gồm chữ số ('' nếu rỗng); `allowNegative` giữ dấu − đứng đầu. */
export function parseMoneyInput(text, { allowNegative = false } = {}) {
  const s = String(text ?? '');
  const neg = allowNegative && /^\s*[-−]/.test(s);
  const digits = s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return neg ? '-' : '';
  return neg ? `-${digits}` : digits;
}

/** Giá trị (số hoặc chuỗi chữ số) → chuỗi hiển thị có dấu chấm ngăn nghìn. */
export function formatMoneyInput(value) {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (s === '-') return '-';
  const n = Math.trunc(Number(s));
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('vi-VN');
}

/** Chuỗi chữ số → số nguyên (null nếu rỗng). */
export function moneyToInt(value) {
  const d = parseMoneyInput(value, { allowNegative: true });
  return d === '' || d === '-' ? null : Number(d);
}
