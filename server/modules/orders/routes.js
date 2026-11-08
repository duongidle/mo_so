import { RETURN_REASONS, RETURN_REASON_CODES } from '../../lib/returnReasons.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, money, qty, query, optionalText, idempotent, patchOf } from '../../lib/http.js';
import { PAYMENT_METHODS } from '../payments/service.js';
import { conflict, badRequest } from '../../lib/errors.js';
import { renderReceipt } from './receipt.js';
import { renderLabels } from './label.js';
import * as svc from './service.js';
import * as shipping from '../shipping/service.js';
import { exportOrders, exportFileName, countExport } from './export.js';
import { rowsToCsv } from '../system/export.js';

const r = new Hono();

const lineInput = z
  .object({
    variant_id: z.string().optional(),
    sku: z.string().optional(),
    name: z.string().optional(),
    qty,
    unit_price: money.optional(),
    discount_amount: money.default(0),
    is_gift: z.boolean().optional(), // dòng quà tặng kèm (giữ cờ khi sửa đơn nháp)
    // Phân bổ kho tay (tuỳ chọn): [{ variant_id?, warehouse_id, qty }]. Bỏ trống = tự lấy theo thứ tự kho của shop.
    allocations: z.array(z.object({ variant_id: z.string().optional(), warehouse_id: z.string(), qty })).optional(),
  })
  .refine((l) => l.variant_id || l.sku, 'Cần variant_id hoặc sku');

const customerInline = z.object({
  name: optionalText,
  phone: optionalText,
  address: optionalText,
  facebook_url: optionalText,
  shopee_username: optionalText,
});

const orderPaymentMethod = z.enum([...PAYMENT_METHODS, 'customer_credit']);
const paymentInput = z.object({ amount: money, method: orderPaymentMethod.default('cash'), paid_at: z.string().nullish(), note: optionalText });

export const orderInput = z.object({
  shop_id: z.string(),
  channel_id: z.string().default('direct'),
  external_id: optionalText,
  customer_id: z.string().nullish(),
  customer: customerInline.nullish(),
  warehouse_id: z.string().nullish(),
  shipping_address: optionalText,
  lines: z.array(lineInput).min(1, 'Đơn cần ít nhất 1 sản phẩm'),
  discount_amount: money.default(0),
  shipping_fee: money.default(0),
  platform_fee_amount: money.default(0),
  seller_shipping_amount: money.default(0),
  note: optionalText,
  internal_note: optionalText,
  tags: z.array(z.string()).default([]),
  tracking_code: optionalText,
  carrier: optionalText,
  ordered_at: z.string().nullish(),
  status: z.enum(['draft', 'confirmed', 'shipping', 'completed']).default('draft'),
  payments: z.array(paymentInput).default([]),
  allow_negative_stock: z.boolean().default(false),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), // hạn khách thanh toán nốt phần còn nợ
  auto_promotions: z.boolean().default(false), // tự áp khuyến mãi đủ điều kiện (máy chủ tính lại)
  promotion_code: z.string().trim().max(40).nullish(),
});

const filterShape = {
  shop_id: z.string().optional(), // nhiều shop: shop_id=a,b
  status: z.string().optional(), // nhiều: status=confirmed,shipping
  channel: z.string().optional(),
  payment_status: z.enum(['unpaid', 'partial', 'paid', 'refunded']).optional(),
  customer_id: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().optional(),
};
const toFilter = (q) => ({
  shopIds: q.shop_id ? q.shop_id.split(',') : null,
  status: q.status ? q.status.split(',') : null,
  channel: q.channel,
  paymentStatus: q.payment_status,
  customerId: q.customer_id,
  from: q.from,
  to: q.to,
  q: q.q,
});

r.get('/', (c) => {
  const q = query(c, z.object({ ...filterShape, limit: z.coerce.number().int().min(1).max(500).default(50), cursor: z.string().optional() }));
  return c.json(svc.listOrders({ ...toFilter(q), limit: q.limit, cursor: q.cursor }));
});

/** Số đơn theo từng trạng thái (cho tab trạng thái). Phải đặt trước /:id */
r.get('/status-counts', (c) => {
  const q = query(c, z.object(filterShape));
  return c.json({ data: svc.countOrdersByStatus(toFilter(q)) });
});

