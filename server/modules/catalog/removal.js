import { getDb } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, emit } from '../../lib/events.js';
import { createAdjustment } from '../inventory/service.js';

const db = () => getDb();
const ph = (a) => a.map(() => '?').join(',');
const one = (sql, ...p) => db().prepare(sql).get(...p).n;

/**
 * Điều gì xảy ra nếu gỡ sản phẩm này. Không ghi gì.
 * Chưa từng có kho/đơn/phiếu nhập/kiểm kê nào thì xoá hẳn được; đã có lịch sử thì chỉ "ngừng kinh doanh" (lưu trữ) để sổ kho, đơn, báo cáo cũ vẫn đúng.
 */
export function productRemovalImpact(productId) {
  const p = db().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) throw notFound('Sản phẩm');
  const variants = db().prepare('SELECT id, sku, kind, archived_at FROM variants WHERE product_id = ?').all(productId);
  const ids = variants.map((v) => v.id);
  const live = variants.filter((v) => !v.archived_at);
  const inIds = ids.length ? ph(ids) : "''";
  const A = ids;

  const history = {
    movements: ids.length ? one(`SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id IN (${inIds})`, ...A) : 0,
    orders: ids.length ? one(`SELECT COUNT(DISTINCT order_id) AS n FROM order_lines WHERE variant_id IN (${inIds})`, ...A) : 0,
    purchases: ids.length ? one(`SELECT COUNT(DISTINCT purchase_id) AS n FROM purchase_lines WHERE variant_id IN (${inIds})`, ...A) : 0,
    counts: ids.length ? one(`SELECT COUNT(DISTINCT count_id) AS n FROM stock_count_lines WHERE variant_id IN (${inIds})`, ...A) : 0,
    as_component: ids.length ? one(`SELECT COUNT(*) AS n FROM bundle_components WHERE component_variant_id IN (${inIds})`, ...A) : 0,
  };
  const hasHistory = Object.values(history).some((n) => n > 0);

  const stockRows = ids.length ? db().prepare(`SELECT s.warehouse_id, w.name AS warehouse_name, s.variant_id, v.sku, s.on_hand, s.avg_cost FROM stock_levels s JOIN warehouses w ON w.id = s.warehouse_id JOIN variants v ON v.id = s.variant_id WHERE s.variant_id IN (${inIds}) AND s.on_hand != 0`).all(...A) : [];
  const positive = stockRows.filter((r) => r.on_hand > 0);
  const negative = stockRows.filter((r) => r.on_hand < 0);

  const combos = ids.length ? db().prepare(`SELECT DISTINCT p2.name FROM bundle_components bc JOIN variants bv ON bv.id = bc.bundle_variant_id JOIN products p2 ON p2.id = bv.product_id
    WHERE bc.component_variant_id IN (${inIds}) AND bv.archived_at IS NULL AND p2.archived_at IS NULL AND p2.id != ?`).all(...A, productId).map((r) => r.name) : [];
  const draftOrders = ids.length ? db().prepare(`SELECT DISTINCT o.code FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status = 'draft' AND l.variant_id IN (${inIds})`).all(...A).map((r) => r.code) : [];
  const draftPurchases = ids.length ? db().prepare(`SELECT DISTINCT pu.code FROM purchase_lines l JOIN purchases pu ON pu.id = l.purchase_id WHERE pu.status = 'draft' AND l.variant_id IN (${inIds})`).all(...A).map((r) => r.code) : [];
  const openCounts = ids.length ? db().prepare(`SELECT DISTINCT c.code FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id WHERE c.status = 'draft' AND l.variant_id IN (${inIds})`).all(...A).map((r) => r.code) : [];
  const asMaterial = ids.length ? db().prepare(`SELECT DISTINCT p2.name FROM packaging_specs ps JOIN products p2 ON p2.id = ps.product_id WHERE ps.material_variant_id IN (${inIds}) AND p2.archived_at IS NULL AND p2.id != ?`).all(...A, productId).map((r) => r.name) : [];
  const ownSpecs = one('SELECT COUNT(*) AS n FROM packaging_specs WHERE product_id = ?', productId);
  const shops = ids.length ? db().prepare(`SELECT DISTINCT s.name FROM shop_listings l JOIN shops s ON s.id = l.shop_id WHERE l.variant_id IN (${inIds}) AND l.active = 1`).all(...A).map((r) => r.name) : [];

  const blockers = [];
  if (combos.length) blockers.push({ code: 'PRODUCT_IN_COMBO', message: `Đang là thành phần của combo ${combos.join(', ')}. Bỏ khỏi combo hoặc gỡ combo trước.` });
  if (asMaterial.length) blockers.push({ code: 'PRODUCT_USED_AS_MATERIAL', message: `Đang là vật tư trong định mức đóng gói của ${asMaterial.join(', ')}. Bỏ khỏi định mức trước.` });
  if (draftOrders.length) blockers.push({ code: 'PRODUCT_IN_DRAFT_ORDER', message: `Còn trong đơn nháp (${draftOrders.slice(0, 5).join(', ')}${draftOrders.length > 5 ? '…' : ''}). Xác nhận hoặc huỷ các đơn đó trước.` });
  if (draftPurchases.length) blockers.push({ code: 'PRODUCT_IN_DRAFT_PURCHASE', message: `Còn trong phiếu nhập nháp (${draftPurchases.slice(0, 5).join(', ')}). Nhận hàng hoặc huỷ phiếu trước.` });
  if (openCounts.length) blockers.push({ code: 'PRODUCT_IN_OPEN_COUNT', message: `Còn trong phiếu kiểm kê chưa hoàn tất (${openCounts.join(', ')}). Hoàn tất hoặc huỷ trước.` });
  if (negative.length) blockers.push({ code: 'PRODUCT_NEGATIVE_STOCK', message: `Đang âm kho ở ${[...new Set(negative.map((n) => n.warehouse_name))].join(', ')}. Nhập hàng hoặc điều chỉnh về 0 trước.` });

  return {
    product: { id: p.id, name: p.name, item_type: p.item_type, archived_at: p.archived_at },
    archived: !!p.archived_at,
    variants: live.map((v) => ({ id: v.id, sku: v.sku, kind: v.kind })),
    stock: { lines: positive.length, qty: Math.round(positive.reduce((a, r) => a + r.on_hand, 0) * 1000) / 1000, value: positive.reduce((a, r) => a + Math.round(r.on_hand * r.avg_cost), 0), by_warehouse: [...new Set(positive.map((r) => r.warehouse_name))] },
    selling_in_shops: shops,
    history,
    own_packaging_specs: ownSpecs,
    mode: hasHistory ? 'archive' : 'delete',
    needs_write_off: positive.length > 0,
    blockers,
  };
}

