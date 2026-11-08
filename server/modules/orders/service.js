import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, toIso, addDays } from '../../lib/time.js';
import { allocate } from '../../lib/money.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { dailyCode } from '../../lib/codes.js';
import { RETURN_REASON_CODES } from '../../lib/returnReasons.js';
import { applyMovement } from '../inventory/service.js';
import { recordPayment, netPaid, listPaymentsFor, voidPaymentRow } from '../payments/service.js';
import { getSetting } from '../settings/service.js';
import { reservedByVariant } from './reservation.js';
import { evaluate as evaluatePromotions, recordUses } from '../loyalty/promotions.js';
import { planAllocation, shopWarehouseIds } from './allocation.js';
import { findOrCreateCustomer, recalcCustomerStats, getCustomer, ensureMember } from '../customers/service.js';
import { getShop } from '../shops/service.js';
import { customerCreditBalance, assertCustomerCredit } from '../payments/credit.js';

const db = () => getDb();

export const STATUSES = ['draft', 'confirmed', 'shipping', 'completed', 'cancelled', 'returned'];
const STOCK_OUT_STATUSES = new Set(['confirmed', 'shipping', 'completed', 'returned']);
const NEXT = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'completed', 'cancelled'],
  shipping: ['completed', 'cancelled'],
  completed: ['cancelled'],
  cancelled: [],
  returned: [],
};
// Đường đi tự động khi nhảy cóc trạng thái (ví dụ draft → completed)
const PATH = { draft: 0, confirmed: 1, shipping: 2, completed: 3 };

// ---------- Đọc ----------
export function getOrder(id) {
  const o = db()
    .prepare(
      `SELECT o.*, s.name AS shop_name, s.code AS shop_code, ch.name AS channel_name, w.name AS warehouse_name
       FROM orders o JOIN shops s ON s.id = o.shop_id JOIN channels ch ON ch.id = o.channel_id JOIN warehouses w ON w.id = o.warehouse_id
       WHERE o.id = ? OR o.code = ?`,
    )
    .get(id, id);
  if (!o) throw notFound('Đơn hàng');
  o.tags = JSON.parse(o.tags || '[]');
  o.lines = db()
    .prepare(`SELECT l.*, COALESCE('/api/v1/files/images/' || v.image_id, p.image_url) AS image_url FROM order_lines l
              LEFT JOIN variants v ON v.id = l.variant_id LEFT JOIN products p ON p.id = v.product_id WHERE l.order_id = ? ORDER BY l.sort_order`)
    .all(o.id);
  const allocs = db()
    .prepare(
      `SELECT a.*, w.name AS warehouse_name, v.sku FROM order_line_allocations a
       JOIN warehouses w ON w.id = a.warehouse_id JOIN variants v ON v.id = a.variant_id
       WHERE a.order_line_id IN (SELECT id FROM order_lines WHERE order_id = ?) ORDER BY a.rowid`,
    )
    .all(o.id);
  for (const l of o.lines) {
    l.allocations = allocs.filter((a) => a.order_line_id === l.id);
    l.planned_allocations = l.planned_allocations ? JSON.parse(l.planned_allocations) : null;
  }
  o.history = db().prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at').all(o.id);
  o.payments = listPaymentsFor('order', o.id);
  o.returns = db()
    .prepare('SELECT * FROM order_returns WHERE order_id = ? ORDER BY created_at')
    .all(o.id)
    .map((r) => ({ ...r, lines: JSON.parse(r.lines), awaiting_goods: !r.goods_received_at, amount_due_to_customer: returnDueToCustomer(r, isMarketplace(o.channel_id)) }));
  // Giá trị đã trả của từng dòng (từ các phiếu trả) để giao diện và máy chủ cùng tính phần còn lại theo luỹ kế
  for (const l of o.lines) l.returned_value = o.returns.reduce((a, r) => a + r.lines.filter((x) => x.order_line_id === l.id).reduce((b, x) => b + x.value, 0), 0);
  o.shipments = db().prepare('SELECT s.*, c.name AS carrier_name, c.tracking_url FROM shipments s JOIN carriers c ON c.id = s.carrier_id WHERE s.order_id = ? ORDER BY s.created_at').all(o.id).map((r) => ({ ...r, tracking_link: r.tracking_url ? r.tracking_url.replace('{code}', encodeURIComponent(r.tracking_code)) : null }));
  o.write_offs = db().prepare('SELECT * FROM return_write_offs WHERE order_id = ? ORDER BY created_at').all(o.id).map((w) => ({ ...w, lines: JSON.parse(w.lines) }));
  o.is_marketplace = isMarketplace(o.channel_id);
  // Ship shop chịu (đơn ngoài sàn): khoản shop phải trả hãng vận chuyển. Đơn sàn đã trừ vào tiền sàn trả nên không có khoản trả riêng
  o.seller_shipping_payments = listPaymentsFor('order_seller_shipping', o.id);
  o.seller_shipping_paid_amount = -netPaid('order_seller_shipping', o.id);
  o.seller_shipping_due = !o.is_marketplace && ['confirmed', 'shipping', 'completed', 'returned'].includes(o.status) ? Math.max(0, o.seller_shipping_amount - o.seller_shipping_paid_amount) : 0;
  o.customer_credit_balance = customerCreditBalance(o.customer_id, o.shop_id);
  o.amount_due = Math.max(0, dueAmount(o) - o.paid_amount);
  o.needs_refund = o.paid_amount > dueAmount(o);
  o.gross_profit = orderGrossProfit(o);
  return o;
}

/**
 * Số tiền shop cần thu về cho đơn.
 * Kênh sàn (Shopee…): sàn thu tiền khách rồi trả shop sau khi trừ phí → cần thu = net_amount.
 * Kênh khác: khách trả thẳng cho shop → cần thu = total_amount (phí ship shop chịu là khoản chi riêng).
 */
function isMarketplace(channelId) {
  return !!db().prepare('SELECT is_marketplace FROM channels WHERE id = ?').get(channelId)?.is_marketplace;
}

/** Lãi gộp một đơn: shop thực nhận − ship hoàn − hàng trả + phí trả hàng thu được − giá vốn − ship chiều về. Khớp báo cáo (finish) và sổ cái. */
export function orderGrossProfit(o) {
  if (o.status === 'cancelled' || o.status === 'draft') return 0;
  return o.net_amount - o.returned_shipping_amount - o.returned_goods_amount + o.return_fee_amount - o.cogs_amount - o.return_shipping_cost;
}

/** Cần trả khách của một phiếu trả: hàng + ship hoàn − phí trả hàng. Đơn sàn: sàn tự hoàn tiền cho người mua nên shop không trả khách. */
function returnDueToCustomer(r, marketplace) {
  return marketplace ? 0 : r.goods_amount + r.shipping_refund_amount - r.return_fee_amount;
}

function dueAmount(o) {
  if (o.status === 'cancelled') return 0;
  const base = isMarketplace(o.channel_id) ? o.net_amount : o.total_amount;
  return Math.max(0, base - o.returned_amount);
}

/** Bộ lọc đơn dùng chung cho danh sách và xuất file, để hai nơi luôn lọc giống hệt nhau */
export function orderFilter(f) {
  const where = [];
  const params = [];
  if (f.shopIds?.length) (where.push(`o.shop_id IN (${f.shopIds.map(() => '?').join(',')})`), params.push(...f.shopIds));
  if (f.status) (where.push(`o.status IN (${f.status.map(() => '?').join(',')})`), params.push(...f.status));
  if (f.channel) (where.push('o.channel_id = ?'), params.push(f.channel));
  if (f.paymentStatus) (where.push('o.payment_status = ?'), params.push(f.paymentStatus));
  if (f.customerId) (where.push('o.customer_id = ?'), params.push(f.customerId));
  if (f.from) (where.push('o.business_date >= ?'), params.push(f.from));
  if (f.to) (where.push('o.business_date <= ?'), params.push(f.to));
  if (f.q) {
    where.push('(o.code LIKE ? OR o.external_id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.tracking_code LIKE ?)');
    params.push(...Array(5).fill(`%${f.q}%`));
  }
  return { where, params };
}

/** Số đơn theo trạng thái, cùng bộ lọc với danh sách (bỏ lọc trạng thái để các tab hiện đủ số) */
export function countOrdersByStatus(f) {
  const { where, params } = orderFilter({ ...f, status: null });
  const rows = db()
    .prepare(`SELECT o.status, COUNT(*) AS n FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY o.status`)
    .all(...params);
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { ...counts, all: rows.reduce((a, r) => a + r.n, 0) };
}

