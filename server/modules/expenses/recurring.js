import { getDb, tx } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { today as clockToday } from '../../lib/clock.js';
import { notFound, badRequest, conflict, AppError } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { dueDates, listDue, periodKey } from '../../lib/schedule.js';
import { createExpense } from './service.js';

const db = () => getDb();

const get = (id) => {
  const r = db().prepare('SELECT r.*, c.name AS category_name, s.name AS shop_name FROM recurring_expenses r JOIN expense_categories c ON c.id = r.category_id LEFT JOIN shops s ON s.id = r.shop_id WHERE r.id = ?').get(id);
  if (!r) throw notFound('Chi phí định kỳ');
  return r;
};

/** Kỳ đã có chi phí (kể cả đã huỷ: huỷ rồi thì không tạo lại) */
const createdKeys = (id) => new Set(db().prepare('SELECT period_key FROM expenses WHERE recurring_id = ?').all(id).map((r) => r.period_key));

/** Kỳ chưa tạo gần nhất kể từ lúc bắt đầu/tiếp tục; null nếu đã hết hạn */
function nextPending(rec) {
  const keys = createdKeys(rec.id);
  for (const d of dueDates(rec, { notBefore: rec.skip_before })) if (!keys.has(periodKey(rec.frequency, d))) return d;
  return null;
}

const refresh = (id) => {
  const rec = get(id);
  db().prepare('UPDATE recurring_expenses SET next_run_date = ?, updated_at = ? WHERE id = ?').run(nextPending(rec), nowIso(), id);
  return get(id);
};

function validate(m) {
  if (m.frequency === 'weekly' ? !(m.day_of_period >= 1 && m.day_of_period <= 7) : !(m.day_of_period >= 1 && m.day_of_period <= 31)) {
    throw badRequest('INVALID_DAY', m.frequency === 'weekly' ? 'Chi phí hằng tuần: chọn thứ 1 (thứ Hai) đến 7 (Chủ nhật)' : 'Ngày trong kỳ phải từ 1 đến 31');
  }
  if (m.end_date && m.end_date < m.start_date) throw badRequest('INVALID_RANGE', 'Ngày kết thúc phải sau ngày bắt đầu');
  if (!db().prepare('SELECT 1 FROM expense_categories WHERE id = ?').get(m.category_id)) throw notFound('Danh mục chi phí');
  if (m.shop_id && !db().prepare('SELECT 1 FROM shops WHERE id = ?').get(m.shop_id)) throw notFound('Shop');
}

export function listRecurring({ includeArchived = false } = {}) {
  const rows = db().prepare(`SELECT r.*, c.name AS category_name, s.name AS shop_name FROM recurring_expenses r JOIN expense_categories c ON c.id = r.category_id LEFT JOIN shops s ON s.id = r.shop_id ${includeArchived ? '' : 'WHERE r.archived_at IS NULL'} ORDER BY r.created_at`).all();
  return rows.map((r) => ({ ...r, created_count: db().prepare('SELECT COUNT(*) AS n FROM expenses WHERE recurring_id = ?').get(r.id).n }));
}

export const getRecurring = get;

export function createRecurring(input, actor) {
  validate(input);
  const id = newId('rex');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO recurring_expenses (id, name, category_id, shop_id, channel_id, amount, method, payee, frequency, day_of_period, start_date, end_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.name, input.category_id, input.shop_id ?? null, input.channel_id ?? null, input.amount, input.method ?? 'cash', input.payee ?? null, input.frequency, input.day_of_period, input.start_date, input.end_date ?? null, at, at);
  const r = refresh(id);
  audit(actor, 'recurring_expense.created', 'recurring_expense', id, null, r);
  return r;
}

export function updateRecurring(id, input, actor) {
  const before = get(id);
  const m = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  validate(m);
  db()
    .prepare('UPDATE recurring_expenses SET name=?, category_id=?, shop_id=?, channel_id=?, amount=?, method=?, payee=?, frequency=?, day_of_period=?, start_date=?, end_date=?, updated_at=? WHERE id=?')
    .run(m.name, m.category_id, m.shop_id ?? null, m.channel_id ?? null, m.amount, m.method, m.payee ?? null, m.frequency, m.day_of_period, m.start_date, m.end_date ?? null, nowIso(), id);
  const after = refresh(id);
  audit(actor, 'recurring_expense.updated', 'recurring_expense', id, before, after);
  return after;
}

