import { allocate } from './money.js';
import { addDays } from './time.js';

/**
 * Hàm thuần về lịch: chi phí định kỳ và khấu hao/phân bổ. Không đụng DB, không đọc đồng hồ (ngày truyền vào).
 * Mọi ngày là chuỗi YYYY-MM-DD theo giờ VN.
 */
const pad = (n) => String(n).padStart(2, '0');
export const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s) => [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];

/** Ngày `day` của tháng (y, m); tháng ngắn hơn thì lấy ngày cuối tháng (31/2 → 28 hoặc 29) */
export const clampedDate = (y, m, day) => ymd(y, m, Math.min(day, lastDayOfMonth(y, m)));

/** Cộng n tháng vào (y, m) → [y, m] */
export function addMonths(y, m, n) {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

export const mondayOf = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Khoá kỳ: duy nhất cho mỗi kỳ của một chi phí định kỳ */
export function periodKey(frequency, date) {
  if (frequency === 'monthly') return date.slice(0, 7);
  if (frequency === 'yearly') return date.slice(0, 4);
  return `W${mondayOf(date)}`; // weekly: theo thứ Hai của tuần
}

/**
 * Các ngày đến hạn của một chi phí định kỳ theo thứ tự tăng dần, từ max(start_date, notBefore) đến end_date (nếu có).
 * monthly: ngày day_of_period (1–31) mỗi tháng, tháng ngắn lấy ngày cuối tháng.
 * weekly: thứ day_of_period (1 = thứ Hai … 7 = Chủ nhật) mỗi tuần.
 * yearly: ngày day_of_period của tháng trong start_date, mỗi năm.
 * Trả generator (vô hạn nếu không có end_date): dùng với `limit`/`upTo`.
 */
export function* dueDates(rec, { notBefore } = {}) {
  const lo = notBefore && notBefore > rec.start_date ? notBefore : rec.start_date;
  const hi = rec.end_date || null;
  const [sy, sm] = parts(rec.start_date);
  let guard = 0;
  if (rec.frequency === 'weekly') {
    let d = addDays(mondayOf(rec.start_date), rec.day_of_period - 1);
    while (guard++ < 100000) {
      if (hi && d > hi) return;
      if (d >= lo) yield d;
      d = addDays(d, 7);
    }
    return;
  }
  for (let i = 0; guard++ < 100000; i++) {
    const [y, m] = rec.frequency === 'yearly' ? [sy + i, sm] : addMonths(sy, sm, i);
    const d = clampedDate(y, m, rec.day_of_period);
    if (hi && d > hi) return;
    if (d >= lo) yield d;
  }
}

/** Tối đa `limit` ngày đến hạn đầu tiên, tuỳ chọn trong (after, upTo] */
export function listDue(rec, { after, upTo, limit = 1000, notBefore } = {}) {
  const out = [];
  for (const d of dueDates(rec, { notBefore })) {
    if (upTo && d > upTo) break;
    if (after && d <= after) continue;
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Lịch khấu hao / phân bổ: `months` kỳ, kỳ đầu là tháng của start_date, mỗi kỳ ghi vào NGÀY CUỐI THÁNG.
 * Chia nguyên giá bằng allocate() nên tổng các kỳ đúng bằng nguyên giá (phần dư rải từ kỳ đầu).
 */
export function depreciationSchedule({ cost, months, start_date }) {
  const [sy, sm] = parts(start_date);
  const amounts = allocate(cost, Array(months).fill(1));
  return amounts.map((amount, i) => {
    const [y, m] = addMonths(sy, sm, i);
    return { period: `${y}-${pad(m)}`, date: ymd(y, m, lastDayOfMonth(y, m)), amount };
  });
}

/** Các kỳ đã hạch toán tính đến `today`; tài sản đã thanh lý thì dừng ở ngày thanh lý (kỳ cuối tháng sau ngày đó không tính) */
export function postedPeriods(asset, today) {
  const cutoff = asset.disposed_at && asset.disposed_at < today ? asset.disposed_at : today;
  return depreciationSchedule(asset).filter((p) => p.date <= cutoff);
}

/** Giá trị đã khấu hao luỹ kế và giá trị còn lại tại `today` (sau thanh lý còn lại = 0) */
export function assetStatus(asset, today) {
  const posted = postedPeriods(asset, today);
  const accumulated = posted.reduce((a, p) => a + p.amount, 0);
  const disposed = Boolean(asset.disposed_at && asset.disposed_at <= today);
  return { accumulated, remaining: disposed ? 0 : asset.cost - accumulated, disposed, disposal_loss: disposed ? asset.cost - accumulated : 0, posted_count: posted.length };
}
