import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';
import { today as clockToday } from '../../lib/clock.js';
import { badRequest } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { writeSetting } from '../settings/service.js';
import { lockDate } from '../../lib/period.js';
import { flushJournal } from './journal.js';

const db = () => getDb();

/** Số dư ròng (Nợ − Có) từng tài khoản đến hết ngày khoá, và băm của chúng */
function balancesAt(date) {
  flushJournal();
  const rows = db().prepare('SELECT l.account_code AS c, SUM(l.debit - l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND e.entry_date <= ? GROUP BY l.account_code HAVING v != 0 ORDER BY l.account_code').all(date);
  const balances = Object.fromEntries(rows.map((r) => [r.c, r.v]));
  return { balances, hash: crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.c, r.v]))).digest('hex') };
}

function takeSnapshot(date) {
  const { balances, hash } = balancesAt(date);
  db().prepare('DELETE FROM period_lock_snapshots').run();
  db().prepare('INSERT INTO period_lock_snapshots (lock_date, taken_at, hash, balances) VALUES (?,?,?,?)').run(date, nowIso(), hash, JSON.stringify(balances));
}

/** Đặt (hoặc bỏ, date = null) ngày khoá sổ và chụp số liệu của kỳ đã khoá để sau này phát hiện thay đổi */
export function setLock(date, actor) {
  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw badRequest('INVALID_DATE', 'Ngày khoá sổ phải là YYYY-MM-DD');
    if (date > clockToday()) throw badRequest('INVALID_DATE', 'Không khoá sổ đến ngày ở tương lai');
  }
  const before = lockDate();
  writeSetting('accounting_lock_date', date);
  if (date) takeSnapshot(date);
  else db().prepare('DELETE FROM period_lock_snapshots').run();
  audit(actor, date ? 'accounting.locked' : 'accounting.unlocked', 'settings', 'accounting_lock_date', { lock_date: before }, { lock_date: date });
  return lockStatus();
}

/**
 * Trạng thái khoá và các thay đổi sau khoá: so số dư hiện tại (đến ngày khoá) với ảnh chụp lúc khoá.
 * Đơn/phiếu nhập trong kỳ khoá vẫn sửa được nên số có thể đổi; ở đây chỉ báo, không chặn.
 */
export function lockStatus() {
  const date = lockDate();
  if (!date) return { lock_date: null, changed: false, changes: [] };
  let snap = db().prepare('SELECT * FROM period_lock_snapshots WHERE lock_date = ?').get(date);
  if (!snap) {
    // Ngày khoá đặt thẳng qua PATCH /settings: chụp lần đầu ngay lúc này
    takeSnapshot(date);
    snap = db().prepare('SELECT * FROM period_lock_snapshots WHERE lock_date = ?').get(date);
  }
  const now = balancesAt(date);
  const old = JSON.parse(snap.balances);
  const changes = [];
  const names = new Map(db().prepare('SELECT code, name FROM accounts').all().map((a) => [a.code, a.name]));
  for (const code of new Set([...Object.keys(old), ...Object.keys(now.balances)])) {
    const was = old[code] || 0;
    const is = now.balances[code] || 0;
    if (was !== is) changes.push({ code, name: names.get(code), at_lock: was, now: is, diff: is - was });
  }
  return { lock_date: date, locked_at: snap.taken_at, changed: now.hash !== snap.hash, changes };
}

export function lockWarnings() {
  const s = lockStatus();
  if (!s.changed) return [];
  return [{ code: 'LOCKED_PERIOD_CHANGED', message: `Kỳ đã khoá (đến ${s.lock_date}) có thay đổi sau khoá ở ${s.changes.length} tài khoản. Xem chi tiết ở tab Khoá sổ.`, changes: s.changes }];
}
