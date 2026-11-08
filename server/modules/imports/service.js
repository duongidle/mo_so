import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, toIso } from '../../lib/time.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { createOrder, updateOrder, transitionOrder, createReturn, addOrderPayment, getOrder } from '../orders/service.js';
import { getShop } from '../shops/service.js';
import { payoutMethodOf } from '../../lib/platforms.js';

const db = () => getDb();

const DEFAULT_STATUS_MAP = {
  draft: 'draft', confirmed: 'confirmed', shipping: 'shipping', completed: 'completed', cancelled: 'cancelled', returned: 'returned',
  'nháp': 'draft', 'xác nhận': 'confirmed', 'đã xác nhận': 'confirmed', 'đang giao': 'shipping', 'hoàn thành': 'completed',
  'đã giao': 'completed', 'huỷ': 'cancelled', 'hủy': 'cancelled', 'đã huỷ': 'cancelled', 'đã hủy': 'cancelled', 'trả hàng': 'returned',
};

export function normalizeStatus(raw, statusMap = {}) {
  if (!raw) return 'completed';
  const s = String(raw).trim();
  if (statusMap[s]) return statusMap[s];
  const lower = s.toLowerCase();
  for (const [k, v] of Object.entries(statusMap)) if (k.toLowerCase() === lower) return v;
  if (DEFAULT_STATUS_MAP[lower]) return DEFAULT_STATUS_MAP[lower];
  for (const [k, v] of Object.entries(DEFAULT_STATUS_MAP)) if (lower.includes(k) && k.length > 3) return v;
  return null;
}

// ---------- Mẫu import ----------
export function listProfiles() {
  return db()
    .prepare('SELECT * FROM import_profiles ORDER BY created_at')
    .all()
    .map((p) => ({ ...p, column_map: JSON.parse(p.column_map), status_map: JSON.parse(p.status_map), options: JSON.parse(p.options) }));
}

