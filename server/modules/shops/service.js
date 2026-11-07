import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { applyIndustry } from './industry.js';
import { hasFeature } from '../../lib/industries.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { contrast, luminance } from '../../lib/color.js';

// Màu nhận diện shop: giữ trong tông giấy–gỗ–gốm của thương hiệu (đã giảm bão hoà), vẫn đủ khác nhau để phân biệt
const PALETTE = ['#865C49', '#42633F', '#33566F', '#8A4E14', '#6A4A70', '#A23A30'];

const parseColors = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const withWarehouses = (s) => ({ ...s, ui_colors: parseColors(s.ui_colors), warehouse_ids: shopWarehouses(s.id).map((w) => w.warehouse_id) });

// Nền mặc định sáng nhất của các chủ đề và màu chữ trên nút chính: màu người dùng chọn phải đọc được trên cả hai
const DEFAULT_PAPER = '#fdfcf9';
const BUTTON_TEXT = '#ede3d2';

/** Màu giao diện riêng của shop. Màu chủ đạo dùng cho nút chính và liên kết nên phải đủ tương phản; nền phải sáng để chữ tối đọc được. */
export function normalizeColors(c) {
  if (c === null || c === undefined) return null;
  const out = {};
  if (c.background) {
    if (luminance(c.background) < 0.75) throw badRequest('COLOR_TOO_DARK', 'Màu nền quá tối. Chọn màu sáng hơn để chữ vẫn dễ đọc.', { field: 'background' });
    out.background = c.background.toLowerCase();
  }
  if (c.primary) {
    const bg = out.background || DEFAULT_PAPER;
    const onButton = contrast(c.primary, BUTTON_TEXT);
    const onPaper = contrast(c.primary, bg);
    if (onButton < 4.5 || onPaper < 4.5) {
      throw badRequest('COLOR_LOW_CONTRAST', `Màu chủ đạo chưa đủ tương phản (chữ trên nút ${onButton.toFixed(1)}:1, trên nền ${onPaper.toFixed(1)}:1, cần ít nhất 4,5:1). Chọn màu đậm hơn.`, { field: 'primary', on_button: Math.round(onButton * 10) / 10, on_background: Math.round(onPaper * 10) / 10 });
    }
    out.primary = c.primary.toLowerCase();
  }
  return Object.keys(out).length ? out : null;
}

export function getShop(id) {
  const s = getDb().prepare('SELECT * FROM shops WHERE id = ?').get(id);
  if (!s) throw notFound('Shop');
  return withWarehouses(s);
}

/** Kho của shop theo thứ tự ưu tiên (1 = lấy hàng trước) */
export function shopWarehouses(shopId) {
  return getDb()
    .prepare(
      `SELECT sw.warehouse_id, sw.priority, w.code, w.name, w.archived_at FROM shop_warehouses sw JOIN warehouses w ON w.id = sw.warehouse_id
       WHERE sw.shop_id = ? ORDER BY sw.priority`,
    )
    .all(shopId);
}

/**
 * Đặt danh sách kho của shop (đã sắp theo ưu tiên). Kho đầu tiên là kho chính: giữ shops.default_warehouse_id đồng bộ
 * để mọi chỗ còn đọc kho mặc định vẫn đúng. Danh sách rỗng = shop chưa có kho.
 */
export function setShopWarehouses(shopId, warehouseIds, actor) {
  const before = getShop(shopId);
  const ids = [...new Set(warehouseIds)];
  for (const id of ids) assertWarehouse(id);
  const db = getDb();
  db.prepare('DELETE FROM shop_warehouses WHERE shop_id = ?').run(shopId);
  const ins = db.prepare('INSERT INTO shop_warehouses (shop_id, warehouse_id, priority) VALUES (?,?,?)');
  ids.forEach((w, i) => ins.run(shopId, w, i + 1));
  db.prepare('UPDATE shops SET default_warehouse_id = ?, updated_at = ? WHERE id = ?').run(ids[0] ?? null, nowIso(), shopId);
  const after = getShop(shopId);
  audit(actor, 'shop.warehouses_changed', 'shop', shopId, { warehouse_ids: before.warehouse_ids }, { warehouse_ids: after.warehouse_ids });
  emit('shop.updated', { entityType: 'shop', entityId: shopId, shopId, data: after });
  return shopWarehouses(shopId);
}

