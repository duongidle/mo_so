import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, query } from '../../lib/http.js';
import * as svc from './reports.js';
import { verifyJournal } from './journal.js';

const r = new Hono();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ids = (v) => (v ? v.split(',') : null);
const period = z.object({ from: date.optional(), to: date.optional(), shop_id: z.string().optional() });

r.get('/accounts', (c) => {
  const q = query(c, z.object({ as_of: date.optional(), balances: z.enum(['0', '1']).optional() }));
  return c.json({ data: svc.listAccounts({ asOf: q.as_of, withBalances: q.balances !== '0' }) });
});
r.post('/accounts', async (c) => {
  const input = await body(c, z.object({ parent_code: z.string().min(1), name: z.string().trim().min(1).max(100) }));
  return c.json({ data: tx(() => svc.createSubAccount(input, c.get('actor'))) }, 201);
});
r.patch('/accounts/:code', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(100).optional(), archived: z.boolean().optional() }));
  return c.json({ data: tx(() => svc.updateAccount(c.req.param('code'), input, c.get('actor'))) });
});
r.patch('/expense-categories/:id', async (c) => {
  const input = await body(c, z.object({ account_code: z.string().min(1) }));
  return c.json({ data: tx(() => svc.setCategoryAccount(c.req.param('id'), input.account_code, c.get('actor'))) });
});

r.get('/journal', (c) => {
  const q = query(c, period.extend({ account: z.string().optional(), source_type: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() }));
  return c.json(svc.journal({ from: q.from, to: q.to, account: q.account, sourceType: q.source_type, shopIds: ids(q.shop_id), q: q.q, limit: q.limit, cursor: q.cursor }));
});
r.get('/ledger/:code', (c) => {
  const q = query(c, period.extend({ limit: z.coerce.number().int().min(1).max(5000).default(1000) }));
  return c.json({ data: svc.ledger(c.req.param('code'), { from: q.from, to: q.to, shopIds: ids(q.shop_id), limit: q.limit }) });
});
r.get('/trial-balance', (c) => {
  const q = query(c, period);
  return c.json({ data: svc.trialBalance({ from: q.from, to: q.to }), meta: { scope: { account_wide: true } } });
});
r.get('/income-statement', (c) => {
  const q = query(c, period);
  return c.json({ data: svc.incomeStatement({ from: q.from, to: q.to, shopIds: ids(q.shop_id) }) });
});
r.get('/balance-sheet', (c) => {
  const q = query(c, z.object({ as_of: date.optional() }));
  return c.json({ data: svc.balanceSheet({ asOf: q.as_of }) });
});
r.get('/cash-flow', (c) => {
  const q = query(c, period);
  return c.json({ data: svc.cashFlowDirect({ from: q.from, to: q.to, shopIds: ids(q.shop_id) }) });
});
r.get('/overview', (c) => c.json({ data: svc.overview({ asOf: query(c, z.object({ as_of: date.optional() })).as_of }) }));
r.get('/verify', (c) => {
  const problems = verifyJournal();
  return c.json({ data: { ok: problems.length === 0, problems } });
});

export default r;
