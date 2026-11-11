// Tiền là số nguyên VND. Mọi phép chia làm tròn về đồng.

export function toVnd(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value);
  // Chấp nhận "1.250.000", "1,250,000", "1250000 ₫"
  const cleaned = String(value).replace(/[^\d-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Chia một tổng tiền theo tỷ lệ trọng số, đảm bảo tổng các phần = tổng gốc */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || weights.length === 0) return weights.map(() => 0);
  if (sum === 0) {
    const base = Math.floor(total / weights.length);
    const out = weights.map(() => base);
    out[out.length - 1] += total - base * weights.length;
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let remainder = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) out[order[k][1]] += 1;
  return out;
}

/** Chuẩn hoá số lượng về tối đa 3 chữ số thập phân (tránh 10.042000000001 sau cộng trừ). */
export function qty3(n) {
  return Math.round(n * 1000) / 1000;
}

/** Số lượng dưới dạng số nguyên nghìn (milli-đơn vị), dùng cho phép tính chính xác. */
const milli = (q) => Math.round(q * 1000);

/**
 * Thành tiền = số lượng × đơn giá, làm tròn về đồng MỘT lần (nửa đồng làm tròn ra xa số 0).
 * Tính qua số nguyên nghìn nên 0,333 × 45.500 không bị sai do số thực. Đây là chỗ DUY NHẤT nhân SL × giá;
 * mọi tổng cộng phải cộng các số nguyên đã làm tròn này, không nhân lại.
 */
export function lineAmount(qty, unitPrice) {
  const num = BigInt(milli(qty)) * BigInt(Math.round(unitPrice));
  return divRound(num, 1000n);
}

/**
 * Phần của một số tiền nguyên ứng với `part` trên `whole` (cùng đơn vị số lượng): round(total × part / whole).
 * Dùng cho luỹ kế khi trả/nhập lại một phần: giá trị luỹ kế sau lần này − tổng đã ghi trước đó.
 */
export function shareOf(total, part, whole) {
  const w = milli(whole);
  if (w === 0) return 0;
  return divRound(BigInt(Math.round(total)) * BigInt(milli(part)), BigInt(w));
}

function divRound(num, den) {
  const neg = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (2n * a + b) / (2n * b);
  return Number(neg ? -q : q);
}

export function formatVnd(n) {
  return `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
}