export function listOrders(f) {
  const { where, params } = orderFilter(f);
  if (f.cursor) (where.push('o.id < ?'), params.push(f.cursor));
  const limit = f.limit ?? 50;
  const rows = db()
    .prepare(
      `SELECT o.id, o.code, o.shop_id, s.name AS shop_name, s.color AS shop_color, o.channel_id, o.external_id, o.customer_id,
              o.customer_name, o.customer_phone, o.status, o.payment_status, o.total_amount, o.net_amount, o.net_revenue,
              o.paid_amount, o.cogs_amount, o.returned_amount, o.stock_warning, o.ordered_at, o.business_date, o.source,
              (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS line_count,
              (SELECT SUM(qty) FROM order_lines l WHERE l.order_id = o.id) AS item_count
       FROM orders o JOIN shops s ON s.id = o.shop_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

// ---------- Tính tiền ----------
function resolveLines(shopId, lines, channelId = null) {
  return lines.map((l, i) => {
    let v;
    if (l.variant_id) v = db().prepare('SELECT v.*, p.name AS product_name, p.item_type FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(l.variant_id);
    else if (l.sku) v = db().prepare('SELECT v.*, p.name AS product_name, p.item_type FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?').get(String(l.sku).trim().toUpperCase());
    if (!v) throw badRequest('VARIANT_NOT_FOUND', `Không tìm thấy sản phẩm ${l.sku || l.variant_id}`, { line: i, sku: l.sku, variant_id: l.variant_id });
    if (v.item_type !== 'product') throw badRequest('MATERIAL_NOT_SELLABLE', `Mặt hàng ${v.sku} là vật tư kho, không thể thêm vào đơn bán`, { line: i, variant_id: v.id });
    let price = l.unit_price;
    if (price == null) {
      // Giá theo thứ tự: giá riêng của kênh → giá niêm yết của shop → giá mặc định
      const cp = channelId ? db().prepare('SELECT price FROM channel_prices WHERE shop_id = ? AND channel_id = ? AND variant_id = ?').get(shopId, channelId, v.id) : null;
      const listing = db().prepare('SELECT price FROM shop_listings WHERE shop_id = ? AND variant_id = ?').get(shopId, v.id);
      price = cp?.price ?? listing?.price ?? v.default_price;
    }
    const discount = l.discount_amount ?? 0;
    if (discount > price * l.qty) throw badRequest('INVALID_DISCOUNT', `Giảm giá dòng ${v.sku} lớn hơn thành tiền`);
    return {
      variant_id: v.id,
      sku: v.sku,
      name: l.name || [v.product_name, v.name].filter(Boolean).join(' – '),
      qty: l.qty,
      unit_price: price,
      discount_amount: discount,
      line_total: price * l.qty - discount,
      is_gift: l.is_gift ? 1 : 0,
      allocations: l.allocations?.length ? l.allocations : null,
    };
  });
}

function computeHeader(lines, f) {
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unit_price, 0);
  const lineDiscount = lines.reduce((a, l) => a + l.discount_amount, 0);
  const afterLines = subtotal - lineDiscount;
  const discount = f.discount_amount ?? 0;
  if (discount > afterLines) throw badRequest('INVALID_DISCOUNT', 'Giảm giá đơn lớn hơn tiền hàng');
  const goods = afterLines - discount;
  const total = goods + (f.shipping_fee ?? 0);
  const net = total - (f.platform_fee_amount ?? 0) - (f.seller_shipping_amount ?? 0);
  const alloc = allocate(discount, lines.map((l) => l.line_total));
  return {
    subtotal,
    line_discount_amount: lineDiscount,
    discount_amount: discount,
    goods_revenue: goods,
    total_amount: total,
    net_amount: net,
    lines: lines.map((l, i) => ({ ...l, allocated_order_discount: alloc[i] })),
  };
}

/** Tính lại các con số phụ thuộc trạng thái & trả hàng */
function refreshDerived(orderId) {
  const o = db().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const lines = db().prepare('SELECT * FROM order_lines WHERE order_id = ?').all(orderId);
  const rt = db()
    .prepare(
      `SELECT COALESCE(SUM(goods_amount),0) AS goods, COALESCE(SUM(shipping_refund_amount),0) AS ship, COALESCE(SUM(return_fee_amount),0) AS fee,
              COALESCE(SUM(return_shipping_cost),0) AS cost FROM order_returns WHERE order_id = ?`,
    )
    .get(orderId);
  // returned_amount = giảm số phải thu = hàng trả + ship hoàn − phí trả hàng (mọi công thức công nợ `total − returned_amount − paid` dùng số này)
  const returned = rt.goods + rt.ship - rt.fee;
  const active = STOCK_OUT_STATUSES.has(o.status);
  const cogs = active ? lines.reduce((a, l) => a + l.cogs_amount, 0) : 0; // cogs_amount của dòng đã trừ phần nhập lại kho
  const netRevenue = active ? o.goods_revenue - rt.goods : 0;
  const paid = netPaid('order', orderId);
  const due = dueAmount({ ...o, returned_amount: returned });
  // Còn nợ khách: đã thu nhiều hơn phải thu. Chỉ đơn ngoài sàn đã xác nhận trở đi (đơn huỷ hoàn tiền theo luồng huỷ; đơn sàn: sàn hoàn người mua)
  const refundOwed = !isMarketplace(o.channel_id) && ['confirmed', 'shipping', 'completed', 'returned'].includes(o.status) ? Math.max(0, paid - due) : 0;
  let paymentStatus = 'unpaid';
  if (paid > 0 && paid >= due) paymentStatus = 'paid';
  else if (paid > 0) paymentStatus = 'partial';
  const hadPayments = db().prepare("SELECT 1 FROM payments WHERE ref_type='order' AND ref_id=? AND voided_at IS NULL LIMIT 1").get(orderId);
  if ((o.status === 'cancelled' || o.status === 'returned') && hadPayments && paid <= 0) paymentStatus = 'refunded';
  if (o.status !== 'cancelled' && due === 0 && paid === 0 && o.status !== 'draft' && hadPayments) paymentStatus = 'refunded';
  db()
    .prepare(
      `UPDATE orders SET returned_amount=?, returned_goods_amount=?, returned_shipping_amount=?, return_fee_amount=?, return_shipping_cost=?, refund_owed_amount=?,
              net_revenue=?, cogs_amount=?, paid_amount=?, payment_status=?, updated_at=? WHERE id=?`,
    )
    .run(returned, rt.goods, rt.ship, rt.fee, rt.cost, refundOwed, netRevenue, cogs, paid, paymentStatus, nowIso(), orderId);
}

// ---------- Tồn kho theo trạng thái ----------
/** Hàng đang được giữ cho đơn nháp khác thì không bán được cho đơn này (trừ khi cho phép âm kho). */
function assertNotReserved(o) {
  const reserved = reservedByVariant(o.id);
  if (!reserved.size) return;
  const need = new Map();
  for (const l of db().prepare('SELECT variant_id, qty FROM order_lines WHERE order_id = ?').all(o.id)) need.set(l.variant_id, (need.get(l.variant_id) ?? 0) + l.qty);
  const whs = shopWarehouseIds(o.shop_id);
  for (const [vid, q] of need) {
    const held = reserved.get(vid) ?? 0;
    if (!held) continue;
    const have = db().prepare(`SELECT COALESCE(SUM(on_hand),0) AS n FROM stock_levels WHERE variant_id = ? AND warehouse_id IN (${whs.map(() => '?').join(',')})`).get(vid, ...whs).n;
    if (have - held < q) {
      const sku = db().prepare('SELECT sku FROM variants WHERE id = ?').get(vid)?.sku;
      throw conflict('STOCK_RESERVED', `${sku}: còn ${have} nhưng ${held} đang giữ cho đơn khác, đơn này cần ${q}. Bỏ giữ hàng ở đơn kia hoặc nhập thêm hàng.`, { variant_id: vid, on_hand: have, reserved: held, required: q });
    }
  }
}
/**
 * Xuất kho khi xác nhận đơn. Mỗi dòng có thể lấy từ nhiều kho (planAllocation). Mỗi phần ghi một biến động kho riêng,
 * giá vốn của phần đó là giá bình quân của CHÍNH kho đó lúc xuất, chụp vào allocation và không tính lại.
 * Giá vốn dòng (cogs_amount) = Σ SL × giá vốn từng phần: cộng số nguyên nên đúng từng đồng; unit_cost chỉ để hiển thị.
 */
function deductStock(o, actor, allowNegative) {
  let warning = false;
  if (!allowNegative) assertNotReserved(o);
  // Đơn import từ sàn đã xảy ra ở quá khứ: ghi biến động kho theo ngày đặt, không phải lúc bấm import
  const at = o.source === 'import' ? o.ordered_at : undefined;
  const lines = db().prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY sort_order').all(o.id);
  const plan = planAllocation(
    o.shop_id,
    lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty, allocations: l.planned_allocations ? JSON.parse(l.planned_allocations) : null })),
    { allowNegative, primaryWarehouseId: o.warehouse_id },
  );
  const insAlloc = db().prepare('INSERT INTO order_line_allocations (id, order_line_id, variant_id, warehouse_id, qty, unit_cost, restocked_qty, created_at) VALUES (?,?,?,?,?,?,0,?)');
  lines.forEach((l, i) => {
    const done = [];
    for (const it of plan.lines[i].items) {
      const res = applyMovement({ warehouseId: it.warehouse_id, variantId: it.variant_id, type: 'sale_out', qty: it.qty, refType: 'order', refId: o.id, refLineId: l.id, shopId: o.shop_id, actorId: actor?.id, allowNegative, at, clampIfClosed: true });
      if (res.negative || it.short_qty > 0) warning = true;
      // Mỗi phần giá vốn một phân bổ: bình quân luôn một phần; FIFO xuất qua nhiều lớp giá thì nhiều phần, đơn giá nguyên
      for (const sl of res.slices) {
        insAlloc.run(newId('ola'), l.id, it.variant_id, it.warehouse_id, sl.qty, sl.unitCost, nowIso());
        done.push({ variant_id: it.variant_id, qty: sl.qty, cost: sl.qty * sl.unitCost });
      }
    }
    const cogs = done.reduce((a, d) => a + d.cost, 0);
    if (plan.lines[i].items.some((it) => it.variant_id !== l.variant_id)) {
      // Combo: chụp từng thành phần (SL mỗi combo + giá vốn trung bình hiển thị) cho phiếu và để biết công thức lúc bán
      const comps = new Map();
      for (const d of done) {
        const c = comps.get(d.variant_id) ?? { qty: 0, cost: 0 };
        c.qty += d.qty;
        c.cost += d.cost;
        comps.set(d.variant_id, c);
      }
      for (const [vid, c] of comps) {
        db().prepare('INSERT INTO order_line_components (id, order_line_id, variant_id, per_bundle_qty, unit_cost) VALUES (?,?,?,?,?)').run(newId('olc'), l.id, vid, c.qty / l.qty, Math.round(c.cost / c.qty));
      }
    }
    db().prepare('UPDATE order_lines SET unit_cost = ?, cogs_amount = ? WHERE id = ?').run(Math.round(cogs / l.qty), cogs, l.id);
  });
  if (warning) db().prepare('UPDATE orders SET stock_warning = 1 WHERE id = ?').run(o.id);
}

/**
 * Nhập lại kho `qty` đơn vị của một dòng: mỗi phần về đúng giá vốn đã chụp. Lấy từ phân bổ tạo SAU CÙNG trước (LIFO).
 * Kho nhận mặc định là kho đã xuất; `warehouseId` (tuỳ chọn) đổi kho nhận, giá vốn vẫn là giá đã chụp.
 * Giảm cogs_amount của dòng đúng bằng giá vốn đã hoàn. Trả về giá vốn đã hoàn.
 */
function putBackLine(o, l, qty, { type, note, actor, at, warehouseId }) {
  const allocs = db()
    .prepare('SELECT * FROM order_line_allocations WHERE order_line_id = ? AND qty > restocked_qty ORDER BY rowid DESC')
    .all(l.id);
  // Combo: mỗi thành phần cần per_bundle × qty; biến thể đơn: qty. per_bundle suy từ tổng phân bổ / SL dòng.
  const all = db().prepare('SELECT variant_id, SUM(qty) AS q FROM order_line_allocations WHERE order_line_id = ? GROUP BY variant_id').all(l.id);
  const need = new Map(all.map((r) => [r.variant_id, (r.q / l.qty) * qty]));
  let restored = 0;
  for (const a of allocs) {
    let n = need.get(a.variant_id) ?? 0;
    if (n <= 0) continue;
    const take = Math.min(n, a.qty - a.restocked_qty);
    need.set(a.variant_id, n - take);
    applyMovement({ warehouseId: warehouseId ?? a.warehouse_id, variantId: a.variant_id, type, qty: take, unitCost: a.unit_cost, refType: 'order', refId: o.id, refLineId: l.id, shopId: o.shop_id, note, actorId: actor?.id, at, clampIfClosed: true });
    db().prepare('UPDATE order_line_allocations SET restocked_qty = restocked_qty + ? WHERE id = ?').run(take, a.id);
    restored += take * a.unit_cost;
  }
  for (const [vid, n] of need) if (n > 0) throw conflict('RESTOCK_EXCEEDS', 'Số lượng nhập lại lớn hơn số đã xuất của dòng đơn', { variant_id: vid, missing: n });
  db().prepare('UPDATE order_lines SET cogs_amount = cogs_amount - ? WHERE id = ?').run(restored, l.id);
  return restored;
}

function restoreStock(o, actor, note) {
  const lines = db().prepare('SELECT * FROM order_lines WHERE order_id = ?').all(o.id);
  for (const l of lines) {
    const qty = l.qty - l.restocked_qty;
    if (qty > 0) putBackLine(o, l, qty, { type: 'sale_cancel_in', note, actor });
    // Đơn huỷ không còn giá vốn nào. Phân bổ vẫn giữ lại làm lịch sử, đã hoàn hết.
    db().prepare('UPDATE order_lines SET cogs_amount = 0 WHERE id = ?').run(l.id);
  }
}

function logStatus(orderId, from, to, note, actor) {
  db()
    .prepare('INSERT INTO order_status_history (id, order_id, from_status, to_status, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('osh'), orderId, from, to, note ?? null, actor?.id ?? null, nowIso());
}

/** Chuyển một bước trạng thái, áp dụng tác động kho */
function step(o, to, { note, actor, allowNegative, at }) {
  if (!NEXT[o.status].includes(to)) throw conflict('INVALID_TRANSITION', `Không thể chuyển đơn từ "${o.status}" sang "${to}"`);
  const time = at || nowIso();
  if (to === 'confirmed') deductStock(o, actor, allowNegative);
  if (to === 'cancelled' && -netPaid('order_seller_shipping', o.id) > 0) throw conflict('SELLER_SHIPPING_PAID', 'Đơn đã trả ship cho hãng vận chuyển nên không huỷ được. Dùng Trả hàng để ghi nhận hàng quay về.');
  if (to === 'cancelled' && STOCK_OUT_STATUSES.has(o.status)) {
    const hasReturns = db().prepare('SELECT 1 FROM order_returns WHERE order_id = ? LIMIT 1').get(o.id);
    if (hasReturns) throw conflict('HAS_RETURNS', 'Đơn đã có phiếu trả hàng, không thể huỷ. Vui lòng tạo thêm phiếu trả cho phần còn lại.');
    restoreStock(o, actor, note || 'Huỷ đơn');
  }
  const col = { confirmed: 'confirmed_at', shipping: 'shipped_at', completed: 'completed_at', cancelled: 'cancelled_at' }[to];
  db()
    .prepare(`UPDATE orders SET status = ?, ${col} = ?, ${to === 'cancelled' ? 'cancel_reason = ?,' : ''} updated_at = ? WHERE id = ?`)
    .run(...[to, time, ...(to === 'cancelled' ? [note ?? null] : []), nowIso(), o.id]);
  logStatus(o.id, o.status, to, note, actor);
  return { ...o, status: to };
}

/** Chuyển đơn tới trạng thái đích, tự đi qua các bước trung gian */
export function transitionOrder(orderId, target, { note, actor, allowNegative = false, at } = {}) {
  let o = db().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw notFound('Đơn hàng');
  if (o.status === target) return getOrder(orderId);
  const before = o.status;
  if (target === 'cancelled') {
    o = step(o, 'cancelled', { note, actor, allowNegative, at });
  } else if (PATH[target] !== undefined && PATH[o.status] !== undefined && PATH[target] > PATH[o.status]) {
    const order = ['draft', 'confirmed', 'shipping', 'completed'];
    for (let i = PATH[o.status] + 1; i <= PATH[target]; i++) {
      // bỏ qua bước shipping nếu đích là completed và đơn chưa từng giao (bán trực tiếp)
      if (order[i] === 'shipping' && target === 'completed') continue;
      o = step(o, order[i], { note, actor, allowNegative, at });
    }
  } else {
    throw conflict('INVALID_TRANSITION', `Không thể chuyển đơn từ "${o.status}" sang "${target}"`);
  }
  refreshDerived(orderId);
  const after = getOrder(orderId);
  if (after.customer_id) recalcCustomerStats(after.customer_id);
  audit(actor, 'order.status_changed', 'order', orderId, { status: before }, { status: after.status });
  emit('order.status_changed', { entityType: 'order', entityId: orderId, shopId: after.shop_id, data: { from: before, to: after.status, order: after } });
  if (after.status === 'cancelled') emit('order.cancelled', { entityType: 'order', entityId: orderId, shopId: after.shop_id, data: after });
  return after;
}

// ---------- Tạo / sửa ----------
function resolveCustomer(input, actor) {
  if (input.customer_id) return getCustomer(input.customer_id);
  const c = input.customer;
  if (!c || (!c.phone && !c.name && !c.facebook_url && !c.shopee_username)) return null;
  return findOrCreateCustomer({ ...c, source_channel: input.channel_id }, actor);
}

/** Kiểm phân bổ kho tay của đơn nháp ngay lúc lưu (tổng phải khớp SL), để lỗi hiện sớm chứ không đợi tới lúc xác nhận */
function checkPlanned(shopId, lines, primaryWarehouseId) {
  if (!lines.some((l) => l.allocations?.length)) return;
  planAllocation(shopId, lines, { allowNegative: true, primaryWarehouseId });
}

/** Xem trước cách đơn sẽ lấy hàng: phân bổ đề xuất (hoặc theo phân bổ tay) kèm tồn từng kho của shop. Không ghi gì. */
export function previewAllocation(input) {
  const shop = getShop(input.shop_id);
  const lines = resolveLines(shop.id, input.lines.map((l) => ({ ...l, discount_amount: 0 })));
  const plan = planAllocation(shop.id, lines, { allowNegative: true, primaryWarehouseId: input.warehouse_id || undefined });
  const names = new Map(db().prepare('SELECT id, name FROM warehouses').all().map((w) => [w.id, w.name]));
  const level = db().prepare('SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?');
  const stockOf = new Map();
  const outLines = plan.lines.map((r, i) => {
    const items = r.items.map((it) => ({ ...it, warehouse_name: names.get(it.warehouse_id) }));
    for (const it of items) {
      if (stockOf.has(it.variant_id)) continue;
      stockOf.set(it.variant_id, { variant_id: it.variant_id, sku: it.sku, warehouses: plan.warehouses.map((w) => ({ warehouse_id: w, warehouse_name: names.get(w), on_hand: level.get(w, it.variant_id)?.on_hand ?? 0 })) });
    }
    return { index: i, variant_id: lines[i].variant_id, sku: lines[i].sku, qty: lines[i].qty, items };
  });
  return {
    primary_warehouse_id: plan.warehouses[0],
    warehouses: plan.warehouses.map((w) => ({ id: w, name: names.get(w) })),
    lines: outLines,
    stock: [...stockOf.values()],
    shortages: plan.shortages,
    warnings: plan.warnings,
    ok: plan.shortages.length === 0,
  };
}

export function createOrder(input, actor, { source = 'manual' } = {}) {
  const shop = getShop(input.shop_id);
  const channel = db().prepare('SELECT id, name, archived_at FROM channels WHERE id = ?').get(input.channel_id || 'direct');
  if (!channel) throw badRequest('INVALID_CHANNEL', `Kênh ${input.channel_id} không tồn tại`);
  if (channel.archived_at) throw badRequest('CHANNEL_DISABLED', `Kênh ${channel.name} đang tắt. Bật lại ở Cài đặt → Nền tảng bán hàng để tạo đơn mới (đơn cũ vẫn xem được).`);
  const warehouseId = input.warehouse_id || shopWarehouseIds(shop.id)[0] || shop.default_warehouse_id; // kho chính = ưu tiên 1
  if (!warehouseId) throw badRequest('NO_WAREHOUSE', `Shop ${shop.name} chưa có kho nào. Thêm kho ở Cài đặt → Shop & kho.`);
  if (input.external_id) {
    const dup = db().prepare('SELECT id, code FROM orders WHERE shop_id = ? AND channel_id = ? AND external_id = ?').get(shop.id, channel.id, input.external_id);
    if (dup) throw conflict('DUPLICATE_ORDER', `Đơn ${input.external_id} đã tồn tại (${dup.code})`, { order_id: dup.id });
  }
  const customer = resolveCustomer(input, actor);
  if (customer) ensureMember(customer.id, shop.id); // mua ở shop nào thì là khách của shop đó
  const lines = resolveLines(shop.id, input.lines, channel.id);
  // Khuyến mãi (module Loyalty): máy chủ tự tính lại, không tin số giảm từ giao diện
  let promoApplied = [];
  let headerInput = input;
  if (input.auto_promotions || input.promotion_code) {
    const ev = evaluatePromotions({ shop_id: shop.id, channel_id: channel.id, customer_id: customer?.id, code: input.promotion_code, lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty, unit_price: l.unit_price, discount_amount: l.discount_amount })) });
    if (input.promotion_code && !ev.code_status?.ok) throw badRequest('PROMOTION_INVALID', ev.code_status?.reason || 'Mã khuyến mãi không dùng được', { code: input.promotion_code });
    lines.forEach((l, i) => { l.discount_amount += ev.line_discounts[i]; l.line_total -= ev.line_discounts[i]; });
    headerInput = { ...input, discount_amount: (input.discount_amount ?? 0) + ev.order_discount };
    promoApplied = ev.applied;
    // Quà tặng kèm: thêm dòng giá 0 (vẫn trừ kho, giá vốn vào giá vốn đơn)
    for (const g of ev.gifts ?? []) lines.push(...resolveLines(shop.id, [{ variant_id: g.variant_id, qty: g.qty, unit_price: 0, name: `Quà tặng: ${g.product_name}`, is_gift: true }], channel.id));
  }
  const h = computeHeader(lines, headerInput);
  checkPlanned(shop.id, h.lines, warehouseId);
  const orderedAt = toIso(input.ordered_at) || nowIso();
  const id = newId('ord');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO orders (id, code, shop_id, channel_id, external_id, customer_id, warehouse_id, status, payment_status,
        customer_name, customer_phone, shipping_address, subtotal, line_discount_amount, discount_amount, goods_revenue,
        shipping_fee, total_amount, platform_fee_amount, seller_shipping_amount, net_amount, note, internal_note, tags,
        tracking_code, carrier, source, ordered_at, business_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'draft','unpaid',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      dailyCode('DH', shop.code, orderedAt),
      shop.id,
      channel.id,
      input.external_id ?? null,
      customer?.id ?? null,
      warehouseId,
      input.customer?.name ?? customer?.name ?? null,
      input.customer?.phone ?? customer?.phone ?? null,
      input.shipping_address ?? input.customer?.address ?? customer?.address ?? null,
      h.subtotal,
      h.line_discount_amount,
      h.discount_amount,
      h.goods_revenue,
      input.shipping_fee ?? 0,
      h.total_amount,
      input.platform_fee_amount ?? 0,
      input.seller_shipping_amount ?? 0,
      h.net_amount,
      input.note ?? null,
      input.internal_note ?? null,
      JSON.stringify(input.tags ?? []),
      input.tracking_code ?? null,
      input.carrier ?? null,
      source,
      orderedAt,
      businessDate(orderedAt),
      at,
      at,
    );
  const ins = db().prepare(
    `INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, discount_amount, line_total, allocated_order_discount, sort_order, planned_allocations, is_gift)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  h.lines.forEach((l, i) => ins.run(newId('orl'), id, l.variant_id, l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.allocated_order_discount, i, l.allocations ? JSON.stringify(l.allocations) : null, l.is_gift ? 1 : 0));
  if (promoApplied.length) recordUses(id, customer?.id, promoApplied);
  {
    const terms = getSetting('payment_terms_days') || 0;
    const due = input.due_date ?? (terms > 0 && !isMarketplace(channel.id) ? addDays(businessDate(orderedAt), terms) : null);
    if (due) db().prepare('UPDATE orders SET due_date = ? WHERE id = ?').run(due, id);
  }
  logStatus(id, null, 'draft', null, actor);
  emit('order.created', { entityType: 'order', entityId: id, shopId: shop.id, data: { id, shop_id: shop.id, channel_id: channel.id, external_id: input.external_id ?? null } });

  const target = input.status || 'draft';
  if (target !== 'draft') transitionOrder(id, target, { actor, allowNegative: input.allow_negative_stock ?? false, note: input.status_note });
  for (const p of input.payments ?? []) {
    if (p.amount > 0) {
      if (p.method === 'customer_credit') {
        if (isMarketplace(channel.id)) throw badRequest('CUSTOMER_CREDIT_MARKETPLACE', 'Không thể dùng tiền khách gửi để thanh toán đơn sàn');
        assertCustomerCredit(customer?.id, shop.id, p.amount);
      }
      recordPayment({ direction: 'in', refType: 'order', refId: id, shopId: shop.id, amount: p.amount, method: p.method, paidAt: p.paid_at, note: p.note }, actor);
    }
  }
  refreshDerived(id);
  if (customer) recalcCustomerStats(customer.id);
  const o = getOrder(id);
  audit(actor, 'order.created', 'order', id, null, o);
  return o;
}