export function setPaused(id, paused, actor, now = clockToday()) {
  const before = get(id);
  // Tiếp tục: không tạo bù các kỳ trong thời gian tạm dừng
  db().prepare('UPDATE recurring_expenses SET paused_at = ?, skip_before = CASE WHEN ? THEN skip_before ELSE ? END, updated_at = ? WHERE id = ?').run(paused ? nowIso() : null, paused ? 1 : 0, now, nowIso(), id);
  const after = refresh(id);
  audit(actor, paused ? 'recurring_expense.paused' : 'recurring_expense.resumed', 'recurring_expense', id, before, after);
  return after;
}

/** Không xoá cứng: lưu trữ. Các chi phí đã tạo giữ nguyên. */
export function archiveRecurring(id, actor) {
  const before = get(id);
  db().prepare('UPDATE recurring_expenses SET archived_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  audit(actor, 'recurring_expense.archived', 'recurring_expense', id, before, null);
  return get(id);
}

/** Xem trước các kỳ sắp tới (chưa tạo): kể từ hôm nay */
export function preview(id, { count = 6, now = clockToday() } = {}) {
  const rec = get(id);
  const keys = createdKeys(id);
  const out = [];
  for (const d of dueDates(rec, { notBefore: rec.skip_before })) {
    if (keys.has(periodKey(rec.frequency, d))) continue;
    out.push({ date: d, period_key: periodKey(rec.frequency, d), amount: rec.amount, overdue: d < now });
    if (out.length >= count) break;
  }
  return out;
}

function make(rec, date, actor) {
  return createExpense(
    { category_id: rec.category_id, shop_id: rec.shop_id, channel_id: rec.channel_id, amount: rec.amount, expense_date: date, payee: rec.payee ?? rec.name, method: rec.method, note: `Định kỳ: ${rec.name}`, recurring_id: rec.id, period_key: periodKey(rec.frequency, date) },
    actor,
  );
}

/** "Tạo ngay kỳ này": tạo chi phí của kỳ hiện tại (tháng/tuần/năm chứa hôm nay) nếu chưa có */
export function runNow(id, actor, now = clockToday()) {
  const rec = get(id);
  if (rec.archived_at) throw conflict('ARCHIVED', 'Chi phí định kỳ đã lưu trữ');
  const key = periodKey(rec.frequency, now);
  const date = listDue(rec, { limit: 100000 }).find((d) => periodKey(rec.frequency, d) === key);
  if (!date) throw conflict('NO_PERIOD', 'Kỳ này nằm ngoài thời gian áp dụng của chi phí định kỳ');
  if (createdKeys(id).has(key)) throw conflict('ALREADY_CREATED', 'Kỳ này đã có chi phí');
  const e = make(rec, date > now ? now : date, actor);
  refresh(id);
  return e;
}

/**
 * Tạo mọi chi phí đến hạn (ngày ≤ hôm nay) chưa có, kể cả các kỳ bỏ lỡ lúc server tắt (bù). Chạy lại nhiều lần không tạo trùng
 * (unique recurring_id + period_key). Kỳ đã khoá sổ bị bỏ qua và báo lại; không tự sửa số liệu kỳ đã khoá.
 */
export function runDue(now = clockToday(), actor = null) {
  const recs = db().prepare('SELECT * FROM recurring_expenses WHERE paused_at IS NULL AND archived_at IS NULL').all();
  let created = 0;
  let skippedLocked = 0;
  for (const rec of recs) {
    const keys = createdKeys(rec.id);
    for (const d of listDue(rec, { upTo: now, notBefore: rec.skip_before, limit: 100000 })) {
      if (keys.has(periodKey(rec.frequency, d))) continue;
      try {
        tx(() => make(rec, d, actor));
        created++;
      } catch (e) {
        if (e instanceof AppError && e.code === 'PERIOD_LOCKED') skippedLocked++;
        else throw e;
      }
    }
    refresh(rec.id);
  }
  return { created, skipped_locked: skippedLocked };
}
