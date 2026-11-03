import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, toIso } from '../../lib/time.js';
import { allocate } from '../../lib/money.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { dailyCode } from '../../lib/codes.js';
import { applyMovement } from '../inventory/service.js';
import { recordPayment, netPaid, listPaymentsFor } from '../payments/service.js';
import { isBundle, componentsOf } from '../catalog/bundles.js';
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
  o.lines = db().prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY sort_order').all(o.id);
  o.history = db().prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at').all(o.id);
  o.payments = listPaymentsFor('order', o.id);
  o.returns = db()
    .prepare('SELECT * FROM order_returns WHERE order_id = ? ORDER BY created_at')
    .all(o.id)
    .map((r) => ({ ...r, lines: JSON.parse(r.lines) }));
  o.amount_due = Math.max(0, dueAmount(o) - o.paid_amount);
  o.needs_refund = o.paid_amount > dueAmount(o);
  o.gross_profit = o.status === 'cancelled' || o.status === 'draft' ? 0 : o.net_amount - o.returned_amount - o.cogs_amount;
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
  const returned = db().prepare('SELECT COALESCE(SUM(goods_amount),0) AS v FROM order_returns WHERE order_id = ?').get(orderId).v;
  const active = STOCK_OUT_STATUSES.has(o.status);
  const cogs = active ? lines.reduce((a, l) => a + (l.qty - l.restocked_qty) * l.unit_cost, 0) : 0;
  const netRevenue = active ? o.goods_revenue - returned : 0;
  const paid = netPaid('order', orderId);
  const due = dueAmount({ ...o, returned_amount: returned });
  let paymentStatus = 'unpaid';
  if (paid > 0 && paid >= due) paymentStatus = 'paid';
  else if (paid > 0) paymentStatus = 'partial';
  const hadPayments = db().prepare("SELECT 1 FROM payments WHERE ref_type='order' AND ref_id=? AND voided_at IS NULL LIMIT 1").get(orderId);
  if ((o.status === 'cancelled' || o.status === 'returned') && hadPayments && paid <= 0) paymentStatus = 'refunded';
  if (o.status !== 'cancelled' && due === 0 && paid === 0 && o.status !== 'draft' && hadPayments) paymentStatus = 'refunded';
  db()
    .prepare('UPDATE orders SET returned_amount=?, net_revenue=?, cogs_amount=?, paid_amount=?, payment_status=?, updated_at=? WHERE id=?')
    .run(returned, netRevenue, cogs, paid, paymentStatus, nowIso(), orderId);
}

// ---------- Tồn kho theo trạng thái ----------
function deductStock(o, actor, allowNegative) {
  let warning = false;
  // Đơn import từ sàn đã xảy ra ở quá khứ: ghi biến động kho theo ngày đặt, không phải lúc bấm import
  const at = o.source === 'import' ? o.ordered_at : undefined;
  const lines = db().prepare('SELECT * FROM order_lines WHERE order_id = ?').all(o.id);
  for (const l of lines) {
    const move = (variantId, qty) =>
      applyMovement({ warehouseId: o.warehouse_id, variantId, type: 'sale_out', qty, refType: 'order', refId: o.id, refLineId: l.id, shopId: o.shop_id, actorId: actor?.id, allowNegative, at });
    if (isBundle(l.variant_id)) {
      // Combo: trừ từng thành phần, chụp thành phần + giá vốn từng cái để hoàn kho/trả hàng sau này đúng
      const comps = componentsOf(l.variant_id);
      if (!comps.length) throw conflict('BUNDLE_EMPTY', `Combo ${l.sku} chưa có thành phần nào`);
      let cost = 0;
      for (const c of comps) {
        const res = move(c.component_variant_id, c.qty * l.qty);
        if (res.negative) warning = true;
        db().prepare('INSERT INTO order_line_components (id, order_line_id, variant_id, per_bundle_qty, unit_cost) VALUES (?,?,?,?,?)').run(newId('olc'), l.id, c.component_variant_id, c.qty, res.unitCost);
        cost += c.qty * res.unitCost;
      }
      db().prepare('UPDATE order_lines SET unit_cost = ? WHERE id = ?').run(cost, l.id);
      continue;
    }
    const res = move(l.variant_id, l.qty);
    if (res.negative) warning = true;
    db().prepare('UPDATE order_lines SET unit_cost = ? WHERE id = ?').run(res.unitCost, l.id);
  }
  if (warning) db().prepare('UPDATE orders SET stock_warning = 1 WHERE id = ?').run(o.id);
}

/** Nhập lại kho `qty` đơn vị của một dòng (combo: nhập lại từng thành phần theo ảnh chụp lúc bán) */
function putBackLine(o, l, qty, { type, note, actor, at }) {
  const base = { warehouseId: o.warehouse_id, type, refType: 'order', refId: o.id, refLineId: l.id, shopId: o.shop_id, note, actorId: actor?.id, at };
  const comps = db().prepare('SELECT * FROM order_line_components WHERE order_line_id = ?').all(l.id);
  if (comps.length) {
    for (const c of comps) applyMovement({ ...base, variantId: c.variant_id, qty: c.per_bundle_qty * qty, unitCost: c.unit_cost });
  } else {
    applyMovement({ ...base, variantId: l.variant_id, qty, unitCost: l.unit_cost });
  }
}

