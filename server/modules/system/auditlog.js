import { getDb } from '../../db/index.js';

const db = () => getDb();

/** Tên hành động tiếng Việt; hành động chưa có tên hiện nguyên mã để không bị giấu. */
export const ACTION_LABELS = {
  'order.created': 'Tạo đơn', 'order.updated': 'Sửa đơn', 'order.status_changed': 'Đổi trạng thái đơn', 'order.returned': 'Trả hàng', 'order.allowance': 'Giảm giá sau bán / bồi thường', 'order.deposit_forfeited': 'Giữ cọc khi huỷ đơn', 'order.return_goods_received': 'Nhận hàng trả về',
  'order.return_write_off': 'Lập phiếu hàng huỷ', 'order.exchanged': 'Đổi hàng', 'order.split': 'Tách đơn', 'order.seller_shipping_paid': 'Trả ship cho hãng vận chuyển', 'order.debt_reminded': 'Nhắc nợ khách',
  'order.reserved': 'Giữ hàng', 'order.unreserved': 'Bỏ giữ hàng', 'import.orders': 'Nhập đơn từ file',
  'purchase.created': 'Tạo phiếu nhập', 'purchase.updated': 'Sửa phiếu nhập', 'purchase.received': 'Nhận hàng nhập', 'purchase.cancelled': 'Huỷ phiếu nhập', 'purchase.payment': 'Trả tiền nhà cung cấp', 'purchase.returned': 'Trả hàng nhập', 'purchase.return_voided': 'Huỷ phiếu trả hàng nhập', 'purchase.allowance_created': 'NCC giảm giá sau nhận', 'purchase.allowance_voided': 'Huỷ giảm giá sau nhận', 'purchase.supplier_refund': 'NCC hoàn tiền', 'purchase.carrier_payment': 'Trả ship nhập', 'payment.voided': 'Huỷ khoản thanh toán',
  'inventory.conversion.created': 'Lập phiếu đóng gói', 'inventory.conversion.voided': 'Huỷ phiếu đóng gói', 'inventory.conversion_recipe.saved': 'Đặt công thức đóng từ', 'inventory.conversion_recipe.deleted': 'Xoá công thức đóng từ',
  'product.created': 'Tạo sản phẩm', 'product.updated': 'Sửa sản phẩm', 'product.removed': 'Gỡ sản phẩm', 'product.restored': 'Khôi phục sản phẩm', 'listing.set': 'Đặt giá niêm yết', 'listing.synced': 'Đồng bộ sản phẩm', 'channel_prices.set': 'Đặt giá theo kênh',
  'stock.transfer': 'Chuyển kho', 'stock.opening': 'Tồn đầu kỳ', 'stock.adjust': 'Điều chỉnh tồn', 'stock.damage': 'Ghi hàng hỏng', 'stock.count': 'Kiểm kê (điều chỉnh)', 'stock.closed': 'Chốt kho', 'stock.reopened': 'Mở lại kỳ kho', 'costing.method_changed': 'Đổi phương pháp giá vốn',
  'stock_count.created': 'Tạo phiếu kiểm kê', 'stock_count.completed': 'Hoàn tất kiểm kê', 'stock_count.cancelled': 'Huỷ phiếu kiểm kê',
  'customer.created': 'Tạo khách', 'customer.updated': 'Sửa khách', 'customer.merged': 'Gộp khách', 'customer.removed_from_shop': 'Xoá khách khỏi shop', 'customer.added_to_shop': 'Thêm khách vào shop', 'customer.tags_changed': 'Đổi nhãn khách',
  'expense.created': 'Ghi chi phí', 'expense.updated': 'Sửa chi phí', 'expense.voided': 'Huỷ chi phí', 'voucher.created': 'Lập chứng từ', 'voucher.updated': 'Sửa chứng từ', 'voucher.voided': 'Huỷ chứng từ',
  'cash.transfer': 'Chuyển quỹ', 'cash.count_adjusted': 'Kiểm đếm quỹ', 'cash.entry_voided': 'Huỷ dòng quỹ', 'shipment.created': 'Tạo vận đơn', 'shipment.status': 'Đổi trạng thái vận đơn', 'carrier_statement.created': 'Chốt đối soát hãng vận chuyển', 'carrier_statement.voided': 'Huỷ phiếu đối soát hãng vận chuyển', 'order.return_removed': 'Gỡ phiếu trả chờ hàng về', 'order.completion_reverted': 'Hoàn tác giao thành công',
  'promotion.created': 'Tạo khuyến mãi', 'promotion.updated': 'Sửa khuyến mãi', 'promotion.archived': 'Lưu trữ khuyến mãi',
  'shop.created': 'Tạo shop', 'shop.updated': 'Sửa shop', 'warehouse.created': 'Tạo kho', 'warehouse.updated': 'Sửa kho', 'warehouse.removed': 'Gỡ kho', 'settings.updated': 'Đổi cài đặt', 'notifications.updated': 'Đổi cài đặt thông báo',
  'api_key.created': 'Tạo API key', 'api_key.revoked': 'Thu hồi API key', 'webhook.created': 'Thêm webhook', 'user.password_changed': 'Đổi mật khẩu', 'platform.enabled': 'Bật nền tảng', 'platform.disabled': 'Tắt nền tảng',
};

