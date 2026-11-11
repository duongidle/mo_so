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

// ---------- Làm tròn tiền theo số lượng lẻ (giống server/lib/money.js) ----------
const milli = (q) => Math.round(Number(q) * 1000);
function divRound(num, den) {
  const neg = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (2n * a + b) / (2n * b);
  return Number(neg ? -q : q);
}

/** Thành tiền = SL × đơn giá, làm tròn về đồng một lần (SL có thể lẻ tới 3 chữ số). */
export function lineAmount(qty, unitPrice) {
  return divRound(BigInt(milli(qty || 0)) * BigInt(Math.round(Number(unitPrice) || 0)), 1000n);
}

/** round(total × part / whole), dùng cho giá trị luỹ kế khi trả một phần. */
export function shareOf(total, part, whole) {
  const w = milli(whole);
  return w === 0 ? 0 : divRound(BigInt(Math.round(total)) * BigInt(milli(part)), BigInt(w));
}
