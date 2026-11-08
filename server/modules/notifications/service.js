import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { badRequest } from '../../lib/errors.js';
import { audit, emit } from '../../lib/events.js';
import { config as appConfig } from '../../lib/config.js';
import { listStock } from '../inventory/service.js';
import { lotSummary } from '../inventory/lots.js';
import { customerDebts } from '../loyalty/debts.js';
import { supplierPayables } from '../expenses/payables.js';
import { pendingPayouts } from '../expenses/service.js';

const db = () => getDb();

export const RULES = {
  low_stock: { label: 'Hàng sắp hết', help: 'Báo mỗi ngày khi có mặt hàng dưới mức tồn tối thiểu hoặc sắp hết theo tốc độ bán.' },
  expiring_lots: { label: 'Hàng sắp hết hạn dùng', help: 'Báo mỗi ngày khi có lô đã hết hạn hoặc sắp hết hạn.' },
  pending_orders: { label: 'Đơn chờ giao quá lâu', help: 'Báo khi có đơn đã xác nhận nhưng chưa giao sau số ngày đặt bên dưới.', param: { key: 'days', label: 'Sau (ngày)', min: 1, max: 30, def: 2 } },
  debts_due: { label: 'Khách nợ đến hạn', help: 'Báo mỗi ngày khi có khoản khách nợ quá hạn hoặc sắp đến hạn.' },
  payables_due: { label: 'Sắp đến hạn trả nhà cung cấp', help: 'Báo mỗi ngày khi có phiếu nhập sắp hoặc đã quá hạn trả.' },
  payout_overdue: { label: 'Đơn sàn chưa nhận tiền', help: 'Báo mỗi ngày khi có đơn sàn giao xong quá số ngày đã đặt ở Cài đặt → Ngưỡng & kho.' },
  daily_summary: { label: 'Tóm tắt ngày hôm qua', help: 'Một tin mỗi sáng: số đơn, doanh thu thuần, tiền khách còn nợ.', param: { key: 'hour', label: 'Gửi lúc (giờ)', min: 0, max: 23, def: 8 } },
};
export const CHANNELS = ['inapp', 'telegram', 'webhook'];

export const defaultConfig = () => ({
  telegram: { bot_token: '', chat_id: '' },
  rules: Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, { enabled: k !== 'daily_summary', channels: ['inapp'], ...(r.param ? { [r.param.key]: r.param.def } : {}) }])),
});

function readRaw() {
  const row = db().prepare('SELECT config FROM notification_config WHERE id = 1').get();
  const def = defaultConfig();
  if (!row) return def;
  const saved = JSON.parse(row.config);
  return { telegram: { ...def.telegram, ...saved.telegram }, rules: Object.fromEntries(Object.keys(RULES).map((k) => [k, { ...def.rules[k], ...saved.rules?.[k] }])) };
}

/** Cấu hình để hiển thị: token bot được che, chỉ báo đã có hay chưa */
export function getConfig() {
  const c = readRaw();
  return { rules: c.rules, rule_info: RULES, channels: CHANNELS, telegram: { chat_id: c.telegram.chat_id, has_token: !!c.telegram.bot_token, token_hint: c.telegram.bot_token ? `…${c.telegram.bot_token.slice(-4)}` : '' } };
}

export function saveConfig(input, actor) {
  const cur = readRaw();
  const next = { telegram: { ...cur.telegram }, rules: { ...cur.rules } };
  if (input.telegram) {
    if (input.telegram.chat_id !== undefined) next.telegram.chat_id = String(input.telegram.chat_id).trim();
    if (input.telegram.bot_token) next.telegram.bot_token = String(input.telegram.bot_token).trim(); // bỏ trống = giữ token cũ
    if (input.telegram.clear_token) next.telegram.bot_token = '';
  }
  for (const [k, v] of Object.entries(input.rules ?? {})) {
    if (!RULES[k]) throw badRequest('INVALID_RULE', `Loại thông báo “${k}” không có`);
    const chans = (v.channels ?? next.rules[k].channels).filter((c) => CHANNELS.includes(c));
    const rule = { ...next.rules[k], enabled: v.enabled ?? next.rules[k].enabled, channels: chans };
    const p = RULES[k].param;
    if (p && v[p.key] !== undefined) {
      const n = Number(v[p.key]);
      if (!Number.isInteger(n) || n < p.min || n > p.max) throw badRequest('INVALID_PARAM', `${RULES[k].label}: “${p.label}” phải từ ${p.min} tới ${p.max}`);
      rule[p.key] = n;
    }
    next.rules[k] = rule;
  }
  if (next.rules && Object.values(next.rules).some((r) => r.enabled && r.channels.includes('telegram')) && (!next.telegram.bot_token || !next.telegram.chat_id)) {
    throw badRequest('TELEGRAM_INCOMPLETE', 'Đã chọn gửi qua Telegram nhưng chưa nhập đủ token bot và mã trò chuyện (chat id)');
  }
  db().prepare('INSERT INTO notification_config (id, config, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at').run(JSON.stringify(next), nowIso());
  const masked = (c) => ({ rules: c.rules, telegram: { chat_id: c.telegram.chat_id, has_token: !!c.telegram.bot_token } });
  audit(actor, 'notifications.updated', 'settings', 'notifications', masked(cur), masked(next));
  return getConfig();
}