/**
 * Gỡ sản phẩm:
 * 1. Chặn nếu còn là thành phần combo, vật tư của định mức khác, còn trong đơn/phiếu nhập/kiểm kê nháp, hoặc âm kho.
 * 2. Còn hàng trong kho thì phải xác nhận xuất huỷ (`write_off`): app lập phiếu hàng hỏng cho từng kho, giá vốn ghi vào chi phí (811). Không bỏ hàng lại cho sản phẩm đã ẩn.
 * 3. Chưa từng dùng: xoá hẳn (dữ liệu nháp, quy ước 6). Đã có lịch sử: ngừng kinh doanh (archived_at trên sản phẩm và các biến thể đang bán, tắt niêm yết). Khôi phục được.
 */
export function removeProduct(productId, { confirm = false, writeOff = false } = {}, actor) {
  const imp = productRemovalImpact(productId);
  if (imp.archived) throw conflict('ALREADY_ARCHIVED', 'Sản phẩm đã ngừng kinh doanh rồi');
  if (!confirm) throw badRequest('CONFIRM_REQUIRED', 'Cần xác nhận gỡ sản phẩm (confirm: true)', { impact: imp });
  if (imp.blockers.length) throw conflict('REMOVE_BLOCKED', imp.blockers.map((b) => b.message).join(' '), { blockers: imp.blockers });
  if (imp.needs_write_off && !writeOff) throw conflict('PRODUCT_HAS_STOCK', `Sản phẩm còn ${imp.stock.qty} trong kho (trị giá ${imp.stock.value} ₫). Xác nhận xuất huỷ phần hàng này (write_off: true) hoặc bán/chuyển hết trước.`, { qty: imp.stock.qty, value: imp.stock.value });

  const at = nowIso();
  const ids = db().prepare('SELECT id FROM variants WHERE product_id = ?').all(productId).map((v) => v.id);
  let writtenOff = null;
  if (imp.needs_write_off) {
    const rows = db().prepare(`SELECT warehouse_id, variant_id, on_hand FROM stock_levels WHERE variant_id IN (${ph(ids)}) AND on_hand > 0`).all(...ids);
    const byWh = new Map();
    for (const r of rows) (byWh.get(r.warehouse_id) || byWh.set(r.warehouse_id, []).get(r.warehouse_id)).push({ variant_id: r.variant_id, change: r.on_hand });
    for (const [warehouseId, lines] of byWh) createAdjustment({ warehouseId, kind: 'damage', reason: `Ngừng kinh doanh: ${imp.product.name}`, lines }, actor);
    writtenOff = { qty: imp.stock.qty, value: imp.stock.value };
  }
  db().prepare('DELETE FROM packaging_specs WHERE product_id = ?').run(productId); // cấu hình, không phải lịch sử

  let mode;
  if (imp.mode === 'delete') {
    // Không có lịch sử nào (kể cả sau xuất huỷ vì xuất huỷ chỉ xảy ra khi đã có tồn, tức đã có biến động → mode archive)
    for (const id of ids) {
      db().prepare('DELETE FROM shop_listings WHERE variant_id = ?').run(id);
      db().prepare('DELETE FROM bundle_components WHERE bundle_variant_id = ?').run(id);
      db().prepare('DELETE FROM stock_levels WHERE variant_id = ?').run(id);
    }
    db().prepare('UPDATE product_images SET product_id = NULL, archived_at = COALESCE(archived_at, ?) WHERE product_id = ?').run(at, productId);
    db().prepare('DELETE FROM variants WHERE product_id = ?').run(productId);
    db().prepare("DELETE FROM custom_values WHERE entity_type = 'product' AND entity_id = ?").run(productId);
    db().prepare('DELETE FROM products WHERE id = ?').run(productId);
    mode = 'deleted';
  } else {
    db().prepare('UPDATE variants SET archived_at = ?, updated_at = ? WHERE product_id = ? AND archived_at IS NULL').run(at, at, productId);
    db().prepare(`UPDATE shop_listings SET active = 0, updated_at = ? WHERE variant_id IN (${ph(ids)})`).run(at, ...ids);
    db().prepare('UPDATE products SET archived_at = ?, updated_at = ? WHERE id = ?').run(at, at, productId);
    mode = 'archived';
  }
  const result = { mode, product_id: productId, name: imp.product.name, written_off: writtenOff };
  audit(actor, 'product.removed', 'product', productId, { name: imp.product.name }, result);
  emit('product.removed', { entityType: 'product', entityId: productId, data: result });
  return result;
}

