import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { PAYMENT_METHODS } from '../payments/service.js';
import { assertUnlocked } from '../../lib/period.js';

const db = () => getDb();

const shape = (a) => a && { ...a, methods: JSON.parse(a.methods || '[]') };

export function getAccount(id) {
  const a = shape(db().prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id));
  if (!a) throw notFound('Quỹ tiền');
  return a;
}

const marks = (arr) => arr.map(() => '?').join(',');

/** Tiền thu/chi và chuyển quỹ của một quỹ trong khoảng ngày (from có thể null = từ đầu) */
function flows(methods, from, to) {
  const lo = from || '0000-00-00';
  const sumPay = (dir) =>
    methods.length
      ? db().prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE voided_at IS NULL AND direction = ? AND method IN (${marks(methods)}) AND business_date >= ? AND business_date <= ?`).get(dir, ...methods, lo, to).v
      : 0;
  const exp = methods.length
    ? db().prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE voided_at IS NULL AND method IN (${marks(methods)}) AND expense_date >= ? AND expense_date <= ?`).get(...methods, lo, to).v
    : 0;
  // Mua tài sản / chi phí trả trước trả bằng phương thức của quỹ (phát sinh ở ngày mua)
  const assets = methods.length
    ? db().prepare(`SELECT COALESCE(SUM(cost),0) AS v FROM assets WHERE voided_at IS NULL AND paid_via IN (${marks(methods)}) AND start_date >= ? AND start_date <= ?`).get(...methods, lo, to).v
    : 0;
  return { cash_in: sumPay('in'), cash_out: sumPay('out'), expenses_out: exp, assets_out: assets };
}

function entriesSum(accountId, from, to) {
  return db().prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM cash_entries WHERE account_id = ? AND voided_at IS NULL AND entry_date >= ? AND entry_date <= ?`).get(accountId, from || '0000-00-00', to).v;
}

/**
 * Dòng tiền của chứng từ tay (phiếu thu/chi, bút toán tổng hợp) trên tài khoản 111x/112x của quỹ: Nợ − Có, mọi ngày đến asOf.
 * Chứng từ tay không được lập trước ngày mở sổ của quỹ (vouchers.js chặn) nên không cần cận dưới ngày.
 */
function manualSum(accountCode, asOf) {
  if (!accountCode) return 0;
  return db()
    .prepare(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_type = 'manual' AND e.voided_at IS NULL AND l.account_code = ? AND e.entry_date <= ?`)
    .get(accountCode, asOf).v;
}

/** Số dư tại cuối ngày asOf. Tính từ sổ, không lưu. */
export function balanceOf(account, asOf = businessDate()) {
  const f = flows(account.methods, account.opening_date, asOf);
  const entries = entriesSum(account.id, account.opening_date, asOf);
  const vouchers = manualSum(account.account_code, asOf);
  return {
    assets_out: f.assets_out,
    vouchers,
    opening_balance: account.opening_balance,
    cash_in: f.cash_in,
    cash_out: f.cash_out,
    expenses_out: f.expenses_out,
    entries,
    balance: account.opening_balance + f.cash_in - f.cash_out - f.expenses_out - f.assets_out + entries + vouchers,
  };
}

export function listAccounts({ asOf = businessDate(), includeArchived = false } = {}) {
  const accounts = db()
    .prepare(`SELECT * FROM cash_accounts ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort_order, created_at`)
    .all()
    .map(shape);
  const data = accounts.map((a) => ({ ...a, ...balanceOf(a, asOf) }));
  // Phương thức chưa gán cho quỹ nào: tiền vẫn ghi sổ nhưng không nằm trong quỹ nào → báo để người dùng gán
  const assigned = new Set(accounts.filter((a) => !a.archived_at).flatMap((a) => a.methods));
  const loose = PAYMENT_METHODS.filter((m) => !assigned.has(m));
  const looseFlows = flows(loose, null, asOf);
  const looseNet = looseFlows.cash_in - looseFlows.cash_out - looseFlows.expenses_out - looseFlows.assets_out;
  return {
    as_of: asOf,
    data,
    total_balance: data.filter((a) => !a.archived_at).reduce((s, a) => s + a.balance, 0),
    unassigned: { methods: loose, net: looseNet, has_activity: looseFlows.cash_in + looseFlows.cash_out + looseFlows.expenses_out + looseFlows.assets_out !== 0 },
  };
}

