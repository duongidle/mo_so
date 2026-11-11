import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { runningCode } from '../../lib/codes.js';
import { today } from '../../lib/clock.js';
import { postingsFor, FALLBACK_EXPENSE_ACCOUNT } from './posting.js';

const db = () => getDb();
const STOCK_TYPES = `('adjust_in','adjust_out','damage_out','opening')`;

/** Ngữ cảnh hạch toán đọc một lần cho mỗi lần sinh lại */
function loadContext() {
  const accounts = db().prepare('SELECT * FROM cash_accounts WHERE archived_at IS NULL ORDER BY sort_order, created_at').all().map((a) => ({ ...a, methods: JSON.parse(a.methods || '[]') }));
  const cats = new Map(db().prepare('SELECT id, account_code FROM expense_categories').all().map((c) => [c.id, c.account_code]));
  const valid = new Set(db().prepare('SELECT code FROM accounts').all().map((a) => a.code));
  const preOpen = (acc, date) => acc.opening_date && date < acc.opening_date;
  const todayStr = today();
  return {
    today: todayStr,
    marketplace: new Map(db().prepare('SELECT id, is_marketplace FROM channels').all().map((c) => [c.id, !!c.is_marketplace])),
    cashAccountFor(method, date) {
      const acc = accounts.find((a) => a.methods.includes(method));
      if (!acc) return '1131';
      return preOpen(acc, date) ? '411' : acc.account_code;
    },
    cashLeg(row, date) {
      return row.opening_date && date < row.opening_date ? '411' : row.account_code;
    },
    expenseAccount(categoryId) {
      const c = cats.get(categoryId);
      return c && valid.has(c) ? c : FALLBACK_EXPENSE_ACCOUNT;
    },
  };
}

const parseLines = (s) => {
  try {
    return JSON.parse(s || '[]');
  } catch {
    return [];
  }
};

/** Ảnh chụp trạng thái hiện tại của một chứng từ (null nếu không còn) */
function snapshot(type, id, ctx) {
  switch (type) {
    case 'order': {
      const o = db().prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!o) return null;
      const returns = db().prepare('SELECT lines FROM order_returns WHERE order_id = ?').all(id).map((r) => ({ restored_cost: parseLines(r.lines).reduce((a, l) => a + (l.restock ? l.restored_cost || 0 : 0), 0) }));
      return { o, returns, marketplace: ctx.marketplace.get(o.channel_id) ?? false };
    }
    case 'return': {
      const r = db().prepare('SELECT * FROM order_returns WHERE id = ?').get(id);
      if (!r) return null;
      const o = db().prepare('SELECT * FROM orders WHERE id = ?').get(r.order_id);
      return { ret: { ...r, lines: parseLines(r.lines) }, o, marketplace: o ? ctx.marketplace.get(o.channel_id) ?? false : false };
    }
    case 'payment': {
      const p = db().prepare('SELECT * FROM payments WHERE id = ?').get(id);
      if (!p) return null;
      const order = ['order', 'order_seller_shipping'].includes(p.ref_type) ? db().prepare('SELECT id, code, channel_id, customer_id FROM orders WHERE id = ?').get(p.ref_id) : null;
      const purchase = ['purchase', 'purchase_carrier'].includes(p.ref_type) ? db().prepare('SELECT id, code, supplier_id FROM purchases WHERE id = ?').get(p.ref_id) : null;
      return { p, order, purchase, marketplace: order ? ctx.marketplace.get(order.channel_id) ?? false : false };
    }
    case 'purchase': {
      const pu = db().prepare('SELECT * FROM purchases WHERE id = ?').get(id);
      return pu ? { pu } : null;
    }
    case 'purchase_return': {
      const ret = db().prepare('SELECT * FROM purchase_returns WHERE id = ?').get(id);
      return ret ? { ret, purchase: db().prepare('SELECT code FROM purchases WHERE id = ?').get(ret.purchase_id) } : null;
    }
    case 'purchase_allowance': {
      const al = db().prepare('SELECT * FROM purchase_allowances WHERE id = ?').get(id);
      return al ? { al, purchase: db().prepare('SELECT code FROM purchases WHERE id = ?').get(al.purchase_id) } : null;
    }
    case 'expense': {
      const e = db().prepare('SELECT e.*, c.name AS category_name FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?').get(id);
      return e ? { e } : null;
    }
    case 'stock': {
      const movements = db().prepare(`SELECT * FROM stock_movements WHERE type IN ${STOCK_TYPES} AND COALESCE(ref_id, id) = ? ORDER BY rowid`).all(id);
      if (!movements.length) return null;
      const adj = db().prepare('SELECT code, kind FROM stock_adjustments WHERE id = ?').get(id);
      const kinds = { count: 'Kiểm kê', damage: 'Hàng hỏng', opening: 'Tồn đầu kỳ' };
      return { movements, label: adj ? `${kinds[adj.kind] || 'Điều chỉnh kho'} ${adj.code}` : movements[0].type === 'opening' ? 'Tồn đầu kỳ khi tạo sản phẩm' : 'Điều chỉnh kho' };
    }
    case 'asset': {
      const a = db().prepare('SELECT * FROM assets WHERE id = ?').get(id);
      return a ? { a } : null;
    }
    case 'cash_open': {
      const account = db().prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id);
      return account ? { account } : null;
    }
    case 'cash_entry': {
      const rows = db()
        .prepare('SELECT e.*, a.account_code, a.opening_date FROM cash_entries e JOIN cash_accounts a ON a.id = e.account_id WHERE (e.pair_id = ? OR e.id = ?) AND e.voided_at IS NULL ORDER BY e.rowid')
        .all(id, id);
      return rows.length ? { rows } : null;
    }
    default:
      return null;
  }
}