/**
 * Xuất đơn theo đúng bộ lọc của danh sách. layout=orders (mỗi đơn một dòng) | lines (mỗi sản phẩm một dòng).
 * format=csv (mặc định, tải về) | json (để giao diện tự dựng file Excel) | count (chỉ đếm, để báo trước số dòng).
 * Phải đặt trước /:id.
 */
r.get('/export', (c) => {
  const q = query(c, z.object({ ...filterShape, layout: z.enum(['orders', 'lines']).default('orders'), format: z.enum(['csv', 'json', 'count']).default('csv') }));
  if (q.format === 'count') return c.json({ data: countExport(toFilter(q)) });
  const out = exportOrders(toFilter(q), q.layout);
  if (q.format === 'json') return c.json({ data: out });
  return new Response(rowsToCsv(out.headers, out.rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${exportFileName(q.layout, q.from, q.to)}"` },
  });
});

/** Xem trước phân bổ kho. Phải đặt trước /:id */
r.post('/allocation-preview', async (c) => {
  const input = await body(c, z.object({ shop_id: z.string(), warehouse_id: z.string().nullish(), lines: z.array(lineInput).min(1) }));
  return c.json({ data: svc.previewAllocation(input) });
});

r.get('/labels', (c) => {
  const ids = (c.req.query('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) throw badRequest('IDS_REQUIRED', 'Chọn ít nhất một đơn để in nhãn');
  return c.html(renderLabels(ids.map((id) => svc.getOrder(id))));
});
r.get('/warranty', (c) => {
  const q = query(c, z.object({ q: z.string().trim().max(80).optional(), shop_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }));
  return c.json({ data: svc.warrantyLookup({ q: q.q, shopIds: q.shop_id ? q.shop_id.split(',') : null, limit: q.limit }) });
});
r.get('/return-reasons', (c) => c.json({ data: RETURN_REASONS }));
r.get('/:id', (c) => c.json({ data: svc.getOrder(c.req.param('id')) }));
r.get('/:id/label', (c) => c.html(renderLabels([svc.getOrder(c.req.param('id'))])));
r.get('/:id/receipt', (c) => c.html(renderReceipt(svc.getOrder(c.req.param('id')), c.req.query('size') || 'a5')));

r.post(
  '/',
  idempotent(async (c) => {
    const input = await body(c, orderInput);
    const source = c.get('actor')?.type === 'api_key' ? 'api' : c.req.query('source') === 'pos' ? 'pos' : 'manual';
    return c.json({ data: tx(() => svc.createOrder(input, c.get('actor'), { source })) }, 201);
  }),
);

r.patch('/:id', async (c) => {
  const input = await body(
    c,
    patchOf(orderInput.omit({ shop_id: true, channel_id: true, status: true, payments: true, allow_negative_stock: true, external_id: true })),
  );
  return c.json({ data: tx(() => svc.updateOrder(c.req.param('id'), input, c.get('actor'))) });
});

r.post('/:id/status', async (c) => {
  const input = await body(
    c,
    z.object({ status: z.enum(['confirmed', 'shipping', 'completed', 'cancelled']), note: optionalText, allow_negative_stock: z.boolean().default(false) }),
  );
  // Hàng đang trên đường giao thì không "huỷ" được: hàng chưa về kho nên cộng tồn ngay là sai. Giao không thành xử lý bằng phiếu trả hàng chờ hàng về
  if (input.status === 'cancelled' && svc.getOrder(c.req.param('id')).status === 'shipping') {
    throw conflict('CANCEL_SHIPPING', 'Đơn đang giao không huỷ được. Nếu khách không nhận hoặc giao không thành, dùng “Giao không thành” (Trả hàng, chờ hàng về).');
  }
  return c.json({ data: tx(() => svc.transitionOrder(c.req.param('id'), input.status, { note: input.note, actor: c.get('actor'), allowNegative: input.allow_negative_stock })) });
});

r.post('/:id/payments', async (c) => {
  const input = await body(c, paymentInput.extend({ amount: money.refine((v) => v > 0, 'Số tiền phải > 0'), direction: z.enum(['in', 'out']).default('in') }));
  return c.json({ data: tx(() => svc.addOrderPayment(c.req.param('id'), { amount: input.amount, method: input.method, paidAt: input.paid_at, note: input.note, direction: input.direction }, c.get('actor'))) });
});

r.post('/:id/returns', async (c) => {
  const input = await body(
    c,
    z.object({
      lines: z.array(z.object({ order_line_id: z.string(), qty, restock: z.boolean().default(true), warehouse_id: z.string().optional() })).min(1),
      reason: optionalText,
      reason_code: z.enum(RETURN_REASON_CODES).nullish(),
      refund: z.object({ amount: money, method: orderPaymentMethod.default('cash'), to_credit: z.boolean().default(false) }).nullish(),
      shipping_refund_amount: money.default(0),
      return_fee_amount: money.default(0),
      return_shipping_cost: money.default(0),
      returned_at: z.string().nullish(),
      awaiting_goods: z.boolean().default(false),
      allow_late: z.boolean().default(false),
    }),
  );
  return c.json({ data: tx(() => svc.createReturn(c.req.param('id'), { lines: input.lines, reason: input.reason, refund: input.refund, returnedAt: input.returned_at, shippingRefund: input.shipping_refund_amount, returnFee: input.return_fee_amount, returnShippingCost: input.return_shipping_cost, awaitingGoods: input.awaiting_goods, reasonCode: input.reason_code, allowLate: input.allow_late }, c.get('actor'))) });
});

r.post('/:id/returns/:returnId/receive', async (c) => {
  const input = await body(c, z.object({ damaged_line_ids: z.array(z.string()).default([]) }));
  return c.json({ data: tx(() => svc.receiveReturn(c.req.param('id'), c.req.param('returnId'), { actor: c.get('actor'), damagedLineIds: input.damaged_line_ids })) });
});

r.post('/:id/ship', async (c) => {
  const input = await body(c, z.object({ carrier_id: z.string(), tracking_code: z.string().trim().min(1).max(60), cod_amount: money.nullish() }));
  return c.json({ data: tx(() => shipping.shipOrder(c.req.param('id'), { carrierId: input.carrier_id, trackingCode: input.tracking_code, codAmount: input.cod_amount }, c.get('actor'))) });
});
r.post('/:id/split', async (c) => {
  const input = await body(c, z.object({ lines: z.array(z.object({ order_line_id: z.string(), qty })).min(1).max(100) }));
  return c.json({ data: tx(() => svc.splitOrder(c.req.param('id'), input, c.get('actor'))) }, 201);
});
r.post('/:id/reserve', async (c) => {
  const input = await body(c, z.object({ reserve: z.boolean(), until: z.string().nullish() }));
  return c.json({ data: tx(() => svc.setReservation(c.req.param('id'), { reserve: input.reserve, until: input.until }, c.get('actor'))) });
});
r.post('/:id/seller-shipping-payments', async (c) => {
  const input = await body(c, z.object({ amount: money.refine((v) => v > 0, 'Số tiền phải > 0'), method: z.enum(PAYMENT_METHODS).default('cash'), paid_at: z.string().nullish(), note: optionalText }));
  return c.json({ data: tx(() => svc.addSellerShippingPayment(c.req.param('id'), { amount: input.amount, method: input.method, paidAt: input.paid_at, note: input.note }, c.get('actor'))) });
});

r.post('/:id/exchange', async (c) => {
  const input = await body(c, z.object({
    return_lines: z.array(z.object({ order_line_id: z.string(), qty, restock: z.boolean().default(true) })).min(1),
    new_lines: z.array(lineInput).min(1),
    reason: optionalText,
    shipping_fee: money.default(0),
    payment_method: z.enum(PAYMENT_METHODS).default('cash'),
  }));
  return c.json({ data: tx(() => svc.exchangeOrder(c.req.param('id'), { returnLines: input.return_lines, newLines: input.new_lines, reason: input.reason, shippingFee: input.shipping_fee, paymentMethod: input.payment_method }, c.get('actor'))) }, 201);
});

export default r;
