// Giới hạn tần suất đơn giản trong bộ nhớ (đủ cho một máy chủ). Cửa sổ trượt theo khoá.
const hits = new Map();

/** Trả true nếu còn trong hạn mức và ghi nhận một lần; false nếu đã vượt. */
export function allow(key, max, windowMs = 3600_000, now = Date.now()) {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}

export const resetRateLimits = () => hits.clear();
