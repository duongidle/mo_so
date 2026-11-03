import { getDb } from '../db/index.js';
import { compactDate } from './time.js';

/** Tăng bộ đếm và trả về giá trị mới. Phải gọi trong transaction. */
export function nextSeq(name) {
  const db = getDb();
  db.prepare(
    'INSERT INTO sequences (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1',
  ).run(name);
  return db.prepare('SELECT value FROM sequences WHERE name = ?').get(name).value;
}

/** Mã chứng từ theo ngày: DH-NH-261103-001 */
export function dailyCode(kind, shopCode, iso) {
  const day = compactDate(iso);
  const n = nextSeq(`${kind}:${shopCode || '_'}:${day}`);
  return [kind, shopCode, day, String(n).padStart(3, '0')].filter(Boolean).join('-');
}

/** Mã liên tục: KH-00001 */
export function runningCode(kind, width = 5) {
  return `${kind}-${String(nextSeq(kind)).padStart(width, '0')}`;
}
