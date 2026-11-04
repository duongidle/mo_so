import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, query } from '../../lib/http.js';
import * as svc from './reports.js';
import { verifyJournal } from './journal.js';
import * as vouchers from './vouchers.js';
import * as assets from './assets.js';
import { setLock, lockStatus, lockWarnings } from './lock.js';
import { money, optionalText, patchOf } from '../../lib/http.js';

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
r.get('/overview', (c) => {
  const data = svc.overview({ asOf: query(c, z.object({ as_of: date.optional() })).as_of });
  data.warnings.push(...lockWarnings());
  data.lock_date = lockStatus().lock_date;
  return c.json({ data });
});
r.get('/verify', (c) => {
  const problems = verifyJournal();
  return c.json({ data: { ok: problems.length === 0, problems } });
});

// ---------- Chứng từ tay ----------
const voucherBase = z.object({
  voucher_date: date,
  description: z.string().trim().min(1).max(200),
  shop_id: z.string().nullish(),
  partner_type: z.enum(['customer', 'supplier']).nullish(),
  partner_id: z.string().nullish(),
  memo: optionalText,
});
const voucherInput = z.discriminatedUnion('type', [
  voucherBase.extend({ type: z.enum(['receipt', 'payment']), cash_account_id: z.string(), account_code: z.string().min(1), amount: money.refine((v) => v > 0, 'Số tiền phải > 0') }),
  voucherBase.extend({ type: z.literal('journal'), lines: z.array(z.object({ account_code: z.string().min(1), debit: money.default(0), credit: money.default(0), memo: optionalText })).min(2).max(60) }),
]);
r.get('/vouchers', (c) => {
  const q = query(c, period.extend({ type: z.enum(['receipt', 'payment', 'journal']).optional(), q: z.string().optional(), include_voided: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().optional() }));
  return c.json(vouchers.listVouchers({ type: q.type, from: q.from, to: q.to, shopIds: ids(q.shop_id), q: q.q, includeVoided: q.include_voided === '1', limit: q.limit, cursor: q.cursor }));
});
r.get('/vouchers/:id', (c) => c.json({ data: vouchers.getVoucher(c.req.param('id')) }));
r.post('/vouchers', async (c) => {
  const input = await body(c, voucherInput);
  return c.json({ data: tx(() => vouchers.createVoucher(input, c.get('actor'))) }, 201);
});
r.patch('/vouchers/:id', async (c) => {
  const input = await body(c, voucherBase.partial().extend({ account_code: z.string().optional(), cash_account_id: z.string().optional(), amount: money.optional(), lines: z.array(z.object({ account_code: z.string(), debit: money.default(0), credit: money.default(0), memo: optionalText })).optional() }));
  return c.json({ data: tx(() => vouchers.updateVoucher(c.req.param('id'), input, c.get('actor'))) });
});
r.delete('/vouchers/:id', (c) => c.json({ data: tx(() => vouchers.voidVoucher(c.req.param('id'), c.get('actor'))) }));

// ---------- Tài sản & chi phí trả trước ----------
const assetInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['fixed_asset', 'prepaid']),
  cost: money.refine((v) => v > 0, 'Nguyên giá phải > 0'),
  start_date: date,
  months: z.coerce.number().int().min(1).max(600),
  expense_account_code: z.string().default('6428'),
  shop_id: z.string().nullish(),
  paid_via: z.string().default('cash'), // phương thức thanh toán hoặc 'unpaid' (ghi phải trả người bán 331)
  note: optionalText,
});
r.get('/assets', (c) => c.json({ data: assets.listAssets({ includeVoided: query(c, z.object({ include_voided: z.enum(['0', '1']).optional() })).include_voided === '1' }) }));
r.post('/assets', async (c) => {
  const input = await body(c, assetInput);
  return c.json({ data: tx(() => assets.createAsset(input, c.get('actor'))) }, 201);
});
r.get('/assets/:id', (c) => c.json({ data: assets.scheduleOf(c.req.param('id')) }));
r.patch('/assets/:id', async (c) => {
  const input = await body(c, patchOf(assetInput));
  return c.json({ data: tx(() => assets.updateAsset(c.req.param('id'), input, c.get('actor'))) });
});
r.post('/assets/:id/dispose', async (c) => {
  const input = await body(c, z.object({ date: date.optional() }));
  return c.json({ data: tx(() => assets.disposeAsset(c.req.param('id'), input, c.get('actor'))) });
});
r.delete('/assets/:id', (c) => c.json({ data: tx(() => assets.voidAsset(c.req.param('id'), c.get('actor'))) }));

// ---------- Khoá sổ ----------
r.get('/lock', (c) => c.json({ data: lockStatus() }));
r.post('/lock', async (c) => {
  const input = await body(c, z.object({ date: date.nullable() }));
  return c.json({ data: tx(() => setLock(input.date, c.get('actor'))) });
});

export default r;
