import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { runningCode } from '../../lib/codes.js';
import { badRequest, notFound, conflict } from '../../lib/errors.js';
import { emit, audit } from '../../lib/events.js';
import { assertUnlocked } from '../../lib/period.js';

const db = () => getDb();
const PREFIX = { receipt: 'PT', payment: 'PC', journal: 'BT' };
const NOT_POSTABLE = new Set(['111', '112', '1131']); // tài khoản tổng / tiền đang chuyển: chỉ hạch toán vào tài khoản quỹ cụ thể (111x/112x)
const isCashCode = (c) => /^11[12]\d+$/.test(c);

/**
 * Chứng từ tay = dòng `vouchers` + bút toán `manual` (is_auto = 0) trong sổ nhật ký. Bút toán tay không bao giờ bị sinh lại.
 * - Phiếu thu khác: Nợ quỹ / Có tài khoản đối ứng (411 vốn góp, 711 thu nhập khác…).
 * - Phiếu chi khác: Nợ tài khoản đối ứng (811 tiền phạt, 411 rút vốn…) / Có quỹ.
 * - Bút toán tổng hợp: nhiều dòng tự do, Σ Nợ = Σ Có.
 * Dòng trên tài khoản quỹ (111x/112x) được cash/balanceOf cộng vào số dư quỹ nên số dư quỹ luôn bằng số dư sổ cái.
 */
function buildLines(input) {
  if (input.type === 'journal') {
    const lines = (input.lines || []).map((l) => ({ account_code: l.account_code, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo ?? null }));
    if (lines.length < 2) throw badRequest('TOO_FEW_LINES', 'Bút toán cần ít nhất hai dòng');
    if (lines.some((l) => !(l.debit > 0 !== l.credit > 0))) throw badRequest('INVALID_LINE', 'Mỗi dòng chỉ có số tiền ở Nợ hoặc ở Có (lớn hơn 0)');
    return lines;
  }
  if (!input.cash_account_id) throw badRequest('CASH_ACCOUNT_REQUIRED', 'Chọn quỹ tiền');
  if (!input.account_code) throw badRequest('ACCOUNT_REQUIRED', 'Chọn tài khoản đối ứng');
  if (!(input.amount > 0)) throw badRequest('INVALID_AMOUNT', 'Số tiền phải lớn hơn 0');
  if (isCashCode(input.account_code)) throw badRequest('USE_TRANSFER', 'Tài khoản đối ứng là quỹ tiền: dùng chuyển quỹ ở Chi phí & quỹ');
  const cash = db().prepare('SELECT * FROM cash_accounts WHERE id = ?').get(input.cash_account_id);
  if (!cash) throw notFound('Quỹ tiền');
  if (cash.archived_at) throw conflict('ACCOUNT_ARCHIVED', 'Quỹ đã lưu trữ');
  const memo = input.memo ?? null;
  return input.type === 'receipt'
    ? [{ account_code: cash.account_code, debit: input.amount, credit: 0, memo }, { account_code: input.account_code, debit: 0, credit: input.amount, memo }]
    : [{ account_code: input.account_code, debit: input.amount, credit: 0, memo }, { account_code: cash.account_code, debit: 0, credit: input.amount, memo }];
}