export function saveProfile(input, id) {
  const at = nowIso();
  if (id) {
    const ex = db().prepare('SELECT id FROM import_profiles WHERE id = ?').get(id);
    if (!ex) throw notFound('Mẫu import');
    db()
      .prepare('UPDATE import_profiles SET name=?, channel_id=?, column_map=?, status_map=?, options=?, updated_at=? WHERE id=?')
      .run(input.name, input.channel_id, JSON.stringify(input.column_map), JSON.stringify(input.status_map ?? {}), JSON.stringify(input.options ?? {}), at, id);
  } else {
    id = newId('imp');
    db()
      .prepare('INSERT INTO import_profiles (id, name, channel_id, column_map, status_map, options, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, input.name, input.channel_id, JSON.stringify(input.column_map), JSON.stringify(input.status_map ?? {}), JSON.stringify(input.options ?? {}), at, at);
  }
  return listProfiles().find((p) => p.id === id);
}

// ---------- Xử lý một đơn ----------
const COMPARABLE = ['shipping_fee', 'platform_fee_amount', 'seller_shipping_amount', 'tracking_code', 'carrier', 'note', 'shipping_address'];

function applyOne(shop, channelId, row, statusMap, actor) {
  if (!row.external_id) throw badRequest('MISSING_EXTERNAL_ID', 'Thiếu mã đơn');
  const status = normalizeStatus(row.status, statusMap);
  if (!status) throw badRequest('UNKNOWN_STATUS', `Không hiểu trạng thái "${row.status}". Thêm vào bảng ánh xạ trạng thái của mẫu import.`);
  const existing = db().prepare('SELECT id FROM orders WHERE shop_id = ? AND channel_id = ? AND external_id = ?').get(shop.id, channelId, String(row.external_id));
  const paidMethod = payoutMethodOf(channelId);

  if (!existing) {
    const createStatus = status === 'returned' ? 'completed' : status === 'cancelled' ? 'draft' : status;
    let o = createOrder(
      {
        shop_id: shop.id,
        channel_id: channelId,
        external_id: String(row.external_id),
        customer: row.customer,
        shipping_address: row.shipping_address ?? row.customer?.address,
        lines: row.lines,
        discount_amount: row.discount_amount ?? 0,
        shipping_fee: row.shipping_fee ?? 0,
        platform_fee_amount: row.platform_fee_amount ?? 0,
        seller_shipping_amount: row.seller_shipping_amount ?? 0,
        note: row.note,
        tracking_code: row.tracking_code,
        carrier: row.carrier,
        ordered_at: row.ordered_at,
        status: createStatus,
        allow_negative_stock: true, // đơn đã xảy ra trên sàn: ghi nhận dù kho hệ thống chưa khớp, gắn cờ cảnh báo
        payments: row.paid_amount > 0 && status !== 'cancelled' ? [{ amount: row.paid_amount, method: paidMethod }] : [],
      },
      actor,
      { source: 'import' },
    );
    if (status === 'cancelled') o = transitionOrder(o.id, 'cancelled', { actor, note: 'Import: đơn đã huỷ trên kênh' });
    if (status === 'returned') {
      o = createReturn(o.id, { lines: o.lines.map((l) => ({ order_line_id: l.id, qty: l.qty, restock: true })), reason: 'Import: trả hàng/hoàn tiền trên kênh' }, actor);
    }
    return { action: 'created', order_id: o.id, code: o.code, status: o.status, warning: o.stock_warning ? 'Xuất kho làm âm tồn' : null };
  }

  // Đã có → so sánh & cập nhật
  const cur = getOrder(existing.id);
  const changes = {};
  const patch = {};
  for (const f of COMPARABLE) {
    const v = row[f];
    if (v !== undefined && v !== null && v !== '' && v !== cur[f]) {
      patch[f] = v;
      changes[f] = { from: cur[f], to: v };
    }
  }
  if (Object.keys(patch).length && cur.status !== 'cancelled') updateOrder(cur.id, patch, actor);

  if (status !== cur.status) {
    if (status === 'returned') {
      const left = cur.lines.filter((l) => l.qty > l.returned_qty);
      if (!['confirmed', 'shipping', 'completed'].includes(cur.status)) throw badRequest('STATUS_CONFLICT', `Đơn đang "${cur.status}", không thể chuyển sang trả hàng tự động`);
      createReturn(cur.id, { lines: left.map((l) => ({ order_line_id: l.id, qty: l.qty - l.returned_qty, restock: true })), reason: 'Import: trả hàng/hoàn tiền trên kênh' }, actor);
    } else if (cur.status === 'cancelled' || cur.status === 'returned') {
      throw badRequest('STATUS_CONFLICT', `Đơn trong hệ thống đang "${cur.status}" nhưng file ghi "${row.status}". Cần xử lý tay.`);
    } else if (status === 'draft') {
      // file ghi trạng thái sớm hơn: bỏ qua, không lùi trạng thái
    } else {
      transitionOrder(cur.id, status, { actor, allowNegative: true, note: 'Import cập nhật trạng thái' });
    }
    changes.status = { from: cur.status, to: status };
  }

  if (row.paid_amount > 0) {
    const now = getOrder(cur.id);
    const diff = row.paid_amount - now.paid_amount;
    if (diff > 0 && now.status !== 'cancelled') {
      addOrderPayment(cur.id, { amount: diff, method: paidMethod, note: 'Import' }, actor);
      changes.paid_amount = { from: now.paid_amount, to: row.paid_amount };
    }
  }

  const after = getOrder(cur.id);
  return { action: Object.keys(changes).length ? 'updated' : 'unchanged', order_id: cur.id, code: cur.code, status: after.status, changes };
}

class Rollback extends Error {}

/**
 * Chạy import. dryRun = true: chạy thật trong transaction rồi huỷ toàn bộ, trả về kết quả dự kiến.
 * Mỗi đơn chạy trong savepoint riêng: một đơn lỗi không chặn đơn khác.
 */
export function runImport({ shopId, channelId, profileId, fileName, orders, dryRun }, actor) {
  const shop = getShop(shopId);
  const profile = profileId ? listProfiles().find((p) => p.id === profileId) : null;
  const statusMap = profile?.status_map ?? {};
  const results = [];

  const work = () => {
    for (const row of orders) {
      const one = db().transaction(() => applyOne(shop, channelId, row, statusMap, actor));
      try {
        results.push({ external_id: row.external_id, ...one() });
      } catch (e) {
        results.push({ external_id: row.external_id, action: 'error', error: e instanceof AppError || e?.name === 'ZodError' ? e.message : `Lỗi hệ thống: ${e.message}`, details: e.details });
      }
    }
    if (dryRun) throw new Rollback();
  };

  try {
    db().transaction(work)();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  const summary = {
    total: results.length,
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    error: results.filter((r) => r.action === 'error').length,
  };

  if (dryRun) return { dry_run: true, summary, results: results.map(({ order_id, code, ...r }) => r) };

  const batchId = newId('imb');
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO import_batches (id, shop_id, channel_id, profile_id, file_name, total, created_count, updated_count, unchanged_count, error_count, actor_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(batchId, shop.id, channelId, profileId ?? null, fileName ?? null, summary.total, summary.created, summary.updated, summary.unchanged, summary.error, actor?.id ?? null, nowIso());
    const ins = db().prepare('INSERT INTO import_rows (id, batch_id, external_id, action, order_id, changes, error, raw) VALUES (?,?,?,?,?,?,?,?)');
    results.forEach((r, i) =>
      ins.run(newId('imr'), batchId, r.external_id ? String(r.external_id) : null, r.action, r.order_id ?? null, r.changes ? JSON.stringify(r.changes) : null, r.error ?? null, JSON.stringify(orders[i])),
    );
    audit(actor, 'import.orders', 'import_batch', batchId, null, summary);
  })();
  return { dry_run: false, batch_id: batchId, summary, results };
}

export function listBatches(limit = 30) {
  return db()
    .prepare('SELECT b.*, s.name AS shop_name FROM import_batches b JOIN shops s ON s.id = b.shop_id ORDER BY b.id DESC LIMIT ?')
    .all(limit);
}

export function getBatch(id) {
  const b = db().prepare('SELECT * FROM import_batches WHERE id = ?').get(id);
  if (!b) throw notFound('Lượt import');
  b.rows = db()
    .prepare('SELECT id, external_id, action, order_id, changes, error FROM import_rows WHERE batch_id = ?')
    .all(id)
    .map((r) => ({ ...r, changes: r.changes ? JSON.parse(r.changes) : null }));
  return b;
}

export const STANDARD_TEMPLATE_HEADER = [
  'ma_don', 'ngay', 'trang_thai', 'ten_khach', 'sdt', 'dia_chi', 'sku', 'so_luong', 'don_gia', 'giam_gia_dong',
  'giam_gia_don', 'phi_ship_khach', 'phi_san', 'phi_ship_shop', 'ghi_chu', 'ma_van_don', 'da_thanh_toan',
];
