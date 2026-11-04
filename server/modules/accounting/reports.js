import { getDb } from '../../db/index.js';
import { businessDate, addDays } from '../../lib/time.js';
import { badRequest, notFound, conflict } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { flushJournal, verifyJournal } from './journal.js';
import { expenseItems, normalizeFilter } from '../reports/service.js';

const db = () => getDb();
const BEGIN = '0000-00-00';
const ph = (arr) => arr.map(() => '?').join(',');
const PL_TYPES = ['revenue', 'contra_revenue', 'expense'];

// ---------- Hệ thống tài khoản ----------
export function listAccounts({ asOf = businessDate(), withBalances = true } = {}) {
  flushJournal();
  const accounts = db().prepare('SELECT * FROM accounts ORDER BY code').all();
  if (!withBalances) return accounts;
  const sums = new Map(db().prepare('SELECT l.account_code AS c, SUM(l.debit) AS d, SUM(l.credit) AS k FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND e.entry_date <= ? GROUP BY l.account_code').all(asOf).map((r) => [r.c, r]));
  return accounts.map((a) => {
    const s = sums.get(a.code) || { d: 0, k: 0 };
    return { ...a, debit: s.d, credit: s.k, balance: a.normal_side === 'debit' ? s.d - s.k : s.k - s.d };
  });
}

export function createSubAccount({ parent_code, name }, actor) {
  const parent = db().prepare('SELECT * FROM accounts WHERE code = ?').get(parent_code);
  if (!parent) throw notFound('Tài khoản cha');
  if (parent.archived_at) throw conflict('ACCOUNT_ARCHIVED', 'Tài khoản cha đã lưu trữ');
  let n = db().prepare('SELECT COUNT(*) AS n FROM accounts WHERE parent_code = ?').get(parent_code).n + 1;
  while (db().prepare('SELECT 1 FROM accounts WHERE code = ?').get(`${parent_code}${n}`)) n++;
  const code = `${parent_code}${n}`;
  db().prepare('INSERT INTO accounts (code, name, type, parent_code, normal_side, is_system) VALUES (?,?,?,?,?,0)').run(code, name, parent.type, parent_code, parent.normal_side);
  const a = db().prepare('SELECT * FROM accounts WHERE code = ?').get(code);
  audit(actor, 'account.created', 'account', code, null, a);
  return a;
}

export function updateAccount(code, { name, archived }, actor) {
  const a = db().prepare('SELECT * FROM accounts WHERE code = ?').get(code);
  if (!a) throw notFound('Tài khoản');
  if (a.is_system) throw conflict('SYSTEM_ACCOUNT', 'Tài khoản hệ thống không đổi tên hoặc lưu trữ được');
  if (archived) {
    flushJournal();
    const used = db().prepare('SELECT 1 FROM journal_lines WHERE account_code = ? LIMIT 1').get(code);
    if (used) throw conflict('ACCOUNT_IN_USE', 'Tài khoản đã có bút toán, không lưu trữ được');
  }
  db().prepare('UPDATE accounts SET name = COALESCE(?, name), archived_at = CASE WHEN ? IS NULL THEN archived_at WHEN ? THEN ? ELSE NULL END WHERE code = ?').run(name ?? null, archived === undefined ? null : 1, archived ? 1 : 0, new Date().toISOString(), code);
  const after = db().prepare('SELECT * FROM accounts WHERE code = ?').get(code);
  audit(actor, 'account.updated', 'account', code, a, after);
  return after;
}

export function setCategoryAccount(categoryId, accountCode, actor) {
  const acc = db().prepare("SELECT * FROM accounts WHERE code = ? AND type = 'expense'").get(accountCode);
  if (!acc) throw badRequest('INVALID_ACCOUNT', 'Danh mục chi phí chỉ gán được cho tài khoản loại chi phí');
  if (!db().prepare('SELECT 1 FROM expense_categories WHERE id = ?').get(categoryId)) throw notFound('Danh mục chi phí');
  db().prepare('UPDATE expense_categories SET account_code = ? WHERE id = ?').run(accountCode, categoryId);
  audit(actor, 'expense_category.mapped', 'expense_category', categoryId, null, { account_code: accountCode });
  return db().prepare('SELECT * FROM expense_categories WHERE id = ?').get(categoryId);
}

