import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, money, qty, query, optionalText, idempotent, patchOf } from '../../lib/http.js';
import { PAYMENT_METHODS } from '../payments/service.js';
import * as svc from './service.js';

const r = new Hono();

const supplierInput = z.object({ name: z.string().trim().min(1), phone: optionalText, address: optionalText, note: optionalText });
r.get('/suppliers', (c) => c.json({ data: svc.listSuppliers(c.req.query('q')) }));
r.post('/suppliers', async (c) => c.json({ data: svc.createSupplier(await body(c, supplierInput), c.get('actor')) }, 201));
r.patch('/suppliers/:id', async (c) => {
  const input = await body(c, supplierInput.partial().extend({ archived: z.boolean().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: svc.updateSupplier(c.req.param('id'), input, c.get('actor')) });
});

const lineInput = z.object({ variant_id: z.string(), qty, unit_cost: money, lot_no: z.string().trim().max(60).nullish(), expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });
const purchaseInput = z.object({
  supplier_id: z.string().nullish(),
  warehouse_id: z.string(),
  shop_id: z.string().nullish(),
  discount_amount: money.default(0),
  shipping_fee: money.default(0),
  shipping_payee: z.enum(['supplier', 'carrier']).default('supplier'), // ai nhận tiền ship: NCC hay bên vận chuyển
  other_fee: money.default(0),
  note: optionalText,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), // hạn trả nhà cung cấp
  supplier_ref: optionalText,
  ordered_at: z.string().nullish(),
  lines: z.array(lineInput).min(1),
  receive: z.boolean().default(false), // nhận hàng luôn
  paid_amount: money.default(0),
  payment_method: z.enum(PAYMENT_METHODS).default('cash'),
});

r.get('/purchases', (c) => {
  const q = query(
    c,
    z.object({
      status: z.enum(['draft', 'received', 'cancelled']).optional(),
      supplier_id: z.string().optional(),
      shop_id: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().optional(),
    }),
  );
  return c.json(svc.listPurchases({ status: q.status, supplierId: q.supplier_id, shopId: q.shop_id, limit: q.limit, cursor: q.cursor }));
});
r.get('/purchases/:id', (c) => c.json({ data: svc.getPurchase(c.req.param('id')) }));
r.post(
  '/purchases',
  idempotent(async (c) => {
    const input = await body(c, purchaseInput);
    return c.json({ data: tx(() => svc.createPurchase(input, c.get('actor'))) }, 201);
  }),
);
r.patch('/purchases/:id', async (c) => {
  const input = await body(c, patchOf(purchaseInput.omit({ receive: true, paid_amount: true, payment_method: true })));
  return c.json({ data: tx(() => svc.updatePurchase(c.req.param('id'), input, c.get('actor'))) });
});
r.post('/purchases/:id/receive', (c) => c.json({ data: tx(() => svc.receivePurchase(c.req.param('id'), c.get('actor'))) }));
r.post('/purchases/:id/cancel', async (c) => {
  const { reason, refund_method } = await body(c, z.object({ reason: optionalText, refund_method: z.enum(PAYMENT_METHODS).nullish() }));
  return c.json({ data: tx(() => svc.cancelPurchase(c.req.param('id'), reason, c.get('actor'), { refundMethod: refund_method })) });
});
r.post('/purchases/:id/payments', async (c) => {
  const input = await body(c, z.object({ amount: money.refine((v) => v > 0), method: z.enum(PAYMENT_METHODS).default('cash'), paid_at: z.string().nullish(), note: optionalText }));
  return c.json({ data: tx(() => svc.addPurchasePayment(c.req.param('id'), { amount: input.amount, method: input.method, paidAt: input.paid_at, note: input.note }, c.get('actor'))) });
});

r.post('/purchases/:id/carrier-payments', async (c) => {
  const input = await body(c, z.object({ amount: money.refine((v) => v > 0), method: z.enum(PAYMENT_METHODS).default('cash'), paid_at: z.string().nullish(), note: optionalText }));
  return c.json({ data: tx(() => svc.addCarrierPayment(c.req.param('id'), { amount: input.amount, method: input.method, paidAt: input.paid_at, note: input.note }, c.get('actor'))) });
});

export default r;
