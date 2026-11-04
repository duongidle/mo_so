import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { today as clockToday } from '../../lib/clock.js';
import { badRequest, notFound, conflict } from '../../lib/errors.js';
import { emit, audit } from '../../lib/events.js';
import { assertUnlocked } from '../../lib/period.js';
import { PAYMENT_METHODS } from '../payments/service.js';
import { depreciationSchedule, assetStatus } from '../../lib/schedule.js';

const db = () => getDb();
const ACCOUNT = { fixed_asset: '211', prepaid: '242' };

const withStatus = (a, now = clockToday()) => {
  const st = assetStatus(a, now);
  return { ...a, accumulated: st.accumulated, remaining: st.remaining, disposed: st.disposed, disposal_loss: st.disposal_loss, status: a.voided_at ? 'voided' : st.disposed ? 'disposed' : st.remaining === 0 ? 'done' : 'active' };
};

function validate(m) {
  if (m.paid_via !== 'unpaid' && !PAYMENT_METHODS.includes(m.paid_via)) throw badRequest('INVALID_METHOD', 'Phương thức thanh toán không hợp lệ (hoặc unpaid = chưa trả, ghi phải trả người bán)');
  if (!/^64[12]/.test(m.expense_account_code) || !db().prepare("SELECT 1 FROM accounts WHERE code = ? AND type = 'expense' AND archived_at IS NULL").get(m.expense_account_code)) {
    throw badRequest('INVALID_ACCOUNT', 'Tài khoản chi phí khấu hao/phân bổ phải thuộc nhóm 641x (bán hàng) hoặc 642x (quản lý)');
  }
  if (m.shop_id && !db().prepare('SELECT 1 FROM shops WHERE id = ?').get(m.shop_id)) throw notFound('Shop');
}

export function getAsset(id) {
  const a = db().prepare('SELECT a.*, s.name AS shop_name FROM assets a LEFT JOIN shops s ON s.id = a.shop_id WHERE a.id = ?').get(id);
  if (!a) throw notFound('Tài sản');
  return withStatus(a);
}

export function listAssets({ includeVoided = false } = {}) {
  return db().prepare(`SELECT a.*, s.name AS shop_name FROM assets a LEFT JOIN shops s ON s.id = a.shop_id ${includeVoided ? '' : 'WHERE a.voided_at IS NULL'} ORDER BY a.start_date DESC, a.id DESC`).all().map((a) => withStatus(a));
}

/** Lịch khấu hao/phân bổ từng tháng, đánh dấu tháng đã hạch toán tính đến hôm nay */
export function scheduleOf(id, now = clockToday()) {
  const a = getAsset(id);
  const cutoff = a.disposed_at && a.disposed_at < now ? a.disposed_at : now;
  let acc = 0;
  const rows = depreciationSchedule(a).map((p) => {
    const posted = p.date <= cutoff && !a.voided_at;
    if (posted) acc += p.amount;
    return { ...p, posted, accumulated: posted ? acc : null };
  });
  return { asset: a, schedule: rows };
}

export function createAsset(input, actor) {
  const m = { expense_account_code: '6428', paid_via: 'cash', shop_id: null, ...input };
  validate(m);
  assertUnlocked(m.start_date, 'Tài sản');
  const id = newId('ast');
  const at = nowIso();
  db()
    .prepare('INSERT INTO assets (id, name, kind, cost, start_date, months, account_code, expense_account_code, shop_id, paid_via, note, actor_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, m.name, m.kind, m.cost, m.start_date, m.months, ACCOUNT[m.kind], m.expense_account_code, m.shop_id ?? null, m.paid_via, m.note ?? null, actor?.id ?? null, at, at);
  const a = getAsset(id);
  emit('asset.created', { entityType: 'asset', entityId: id, shopId: a.shop_id, data: a });
  audit(actor, 'asset.created', 'asset', id, null, a);
  return a;
}

export function updateAsset(id, input, actor) {
  const before = getAsset(id);
  if (before.voided_at) throw conflict('ASSET_VOIDED', 'Tài sản đã huỷ');
  if (before.disposed_at) throw conflict('ASSET_DISPOSED', 'Tài sản đã thanh lý, không sửa được');
  const m = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  m.account_code = ACCOUNT[m.kind];
  validate(m);
  assertUnlocked([before.start_date, m.start_date], 'Tài sản');
  db()
    .prepare('UPDATE assets SET name=?, kind=?, cost=?, start_date=?, months=?, account_code=?, expense_account_code=?, shop_id=?, paid_via=?, note=?, updated_at=? WHERE id=?')
    .run(m.name, m.kind, m.cost, m.start_date, m.months, m.account_code, m.expense_account_code, m.shop_id ?? null, m.paid_via, m.note ?? null, nowIso(), id);
  const after = getAsset(id);
  audit(actor, 'asset.updated', 'asset', id, before, after);
  return after;
}

/**
 * Thanh lý: ngừng khấu hao từ ngày thanh lý; giá trị còn lại ghi vào 811 (chi phí khác). Tháng chưa trọn đến ngày thanh lý không tính khấu hao.
 * Tiền thu về nếu bán tài sản: ghi bằng phiếu thu khác (711 hoặc 811 giảm), không tự động.
 */
export function disposeAsset(id, { date }, actor) {
  const before = getAsset(id);
  if (before.voided_at) throw conflict('ASSET_VOIDED', 'Tài sản đã huỷ');
  if (before.disposed_at) throw conflict('ALREADY_DISPOSED', 'Tài sản đã thanh lý');
  const d = date || clockToday();
  if (d < before.start_date) throw badRequest('INVALID_DATE', 'Ngày thanh lý không thể trước ngày mua');
  if (d > clockToday()) throw badRequest('INVALID_DATE', 'Ngày thanh lý không thể ở tương lai');
  assertUnlocked(d, 'Thanh lý tài sản');
  db().prepare('UPDATE assets SET disposed_at = ?, updated_at = ? WHERE id = ?').run(d, nowIso(), id);
  const after = getAsset(id);
  audit(actor, 'asset.disposed', 'asset', id, before, after);
  emit('asset.disposed', { entityType: 'asset', entityId: id, shopId: after.shop_id, data: after });
  return after;
}

/** Huỷ bản ghi nhập nhầm: không còn bút toán nào (không xoá cứng) */
export function voidAsset(id, actor) {
  const before = getAsset(id);
  if (before.voided_at) throw conflict('ALREADY_VOIDED', 'Tài sản đã huỷ');
  assertUnlocked([before.start_date, before.disposed_at], 'Tài sản');
  db().prepare('UPDATE assets SET voided_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  const after = getAsset(id);
  audit(actor, 'asset.voided', 'asset', id, before, after);
  return after;
}