/** Đường dẫn giao diện tới chứng từ gốc của một bút toán (để bấm từ sổ nhật ký/sổ cái mở chứng từ) */
function sourcePath(type, id) {
  switch (type) {
    case 'order': return `/orders/${id}`;
    case 'return': {
      const r = db().prepare('SELECT order_id FROM order_returns WHERE id = ?').get(id);
      return r ? `/orders/${r.order_id}` : null;
    }
    case 'payment': {
      const p = db().prepare('SELECT ref_type, ref_id FROM payments WHERE id = ?').get(id);
      return p?.ref_type === 'order' ? `/orders/${p.ref_id}` : p?.ref_type === 'purchase' ? '/purchases' : '/expenses?tab=cash';
    }
    case 'manual': return '/accounting?tab=vouchers';
    case 'asset': return '/accounting?tab=assets';
    case 'purchase': return '/purchases';
    case 'expense': return '/expenses';
    case 'stock': return '/stock';
    case 'cash_open':
    case 'cash_entry': return '/expenses?tab=cash';
    default: return null;
  }
}
const withPaths = (rows) => {
  const cache = new Map();
  return rows.map((r) => {
    const k = `${r.source_type}|${r.source_id}`;
    if (!cache.has(k)) cache.set(k, sourcePath(r.source_type, r.source_id));
    return { ...r, source_path: cache.get(k) };
  });
};

// ---------- Sổ nhật ký ----------
/** Con trỏ = "ngày|rowid" của bút toán cuối trang. Mới nhất trước. */
export function journal({ from, to, account, sourceType, shopIds, q, limit = 50, cursor } = {}) {
  flushJournal();
  const where = ['e.voided_at IS NULL'];
  const params = [];
  if (from) (where.push('e.entry_date >= ?'), params.push(from));
  if (to) (where.push('e.entry_date <= ?'), params.push(to));
  if (sourceType) (where.push('e.source_type = ?'), params.push(sourceType));
  if (shopIds?.length) (where.push(`e.shop_id IN (${ph(shopIds)})`), params.push(...shopIds));
  if (account) (where.push('EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = e.id AND x.account_code = ?)'), params.push(account));
  if (q) (where.push('(e.code LIKE ? OR e.description LIKE ?)'), params.push(`%${q}%`, `%${q}%`));
  if (cursor) {
    const [d, r] = cursor.split('|');
    where.push('(e.entry_date < ? OR (e.entry_date = ? AND e.rowid < ?))');
    params.push(d, d, Number(r));
  }
  const rows = db().prepare(`SELECT e.rowid AS rid, e.* FROM journal_entries e WHERE ${where.join(' AND ')} ORDER BY e.entry_date DESC, e.rowid DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const linesOf = db().prepare('SELECT l.*, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.code = l.account_code WHERE l.entry_id = ? ORDER BY l.sort_order');
  const data = withPaths(page.map(({ rid, ...e }) => {
    const lines = linesOf.all(e.id);
    return { ...e, lines, total: lines.reduce((a, l) => a + l.debit, 0) };
  }));
  const last = page[page.length - 1];
  return { data, next_cursor: hasMore ? `${last.entry_date}|${last.rid}` : null };
}

// ---------- Sổ cái ----------
/** Sổ cái một tài khoản (tài khoản cha: gồm các tài khoản con). Số dư theo chiều bình thường của tài khoản. */
export function ledger(code, { from, to = businessDate(), shopIds, limit = 1000 } = {}) {
  flushJournal();
  const acc = db().prepare('SELECT * FROM accounts WHERE code = ?').get(code);
  if (!acc) throw notFound('Tài khoản');
  const codes = [code, ...db().prepare('SELECT code FROM accounts WHERE parent_code = ?').all(code).map((c) => c.code)];
  const sign = acc.normal_side === 'debit' ? 1 : -1;
  const shopSql = shopIds?.length ? `AND l.shop_id IN (${ph(shopIds)})` : '';
  const sp = shopIds?.length ? shopIds : [];
  const lo = from || BEGIN;
  const open = from
    ? db().prepare(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code IN (${ph(codes)}) AND e.entry_date < ? ${shopSql}`).get(...codes, from, ...sp).v * sign
    : 0;
  const rows = db()
    .prepare(
      `SELECT e.id AS entry_id, e.code AS entry_code, e.entry_date, e.description, e.source_type, e.source_id, l.account_code, l.debit, l.credit, l.memo, l.shop_id, l.partner_type, l.partner_id
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.voided_at IS NULL AND l.account_code IN (${ph(codes)}) AND e.entry_date >= ? AND e.entry_date <= ? ${shopSql}
       ORDER BY e.entry_date, e.rowid, l.sort_order`,
    )
    .all(...codes, lo, to, ...sp);
  let run = open;
  const lines = withPaths(rows.map((r) => ({ ...r, balance: (run += (r.debit - r.credit) * sign) })));
  return {
    account: acc,
    from: from || null,
    to,
    opening_balance: open,
    debit: rows.reduce((a, r) => a + r.debit, 0),
    credit: rows.reduce((a, r) => a + r.credit, 0),
    closing_balance: run,
    truncated: lines.length > limit,
    data: lines.slice(-limit),
  };
}