const LABEL_SQL = {
  order: 'SELECT code AS l FROM orders WHERE id = ?', purchase: 'SELECT code AS l FROM purchases WHERE id = ?', product: 'SELECT name AS l FROM products WHERE id = ?',
  customer: 'SELECT name AS l FROM customers WHERE id = ?', shop: 'SELECT name AS l FROM shops WHERE id = ?', warehouse: 'SELECT name AS l FROM warehouses WHERE id = ?',
  expense: 'SELECT COALESCE(note, payee, id) AS l FROM expenses WHERE id = ?', variant: 'SELECT sku AS l FROM variants WHERE id = ?', promotion: 'SELECT name AS l FROM promotions WHERE id = ?',
  stock_count: 'SELECT code AS l FROM stock_counts WHERE id = ?', carrier_statement: 'SELECT code AS l FROM carrier_statements WHERE id = ?',
};
const SKIP = new Set(['lines', 'history', 'payments', 'returns', 'allocations', 'shipments', 'write_offs', 'seller_shipping_payments', 'updated_at', 'created_at', 'tags', 'items']);
const tryParse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** Các trường thay đổi giữa trước và sau (chỉ giá trị đơn giản, bỏ danh sách dài và mốc thời gian nội bộ) */
export function diffOf(before, after) {
  const out = [];
  const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const b = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (SKIP.has(k)) continue;
    const x = b[k] ?? null;
    const y = a[k] ?? null;
    if (!scalar(x) || !scalar(y) || x === y) continue;
    out.push({ field: k, from: x, to: y });
    if (out.length >= 12) break;
  }
  return out;
}

export function listAudit({ entityType, action, q, from, to, entityId, limit = 50, cursor } = {}) {
  const where = [];
  const params = [];
  if (entityType) (where.push('a.entity_type = ?'), params.push(entityType));
  if (entityId) (where.push('a.entity_id = ?'), params.push(entityId));
  if (action) (where.push('a.action = ?'), params.push(action));
  if (from) (where.push("date(a.created_at, '+7 hours') >= ?"), params.push(from));
  if (to) (where.push("date(a.created_at, '+7 hours') <= ?"), params.push(to));
  if (q) (where.push('(a.action LIKE ? OR a.entity_id LIKE ? OR a.after LIKE ?)'), params.push(...Array(3).fill(`%${q}%`)));
  if (cursor) (where.push('a.id < ?'), params.push(cursor));
  const rows = db().prepare(`SELECT a.* FROM audit_log a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const keyNames = new Map(db().prepare('SELECT id, name FROM api_keys').all().map((k) => [k.id, k.name]));
  const data = (hasMore ? rows.slice(0, limit) : rows).map((r) => {
    const sql = LABEL_SQL[r.entity_type];
    const label = sql && r.entity_id ? db().prepare(sql).get(r.entity_id)?.l ?? null : null;
    const actor = r.actor_type === 'api_key' ? `API key “${keyNames.get(r.actor_id) ?? r.actor_id}”` : r.actor_type === 'user' ? 'Chủ shop' : 'Hệ thống';
    return {
      id: r.id, at: r.created_at, action: r.action, action_label: ACTION_LABELS[r.action] || r.action, entity_type: r.entity_type, entity_id: r.entity_id, entity_label: label, actor,
      changes: diffOf(tryParse(r.before), tryParse(r.after)),
    };
  });
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

/** Các loại đối tượng và hành động đã có trong nhật ký, để giao diện dựng bộ lọc */
export function auditFacets() {
  return {
    entity_types: db().prepare('SELECT entity_type AS v, COUNT(*) AS n FROM audit_log GROUP BY 1 ORDER BY n DESC').all(),
    actions: db().prepare('SELECT action AS v, COUNT(*) AS n FROM audit_log GROUP BY 1 ORDER BY n DESC').all().map((r) => ({ ...r, label: ACTION_LABELS[r.v] || r.v })),
  };
}