/** Mọi chứng từ nguồn hiện có (để dựng lại toàn bộ và để kiểm tra) */
function allSources() {
  const q = (sql, type) => db().prepare(sql).all().map((r) => ({ type, id: r.id }));
  return [
    ...q('SELECT id FROM orders', 'order'),
    ...q('SELECT id FROM order_returns', 'return'),
    ...q('SELECT id FROM payments', 'payment'),
    ...q('SELECT id FROM purchases', 'purchase'),
    ...q('SELECT id FROM purchase_returns', 'purchase_return'),
    ...q('SELECT id FROM purchase_allowances', 'purchase_allowance'),
    ...q('SELECT id FROM expenses', 'expense'),
    ...q('SELECT id FROM assets', 'asset'),
    ...q('SELECT id FROM cash_accounts', 'cash_open'),
    ...q('SELECT DISTINCT COALESCE(pair_id, id) AS id FROM cash_entries', 'cash_entry'),
    ...q(`SELECT DISTINCT COALESCE(ref_id, id) AS id FROM stock_movements WHERE type IN ${STOCK_TYPES}`, 'stock'),
  ];
}

const expectedFor = (type, id, ctx) => postingsFor(type, snapshot(type, id, ctx), ctx);

/**
 * Khấu hao/phân bổ phụ thuộc "hôm nay": khi sang ngày mới (hoặc đồng hồ giả của test đổi), đánh dấu bẩn mọi tài sản chưa huỷ một lần.
 * Mốc ngày lưu ở journal_meta; cùng ngày thì không làm gì nên rất rẻ.
 */
function refreshAssetsForToday() {
  const t = today();
  const last = db().prepare("SELECT value FROM journal_meta WHERE key = 'asset_day'").get()?.value;
  if (last === t) return;
  db().transaction(() => {
    db().prepare("INSERT OR IGNORE INTO journal_dirty SELECT 'asset', id FROM assets WHERE voided_at IS NULL").run();
    db().prepare("INSERT INTO journal_meta (key, value) VALUES ('asset_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(t);
  })();
}

/** Sinh lại bút toán tự động của các chứng từ bẩn. Rẻ khi không có gì bẩn. Trả số chứng từ đã xử lý. */
export function flushJournal() {
  refreshAssetsForToday();
  const dirty = db().prepare('SELECT source_type, source_id FROM journal_dirty').all();
  if (!dirty.length) return 0;
  const ctx = loadContext();
  const findOld = db().prepare('SELECT id, code FROM journal_entries WHERE is_auto = 1 AND source_type = ? AND source_id = ? ORDER BY rowid');
  const del = db().prepare('DELETE FROM journal_entries WHERE id = ?');
  const insE = db().prepare('INSERT INTO journal_entries (id, code, entry_date, business_date, description, source_type, source_id, shop_id, is_auto, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)');
  const insL = db().prepare('INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, shop_id, channel_id, partner_type, partner_id, memo, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  db().transaction(() => {
    const at = nowIso();
    for (const d of dirty) {
      const old = findOld.all(d.source_type, d.source_id);
      for (const o of old) del.run(o.id);
      const entries = expectedFor(d.source_type, d.source_id, ctx);
      entries.forEach((e, i) => {
        const id = newId('je');
        insE.run(id, old[i]?.code ?? runningCode('BT', 6), e.date, e.date, e.description, e.source_type, e.source_id, e.shop_id, at);
        for (const l of e.lines) insL.run(newId('jl'), id, l.account, l.debit, l.credit, l.shop_id, l.channel_id, l.partner_type, l.partner_id, l.memo, l.sort_order);
      });
    }
    db().prepare('DELETE FROM journal_dirty').run();
  })();
  return dirty.length;
}