// ---------- Cân đối phát sinh ----------
export function trialBalance({ from, to = businessDate() } = {}) {
  flushJournal();
  const lo = from || BEGIN;
  const accounts = db().prepare('SELECT * FROM accounts ORDER BY code').all();
  const agg = (sql, ...p) => new Map(db().prepare(sql).all(...p).map((r) => [r.c, r]));
  const base = 'SELECT l.account_code AS c, SUM(l.debit) AS d, SUM(l.credit) AS k FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND ';
  const before = agg(`${base} e.entry_date < ? GROUP BY l.account_code`, lo);
  const during = agg(`${base} e.entry_date >= ? AND e.entry_date <= ? GROUP BY l.account_code`, lo, to);
  const rows = [];
  for (const a of accounts) {
    const b = before.get(a.code) || { d: 0, k: 0 };
    const p = during.get(a.code) || { d: 0, k: 0 };
    if (!b.d && !b.k && !p.d && !p.k) continue;
    const ob = b.d - b.k;
    const cb = ob + p.d - p.k;
    rows.push({ code: a.code, name: a.name, type: a.type, opening_debit: Math.max(0, ob), opening_credit: Math.max(0, -ob), debit: p.d, credit: p.k, closing_debit: Math.max(0, cb), closing_credit: Math.max(0, -cb) });
  }
  const tot = (k) => rows.reduce((a, r) => a + r[k], 0);
  const totals = Object.fromEntries(['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'].map((k) => [k, tot(k)]));
  return { from: from || null, to, data: rows, totals, balanced: totals.opening_debit === totals.opening_credit && totals.debit === totals.credit && totals.closing_debit === totals.closing_credit };
}

// ---------- Kết quả kinh doanh ----------
const accountNames = () => new Map(db().prepare('SELECT code, name FROM accounts').all().map((a) => [a.code, a.name]));

/**
 * KQKD theo kỳ. Lọc shop: dòng ghi đúng shop + phần chi phí chung chia về shop theo ĐÚNG hàm của báo cáo (expenseItems),
 * nên lợi nhuận từng shop khớp báo cáo. Điều chỉnh kho/kiểm đếm quỹ không thuộc shop nào nên không vào KQKD của shop.
 * Cấu trúc: doanh thu thuần → giá vốn → lãi gộp → chi phí bán hàng (641x) và quản lý (642x) → lãi thuần HĐKD → thu/chi khác (711/811) → lãi trước thuế.
 */
