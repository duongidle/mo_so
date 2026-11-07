import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { createTransfer } from '../inventory/service.js';
import { setShopWarehouses, shopWarehouses } from '../shops/service.js';

export function getWarehouse(id) {
  const w = getDb().prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
  if (!w) throw notFound('Kho');
  return w;
}

export function listWarehouses({ includeArchived = false } = {}) {
  return getDb()
    .prepare(`SELECT * FROM warehouses ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at`)
    .all();
}

export function createWarehouse(input, actor) {
  const id = newId('whs');
  const at = nowIso();
  getDb()
    .prepare(
      'INSERT INTO warehouses (id, code, name, address, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(id, input.code.toUpperCase(), input.name, input.address ?? null, input.note ?? null, at, at);
  const w = getWarehouse(id);
  audit(actor, 'warehouse.created', 'warehouse', id, null, w);
  emit('warehouse.created', { entityType: 'warehouse', entityId: id, data: w });
  return w;
}

export function updateWarehouse(id, input, actor, { force = false } = {}) {
  const before = getWarehouse(id);
  const archiving = !!input.archived_at && !before.archived_at;
  const detached = [];
  if (archiving) {
    const shops = getDb()
      .prepare('SELECT s.id, s.name FROM shop_warehouses sw JOIN shops s ON s.id = sw.shop_id WHERE sw.warehouse_id = ? AND s.archived_at IS NULL ORDER BY s.name')
      .all(id);
    const only = shops.filter((s) => shopWarehouses(s.id).filter((w) => !w.archived_at).length <= 1);
    if (only.length) throw conflict('WAREHOUSE_LAST', `Không lưu trữ được: đây là kho duy nhất của shop ${only.map((s) => s.name).join(', ')}. Thêm kho khác cho shop trước`, { shops: only });
    if (shops.length && !force) throw conflict('WAREHOUSE_IN_USE', `Kho đang nằm trong danh sách kho của shop ${shops.map((s) => s.name).join(', ')}. Lưu trữ sẽ gỡ kho khỏi các shop này`, { shops });
    detached.push(...shops);
    // Đóng kho: kho phải hết hàng (chuyển sang kho khác hoặc xuất hết) và không còn việc dở dang, nếu không hàng sẽ "mồ côi" trong kho đã ẩn
    const stock = getDb().prepare('SELECT COUNT(*) AS n, COALESCE(SUM(on_hand), 0) AS qty FROM stock_levels WHERE warehouse_id = ? AND on_hand != 0').get(id);
    if (stock.n > 0) throw conflict('WAREHOUSE_HAS_STOCK', `Kho còn hàng (${stock.n} mặt hàng, tổng ${stock.qty}). Chuyển sang kho khác hoặc xuất/điều chỉnh về 0 trước khi đóng kho.`, { lines: stock.n, qty: stock.qty });
    const open = getDb().prepare("SELECT code FROM stock_counts WHERE warehouse_id = ? AND status = 'draft'").all(id);
    if (open.length) throw conflict('WAREHOUSE_HAS_OPEN_COUNT', `Kho còn phiếu kiểm kê chưa hoàn tất (${open.map((c) => c.code).join(', ')}). Hoàn tất hoặc huỷ trước khi đóng kho.`, { counts: open });
    const drafts = getDb().prepare("SELECT code FROM purchases WHERE warehouse_id = ? AND status = 'draft'").all(id);
    if (drafts.length) throw conflict('WAREHOUSE_HAS_DRAFT_PURCHASE', `Kho còn phiếu nhập nháp (${drafts.map((c) => c.code).join(', ')}). Nhận hàng vào kho khác hoặc huỷ trước khi đóng kho.`, { purchases: drafts });
  }
  const next = { ...before, ...input, code: (input.code ?? before.code).toUpperCase(), updated_at: nowIso() };
  getDb()
    .prepare('UPDATE warehouses SET code=?, name=?, address=?, note=?, archived_at=?, updated_at=? WHERE id=?')
    .run(next.code, next.name, next.address, next.note, next.archived_at, next.updated_at, id);
  for (const sh of detached) {
    setShopWarehouses(sh.id, shopWarehouses(sh.id).map((w) => w.warehouse_id).filter((w) => w !== id), actor);
  }
  const after = getWarehouse(id);
  if (detached.length) audit(actor, 'warehouse.archived_detached', 'warehouse', id, before, { detached_from_shops: detached.map((x) => x.id) });
  audit(actor, 'warehouse.updated', 'warehouse', id, before, after);
  return after;
}

const count = (sql, ...p) => getDb().prepare(sql).get(...p).n;

/**
 * Điều gì xảy ra nếu gỡ kho này: hàng còn trong kho, shop đang dùng, việc dở dang, và kho đã có lịch sử chưa.
 * Kho chưa từng có biến động nào thì xoá hẳn được; kho đã có lịch sử thì chỉ đóng (lưu trữ) để sổ kho, đơn, phiếu nhập cũ vẫn trỏ đúng.
 */
export function warehouseImpact(id) {
  const w = getWarehouse(id);
  const db = getDb();
  const stock = db.prepare('SELECT variant_id, on_hand, avg_cost FROM stock_levels WHERE warehouse_id = ? AND on_hand != 0').all(id);
  const negative = stock.filter((s) => s.on_hand < 0);
  const shops = db
    .prepare('SELECT s.id, s.name FROM shop_warehouses sw JOIN shops s ON s.id = sw.shop_id WHERE sw.warehouse_id = ? AND s.archived_at IS NULL ORDER BY s.name')
    .all(id)
    .map((s) => ({ ...s, only: shopWarehouses(s.id).filter((x) => !x.archived_at).length <= 1 }));
  const drafts = db.prepare("SELECT code FROM purchases WHERE warehouse_id = ? AND status = 'draft' ORDER BY ordered_at").all(id);
  const counts = db.prepare("SELECT code FROM stock_counts WHERE warehouse_id = ? AND status = 'draft' ORDER BY created_at").all(id);
  const planned = db.prepare("SELECT DISTINCT o.code FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status = 'draft' AND l.planned_allocations LIKE ?").all(`%${id}%`);
  const history = {
    movements: count('SELECT COUNT(*) AS n FROM stock_movements WHERE warehouse_id = ?', id),
    purchases: count('SELECT COUNT(*) AS n FROM purchases WHERE warehouse_id = ?', id),
    orders: count('SELECT COUNT(*) AS n FROM orders WHERE warehouse_id = ?', id) + count('SELECT COUNT(*) AS n FROM order_line_allocations WHERE warehouse_id = ?', id),
    counts: count('SELECT COUNT(*) AS n FROM stock_counts WHERE warehouse_id = ?', id),
    adjustments: count('SELECT COUNT(*) AS n FROM stock_adjustments WHERE warehouse_id = ?', id),
  };
  const hasHistory = Object.values(history).some((n) => n > 0);
  const blockers = [];
  const only = shops.filter((s) => s.only);
  if (only.length) blockers.push({ code: 'WAREHOUSE_LAST', message: `Đây là kho duy nhất của shop ${only.map((s) => s.name).join(', ')}. Thêm kho khác cho shop trước.` });
  if (counts.length) blockers.push({ code: 'WAREHOUSE_HAS_OPEN_COUNT', message: `Còn phiếu kiểm kê chưa hoàn tất (${counts.map((c) => c.code).join(', ')}). Hoàn tất hoặc huỷ trước.` });
  if (drafts.length) blockers.push({ code: 'WAREHOUSE_HAS_DRAFT_PURCHASE', message: `Còn phiếu nhập nháp (${drafts.map((c) => c.code).join(', ')}). Nhận hàng vào kho khác hoặc huỷ trước.` });
  if (negative.length) blockers.push({ code: 'WAREHOUSE_NEGATIVE_STOCK', message: `${negative.length} mặt hàng đang âm kho. Nhập hàng hoặc điều chỉnh về 0 trước, vì không chuyển được số âm.` });
  const positive = stock.filter((s) => s.on_hand > 0);
  return {
    warehouse: w,
    archived: !!w.archived_at,
    stock: { lines: positive.length, qty: Math.round(positive.reduce((a, s) => a + s.on_hand, 0) * 1000) / 1000, value: positive.reduce((a, s) => a + Math.round(s.on_hand * s.avg_cost), 0) },
    shops,
    draft_purchases: drafts.map((d) => d.code),
    open_counts: counts.map((c) => c.code),
    draft_orders_with_plan: planned.map((o) => o.code),
    history,
    mode: hasHistory ? 'close' : 'delete',
    needs_transfer: positive.length > 0,
    blockers,
  };
}

/**
 * Gỡ một kho. Việc làm theo thứ tự, tất cả trong một giao dịch của route:
 * 1. Chặn nếu còn việc dở (kiểm kê, phiếu nhập nháp, kho duy nhất của shop, đang âm kho).
 * 2. Còn hàng thì bắt buộc chuyển sang kho khác (phiếu chuyển kho giữ nguyên giá vốn), không cho bỏ hàng lại.
 * 3. Xoá kế hoạch chia kho của các đơn nháp trỏ vào kho này (đơn sẽ tự chia lại khi xác nhận).
 * 4. Gỡ kho khỏi danh sách kho của mọi shop (kho chính của shop được cập nhật theo).
 * 5. Chưa từng có biến động/phiếu/đơn nào thì xoá hẳn, ngược lại lưu trữ (đóng kho) để lịch sử cũ vẫn đọc được. Không bao giờ xoá cứng dữ liệu nghiệp vụ.
 */
export function removeWarehouse(id, { transferTo = null, confirm = false } = {}, actor) {
  const imp = warehouseImpact(id);
  if (imp.archived) throw conflict('ALREADY_CLOSED', 'Kho đã đóng rồi');
  if (!confirm) throw badRequest('CONFIRM_REQUIRED', 'Cần xác nhận gỡ kho (confirm: true)', { impact: imp });
  if (imp.blockers.length) throw conflict('REMOVE_BLOCKED', imp.blockers.map((b) => b.message).join(' '), { blockers: imp.blockers });
  const db = getDb();
  let transferred = null;
  if (imp.needs_transfer) {
    if (!transferTo) throw conflict('WAREHOUSE_HAS_STOCK', `Kho còn ${imp.stock.lines} mặt hàng (tổng ${imp.stock.qty}). Chọn kho nhận hàng để chuyển trước khi gỡ.`, { lines: imp.stock.lines, qty: imp.stock.qty });
    if (transferTo === id) throw badRequest('SAME_WAREHOUSE', 'Kho nhận phải khác kho đang gỡ');
    const dest = getWarehouse(transferTo);
    if (dest.archived_at) throw badRequest('INVALID_WAREHOUSE', 'Kho nhận đã đóng');
    const lines = db.prepare('SELECT variant_id, on_hand FROM stock_levels WHERE warehouse_id = ? AND on_hand > 0').all(id).map((l) => ({ variant_id: l.variant_id, qty: l.on_hand }));
    createTransfer({ fromWarehouseId: id, toWarehouseId: transferTo, lines, note: `Gỡ kho ${imp.warehouse.name}` }, actor);
    transferred = { to: transferTo, lines: lines.length };
  }
  const cleared = db.prepare("UPDATE order_lines SET planned_allocations = NULL WHERE planned_allocations LIKE ? AND order_id IN (SELECT id FROM orders WHERE status = 'draft')").run(`%${id}%`).changes;
  for (const sh of imp.shops) {
    setShopWarehouses(sh.id, shopWarehouses(sh.id).map((x) => x.warehouse_id).filter((x) => x !== id), actor);
  }
  const after = warehouseImpact(id);
  let mode;
  if (after.mode === 'delete') {
    db.prepare('DELETE FROM stock_levels WHERE warehouse_id = ?').run(id);
    db.prepare('DELETE FROM shop_warehouses WHERE warehouse_id = ?').run(id);
    db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
    mode = 'deleted';
  } else {
    db.prepare('UPDATE warehouses SET archived_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
    mode = 'closed';
  }
  const result = { mode, warehouse_id: id, name: imp.warehouse.name, transferred, detached_from_shops: imp.shops.map((s) => s.id), cleared_plans: cleared };
  audit(actor, 'warehouse.removed', 'warehouse', id, imp.warehouse, result);
  emit('warehouse.removed', { entityType: 'warehouse', entityId: id, data: result });
  return result;
}