const EDITABLE_ALWAYS = ['note', 'internal_note', 'tracking_code', 'carrier', 'shipping_address', 'customer_name', 'customer_phone', 'platform_fee_amount', 'seller_shipping_amount', 'shipping_fee', 'tags', 'ordered_at'];

export function updateOrder(id, input, actor) {
  const before = getOrder(id);
  if (before.status === 'cancelled') throw conflict('ORDER_CANCELLED', 'Đơn đã huỷ, không thể sửa');
  const touchesGoods = !!(input.lines || input.discount_amount !== undefined || input.warehouse_id);
  // Đơn đã xác nhận mà hàng còn ở shop (chưa giao): sửa được cả sản phẩm. Hàng được cộng lại kho rồi trừ lại theo nội dung mới, trong cùng một giao dịch
  const revise = before.status === 'confirmed' && touchesGoods;
  const isDraft = before.status === 'draft' || revise;
  if (!isDraft && touchesGoods) {
    throw conflict('NOT_DRAFT', 'Đơn đã giao đi nên không sửa sản phẩm, giảm giá, kho được. Dùng Trả hàng hoặc Đổi hàng.');
  }
  if (revise) {
    if (db().prepare('SELECT 1 FROM order_returns WHERE order_id = ? LIMIT 1').get(before.id)) throw conflict('HAS_RETURNS', 'Đơn đã có phiếu trả hàng nên không sửa sản phẩm được');
    restoreStock(before, actor, 'Sửa đơn đã xác nhận');
    const lineIds = before.lines.map((l) => l.id);
    for (const lid of lineIds) {
      db().prepare('DELETE FROM order_line_allocations WHERE order_line_id = ?').run(lid);
      db().prepare('DELETE FROM order_line_components WHERE order_line_id = ?').run(lid);
    }
  }
  const merged = { ...before, ...input };
  if (input.customer_id !== undefined || input.customer) {
    const c = resolveCustomer(input, actor);
    merged.customer_id = c?.id ?? null;
    if (c) {
      ensureMember(c.id, before.shop_id);
      merged.customer_name = input.customer?.name ?? c.name;
      merged.customer_phone = input.customer?.phone ?? c.phone;
    }
  }
  if (!merged.warehouse_id) merged.warehouse_id = before.warehouse_id;
  let lines = before.lines;
  if (isDraft && input.lines) {
    lines = resolveLines(before.shop_id, input.lines, before.channel_id);
  }
  const h = computeHeader(lines.map((l) => ({ ...l, line_total: l.line_total ?? l.qty * l.unit_price - l.discount_amount })), merged);
  if (isDraft && input.lines) checkPlanned(before.shop_id, h.lines, merged.warehouse_id);
  const orderedAt = input.ordered_at ? toIso(input.ordered_at) : before.ordered_at;
  db()
    .prepare(
      `UPDATE orders SET customer_id=?, customer_name=?, customer_phone=?, shipping_address=?, warehouse_id=?,
        subtotal=?, line_discount_amount=?, discount_amount=?, goods_revenue=?, shipping_fee=?, total_amount=?,
        platform_fee_amount=?, seller_shipping_amount=?, net_amount=?, note=?, internal_note=?, tags=?, tracking_code=?, carrier=?,
        ordered_at=?, business_date=?, updated_at=? WHERE id=?`,
    )
    .run(
      merged.customer_id,
      merged.customer_name,
      merged.customer_phone,
      merged.shipping_address,
      merged.warehouse_id,
      h.subtotal,
      h.line_discount_amount,
      h.discount_amount,
      h.goods_revenue,
      merged.shipping_fee,
      h.total_amount,
      merged.platform_fee_amount,
      merged.seller_shipping_amount,
      h.net_amount,
      merged.note,
      merged.internal_note,
      JSON.stringify(merged.tags ?? []),
      merged.tracking_code,
      merged.carrier,
      orderedAt,
      businessDate(orderedAt),
      nowIso(),
      id,
    );
  if (isDraft && input.lines) {
    db().prepare('DELETE FROM order_lines WHERE order_id = ?').run(before.id);
    const ins = db().prepare(
      `INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, discount_amount, line_total, allocated_order_discount, sort_order, planned_allocations, is_gift)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    h.lines.forEach((l, i) => ins.run(newId('orl'), before.id, l.variant_id, l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.allocated_order_discount, i, l.allocations ? JSON.stringify(l.allocations) : null, l.is_gift ? 1 : 0));
  } else {
    const upd = db().prepare('UPDATE order_lines SET allocated_order_discount = ? WHERE id = ?');
    h.lines.forEach((l) => upd.run(l.allocated_order_discount, l.id));
  }
  if (revise) {
    deductStock(db().prepare('SELECT * FROM orders WHERE id = ?').get(before.id), actor, false);
    logStatus(before.id, 'confirmed', 'confirmed', 'Sửa nội dung đơn đã xác nhận', actor);
  }
  if (input.due_date !== undefined) db().prepare('UPDATE orders SET due_date = ? WHERE id = ?').run(input.due_date, before.id);
  refreshDerived(before.id);
  if (before.customer_id) recalcCustomerStats(before.customer_id);
  if (merged.customer_id && merged.customer_id !== before.customer_id) recalcCustomerStats(merged.customer_id);
  const after = getOrder(before.id);
  audit(actor, 'order.updated', 'order', before.id, before, after);
  emit('order.updated', { entityType: 'order', entityId: before.id, shopId: after.shop_id, data: after });
  return after;
}

// ---------- Thanh toán ----------
export function addOrderPayment(id, { amount, method, paidAt, note, direction = 'in' }, actor) {
  const o = getOrder(id);
  if (method === 'customer_credit') {
    if (o.is_marketplace) throw badRequest('CUSTOMER_CREDIT_MARKETPLACE', 'Không thể dùng tiền khách gửi cho đơn sàn');
    if (direction === 'in') assertCustomerCredit(o.customer_id, o.shop_id, amount);
    if (direction === 'out' && !o.customer_id) throw badRequest('CUSTOMER_CREDIT_CUSTOMER_REQUIRED', 'Cần hồ sơ khách để chuyển tiền hoàn thành tiền khách gửi');
  }
  if (direction === 'in' && o.status === 'cancelled') throw conflict('ORDER_CANCELLED', 'Đơn đã huỷ');
  if (direction === 'out' && amount > o.paid_amount) throw badRequest('OVER_REFUND', 'Số tiền hoàn lớn hơn số đã thu');
  if (direction === 'out' && o.status !== 'cancelled' && !o.is_marketplace && o.status !== 'draft' && amount > o.refund_owed_amount) {
    throw badRequest('OVER_REFUND', `Chỉ còn nợ khách ${o.refund_owed_amount}; không hoàn nhiều hơn số đó`, { max: o.refund_owed_amount });
  }
  const p = recordPayment({ direction, refType: 'order', refId: o.id, shopId: o.shop_id, amount, method, paidAt, note }, actor);
  refreshDerived(o.id);
  const after = getOrder(o.id);
  emit('order.payment_recorded', { entityType: 'order', entityId: o.id, shopId: o.shop_id, data: { payment: p, paid_amount: after.paid_amount, payment_status: after.payment_status } });
  return after;
}

/**
 * Huỷ một khoản thanh toán ghi nhầm của đơn (không xoá: đánh dấu `voided_at`, giữ trong sổ và nhật ký).
 * Chỉ khoản thu/hoàn nhập tay và khoản trả ship cho hãng; khoản do trả hàng hoặc đối soát tạo ra phải xử lý ở nơi tạo ra chúng.
 */
export function voidOrderPayment(p, reason, actor) {
  const o = getOrder(p.ref_id);
  if (p.ref_type === 'order') {
    if (p.direction === 'out' && /^(Hoàn tiền trả hàng|Chuyển tiền trả hàng)/.test(p.note || '')) {
      throw conflict('PAYMENT_FROM_RETURN', 'Khoản hoàn này do phiếu trả hàng tạo ra, không huỷ riêng được.');
    }
    if (/_payout$/.test(p.method) && db().prepare('SELECT 1 FROM payout_adjustments WHERE order_id = ? LIMIT 1').get(o.id)) {
      throw conflict('PAYOUT_HAS_ADJUSTMENT', 'Đơn này đã đối soát lệch và cộng phần lệch vào phí sàn. Sửa lại phí sàn của đơn trước, rồi mới huỷ khoản tiền sàn trả.');
    }
    if (p.direction === 'in' && o.paid_amount - p.amount < 0) {
      throw conflict('PAYMENT_HAS_REFUND', 'Đã có khoản hoàn tiền dựa trên khoản thu này. Huỷ khoản hoàn trước, rồi huỷ khoản thu.');
    }
  }
  const at = nowIso();
  voidPaymentRow(p, at);
  if (p.ref_type === 'order') refreshDerived(o.id);
  const after = getOrder(o.id);
  audit(actor, 'payment.voided', 'order', o.id, { payment: { id: p.id, direction: p.direction, amount: p.amount, method: p.method } }, { reason: reason ?? null, paid_amount: after.paid_amount });
  emit('order.updated', { entityType: 'order', entityId: o.id, shopId: o.shop_id, data: after });
  return after;
}

// ---------- Trả hàng ----------
/**
 * Giá trị hàng của một lần trả = giá trị luỹ kế sau lần này − tổng đã trả trước đó, với
 * luỹ kế(n) = round((line_total − giảm giá đơn phân bổ) × n / SL dòng). Trả hết dòng thì tổng các lần bằng đúng tiền thực của dòng
 * (không làm tròn riêng từng lần). `returned_value` là tổng giá trị đã ghi ở các phiếu trước (kể cả phiếu cũ làm tròn kiểu cũ).
 */
export function returnLineValue(l, qty) {
  const net = l.line_total - l.allocated_order_discount;
  const cum = l.returned_qty + qty >= l.qty ? net : Math.round((net * (l.returned_qty + qty)) / l.qty);
  return cum - l.returned_value;
}

/**
 * lines: [{ order_line_id, qty, restock, warehouse_id? }] — restock=false nghĩa là hàng hỏng, không nhập lại kho (giá vốn không đổi);
 *   restock=true nhập lại theo LIFO về đúng kho đã xuất, hoặc `warehouse_id` nếu chọn kho nhận khác
 * refund: { amount, method } — tiền trả khách ngay lúc lập phiếu
 * shippingRefund: hoàn phí ship cho khách (tối đa phí ship còn lại của đơn); returnFee: phí trả hàng shop giữ lại (tối đa hàng + ship hoàn);
 * returnShippingCost: phí ship chiều về shop chịu.
 * Cần trả khách = hàng + ship hoàn − phí trả hàng; tiền trả ngay không vượt số đó và không vượt số khách đã trả.
 * Kênh sàn: sàn tự hoàn tiền cho người mua → không có ship hoàn, phí trả hàng, tiền trả khách (chỉ ship chiều về nếu sàn tính cho shop).
 */
export function createReturn(orderId, { lines, reason, refund, returnedAt, shippingRefund = 0, returnFee = 0, returnShippingCost = 0, awaitingGoods = false, reasonCode = null, allowLate = false }, actor) {
  const o = getOrder(orderId);
  if (!['completed', 'shipping', 'confirmed'].includes(o.status)) throw conflict('INVALID_STATUS', 'Chỉ trả hàng cho đơn đã xác nhận/giao/hoàn thành');
  // Thời hạn nhận trả: chỉ áp cho đơn đã hoàn thành (khách đã nhận hàng). Quá hạn vẫn nhận được nếu chủ shop xác nhận.
  const windowDays = getSetting('return_window_days') || 0;
  if (windowDays > 0 && o.status === 'completed' && o.completed_at && !allowLate) {
    const days = Math.floor((Date.now() - new Date(o.completed_at).getTime()) / 86400000);
    if (days > windowDays) throw conflict('RETURN_WINDOW_EXPIRED', `Đơn hoàn thành ${days} ngày trước, quá hạn trả hàng ${windowDays} ngày. Xác nhận nhận trả quá hạn nếu muốn vẫn nhận.`, { days, window_days: windowDays });
  }
  if (reasonCode && !RETURN_REASON_CODES.includes(reasonCode)) throw badRequest('INVALID_REASON', 'Lý do trả hàng không hợp lệ', { allowed: RETURN_REASON_CODES });
  const refundAmount = refund?.amount ?? 0;
  if (o.is_marketplace && (shippingRefund > 0 || returnFee > 0 || refundAmount > 0)) {
    throw badRequest('MARKETPLACE_RETURN', 'Đơn sàn: sàn tự hoàn tiền cho người mua nên không có hoàn ship, phí trả hàng hay tiền trả khách');
  }
  const shipLeft = o.shipping_fee - o.returned_shipping_amount;
  if (shippingRefund > shipLeft) throw badRequest('OVER_SHIPPING_REFUND', `Hoàn phí ship tối đa ${shipLeft}`, { max: shipLeft });
  const at = toIso(returnedAt) || nowIso();
  // Hàng chưa về shop (đơn sàn chờ sàn trả, hoặc giao không thành đang trên đường về): chưa nhập kho, chưa hoàn giá vốn cho tới khi bấm đã nhận hàng
  const waitingForGoods = !!awaitingGoods;
  const damaged = [];
  const id = newId('ret');
  const result = [];
  let goods = 0;
  for (const r of lines) {
    const l = o.lines.find((x) => x.id === r.order_line_id);
    if (!l) throw badRequest('LINE_NOT_FOUND', 'Dòng đơn không tồn tại', r);
    if (r.qty > l.qty - l.returned_qty) throw badRequest('RETURN_QTY', `Dòng ${l.sku}: chỉ còn trả được ${l.qty - l.returned_qty}`);
    const value = returnLineValue(l, r.qty);
    goods += value;
    let restoredCost = 0;
    if (!r.restock && !waitingForGoods) damaged.push({ order_line_id: l.id, variant_id: l.variant_id, sku: l.sku, qty: r.qty, unit_cost: l.unit_cost });
    if (r.restock && !waitingForGoods) {
      restoredCost = putBackLine(o, l, r.qty, { type: 'sale_return_in', note: reason, actor, at, warehouseId: r.warehouse_id });
    }
    db()
      .prepare('UPDATE order_lines SET returned_qty = returned_qty + ?, restocked_qty = restocked_qty + ? WHERE id = ?')
      .run(r.qty, r.restock && !waitingForGoods ? r.qty : 0, l.id);
    l.returned_qty += r.qty;
    l.returned_value += value;
    result.push({ order_line_id: l.id, variant_id: l.variant_id, sku: l.sku, qty: r.qty, restock: !!r.restock, received: !waitingForGoods, value, unit_cost: l.unit_cost, restored_cost: restoredCost });
  }
  if (returnFee > goods + shippingRefund) throw badRequest('OVER_RETURN_FEE', `Phí trả hàng tối đa ${goods + shippingRefund} (hàng trả + ship hoàn)`, { max: goods + shippingRefund });
  const dueToCustomer = goods + shippingRefund - returnFee;
  if (refundAmount > dueToCustomer) throw badRequest('OVER_REFUND', `Tiền trả khách tối đa ${dueToCustomer} (cần trả khách của phiếu này)`, { max: dueToCustomer });
  if (refundAmount > o.paid_amount) throw badRequest('OVER_REFUND', 'Số tiền hoàn lớn hơn số đã thu');
  db()
    .prepare(
      `INSERT INTO order_returns (id, code, order_id, shop_id, goods_amount, shipping_refund_amount, return_fee_amount, return_shipping_cost, refund_amount, reason, lines, returned_at, business_date, actor_id, created_at, goods_received_at, reason_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, dailyCode('TH', o.shop_code, at), o.id, o.shop_id, goods, shippingRefund, returnFee, returnShippingCost, refundAmount, reason ?? null, JSON.stringify(result), at, businessDate(at), actor?.id ?? null, nowIso(), waitingForGoods ? null : at, reasonCode ?? null);
  if (damaged.length) createWriteOff(o, id, damaged, at, reason, actor);
  if (refundAmount > 0) {
    const method = refund.to_credit ? 'customer_credit' : refund.method ?? 'cash';
    if (method === 'customer_credit' && !o.customer_id) throw badRequest('CUSTOMER_CREDIT_CUSTOMER_REQUIRED', 'Cần hồ sơ khách để chuyển tiền hoàn thành tiền khách gửi');
    recordPayment({ direction: 'out', refType: 'order', refId: o.id, shopId: o.shop_id, amount: refundAmount, method, paidAt: at, note: refund.to_credit ? 'Chuyển tiền trả hàng thành tiền khách gửi' : 'Hoàn tiền trả hàng' }, actor);
  }
  const fully = db().prepare('SELECT SUM(qty - returned_qty) AS left FROM order_lines WHERE order_id = ?').get(o.id).left === 0;
  if (fully) {
    db().prepare("UPDATE orders SET status = 'returned', updated_at = ? WHERE id = ?").run(nowIso(), o.id);
    logStatus(o.id, o.status, 'returned', reason, actor);
  }
  refreshDerived(o.id);
  if (o.customer_id) recalcCustomerStats(o.customer_id);
  const after = getOrder(o.id);
  audit(actor, 'order.returned', 'order', o.id, null, { return_id: id, lines: result, goods, shippingRefund, returnFee, returnShippingCost, refundAmount });
  emit('order.returned', { entityType: 'order', entityId: o.id, shopId: o.shop_id, data: { return_id: id, goods_amount: goods, shipping_refund_amount: shippingRefund, return_fee_amount: returnFee, return_shipping_cost: returnShippingCost, refund_amount: refundAmount, order: after } });
  return after;
}

/**
 * Phiếu hàng huỷ: hàng khách trả về bị hỏng nên không nhập lại kho. Chỉ là chứng từ tra cứu (không có biến động kho, không có bút toán riêng):
 * giá vốn của hàng đó không được hoàn nên vẫn nằm trong giá vốn của đơn, tức là một khoản lỗ trong lãi gộp.
 */
function createWriteOff(o, returnId, items, at, reason, actor) {
  const id = newId('wof');
  const total = items.reduce((a, i) => a + Math.round(i.qty * i.unit_cost), 0);
  db()
    .prepare('INSERT INTO return_write_offs (id, code, return_id, order_id, shop_id, warehouse_id, lines, total_cost, reason, created_at, business_date, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, dailyCode('HH', o.shop_code, at), returnId, o.id, o.shop_id, o.warehouse_id, JSON.stringify(items), total, reason ?? null, nowIso(), businessDate(at), actor?.id ?? null);
  audit(actor, 'order.return_write_off', 'order', o.id, null, { write_off_id: id, return_id: returnId, total_cost: total });
}

/**
 * Nhận hàng của phiếu trả đang chờ hàng về (đơn sàn, hoặc giao không thành): lúc này mới nhập kho và hoàn giá vốn.
 * `damagedLineIds`: các dòng hàng về đã hỏng, không nhập kho mà lập phiếu hàng huỷ.
 */
export function receiveReturn(orderId, returnId, { actor, receivedAt, damagedLineIds = [] } = {}) {
  const o = getOrder(orderId);
  const ret = db().prepare('SELECT * FROM order_returns WHERE id = ? AND order_id = ?').get(returnId, orderId);
  if (!ret) throw notFound('Phiếu trả hàng');
  if (ret.goods_received_at) throw conflict('RETURN_ALREADY_RECEIVED', 'Hàng của phiếu trả này đã được nhận');
  const at = toIso(receivedAt) || nowIso();
  const lines = JSON.parse(ret.lines || '[]');
  const forcedDamaged = new Set(damagedLineIds);
  const damaged = [];
  for (const item of lines) {
    if (forcedDamaged.has(item.order_line_id)) item.restock = false;
    if (!item.restock) {
      item.received = true;
      damaged.push({ order_line_id: item.order_line_id, variant_id: item.variant_id, sku: item.sku, qty: item.qty, unit_cost: item.unit_cost });
      continue;
    }
    const line = db().prepare('SELECT * FROM order_lines WHERE id = ? AND order_id = ?').get(item.order_line_id, orderId);
    if (!line) throw conflict('RETURN_LINE_MISSING', 'Không tìm thấy dòng đơn của phiếu trả');
    item.restored_cost = putBackLine(o, line, item.qty, { type: 'sale_return_in', note: ret.reason, actor, at });
    item.received = true;
    db().prepare('UPDATE order_lines SET restocked_qty = restocked_qty + ? WHERE id = ?').run(item.qty, line.id);
  }
  if (damaged.length) createWriteOff(o, returnId, damaged, at, ret.reason, actor);
  db().prepare('UPDATE order_returns SET lines = ?, goods_received_at = ? WHERE id = ?').run(JSON.stringify(lines), at, returnId);
  refreshDerived(orderId);
  if (o.customer_id) recalcCustomerStats(o.customer_id);
  const after = getOrder(orderId);
  audit(actor, 'order.return_goods_received', 'order', o.id, null, { return_id: returnId, received_at: at });
  emit('order.return_goods_received', { entityType: 'order', entityId: o.id, shopId: o.shop_id, data: { return_id: returnId, order: after } });
  return after;
}

/**
 * Gỡ phiếu trả hàng đang chờ hàng về (hàng chưa nhập kho, chưa có tiền trả khách, chưa có phiếu hàng huỷ): phiếu này chưa tạo ra
 * thay đổi nào ngoài con số trên đơn, nên là dữ liệu nháp theo quy ước 6. Bản sao đầy đủ lưu vào audit_log.
 * `restoreStatus`: nếu phiếu làm đơn thành "đã trả hết" thì đưa đơn về trạng thái này.
 */
export function removeAwaitingReturn(orderId, returnId, { actor, restoreStatus = null } = {}) {
  const o = getOrder(orderId);
  const ret = db().prepare('SELECT * FROM order_returns WHERE id = ? AND order_id = ?').get(returnId, orderId);
  if (!ret) throw notFound('Phiếu trả hàng');
  if (ret.goods_received_at) throw conflict('RETURN_ALREADY_RECEIVED', 'Hàng của phiếu trả này đã nhập kho, không gỡ được');
  if (ret.refund_amount > 0) throw conflict('RETURN_HAS_REFUND', 'Phiếu trả này đã hoàn tiền cho khách, không gỡ được');
  if (db().prepare('SELECT 1 FROM return_write_offs WHERE return_id = ? LIMIT 1').get(returnId)) throw conflict('RETURN_HAS_WRITE_OFF', 'Phiếu trả này đã có phiếu hàng huỷ, không gỡ được');
  for (const item of JSON.parse(ret.lines || '[]')) {
    db().prepare('UPDATE order_lines SET returned_qty = MAX(0, returned_qty - ?) WHERE id = ? AND order_id = ?').run(item.qty, item.order_line_id, orderId);
  }
  db().prepare('DELETE FROM order_returns WHERE id = ?').run(returnId);
  if (o.status === 'returned' && restoreStatus) {
    const left = db().prepare('SELECT SUM(qty - returned_qty) AS n FROM order_lines WHERE order_id = ?').get(orderId).n;
    if (left > 0) {
      db().prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(restoreStatus, nowIso(), orderId);
      logStatus(orderId, 'returned', restoreStatus, 'Gỡ phiếu trả hàng chờ hàng về', actor);
    }
  }
  refreshDerived(orderId);
  if (o.customer_id) recalcCustomerStats(o.customer_id);
  const after = getOrder(orderId);
  audit(actor, 'order.return_removed', 'order', orderId, { return: ret }, { status: after.status });
  emit('order.updated', { entityType: 'order', entityId: orderId, shopId: o.shop_id, data: after });
  return after;
}

/** Đưa đơn "hoàn thành" về "đang giao" (hoàn tác việc đánh dấu giao thành công). Chỉ khi đơn vẫn đang hoàn thành và chưa có phiếu trả. */
export function revertOrderCompletion(orderId, { actor, note } = {}) {
  const o = db().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw notFound('Đơn hàng');
  if (o.status !== 'completed') throw conflict('ORDER_CHANGED', `Đơn ${o.code} đã đổi trạng thái sang “${o.status}” sau đối soát`);
  if (db().prepare('SELECT 1 FROM order_returns WHERE order_id = ? LIMIT 1').get(orderId)) throw conflict('HAS_RETURNS', `Đơn ${o.code} đã có phiếu trả hàng sau đối soát`);
  db().prepare("UPDATE orders SET status = 'shipping', completed_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), orderId);
  logStatus(orderId, 'completed', 'shipping', note, actor);
  refreshDerived(orderId);
  if (o.customer_id) recalcCustomerStats(o.customer_id);
  const after = getOrder(orderId);
  audit(actor, 'order.completion_reverted', 'order', orderId, { status: 'completed' }, { status: 'shipping' });
  emit('order.status_changed', { entityType: 'order', entityId: orderId, shopId: o.shop_id, data: { from: 'completed', to: 'shipping', order: after } });
  return after;
}

/** Ghi việc shop đã trả tiền ship cho hãng vận chuyển (ship shop chịu của đơn ngoài sàn): bù khoản phải trả khác (3388) đã ghi khi bán. */
export function addSellerShippingPayment(id, { amount, method = 'cash', paidAt, note }, actor) {
  const o = getOrder(id);
  if (o.is_marketplace) throw badRequest('MARKETPLACE_SHIPPING', 'Đơn sàn: ship shop chịu đã trừ vào tiền sàn trả, không ghi trả riêng');
  if (!['confirmed', 'shipping', 'completed', 'returned'].includes(o.status)) throw conflict('INVALID_STATUS', 'Chỉ ghi trả ship cho đơn đã xác nhận trở đi');
  if (amount > o.seller_shipping_due) throw badRequest('OVER_SHIPPING_PAID', `Ship shop chịu còn phải trả ${o.seller_shipping_due}`, { max: o.seller_shipping_due });
  recordPayment({ direction: 'out', refType: 'order_seller_shipping', refId: o.id, shopId: o.shop_id, amount, method, paidAt, note: note ?? 'Trả ship cho hãng vận chuyển' }, actor);
  audit(actor, 'order.seller_shipping_paid', 'order', o.id, null, { amount, method });
  return getOrder(id);
}

/** Đổi hàng một giao dịch: ghi phiếu trả, chuyển phần đã thu thành tiền khách gửi, rồi tạo đơn hàng mới. */
export const receiveMarketplaceReturn = receiveReturn;

/**
 * Tách đơn (giao từng phần): chuyển một phần số lượng của đơn nháp hoặc đơn đã xác nhận sang một đơn nháp mới.
 * Đơn mới cùng khách, kênh, kho, ghi chú "Tách từ …"; phí ship và các khoản đã thu ở lại đơn gốc.
 * Giảm giá từng dòng và giảm giá cả đơn chia theo tỷ lệ phần chuyển đi (chia bằng allocate nên tổng khớp từng đồng).
 */
export function splitOrder(orderId, { lines }, actor) {
  const o = getOrder(orderId);
  if (!['draft', 'confirmed'].includes(o.status)) throw conflict('INVALID_STATUS', 'Chỉ tách được đơn nháp hoặc đơn đã xác nhận (hàng chưa giao)');
  if (!lines?.length) throw badRequest('SPLIT_LINES_REQUIRED', 'Chọn ít nhất một dòng để tách');
  const move = new Map();
  for (const m of lines) {
    const l = o.lines.find((x) => x.id === m.order_line_id);
    if (!l) throw badRequest('LINE_NOT_FOUND', 'Dòng đơn không tồn tại', m);
    if (!(m.qty > 0) || m.qty > l.qty) throw badRequest('SPLIT_QTY', `Dòng ${l.sku}: số lượng tách phải từ 0 tới ${l.qty}`);
    move.set(l.id, (move.get(l.id) ?? 0) + m.qty);
  }
  const keepLines = [];
  const newLines = [];
  for (const l of o.lines) {
    const q = move.get(l.id) ?? 0;
    const lineDisc = q === l.qty ? l.discount_amount : Math.round((l.discount_amount * q) / l.qty);
    if (q > 0) newLines.push({ variant_id: l.variant_id, name: l.name, qty: q, unit_price: l.unit_price, discount_amount: lineDisc });
    if (q < l.qty) keepLines.push({ variant_id: l.variant_id, name: l.name, qty: l.qty - q, unit_price: l.unit_price, discount_amount: l.discount_amount - lineDisc });
  }
  if (!keepLines.length) throw badRequest('SPLIT_ALL', 'Đơn gốc phải còn ít nhất một sản phẩm. Muốn chuyển hết thì không cần tách.');
  const base = (arr) => arr.reduce((a, l) => a + l.qty * l.unit_price - l.discount_amount, 0);
  const [moveDisc, keepDisc] = allocate(o.discount_amount, [base(newLines), base(keepLines)]);
  // Đơn gốc trước: nếu thiếu hàng cho phần còn lại thì lỗi ở đây, chưa tạo đơn mới
  updateOrder(o.id, { lines: keepLines, discount_amount: keepDisc }, actor);
  const child = createOrder({
    shop_id: o.shop_id, channel_id: o.channel_id, customer_id: o.customer_id ?? undefined, warehouse_id: o.warehouse_id,
    shipping_address: o.shipping_address, lines: newLines, discount_amount: moveDisc, shipping_fee: 0,
    note: `Tách từ ${o.code}`, tags: ['tách-đơn'],
  }, actor);
  db().prepare('UPDATE orders SET parent_order_id = ? WHERE id = ?').run(o.id, child.id);
  audit(actor, 'order.split', 'order', o.id, null, { child_id: child.id, child_code: child.code });
  return { parent: getOrder(o.id), child: getOrder(child.id) };
}

/** Giữ hàng cho đơn nháp tới một ngày (hoặc không hạn). Tắt giữ hàng: reserve=false. */
export function setReservation(orderId, { reserve, until }, actor) {
  const o = getOrder(orderId);
  if (o.status !== 'draft') throw conflict('INVALID_STATUS', 'Chỉ giữ hàng cho đơn nháp');
  if (reserve && until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw badRequest('INVALID_DATE', 'Hạn giữ hàng phải là YYYY-MM-DD');
  db().prepare('UPDATE orders SET reserve_stock = ?, reserved_until = ?, updated_at = ? WHERE id = ?').run(reserve ? 1 : 0, reserve ? until ?? null : null, nowIso(), orderId);
  audit(actor, reserve ? 'order.reserved' : 'order.unreserved', 'order', orderId, null, { until: until ?? null });
  return getOrder(orderId);
}

export function exchangeOrder(orderId, { returnLines, newLines, reason, shippingFee = 0, paymentMethod = 'cash' }, actor) {
  const old = getOrder(orderId);
  if (old.is_marketplace) throw badRequest('MARKETPLACE_EXCHANGE', 'Đơn sàn cần xử lý trả hàng theo quy trình của sàn, không hỗ trợ đổi trực tiếp');
  if (!old.customer_id) throw badRequest('CUSTOMER_REQUIRED', 'Cần gắn đơn với hồ sơ khách để đổi hàng và đối trừ tiền chính xác');
  if (!['confirmed', 'shipping', 'completed'].includes(old.status)) throw conflict('INVALID_STATUS', 'Chỉ đổi hàng cho đơn đã xác nhận/giao/hoàn thành');
  if (!returnLines?.length || !newLines?.length) throw badRequest('EXCHANGE_LINES_REQUIRED', 'Chọn ít nhất một sản phẩm trả và một sản phẩm đổi');
  const returnedGoods = returnLines.reduce((sum, r) => {
    const line = old.lines.find((l) => l.id === r.order_line_id);
    if (!line || r.qty < 1 || r.qty > line.qty - line.returned_qty) throw badRequest('RETURN_QTY', 'Số lượng đổi vượt phần hàng còn lại');
    return sum + returnLineValue(line, r.qty);
  }, 0);
  const creditIssued = Math.min(returnedGoods, old.paid_amount);
  const returned = createReturn(orderId, {
    lines: returnLines,
    reason: reason || 'Đổi hàng',
    refund: creditIssued ? { amount: creditIssued, method: 'customer_credit', to_credit: true } : null,
  }, actor);
  const h = computeHeader(resolveLines(old.shop_id, newLines), { shipping_fee: shippingFee });
  const creditUsed = Math.min(creditIssued, h.total_amount);
  const cashDue = h.total_amount - creditUsed;
  const created = createOrder({
    shop_id: old.shop_id,
    channel_id: old.channel_id,
    customer_id: old.customer_id,
    lines: newLines,
    shipping_fee: shippingFee,
    status: 'completed',
    payments: [
      ...(creditUsed ? [{ amount: creditUsed, method: 'customer_credit' }] : []),
      ...(cashDue ? [{ amount: cashDue, method: paymentMethod }] : []),
    ],
  }, actor);
  audit(actor, 'order.exchanged', 'order', old.id, null, { return_order_id: old.id, new_order_id: created.id, credit_issued: creditIssued, credit_used: creditUsed, cash_due: cashDue });
  return { returned, created, credit_issued: creditIssued, credit_used: creditUsed, cash_due: cashDue, remaining_credit: creditIssued - creditUsed };
}

/**
 * Tra cứu bảo hành: các dòng hàng đã bán (đơn hoàn thành) của sản phẩm có số ngày bảo hành, khớp theo mã đơn, SĐT, tên khách hoặc SKU.
 * Hết bảo hành = ngày hoàn thành (giờ VN) + số ngày bảo hành.
 */
export function warrantyLookup({ q, shopIds, limit = 50 }) {
  const where = ["o.status = 'completed'", 'p.warranty_days > 0', 'l.qty > l.returned_qty'];
  const params = [];
  if (shopIds?.length) (where.push(`o.shop_id IN (${shopIds.map(() => '?').join(',')})`), params.push(...shopIds));
  if (q) {
    where.push('(o.code LIKE ? OR o.customer_phone LIKE ? OR o.customer_name LIKE ? OR l.sku LIKE ? OR l.name LIKE ?)');
    params.push(...Array(5).fill(`%${q}%`));
  }
  const today = businessDate(nowIso());
  return db()
    .prepare(
      `SELECT o.id AS order_id, o.code AS order_code, o.customer_name, o.customer_phone, o.completed_at, l.sku, l.name, l.qty - l.returned_qty AS qty, p.warranty_days,
              date(o.completed_at, '+7 hours', '+' || p.warranty_days || ' days') AS warranty_until
       FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
       WHERE ${where.join(' AND ')} ORDER BY o.completed_at DESC LIMIT ?`,
    )
    .all(...params, limit)
    .map((r) => ({ ...r, in_warranty: r.warranty_until >= today, days_left: Math.round((new Date(`${r.warranty_until}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) }));
}
