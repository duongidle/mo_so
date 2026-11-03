import { config } from './config.js';

export const nowIso = () => new Date().toISOString();

/** Ngày kinh doanh (YYYY-MM-DD) theo múi giờ VN của một thời điểm */
export function businessDate(iso = nowIso(), tz = config.businessTz) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** YYMMDD theo giờ VN, dùng trong mã chứng từ */
export function compactDate(iso = nowIso()) {
  return businessDate(iso).slice(2).replaceAll('-', '');
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/** Chuẩn hoá giá trị ngày/giờ người dùng nhập về ISO UTC. Chấp nhận 'YYYY-MM-DD' (hiểu là 12:00 giờ VN) hoặc ISO đầy đủ. */
export function toIso(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00+07:00`).toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
