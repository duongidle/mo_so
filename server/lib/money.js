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

export function formatVnd(n) {
  return `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
}