function assertMethods(methods, exceptId) {
  const bad = methods.filter((m) => !PAYMENT_METHODS.includes(m));
  if (bad.length) throw badRequest('INVALID_METHOD', `Phương thức không hợp lệ: ${bad.join(', ')}`);
  if (new Set(methods).size !== methods.length) throw badRequest('DUPLICATE_METHOD', 'Phương thức bị lặp');
  const others = db().prepare('SELECT id, name, methods FROM cash_accounts WHERE archived_at IS NULL AND id IS NOT ?').all(exceptId ?? null);
  for (const o of others) {
    const taken = JSON.parse(o.methods).filter((m) => methods.includes(m));
    if (taken.length) throw conflict('METHOD_TAKEN', `Phương thức ${taken.join(', ')} đã thuộc quỹ “${o.name}”. Bỏ khỏi quỹ đó trước.`, { account_id: o.id, methods: taken });
  }
}

export function createAccount(input, actor) {
  assertMethods(input.methods, null);
  const id = newId('cac');
  const at = nowIso();
  db()
    .prepare('INSERT INTO cash_accounts (id, name, kind, methods, opening_balance, opening_date, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, input.name, input.kind, JSON.stringify(input.methods), input.opening_balance ?? 0, input.opening_date ?? null, input.sort_order ?? 9, at, at);
  const a = getAccount(id);
  audit(actor, 'cash_account.created', 'cash_account', id, null, a);
  return { ...a, ...balanceOf(a) };
}

export function updateAccount(id, input, actor) {
  const before = getAccount(id);
  const m = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  if (input.methods) assertMethods(m.methods, id);
  if (input.archived_at && m.methods.length) throw conflict('ACCOUNT_HAS_METHODS', 'Quỹ còn nhận phương thức thanh toán. Chuyển các phương thức đó sang quỹ khác trước khi lưu trữ.');
  db()
    .prepare('UPDATE cash_accounts SET name=?, kind=?, methods=?, opening_balance=?, opening_date=?, sort_order=?, archived_at=?, updated_at=? WHERE id=?')
    .run(m.name, m.kind, JSON.stringify(m.methods), m.opening_balance, m.opening_date ?? null, m.sort_order, m.archived_at ?? null, nowIso(), id);
  const after = getAccount(id);
  audit(actor, 'cash_account.updated', 'cash_account', id, before, after);
  return { ...after, ...balanceOf(after) };
}

/** Chuyển tiền giữa hai quỹ (rút tiền ngân hàng về két, nộp tiền mặt vào ngân hàng…): hai dòng đối ứng, tổng số dư không đổi */
export function transfer({ fromId, toId, amount, date, note }, actor) {
  if (fromId === toId) throw badRequest('SAME_ACCOUNT', 'Hai quỹ phải khác nhau');
  const from = getAccount(fromId);
  const to = getAccount(toId);
  if (from.archived_at || to.archived_at) throw conflict('ACCOUNT_ARCHIVED', 'Quỹ đã lưu trữ');
  const d = date || businessDate();
  assertUnlocked(d, 'Chuyển quỹ');
  const pair = newId('cpr');
  const at = nowIso();
  const ins = db().prepare('INSERT INTO cash_entries (id, account_id, kind, amount, entry_date, pair_id, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  ins.run(newId('cen'), from.id, 'transfer', -amount, d, pair, note ?? null, actor?.id ?? null, at);
  ins.run(newId('cen'), to.id, 'transfer', amount, d, pair, note ?? null, actor?.id ?? null, at);
  audit(actor, 'cash.transfer', 'cash_account', from.id, null, { from: from.id, to: to.id, amount, date: d, pair });
  return { pair_id: pair, from_account_id: from.id, to_account_id: to.id, amount, date: d };
}

/**
 * Chốt số dư theo kiểm đếm thực tế: so với số dư hệ thống tại hôm nay, chênh bao nhiêu thì ghi một dòng điều chỉnh bấy nhiêu.
 * Không sửa thu chi cũ; chênh lệch luôn nhìn thấy được trong sổ quỹ.
 */
export function countAccount(id, { countedAmount, note }, actor) {
  const a = getAccount(id);
  if (a.archived_at) throw conflict('ACCOUNT_ARCHIVED', 'Quỹ đã lưu trữ');
  const today = businessDate();
  assertUnlocked(today, 'Kiểm đếm quỹ');
  const system = balanceOf(a, today).balance;
  const diff = countedAmount - system;
  if (diff !== 0) {
    db()
      .prepare('INSERT INTO cash_entries (id, account_id, kind, amount, entry_date, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(newId('cen'), a.id, 'adjust', diff, today, note || `Kiểm đếm: hệ thống ${system}, thực tế ${countedAmount}`, actor?.id ?? null, nowIso());
    audit(actor, 'cash.count_adjusted', 'cash_account', a.id, { balance: system }, { balance: countedAmount, diff });
  }
  return { account_id: a.id, system_balance: system, counted_amount: countedAmount, difference: diff, balance: balanceOf(a, today).balance };
}

/** Huỷ một dòng chuyển quỹ (cả hai phía) hoặc điều chỉnh. Không xoá cứng. */
export function voidEntry(id, actor) {
  const e = db().prepare('SELECT * FROM cash_entries WHERE id = ?').get(id);
  if (!e) throw notFound('Dòng sổ quỹ');
  if (e.voided_at) throw conflict('ALREADY_VOIDED', 'Dòng này đã huỷ');
  assertUnlocked(e.entry_date, 'Dòng sổ quỹ');
  const at = nowIso();
  if (e.pair_id) db().prepare('UPDATE cash_entries SET voided_at = ? WHERE pair_id = ? AND voided_at IS NULL').run(at, e.pair_id);
  else db().prepare('UPDATE cash_entries SET voided_at = ? WHERE id = ?').run(at, id);
  audit(actor, 'cash.entry_voided', 'cash_entry', id, e, null);
  return { voided: true, pair_id: e.pair_id };
}

/** Sổ quỹ: mọi dòng tiền vào/ra của quỹ trong khoảng, kèm số dư chạy */
export function ledger(id, { from, to = businessDate(), limit = 200 } = {}) {
  const a = getAccount(id);
  const methods = a.methods;
  const lo = a.opening_date && (!from || from < a.opening_date) ? a.opening_date : from || '0000-00-00';
  const parts = [];
  if (methods.length) {
    parts.push(
      ...db()
        .prepare(
          `SELECT p.id, p.business_date AS date, p.created_at AS at, CASE p.direction WHEN 'in' THEN p.amount ELSE -p.amount END AS amount,
                  'payment' AS source, p.ref_type, p.ref_id, p.method, p.note
           FROM payments p WHERE p.voided_at IS NULL AND p.method IN (${marks(methods)}) AND p.business_date >= ? AND p.business_date <= ?`,
        )
        .all(...methods, lo, to),
      ...db()
        .prepare(
          `SELECT e.id, e.expense_date AS date, e.created_at AS at, -e.amount AS amount, 'expense' AS source, 'expense' AS ref_type, e.id AS ref_id, e.method, COALESCE(e.payee, e.note) AS note
           FROM expenses e WHERE e.voided_at IS NULL AND e.method IN (${marks(methods)}) AND e.expense_date >= ? AND e.expense_date <= ?`,
        )
        .all(...methods, lo, to),
    );
  }
  parts.push(
    ...db()
      .prepare(`SELECT a.id, a.start_date AS date, a.created_at AS at, -a.cost AS amount, 'asset' AS source, 'asset' AS ref_type, a.id AS ref_id, a.paid_via AS method, a.name AS note FROM assets a WHERE a.voided_at IS NULL AND a.start_date >= ? AND a.start_date <= ? AND a.paid_via IN (${marks(methods.length ? methods : ['-'])})`)
      .all(lo, to, ...(methods.length ? methods : ['-'])),
    ...(a.account_code
      ? db()
          .prepare(`SELECT e.id, e.entry_date AS date, e.created_at AS at, l.debit - l.credit AS amount, 'voucher' AS source, 'voucher' AS ref_type, e.source_id AS ref_id, NULL AS method, e.description AS note FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_type = 'manual' AND e.voided_at IS NULL AND l.account_code = ? AND e.entry_date >= ? AND e.entry_date <= ?`)
          .all(a.account_code, lo, to)
      : []),
    ...db()
      .prepare(`SELECT id, entry_date AS date, created_at AS at, amount, kind AS source, NULL AS ref_type, pair_id AS ref_id, NULL AS method, note FROM cash_entries WHERE account_id = ? AND voided_at IS NULL AND entry_date >= ? AND entry_date <= ?`)
      .all(id, lo, to),
  );
  parts.sort((x, y) => x.date.localeCompare(y.date) || x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
  // Số dư trước dòng đầu tiên trong khoảng: số dư cuối ngày trước khoảng (hoặc số dư đầu nếu khoảng bắt đầu từ ngày mở sổ)
  const before = lo === (a.opening_date || '0000-00-00') || lo === '0000-00-00' ? a.opening_balance : balanceOf(a, addDay(lo, -1)).balance;
  let run = before;
  const rows = parts.map((r) => ({ ...r, balance: (run += r.amount) }));
  return { account: a, opening_balance: before, closing_balance: run, data: rows.slice(-limit) };
}

function addDay(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
