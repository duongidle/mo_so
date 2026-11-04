import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { PLATFORMS, platformList } from '../../lib/platforms.js';
import { getSetting, writeSetting } from '../settings/service.js';

const db = () => getDb();

export const ALWAYS_ON = ['direct', 'other'];

export const enabledPlatformIds = () => getSetting('enabled_platforms');

function view(p) {
  const ch = db().prepare('SELECT * FROM channels WHERE id = ?').get(p.channel.id);
  const orders = ch ? db().prepare('SELECT COUNT(*) AS n FROM orders WHERE channel_id = ?').get(ch.id).n : 0;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    features: p.features,
    channel_id: p.channel.id,
    is_marketplace: !!p.channel.is_marketplace,
    payout_method: p.payout_method,
    payout_label: p.payout_label ?? null,
    import_profile_id: p.import_profile.id,
    enabled: enabledPlatformIds().includes(p.id),
    order_count: orders,
  };
}

export const listPlatforms = () => platformList().map(view);

export function getPlatform(id) {
  const p = PLATFORMS[id];
  if (!p) throw notFound('Nền tảng');
  return p;
}

function ensureChannel(p) {
  const ch = db().prepare('SELECT * FROM channels WHERE id = ?').get(p.channel.id);
  if (!ch) {
    db().prepare('INSERT INTO channels (id, name, is_marketplace, sort_order) VALUES (?,?,?,?)').run(p.channel.id, p.channel.name, p.channel.is_marketplace, p.channel.sort_order);
  } else if (ch.archived_at) {
    db().prepare('UPDATE channels SET archived_at = NULL WHERE id = ?').run(p.channel.id);
  }
}

/** Mẫu import của nền tảng phải tồn tại (dựng lại từ danh mục nếu bị xoá). Mẫu dùng chung (imp_standard) thì chỉ cần có sẵn. */
function ensureProfile(p) {
  const prof = p.import_profile;
  if (db().prepare('SELECT 1 FROM import_profiles WHERE id = ?').get(prof.id)) return;
  if (!prof.column_map) return;
  const at = nowIso();
  db()
    .prepare('INSERT INTO import_profiles (id, name, channel_id, column_map, status_map, options, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(prof.id, prof.name, prof.channel_id, JSON.stringify(prof.column_map), JSON.stringify(prof.status_map ?? {}), JSON.stringify(prof.options ?? {}), at, at);
}

/** Phương thức tiền về phải thuộc đúng một quỹ. Chưa có thì gán vào quỹ ngân hàng (mặc định cac_bank). */
function ensurePayoutMapped(p) {
  const m = p.payout_method;
  if (!m) return;
  const accounts = db().prepare('SELECT id, kind, methods FROM cash_accounts WHERE archived_at IS NULL ORDER BY sort_order').all();
  if (accounts.some((a) => JSON.parse(a.methods).includes(m))) return;
  const target = accounts.find((a) => a.id === 'cac_bank') || accounts.find((a) => a.kind === 'bank');
  if (!target) return; // chưa có quỹ nào phù hợp: báo ở mục "chưa gán quỹ" của báo cáo
  db().prepare('UPDATE cash_accounts SET methods = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...JSON.parse(target.methods), m]), nowIso(), target.id);
}

export function enablePlatform(id, actor) {
  const p = getPlatform(id);
  const before = enabledPlatformIds();
  ensureChannel(p);
  ensureProfile(p);
  ensurePayoutMapped(p);
  const after = before.includes(id) ? before : [...before, id];
  writeSetting('enabled_platforms', after);
  audit(actor, 'platform.enabled', 'platform', id, { enabled_platforms: before }, { enabled_platforms: after });
  return view(p);
}

/** Tắt = lưu trữ kênh (ẩn khỏi bộ chọn). Đơn, tiền treo, mẫu import, phương thức payout đều giữ nguyên. */
export function disablePlatform(id, actor) {
  const p = getPlatform(id);
  const before = enabledPlatformIds();
  db().prepare('UPDATE channels SET archived_at = COALESCE(archived_at, ?) WHERE id = ?').run(nowIso(), p.channel.id);
  const after = before.filter((x) => x !== id);
  writeSetting('enabled_platforms', after);
  audit(actor, 'platform.disabled', 'platform', id, { enabled_platforms: before }, { enabled_platforms: after });
  return view(p);
}

// ---------- Kênh ----------
export function listChannels({ includeArchived = false } = {}) {
  return db().prepare(`SELECT * FROM channels ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort_order, name`).all();
}

export function getChannel(id) {
  const ch = db().prepare('SELECT * FROM channels WHERE id = ?').get(id);
  if (!ch) throw notFound('Kênh');
  return ch;
}

export function createChannel(input, actor) {
  const dup = db().prepare('SELECT id FROM channels WHERE lower(name) = lower(?)').get(input.name);
  if (dup) throw conflict('CHANNEL_NAME_TAKEN', `Đã có kênh tên “${input.name}”`);
  const id = newId('ch');
  db().prepare('INSERT INTO channels (id, name, is_marketplace, sort_order) VALUES (?,?,?,6)').run(id, input.name, input.is_marketplace ? 1 : 0);
  const ch = getChannel(id);
  audit(actor, 'channel.created', 'channel', id, null, ch);
  return ch;
}

/** Chỉ kênh tuỳ chỉnh (ch_…) sửa được. Kênh của nền tảng bật/tắt ở /platforms; direct và other cố định. */
export function updateChannel(id, input, actor) {
  const before = getChannel(id);
  if (!id.startsWith('ch_')) throw badRequest('CHANNEL_FIXED', 'Kênh dựng sẵn không sửa được. Nền tảng bật/tắt ở Cài đặt → Nền tảng bán hàng.');
  const m = { ...before };
  if (input.name !== undefined) {
    const dup = db().prepare('SELECT id FROM channels WHERE lower(name) = lower(?) AND id != ?').get(input.name, id);
    if (dup) throw conflict('CHANNEL_NAME_TAKEN', `Đã có kênh tên “${input.name}”`);
    m.name = input.name;
  }
  if (input.is_marketplace !== undefined && (input.is_marketplace ? 1 : 0) !== before.is_marketplace) {
    // Kênh sàn và kênh thường tính "số tiền cần thu" khác nhau: đổi khi đã có đơn sẽ làm lệch công nợ
    if (db().prepare('SELECT 1 FROM orders WHERE channel_id = ? LIMIT 1').get(id)) throw conflict('CHANNEL_IN_USE', 'Kênh đã có đơn nên không đổi được loại kênh (sàn / thường)');
    m.is_marketplace = input.is_marketplace ? 1 : 0;
  }
  if (input.archived !== undefined) m.archived_at = input.archived ? before.archived_at || nowIso() : null;
  db().prepare('UPDATE channels SET name = ?, is_marketplace = ?, archived_at = ? WHERE id = ?').run(m.name, m.is_marketplace, m.archived_at ?? null, id);
  const after = getChannel(id);
  audit(actor, 'channel.updated', 'channel', id, before, after);
  return after;
}