function restoreStock(o, actor, note) {
  const lines = db().prepare('SELECT * FROM order_lines WHERE order_id = ?').all(o.id);
  for (const l of lines) {
    const qty = l.qty - l.restocked_qty;
    if (qty <= 0) continue;
    putBackLine(o, l, qty, { type: 'sale_cancel_in', note, actor });
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

export function createOrder(input, actor, { source = 'manual' } = {}) {
  const shop = getShop(input.shop_id);
  const channel = db().prepare('SELECT id FROM channels WHERE id = ?').get(input.channel_id || 'direct');
  if (!channel) throw badRequest('INVALID_CHANNEL', `Kênh ${input.channel_id} không tồn tại`);
  const warehouseId = input.warehouse_id || shop.default_warehouse_id;
  if (!warehouseId) throw badRequest('NO_WAREHOUSE', `Shop ${shop.name} chưa có kho mặc định`);
  if (input.external_id) {
    const dup = db().prepare('SELECT id, code FROM orders WHERE shop_id = ? AND channel_id = ? AND external_id = ?').get(shop.id, channel.id, input.external_id);
    if (dup) throw conflict('DUPLICATE_ORDER', `Đơn ${input.external_id} đã tồn tại (${dup.code})`, { order_id: dup.id });
  }
  const customer = resolveCustomer(input, actor);
  if (customer) ensureMember(customer.id, shop.id); // mua ở shop nào thì là khách của shop đó
  const lines = resolveLines(shop.id, input.lines);
  const h = computeHeader(lines, input);
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
    `INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, discount_amount, line_total, allocated_order_discount, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  h.lines.forEach((l, i) => ins.run(newId('orl'), id, l.variant_id, l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.allocated_order_discount, i));
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
  let lines = before.lines;
  if (isDraft && input.lines) {
    lines = resolveLines(before.shop_id, input.lines);
  }
  const h = computeHeader(lines.map((l) => ({ ...l, line_total: l.line_total ?? l.qty * l.unit_price - l.discount_amount })), merged);
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
      `INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, discount_amount, line_total, allocated_order_discount, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    h.lines.forEach((l, i) => ins.run(newId('orl'), before.id, l.variant_id, l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.allocated_order_discount, i));
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
  const p = recordPayment({ direction, refType: 'order', refId: o.id, shopId: o.shop_id, amount, method, paidAt, note }, actor);
  refreshDerived(o.id);
  const after = getOrder(o.id);
  emit('order.payment_recorded', { entityType: 'order', entityId: o.id, shopId: o.shop_id, data: { payment: p, paid_amount: after.paid_amount, payment_status: after.payment_status } });
  return after;
}

// ---------- Trả hàng ----------
/**
 * lines: [{ order_line_id, qty, restock }] — restock=false nghĩa là hàng hỏng, không nhập lại kho
 * refund: { amount, method } — tiền hoàn thực tế (có thể khác giá trị hàng)
 */
export function createReturn(orderId, { lines, reason, refund, returnedAt }, actor) {
  const o = getOrder(orderId);
  if (!['completed', 'shipping', 'confirmed'].includes(o.status)) throw conflict('INVALID_STATUS', 'Chỉ trả hàng cho đơn đã xác nhận/giao/hoàn thành');
  const at = toIso(returnedAt) || nowIso();
  const id = newId('ret');
  const result = [];
  let goods = 0;
  for (const r of lines) {
    const l = o.lines.find((x) => x.id === r.order_line_id);
    if (!l) throw badRequest('LINE_NOT_FOUND', 'Dòng đơn không tồn tại', r);
    if (r.qty > l.qty - l.returned_qty) throw badRequest('RETURN_QTY', `Dòng ${l.sku}: chỉ còn trả được ${l.qty - l.returned_qty}`);
    // Giá trị hàng trả = phần doanh thu thực của dòng (sau giảm giá dòng + phân bổ giảm giá đơn) theo tỷ lệ SL
    const value = Math.round(((l.line_total - l.allocated_order_discount) * r.qty) / l.qty);
    goods += value;
    if (r.restock) {
      putBackLine(o, l, r.qty, { type: 'sale_return_in', note: reason, actor, at });
    }
    db()
      .prepare('UPDATE order_lines SET returned_qty = returned_qty + ?, restocked_qty = restocked_qty + ? WHERE id = ?')
      .run(r.qty, r.restock ? r.qty : 0, l.id);
    result.push({ order_line_id: l.id, variant_id: l.variant_id, sku: l.sku, qty: r.qty, restock: !!r.restock, value, unit_cost: l.unit_cost });
  }
  const refundAmount = refund?.amount ?? 0;
  db()
    .prepare(
      `INSERT INTO order_returns (id, code, order_id, shop_id, goods_amount, refund_amount, reason, lines, returned_at, business_date, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, dailyCode('TH', o.shop_code, at), o.id, o.shop_id, goods, refundAmount, reason ?? null, JSON.stringify(result), at, businessDate(at), actor?.id ?? null, nowIso());
  if (refundAmount > 0) {
    if (refundAmount > o.paid_amount) throw badRequest('OVER_REFUND', 'Số tiền hoàn lớn hơn số đã thu');
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
  audit(actor, 'order.returned', 'order', o.id, null, { return_id: id, lines: result, goods, refundAmount });
  emit('order.returned', { entityType: 'order', entityId: o.id, shopId: o.shop_id, data: { return_id: id, goods_amount: goods, refund_amount: refundAmount, order: after } });
  return after;
}