/** Bán lại sản phẩm đã ngừng kinh doanh: mở lại sản phẩm và các biến thể bị ẩn cùng lúc với nó, bật lại niêm yết */
export function restoreProduct(productId, actor) {
  const p = db().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) throw notFound('Sản phẩm');
  if (!p.archived_at) throw conflict('NOT_ARCHIVED', 'Sản phẩm đang bán, không cần khôi phục');
  const at = nowIso();
  const vids = db().prepare('SELECT id FROM variants WHERE product_id = ? AND archived_at = ?').all(productId, p.archived_at).map((v) => v.id);
  if (vids.length) {
    db().prepare(`UPDATE variants SET archived_at = NULL, updated_at = ? WHERE id IN (${ph(vids)})`).run(at, ...vids);
    db().prepare(`UPDATE shop_listings SET active = 1, updated_at = ? WHERE variant_id IN (${ph(vids)})`).run(at, ...vids);
  }
  const cat = p.category_id && db().prepare('SELECT archived_at FROM categories WHERE id = ?').get(p.category_id);
  db().prepare('UPDATE products SET archived_at = NULL, category_id = ?, updated_at = ? WHERE id = ?').run(cat?.archived_at ? null : p.category_id, at, productId);
  audit(actor, 'product.restored', 'product', productId, { archived_at: p.archived_at }, { restored_variants: vids.length });
  emit('product.restored', { entityType: 'product', entityId: productId, data: { restored_variants: vids.length } });
  return { product_id: productId, restored_variants: vids.length };
}
