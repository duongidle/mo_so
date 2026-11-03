import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, money, query, optionalText, patchOf } from '../../lib/http.js';
import { PAYMENT_METHODS } from '../payments/service.js';
import * as svc from './service.js';

const r = new Hono();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ids = (v) => (v ? v.split(',') : null);

r.get('/expense-categories', (c) => c.json({ data: svc.listCategories() }));
r.post('/expense-categories', async (c) => c.json({ data: svc.createCategory(await body(c, z.object({ name: z.string().trim().min(1).max(60) }))) }, 201));

const expenseInput = z.object({
  category_id: z.string(),
  shop_id: z.string().nullish(),
  channel_id: z.string().nullish(),
  amount: money.refine((v) => v > 0, 'Số tiền phải > 0'),
  expense_date: date.optional(),
  payee: optionalText,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  note: optionalText,
});

r.get('/expenses', (c) => {
  const q = query(c, z.object({ shop_id: z.string().optional(), category_id: z.string().optional(), from: date.optional(), to: date.optional(), include_voided: z.enum(['0', '1']).optional(), include_shared: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().optional() }));
  return c.json(svc.listExpenses({ shopIds: ids(q.shop_id), categoryId: q.category_id, from: q.from, to: q.to, includeVoided: q.include_voided === '1', includeShared: q.include_shared !== '0', limit: q.limit, cursor: q.cursor }));
});
r.get('/expenses/:id', (c) => c.json({ data: svc.getExpense(c.req.param('id')) }));
r.post('/expenses', async (c) => {
  const input = await body(c, expenseInput);
  return c.json({ data: tx(() => svc.createExpense(input, c.get('actor'))) }, 201);
});
r.patch('/expenses/:id', async (c) => {
  const input = await body(c, patchOf(expenseInput));
  return c.json({ data: tx(() => svc.updateExpense(c.req.param('id'), input, c.get('actor'))) });
});
r.delete('/expenses/:id', (c) => c.json({ data: tx(() => svc.voidExpense(c.req.param('id'), c.get('actor'))) }));

r.get('/payments', (c) => {
  const q = query(c, z.object({ direction: z.enum(['in', 'out']).optional(), ref_type: z.string().optional(), method: z.string().optional(), shop_id: z.string().optional(), from: date.optional(), to: date.optional(), limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().optional() }));
  return c.json(svc.listPayments({ direction: q.direction, refType: q.ref_type, method: q.method, from: q.from, to: q.to, shopIds: ids(q.shop_id), limit: q.limit, cursor: q.cursor }));
});

// Đối soát tiền sàn
r.get('/reconciliation/pending', (c) => {
  const q = query(c, z.object({ shop_id: z.string().optional(), channel: z.string().optional(), from: date.optional(), to: date.optional() }));
  return c.json(svc.pendingPayouts({ shopIds: ids(q.shop_id), channel: q.channel, from: q.from, to: q.to }));
});
r.post('/reconciliation/payouts', async (c) => {
  const input = await body(
    c,
    z.object({
      items: z.array(z.object({ order_id: z.string().optional(), external_id: z.string().optional(), amount: money.optional() }).refine((i) => i.order_id || i.external_id, 'Cần order_id hoặc external_id')).min(1).max(500),
      method: z.enum(PAYMENT_METHODS).default('shopee_payout'),
      paid_at: z.string().nullish(),
      note: optionalText,
      shop_id: z.string().optional(),
    }),
  );
  return c.json({ data: tx(() => svc.recordPayouts({ items: input.items, method: input.method, paidAt: input.paid_at, note: input.note, shopId: input.shop_id }, c.get('actor'))) });
});

export default r;
