import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, toIso } from '../../lib/time.js';
import { allocate } from '../../lib/money.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { dailyCode } from '../../lib/codes.js';
import { applyMovement } from '../inventory/service.js';
import { recordPayment, netPaid, listPaymentsFor } from '../payments/service.js';
import { planAllocation, shopWarehouseIds } from './allocation.js';
import { findOrCreateCustomer, recalcCustomerStats, getCustomer, ensureMember } from '../customers/service.js';
import { getShop } from '../shops/service.js';

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
// Đường đi tự động khi nhảy cóc trạng thái (vd draft → completed)
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
    .map((r) => ({ ...r, lines: JSON.parse(r.lines), amount_due_to_customer: returnDueToCustomer(r, isMarketplace(o.channel_id)) }));
  // Giá trị đã trả của từng dòng (từ các phiếu trả) để giao diện và máy chủ cùng tính phần còn lại theo luỹ kế
  for (const l of o.lines) l.returned_value = o.returns.reduce((a, r) => a + r.lines.filter((x) => x.order_line_id === l.id).reduce((b, x) => b + x.value, 0), 0);
  o.is_marketplace = isMarketplace(o.channel_id);
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
function resolveLines(shopId, lines) {
  return lines.map((l, i) => {
    let v;
    if (l.variant_id) v = db().prepare('SELECT v.*, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(l.variant_id);
    else if (l.sku) v = db().prepare('SELECT v.*, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?').get(String(l.sku).trim().toUpperCase());
    if (!v) throw badRequest('VARIANT_NOT_FOUND', `Không tìm thấy sản phẩm ${l.sku || l.variant_id}`, { line: i, sku: l.sku, variant_id: l.variant_id });
    let price = l.unit_price;
    if (price == null) {
      const listing = db().prepare('SELECT price FROM shop_listings WHERE shop_id = ? AND variant_id = ?').get(shopId, v.id);
      price = listing?.price ?? v.default_price;
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
/**
 * Xuất kho khi xác nhận đơn. Mỗi dòng có thể lấy từ nhiều kho (planAllocation). Mỗi phần ghi một biến động kho riêng,
 * giá vốn của phần đó là giá bình quân của CHÍNH kho đó lúc xuất, chụp vào allocation và không tính lại.
 * Giá vốn dòng (cogs_amount) = Σ SL × giá vốn từng phần: cộng số nguyên nên đúng từng đồng; unit_cost chỉ để hiển thị.
 */
function deductStock(o, actor, allowNegative) {
  let warning = false;
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
      const res = applyMovement({ warehouseId: it.warehouse_id, variantId: it.variant_id, type: 'sale_out', qty: it.qty, refType: 'order', refId: o.id, refLineId: l.id, shopId: o.shop_id, actorId: actor?.id, allowNegative, at });
      if (res.negative || it.short_qty > 0) warning = true;
      insAlloc.run(newId('ola'), l.id, it.variant_id, it.warehouse_id, it.qty, res.unitCost, nowIso());
      done.push({ variant_id: it.variant_id, qty: it.qty, cost: it.qty * res.unitCost });
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
    applyMovement({ warehouseId: warehouseId ?? a.warehouse_id, variantId: a.variant_id, type, qty: take, unitCost: a.unit_cost, refType: 'order', refId: o.id, refLineId: l.id, shopId: o.shop_id, note, actorId: actor?.id, at });
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
  if (to === 'cancelled' && STOCK_OUT_STATUSES.has(o.status)) {
    const hasReturns = db().prepare('SELECT 1 FROM order_returns WHERE order_id = ? LIMIT 1').get(o.id);
    if (hasReturns) throw conflict('HAS_RETURNS', 'Đơn đã có phiếu trả hàng, không thể huỷ. Hãy tạo thêm phiếu trả cho phần còn lại.');
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
  const lines = resolveLines(shop.id, input.lines);
  const h = computeHeader(lines, input);
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
    `INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, discount_amount, line_total, allocated_order_discount, sort_order, planned_allocations)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  h.lines.forEach((l, i) => ins.run(newId('orl'), id, l.variant_id, l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.allocated_order_discount, i, l.allocations ? JSON.stringify(l.allocations) : null));
  logStatus(id, null, 'draft', null, actor);
  emit('order.created', { entityType: 'order', entityId: id, shopId: shop.id, data: { id, shop_id: shop.id, channel_id: channel.id, external_id: input.external_id ?? null } });

  const target = input.status || 'draft';
  if (target !== 'draft') transitionOrder(id, target, { actor, allowNegative: input.allow_negative_stock ?? false, note: input.status_note });
  for (const p of input.payments ?? []) {
    if (p.amount > 0) recordPayment({ direction: 'in', refType: 'order', refId: id, shopId: shop.id, amount: p.amount, method: p.method, paidAt: p.paid_at, note: p.note }, actor);
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
  const isDraft = before.status === 'draft';
  if (!isDraft && (input.lines || input.discount_amount !== undefined || input.warehouse_id)) {
    throw conflict('NOT_DRAFT', 'Chỉ sửa được sản phẩm, giảm giá, kho khi đơn còn nháp. Hãy huỷ đơn và tạo lại, hoặc tạo phiếu trả hàng.');
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
    lines = resolveLines(before.shop_id, input.lines);
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
      `INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, discount_amount, line_total, allocated_order_discount, sort_order, planned_allocations)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    h.lines.forEach((l, i) => ins.run(newId('orl'), before.id, l.variant_id, l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.allocated_order_discount, i, l.allocations ? JSON.stringify(l.allocations) : null));
  } else {
    const upd = db().prepare('UPDATE order_lines SET allocated_order_discount = ? WHERE id = ?');
    h.lines.forEach((l) => upd.run(l.allocated_order_discount, l.id));
  }
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
export function createReturn(orderId, { lines, reason, refund, returnedAt, shippingRefund = 0, returnFee = 0, returnShippingCost = 0 }, actor) {
  const o = getOrder(orderId);
  if (!['completed', 'shipping', 'confirmed'].includes(o.status)) throw conflict('INVALID_STATUS', 'Chỉ trả hàng cho đơn đã xác nhận/giao/hoàn thành');
  const refundAmount = refund?.amount ?? 0;
  if (o.is_marketplace && (shippingRefund > 0 || returnFee > 0 || refundAmount > 0)) {
    throw badRequest('MARKETPLACE_RETURN', 'Đơn sàn: sàn tự hoàn tiền cho người mua nên không có hoàn ship, phí trả hàng hay tiền trả khách');
  }
  const shipLeft = o.shipping_fee - o.returned_shipping_amount;
  if (shippingRefund > shipLeft) throw badRequest('OVER_SHIPPING_REFUND', `Hoàn phí ship tối đa ${shipLeft}`, { max: shipLeft });
  const at = toIso(returnedAt) || nowIso();
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
    if (r.restock) {
      restoredCost = putBackLine(o, l, r.qty, { type: 'sale_return_in', note: reason, actor, at, warehouseId: r.warehouse_id });
    }
    db()
      .prepare('UPDATE order_lines SET returned_qty = returned_qty + ?, restocked_qty = restocked_qty + ? WHERE id = ?')
      .run(r.qty, r.restock ? r.qty : 0, l.id);
    l.returned_qty += r.qty;
    l.returned_value += value;
    result.push({ order_line_id: l.id, variant_id: l.variant_id, sku: l.sku, qty: r.qty, restock: !!r.restock, value, unit_cost: l.unit_cost, restored_cost: restoredCost });
  }
  if (returnFee > goods + shippingRefund) throw badRequest('OVER_RETURN_FEE', `Phí trả hàng tối đa ${goods + shippingRefund} (hàng trả + ship hoàn)`, { max: goods + shippingRefund });
  const dueToCustomer = goods + shippingRefund - returnFee;
  if (refundAmount > dueToCustomer) throw badRequest('OVER_REFUND', `Tiền trả khách tối đa ${dueToCustomer} (cần trả khách của phiếu này)`, { max: dueToCustomer });
  if (refundAmount > o.paid_amount) throw badRequest('OVER_REFUND', 'Số tiền hoàn lớn hơn số đã thu');
  db()
    .prepare(
      `INSERT INTO order_returns (id, code, order_id, shop_id, goods_amount, shipping_refund_amount, return_fee_amount, return_shipping_cost, refund_amount, reason, lines, returned_at, business_date, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, dailyCode('TH', o.shop_code, at), o.id, o.shop_id, goods, shippingRefund, returnFee, returnShippingCost, refundAmount, reason ?? null, JSON.stringify(result), at, businessDate(at), actor?.id ?? null, nowIso());
  if (refundAmount > 0) {
    recordPayment({ direction: 'out', refType: 'order', refId: o.id, shopId: o.shop_id, amount: refundAmount, method: refund.method ?? 'cash', paidAt: at, note: `Hoàn tiền trả hàng` }, actor);
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