/** Đưa một kho lên đầu danh sách của shop (thêm nếu chưa có) */
function promoteWarehouse(shopId, warehouseId) {
  const cur = shopWarehouses(shopId).map((w) => w.warehouse_id).filter((w) => w !== warehouseId);
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM shop_warehouses WHERE shop_id = ?').run(shopId);
    const ins = db.prepare('INSERT INTO shop_warehouses (shop_id, warehouse_id, priority) VALUES (?,?,?)');
    [warehouseId, ...cur].forEach((w, i) => ins.run(shopId, w, i + 1));
  })();
}

export function shopHasFeature(shopId, feature) {
  const s = getDb().prepare('SELECT industry FROM shops WHERE id = ?').get(shopId);
  return !!s && hasFeature(s.industry, feature);
}

export function listShops({ includeArchived = false } = {}) {
  return getDb()
    .prepare(`SELECT * FROM shops ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at`)
    .all()
    .map(withWarehouses);
}

function assertWarehouse(id) {
  if (!id) return;
  const w = getDb().prepare('SELECT id FROM warehouses WHERE id = ? AND archived_at IS NULL').get(id);
  if (!w) throw badRequest('INVALID_WAREHOUSE', 'Kho mặc định không tồn tại');
}

export function createShop(input, actor) {
  assertWarehouse(input.default_warehouse_id);
  const db = getDb();
  const id = newId('shp');
  const at = nowIso();
  const count = db.prepare('SELECT COUNT(*) n FROM shops').get().n;
  db.prepare(
    `INSERT INTO shops (id, code, name, description, color, default_warehouse_id, phone, address, receipt_footer, industry, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.code.toUpperCase(),
    input.name,
    input.description ?? null,
    input.color ?? PALETTE[count % PALETTE.length],
    input.default_warehouse_id ?? null,
    input.phone ?? null,
    input.address ?? null,
    input.receipt_footer ?? 'Cảm ơn quý khách!',
    input.industry ?? 'general',
    at,
    at,
  );
  if (input.default_warehouse_id) promoteWarehouse(id, input.default_warehouse_id);
  applyIndustry(id);
  const s = getShop(id);
  audit(actor, 'shop.created', 'shop', id, null, s);
  emit('shop.created', { entityType: 'shop', entityId: id, shopId: id, data: s });
  return s;
}

const FIELDS = ['code', 'name', 'description', 'color', 'default_warehouse_id', 'phone', 'address', 'receipt_footer', 'industry', 'archived_at', 'ui_colors'];

export function updateShop(id, input, actor) {
  const before = getShop(id);
  if (input.default_warehouse_id !== undefined) assertWarehouse(input.default_warehouse_id);
  const next = { ...before };
  delete next.warehouse_ids;
  for (const f of FIELDS) if (input[f] !== undefined) next[f] = input[f];
  if (input.ui_colors !== undefined) {
    const c = normalizeColors(input.ui_colors);
    next.ui_colors = c ? JSON.stringify(c) : null;
  } else next.ui_colors = before.ui_colors ? JSON.stringify(before.ui_colors) : null;
  next.code = next.code.toUpperCase();
  next.updated_at = nowIso();
  getDb()
    .prepare(`UPDATE shops SET ${FIELDS.map((f) => `${f}=?`).join(', ')}, updated_at=? WHERE id=?`)
    .run(...FIELDS.map((f) => next[f]), next.updated_at, id);
  // Đổi kho mặc định = đưa kho đó lên ưu tiên 1 (kho cũ vẫn ở danh sách, xếp sau)
  if (input.default_warehouse_id !== undefined && input.default_warehouse_id !== before.default_warehouse_id) {
    if (input.default_warehouse_id) promoteWarehouse(id, input.default_warehouse_id);
    else setShopWarehouses(id, [], actor);
  }
  if (next.industry !== before.industry) applyIndustry(id);
  const after = getShop(id);
  audit(actor, 'shop.updated', 'shop', id, before, after);
  emit('shop.updated', { entityType: 'shop', entityId: id, shopId: id, data: after });
  return after;
}