function validate(input, lines) {
  const accs = new Map(db().prepare('SELECT code, archived_at FROM accounts').all().map((a) => [a.code, a]));
  for (const l of lines) {
    const a = accs.get(l.account_code);
    if (!a) throw badRequest('INVALID_ACCOUNT', `Tài khoản ${l.account_code} không tồn tại`);
    if (a.archived_at) throw conflict('ACCOUNT_ARCHIVED', `Tài khoản ${l.account_code} đã lưu trữ`);
    if (NOT_POSTABLE.has(l.account_code)) throw badRequest('ACCOUNT_NOT_POSTABLE', `Tài khoản ${l.account_code} là tài khoản tổng: chọn tài khoản quỹ cụ thể (vd 1111) hoặc tài khoản khác`);
  }
  const sum = (k) => lines.reduce((a, l) => a + l[k], 0);
  if (sum('debit') !== sum('credit')) throw badRequest('UNBALANCED', `Bút toán không cân: Nợ ${sum('debit')} khác Có ${sum('credit')}`, { debit: sum('debit'), credit: sum('credit') });
  // Dòng tiền không được lập trước ngày mở sổ của quỹ: số dư đầu đã gồm mọi thứ trước đó
  const cashAccs = db().prepare('SELECT account_code, opening_date, name FROM cash_accounts').all();
  for (const l of lines) {
    const c = cashAccs.find((x) => x.account_code === l.account_code);
    if (c?.opening_date && input.voucher_date < c.opening_date) throw badRequest('CASH_BEFORE_OPENING', `Quỹ “${c.name}” mở sổ từ ${c.opening_date}: không lập chứng từ tiền trước ngày đó`);
  }
  if (input.shop_id && !db().prepare('SELECT 1 FROM shops WHERE id = ?').get(input.shop_id)) throw notFound('Shop');
  if (input.partner_type) {
    const t = input.partner_type === 'customer' ? 'customers' : input.partner_type === 'supplier' ? 'suppliers' : null;
    if (!t || !input.partner_id || !db().prepare(`SELECT 1 FROM ${t} WHERE id = ?`).get(input.partner_id)) throw notFound('Đối tác');
  }
}

function writeEntry(entryId, code, input, lines) {
  const shop = input.shop_id ?? null;
  const partner = input.partner_type ? { t: input.partner_type, i: input.partner_id } : { t: null, i: null };
  const ins = db().prepare('INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, shop_id, channel_id, partner_type, partner_id, memo, sort_order) VALUES (?,?,?,?,?,?,NULL,?,?,?,?)');
  lines.forEach((l, i) => ins.run(newId('jl'), entryId, l.account_code, l.debit, l.credit, shop, isCashCode(l.account_code) ? null : partner.t, isCashCode(l.account_code) ? null : partner.i, l.memo, i));
}

const shape = (v) => {
  if (!v) return v;
  const lines = v.entry_id ? db().prepare('SELECT l.account_code, a.name AS account_name, l.debit, l.credit, l.memo FROM journal_lines l JOIN accounts a ON a.code = l.account_code WHERE l.entry_id = ? ORDER BY l.sort_order').all(v.entry_id) : [];
  return { ...v, lines };
};

export function getVoucher(id) {
  const v = db().prepare('SELECT v.*, s.name AS shop_name, c.name AS cash_account_name FROM vouchers v LEFT JOIN shops s ON s.id = v.shop_id LEFT JOIN cash_accounts c ON c.id = v.cash_account_id WHERE v.id = ?').get(id);
  if (!v) throw notFound('Chứng từ');
  return shape(v);
}