// ---------- Gửi ----------
async function sendTelegram(cfg, text, fetchImpl) {
  if (!cfg.telegram.bot_token || !cfg.telegram.chat_id) return 'error: chưa cấu hình Telegram';
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${cfg.telegram.bot_token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.telegram.chat_id, text }), signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? 'sent' : `error: Telegram trả mã ${res.status}`;
  } catch (e) {
    return `error: ${e.name === 'TimeoutError' ? 'quá thời gian chờ' : 'không kết nối được Telegram'}`;
  }
}

/** Tạo một thông báo (một lần cho mỗi dedupe_key) rồi gửi theo các kênh của quy tắc. Trả về thông báo mới hoặc null nếu đã có. */
export async function notify({ kind, title, body, link, severity = 'info', dedupeKey, channels = ['inapp'] }, cfg = readRaw(), fetchImpl = fetch) {
  const id = newId('ntf');
  const r = db().prepare('INSERT OR IGNORE INTO notifications (id, kind, title, body, link, severity, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, kind, title, body ?? null, link ?? null, severity, dedupeKey ?? null, nowIso());
  if (!r.changes) return null;
  const deliveries = {};
  if (channels.includes('telegram')) deliveries.telegram = await sendTelegram(cfg, `${title}${body ? `\n${body}` : ''}`, fetchImpl);
  if (channels.includes('webhook')) {
    emit('notification.created', { entityType: 'notification', entityId: id, data: { id, kind, title, body: body ?? null, link: link ?? null, severity } });
    deliveries.webhook = 'queued';
  }
  db().prepare('UPDATE notifications SET deliveries = ? WHERE id = ?').run(JSON.stringify(deliveries), id);
  return db().prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

const vnd = (n) => `${Number(n).toLocaleString('vi-VN')} ₫`;

/**
 * Kiểm tra các quy tắc đang bật và tạo thông báo mới. Mỗi loại tối đa một lần mỗi ngày (khoá theo ngày giờ VN), nên chạy lặp không gửi trùng.
 * `at` để thử với ngày giờ giả.
 */
export async function runNotifications({ at = new Date(), fetchImpl = fetch } = {}) {
  const cfg = readRaw();
  const today = businessDate(at.toISOString());
  const hourVn = Number(new Intl.DateTimeFormat('en-GB', { timeZone: appConfig.businessTz, hour: '2-digit', hour12: false }).format(at)) % 24;
  const made = [];
  const emitOne = async (kind, rule, payload) => {
    if (!rule.enabled || !payload) return;
    const n = await notify({ kind, ...payload, dedupeKey: `${kind}:${today}`, channels: rule.channels }, cfg, fetchImpl);
    if (n) made.push(n);
  };
  const R = cfg.rules;

  const low = R.low_stock.enabled ? listStock({ filter: 'low', limit: 500 }).filter((r) => r.item_type === 'product') : [];
  await emitOne('low_stock', R.low_stock, low.length && { title: `${low.length} mặt hàng sắp hết`, body: low.slice(0, 5).map((r) => `${r.sku}: còn ${r.on_hand}`).join(', ') + (low.length > 5 ? '…' : ''), link: '/stock?filter=low', severity: 'warning' });

  if (R.expiring_lots.enabled) {
    const s = lotSummary();
    await emitOne('expiring_lots', R.expiring_lots, (s.expired.lots || s.expiring.lots) && { title: 'Hàng sắp hoặc đã hết hạn dùng', body: `${s.expired.lots} lô đã hết hạn (${s.expired.qty} cái), ${s.expiring.lots} lô sắp hết hạn (${s.expiring.qty} cái)`, link: '/stock', severity: s.expired.lots ? 'critical' : 'warning' });
  }

  if (R.pending_orders.enabled) {
    const cutoff = new Date(at.getTime() - R.pending_orders.days * 86400000).toISOString();
    const n = db().prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'confirmed' AND confirmed_at < ?").get(cutoff).n;
    await emitOne('pending_orders', R.pending_orders, n && { title: `${n} đơn đã xác nhận quá ${R.pending_orders.days} ngày chưa giao`, link: '/orders?status=confirmed', severity: 'warning' });
  }

  if (R.debts_due.enabled) {
    const d = customerDebts({ today });
    const due = d.data.filter((x) => x.bucket !== 'no_due');
    await emitOne('debts_due', R.debts_due, due.length && { title: `${due.length} khoản khách nợ cần nhắc`, body: `Tổng ${vnd(due.reduce((a, x) => a + x.debt, 0))}, quá hạn ${due.filter((x) => x.bucket === 'overdue').length} khoản`, link: '/loyalty', severity: d.overdue_count ? 'warning' : 'info' });
  }

  if (R.payables_due.enabled) {
    const p = supplierPayables({ today });
    await emitOne('payables_due', R.payables_due, p.data.length && { title: `${p.data.length} khoản sắp đến hạn trả nhà cung cấp`, body: `Tổng ${vnd(p.total)}, quá hạn ${p.overdue_count} khoản`, link: '/expenses?tab=payables', severity: p.overdue_count ? 'warning' : 'info' });
  }

  if (R.payout_overdue.enabled) {
    const o = pendingPayouts({});
    await emitOne('payout_overdue', R.payout_overdue, o.overdue_count && { title: `${o.overdue_count} đơn sàn quá ${o.overdue_days} ngày chưa nhận tiền`, body: `Tổng ${vnd(o.overdue_amount)}. Nên kiểm tra và khiếu nại với sàn.`, link: '/expenses', severity: 'warning' });
  }

  if (R.daily_summary.enabled && hourVn >= R.daily_summary.hour) {
    const y = addDays(today, -1);
    const s = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(net_revenue),0) AS rev FROM orders WHERE business_date = ? AND status IN ('confirmed','shipping','completed','returned')").get(y);
    const debt = db().prepare("SELECT COALESCE(SUM(total_amount - returned_amount - paid_amount),0) AS d FROM orders o JOIN channels ch ON ch.id = o.channel_id WHERE ch.is_marketplace = 0 AND o.status = 'completed' AND (total_amount - returned_amount - paid_amount) > 0").get().d;
    await emitOne('daily_summary', R.daily_summary, { title: `Ngày ${y.split('-').reverse().join('/')}: ${s.n} đơn, doanh thu thuần ${vnd(s.rev)}`, body: debt > 0 ? `Khách còn nợ ${vnd(debt)}` : null, link: '/reports' });
  }
  return made;
}

/** Gửi thử qua các kênh đang cấu hình để chủ shop biết đã nhận được chưa */
export async function sendTest({ channels = ['inapp'] }, fetchImpl = fetch) {
  const n = await notify({ kind: 'test', title: 'Thông báo thử từ Mở Sổ', body: 'Nếu bạn thấy tin này thì kênh đã hoạt động.', dedupeKey: `test:${newId('t')}`, channels }, readRaw(), fetchImpl);
  return { ...n, deliveries: JSON.parse(n.deliveries || '{}') };
}

export function listNotifications({ unreadOnly = false, limit = 30 } = {}) {
  const rows = db().prepare(`SELECT * FROM notifications ${unreadOnly ? 'WHERE read_at IS NULL' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`).all(limit).map((r) => ({ ...r, deliveries: r.deliveries ? JSON.parse(r.deliveries) : {} }));
  return { data: rows, unread: db().prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get().n };
}

export function markRead({ ids, all }) {
  const at = nowIso();
  if (all) db().prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(at);
  else for (const id of ids ?? []) db().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(at, id);
  return listNotifications({ limit: 1 }).unread;
}