const sig = (e) => JSON.stringify([e.date, e.shop_id ?? null, e.description, e.lines.map((l) => [l.account, l.debit, l.credit, l.shop_id ?? null, l.channel_id ?? null, l.partner_type ?? null, l.partner_id ?? null, l.memo ?? null])]);

/**
 * So sổ cái đang lưu với sổ dựng lại trong bộ nhớ từ chứng từ. Trả danh sách lệch (rỗng = khớp hoàn toàn):
 * bút toán thiếu/thừa/sai nội dung, bút toán không cân, bút toán mồ côi (chứng từ nguồn không còn sinh ra nó).
 */
export function verifyJournal() {
  flushJournal();
  const ctx = loadContext();
  const bad = [];
  const expected = new Map();
  for (const s of allSources()) {
    const es = expectedFor(s.type, s.id, ctx);
    if (es.length) expected.set(`${s.type}|${s.id}`, es.map(sig));
  }
  const rows = db().prepare('SELECT * FROM journal_entries WHERE is_auto = 1 ORDER BY source_type, source_id, rowid').all();
  const linesOf = db().prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order');
  const actual = new Map();
  for (const r of rows) {
    const lines = linesOf.all(r.id).map((l) => ({ account: l.account_code, debit: l.debit, credit: l.credit, shop_id: l.shop_id, channel_id: l.channel_id, partner_type: l.partner_type, partner_id: l.partner_id, memo: l.memo }));
    const dsum = lines.reduce((a, l) => a + l.debit, 0);
    const csum = lines.reduce((a, l) => a + l.credit, 0);
    if (dsum !== csum) bad.push({ key: `${r.source_type}|${r.source_id}`, problem: 'KHONG_CAN', code: r.code, debit: dsum, credit: csum });
    const k = `${r.source_type}|${r.source_id}`;
    if (!actual.has(k)) actual.set(k, []);
    actual.get(k).push(sig({ date: r.entry_date, shop_id: r.shop_id, description: r.description, lines }));
  }
  for (const [k, sigs] of expected) {
    const a = actual.get(k);
    if (!a) bad.push({ key: k, problem: 'THIEU', detail: 'chứng từ có bút toán nhưng sổ chưa có' });
    else if (JSON.stringify(a) !== JSON.stringify(sigs)) bad.push({ key: k, problem: 'SAI_NOI_DUNG' });
  }
  // Bút toán tay không bao giờ sinh lại, nhưng vẫn phải cân
  for (const m of db().prepare("SELECT e.code, SUM(l.debit) AS d, SUM(l.credit) AS k FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.is_auto = 0 GROUP BY e.id").all()) {
    if (m.d !== m.k) bad.push({ key: `manual|${m.code}`, problem: 'KHONG_CAN', code: m.code, debit: m.d, credit: m.k });
  }
  for (const k of actual.keys()) if (!expected.has(k)) bad.push({ key: k, problem: 'MO_COI', detail: 'bút toán không còn chứng từ sinh ra' });
  return bad;
}

/** Dựng lại toàn bộ bút toán tự động từ chứng từ (sửa chữa; bình thường không cần). Bút toán tay giữ nguyên. */
export function rebuildJournal() {
  db().transaction(() => {
    db().prepare('DELETE FROM journal_entries WHERE is_auto = 1').run();
    db().prepare('DELETE FROM journal_dirty').run();
    const ins = db().prepare('INSERT OR IGNORE INTO journal_dirty VALUES (?, ?)');
    for (const s of allSources()) ins.run(s.type, s.id);
  })();
  return flushJournal();
}
