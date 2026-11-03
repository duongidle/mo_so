import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, money, patchOf, query, optionalText } from '../../lib/http.js';
import { PAYMENT_METHODS } from '../payments/service.js';
import * as svc from './service.js';

const r = new Hono();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const accountInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['cash', 'bank', 'ewallet', 'other']).default('cash'),
  methods: z.array(z.enum(PAYMENT_METHODS)).default([]),
  opening_balance: z.coerce.number().int().default(0),
  opening_date: date.nullish(),
  sort_order: z.coerce.number().int().optional(),
});

r.get('/accounts', (c) => {
  const q = query(c, z.object({ as_of: date.optional(), include_archived: z.enum(['0', '1']).optional() }));
  return c.json(svc.listAccounts({ asOf: q.as_of, includeArchived: q.include_archived === '1' }));
});
r.post('/accounts', async (c) => {
  const input = await body(c, accountInput);
  return c.json({ data: tx(() => svc.createAccount(input, c.get('actor'))) }, 201);
});
r.patch('/accounts/:id', async (c) => {
  const input = await body(c, patchOf(accountInput).extend({ archived: z.boolean().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: tx(() => svc.updateAccount(c.req.param('id'), input, c.get('actor'))) });
});
r.get('/accounts/:id/ledger', (c) => {
  const q = query(c, z.object({ from: date.optional(), to: date.optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }));
  return c.json({ data: svc.ledger(c.req.param('id'), q) });
});
r.post('/accounts/:id/count', async (c) => {
  const input = await body(c, z.object({ counted_amount: z.coerce.number().int(), note: optionalText }));
  return c.json({ data: tx(() => svc.countAccount(c.req.param('id'), { countedAmount: input.counted_amount, note: input.note }, c.get('actor'))) });
});
r.post('/transfers', async (c) => {
  const input = await body(c, z.object({ from_account_id: z.string(), to_account_id: z.string(), amount: money.refine((v) => v > 0, 'Số tiền phải > 0'), date: date.optional(), note: optionalText }));
  return c.json({ data: tx(() => svc.transfer({ fromId: input.from_account_id, toId: input.to_account_id, amount: input.amount, date: input.date, note: input.note }, c.get('actor'))) }, 201);
});
r.delete('/entries/:id', (c) => c.json({ data: tx(() => svc.voidEntry(c.req.param('id'), c.get('actor'))) }));


export default r;