export function incomeStatement({ from, to, shopIds } = {}) {
  flushJournal();
  const f = normalizeFilter({ from, to, shopIds });
  const shopSql = f.shopIds ? `AND l.shop_id IN (${ph(f.shopIds)})` : '';
  const rows = db()
    .prepare(
      `SELECT l.account_code AS c, (e.source_type = 'asset' AND l.account_code != '811') AS dep, SUM(l.debit) AS d, SUM(l.credit) AS k FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.code = l.account_code
       WHERE e.voided_at IS NULL AND a.type IN ('revenue','contra_revenue','expense') AND e.entry_date >= ? AND e.entry_date <= ? ${shopSql} GROUP BY l.account_code, dep`,
    )
    .all(f.from, f.to, ...(f.shopIds || []));
  const amt = new Map();
  const add = (code, v) => amt.set(code, (amt.get(code) || 0) + v);
  const names = accountNames();
  const depMap = new Map(); // khấu hao/phân bổ tài sản: tách riêng khỏi chi phí của báo cáo (không phải dòng chi phí)
  for (const r of rows) {
    if (r.dep) depMap.set(r.c, (depMap.get(r.c) || 0) + r.d - r.k);
    else add(r.c, names.has(r.c) && /^(5|7)/.test(r.c) && r.c !== '5212' ? r.k - r.d : r.d - r.k);
  }
  let sharedAllocated = 0;
  if (f.shopIds) {
    // Chi phí chung (ledger ghi shop NULL) → phần chia về shop đang xem, theo quy tắc phân bổ của báo cáo
    const cats = new Map(db().prepare('SELECT id, account_code FROM expense_categories').all().map((c) => [c.id, c.account_code || '6428']));
    for (const i of expenseItems(f)) {
      if (i.kind !== 'shared') continue;
      add(cats.get(i.category_id) || '6428', i.amount);
      sharedAllocated += i.amount;
    }
  }
  const g = (c) => amt.get(c) || 0;
  const detail = (re) => [...amt.entries()].filter(([c]) => re.test(c) && g(c) !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([code, amount]) => ({ code, name: names.get(code), amount }));
  const selling = detail(/^641/);
  const admin = detail(/^642/);
  const sum = (arr) => arr.reduce((a, r) => a + r.amount, 0);
  const depreciation = [...depMap.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([code, amount]) => ({ code, name: names.get(code), amount }));
  const revenueNet = g('5111') + g('5113') + g('5118') - g('5212');
  const gross = revenueNet - g('632');
  const operatingBeforeDep = gross - sum(selling) - sum(admin);
  const operating = operatingBeforeDep - sum(depreciation);
  return {
    filter: f,
    revenue_goods: g('5111'),
    revenue_shipping: g('5113'),
    revenue_return_fee: g('5118'), // phí trả hàng shop giữ lại
    returns: g('5212'),
    net_revenue: revenueNet,
    net_goods_revenue: g('5111') - g('5212'), // = "doanh thu thuần" của báo cáo bán hàng (chưa gồm phí ship khách trả)
    cogs: g('632'),
    gross_profit: gross,
    selling_expenses: selling,
    admin_expenses: admin,
    depreciation,
    depreciation_total: sum(depreciation),
    operating_profit_before_depreciation: operatingBeforeDep,
    operating_profit: operating,
    other_income: g('711'),
    other_expense: g('811'),
    profit_before_tax: operating + g('711') - g('811'),
    shared_expenses_allocated: sharedAllocated,
    by_account: Object.fromEntries(amt),
    scope: { shop_filtered: Boolean(f.shopIds), other_items_excluded: Boolean(f.shopIds), depreciation_not_in_reports: true },
  };
}

// ---------- Cân đối kế toán ----------
/** Luôn toàn tài khoản. Lợi nhuận mọi kỳ đến ngày xem chưa kết chuyển hiện thành "421 – lợi nhuận kỳ này". */
export function balanceSheet({ asOf = businessDate() } = {}) {
  flushJournal();
  const accounts = listAccounts({ asOf });
  const sec = (type) => accounts.filter((a) => a.type === type && a.balance !== 0).map((a) => ({ code: a.code, name: a.name, balance: a.type === 'asset' ? a.debit - a.credit : a.balance }));
  const assets = sec('asset');
  const liabilities = sec('liability');
  const equity = sec('equity');
  const profit = accounts.filter((a) => PL_TYPES.includes(a.type)).reduce((p, a) => p + a.credit - a.debit, 0);
  const total = (arr) => arr.reduce((a, r) => a + r.balance, 0);
  const totalAssets = total(assets);
  const totalLiab = total(liabilities);
  const totalEquity = total(equity) + profit;
  return {
    as_of: asOf,
    assets,
    total_assets: totalAssets,
    liabilities,
    total_liabilities: totalLiab,
    equity,
    current_profit: profit,
    total_equity: totalEquity,
    total_liabilities_equity: totalLiab + totalEquity,
    difference: totalAssets - totalLiab - totalEquity,
    balanced: totalAssets === totalLiab + totalEquity,
    scope: { account_wide: true },
  };
}

// ---------- Lưu chuyển tiền (trực tiếp) ----------
const CASH_GROUPS = {
  '131': ['Thu tiền khách / hoàn tiền khách', 'operating'],
  '1388': ['Tiền sàn trả về / hoàn', 'operating'],
  '331': ['Trả nhà cung cấp / NCC hoàn tiền', 'operating'],
  '3388': ['Chi trả khoản khác (phí sàn, ship, chi phí chưa trả)', 'operating'],
  '711': ['Chênh lệch kiểm đếm thừa', 'other'],
  '811': ['Chênh lệch kiểm đếm thiếu và chi khác', 'other'],
  '411': ['Vốn (số dư đầu, thu chi trước ngày mở sổ, góp/rút vốn)', 'equity'],
  '211': ['Mua tài sản cố định', 'investing'],
  '242': ['Chi phí trả trước (thuê, bảo hiểm…)', 'investing'],
};
const isCash = (c) => c.startsWith('111') || c.startsWith('112');