export function createVoucher(input, actor) {
  const lines = buildLines(input);
  assertUnlocked(input.voucher_date, 'Chứng từ');
  validate(input, lines);
  const id = newId('vch');
  const entryId = newId('je');
  const code = runningCode(PREFIX[input.type], 6);
  const at = nowIso();
  const total = lines.reduce((a, l) => a + l.debit, 0);
  db().prepare('INSERT INTO journal_entries (id, code, entry_date, business_date, description, source_type, source_id, shop_id, is_auto, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)').run(entryId, code, input.voucher_date, input.voucher_date, input.description, 'manual', id, input.shop_id ?? null, at);
  writeEntry(entryId, code, input, lines);
  db()
    .prepare('INSERT INTO vouchers (id, code, type, voucher_date, description, shop_id, partner_type, partner_id, cash_account_id, counter_account, total_amount, entry_id, actor_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, code, input.type, input.voucher_date, input.description, input.shop_id ?? null, input.partner_type ?? null, input.partner_id ?? null, input.type === 'journal' ? null : input.cash_account_id, input.type === 'journal' ? null : input.account_code, total, entryId, actor?.id ?? null, at, at);
  const v = getVoucher(id);
  emit('voucher.created', { entityType: 'voucher', entityId: id, shopId: v.shop_id, data: v });
  audit(actor, 'voucher.created', 'voucher', id, null, v);
  return v;
}

export function updateVoucher(id, input, actor) {
  const before = getVoucher(id);
  if (before.voided_at) throw conflict('VOUCHER_VOIDED', 'Chứng từ đã huỷ, không sửa được');
  const m = { type: before.type, cash_account_id: before.cash_account_id, account_code: before.counter_account, ...before, ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'type')) };
  if (before.type === 'journal' && !input.lines) m.lines = before.lines;
  if (before.type !== 'journal' && input.amount === undefined) m.amount = before.total_amount;
  const lines = buildLines(m);
  assertUnlocked([before.voucher_date, m.voucher_date], 'Chứng từ');
  validate(m, lines);
  const total = lines.reduce((a, l) => a + l.debit, 0);
  db().prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(before.entry_id);
  db().prepare('UPDATE journal_entries SET entry_date = ?, business_date = ?, description = ?, shop_id = ? WHERE id = ?').run(m.voucher_date, m.voucher_date, m.description, m.shop_id ?? null, before.entry_id);
  writeEntry(before.entry_id, before.code, m, lines);
  db()
    .prepare('UPDATE vouchers SET voucher_date=?, description=?, shop_id=?, partner_type=?, partner_id=?, cash_account_id=?, counter_account=?, total_amount=?, updated_at=? WHERE id=?')
    .run(m.voucher_date, m.description, m.shop_id ?? null, m.partner_type ?? null, m.partner_id ?? null, before.type === 'journal' ? null : m.cash_account_id, before.type === 'journal' ? null : m.account_code, total, nowIso(), id);
  const after = getVoucher(id);
  audit(actor, 'voucher.updated', 'voucher', id, before, after);
  emit('voucher.updated', { entityType: 'voucher', entityId: id, shopId: after.shop_id, data: after });
  return after;
}

/** Không xoá cứng: đánh dấu huỷ (bút toán cũng được đánh dấu nên không vào sổ và báo cáo) */
export function voidVoucher(id, actor) {
  const before = getVoucher(id);
  if (before.voided_at) throw conflict('ALREADY_VOIDED', 'Chứng từ đã huỷ');
  assertUnlocked(before.voucher_date, 'Chứng từ');
  const at = nowIso();
  db().prepare('UPDATE vouchers SET voided_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
  db().prepare('UPDATE journal_entries SET voided_at = ? WHERE id = ?').run(at, before.entry_id);
  const after = getVoucher(id);
  audit(actor, 'voucher.voided', 'voucher', id, before, after);
  emit('voucher.voided', { entityType: 'voucher', entityId: id, shopId: after.shop_id, data: after });
  return after;
}

export function listVouchers({ type, from, to, shopIds, q, includeVoided = false, limit = 100, cursor } = {}) {
  const where = [];
  const params = [];
  if (!includeVoided) where.push('v.voided_at IS NULL');
  if (type) (where.push('v.type = ?'), params.push(type));
  if (from) (where.push('v.voucher_date >= ?'), params.push(from));
  if (to) (where.push('v.voucher_date <= ?'), params.push(to));
  if (shopIds?.length) (where.push(`v.shop_id IN (${shopIds.map(() => '?').join(',')})`), params.push(...shopIds));
  if (q) (where.push('(v.code LIKE ? OR v.description LIKE ?)'), params.push(`%${q}%`, `%${q}%`));
  if (cursor) (where.push('v.id < ?'), params.push(cursor));
  const rows = db().prepare(`SELECT v.*, s.name AS shop_name, c.name AS cash_account_name FROM vouchers v LEFT JOIN shops s ON s.id = v.shop_id LEFT JOIN cash_accounts c ON c.id = v.cash_account_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.id DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows).map(shape);
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}