/** Lưu chuyển tiền trực tiếp từ các tài khoản tiền (111x, 112x), phân loại theo tài khoản đối ứng của bút toán */
export function cashFlowDirect({ from, to = businessDate(), shopIds } = {}) {
  flushJournal();
  const lo = from || BEGIN;
  const accounts = db().prepare("SELECT code FROM accounts WHERE code LIKE '111_%' OR code LIKE '112_%'").all().map((a) => a.code);
  const names = accountNames();
  const bal = (before) => (accounts.length ? db().prepare(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code IN (${ph(accounts)}) AND e.entry_date ${before ? '<' : '<='} ?`).get(...accounts, before ? lo : to).v : 0);
  const opening = bal(true);
  const shopSql = shopIds?.length ? `AND l.shop_id IN (${ph(shopIds)})` : '';
  const cashLines = accounts.length
    ? db().prepare(`SELECT l.entry_id, e.source_type, l.account_code, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code IN (${ph(accounts)}) AND e.entry_date >= ? AND e.entry_date <= ? ${shopSql}`).all(...accounts, lo, to, ...(shopIds || []))
    : [];
  const counters = db().prepare('SELECT account_code, debit, credit FROM journal_lines WHERE entry_id = ?');
  const groups = new Map();
  const put = (key, label, kind, inflow, outflow) => {
    const g = groups.get(key) || { key, label, kind, inflow: 0, outflow: 0 };
    g.inflow += inflow;
    g.outflow += outflow;
    groups.set(key, g);
  };
  const cache = new Map();
  for (const l of cashLines) {
    if (!cache.has(l.entry_id)) cache.set(l.entry_id, counters.all(l.entry_id).filter((x) => !isCash(x.account_code)));
    const other = cache.get(l.entry_id);
    const key = other[0]?.account_code ?? 'transfer';
    if (!other.length) put('transfer', 'Chuyển quỹ nội bộ (tổng bằng 0)', 'internal', l.debit, l.credit);
    else if (l.source_type === 'expense') put(`exp:${key}`, `Chi phí: ${names.get(key)}`, 'operating', l.debit, l.credit);
    else put(key, CASH_GROUPS[key]?.[0] ?? names.get(key) ?? key, CASH_GROUPS[key]?.[1] ?? 'other', l.debit, l.credit);
  }
  const data = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map((g) => ({ ...g, net: g.inflow - g.outflow }));
  const net = data.reduce((a, g) => a + g.net, 0);
  const operatingNet = data.filter((g) => g.kind === 'operating').reduce((a, g) => a + g.net, 0);
  return {
    from: from || null,
    to,
    opening_balance: opening,
    data,
    operating_net: operatingNet,
    net_change: net,
    closing_balance: opening + net,
    check_closing: bal(false),
    scope: { shop_filtered: Boolean(shopIds?.length), opening_closing_account_wide: Boolean(shopIds?.length) },
  };
}

// ---------- Tổng quan kế toán ----------
export function overview({ asOf = businessDate() } = {}) {
  flushJournal();
  const accounts = listAccounts({ asOf });
  const by = (re) => accounts.filter((a) => re.test(a.code)).reduce((s, a) => s + (a.debit - a.credit), 0);
  const monthFrom = `${asOf.slice(0, 7)}-01`;
  const month = incomeStatement({ from: monthFrom, to: asOf });
  const transit = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l WHERE l.account_code = '1131'").get();
  const warnings = [];
  if (transit.n > 0) warnings.push({ code: 'UNASSIGNED_METHOD', message: `${transit.n} dòng tiền thuộc phương thức chưa gán quỹ nào (tài khoản 1131, ${transit.v} ₫). Gán phương thức vào quỹ ở Chi phí & quỹ → Quỹ tiền.`, amount: transit.v });
  const bad = db().prepare('SELECT COUNT(*) AS n FROM journal_dirty').get().n;
  if (bad) warnings.push({ code: 'DIRTY', message: 'Sổ đang chờ tính lại.' });
  return {
    as_of: asOf,
    cash: by(/^11[12]\d/),
    receivable_customers: by(/^131$/),
    receivable_marketplace: by(/^1388$/),
    inventory: by(/^156$/),
    payable_suppliers: -by(/^331$/),
    month_from: monthFrom,
    month_profit: month.profit_before_tax,
    month_net_revenue: month.net_revenue,
    warnings,
  };
}

export { verifyJournal };
