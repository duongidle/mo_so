import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, query, optionalText, money } from '../../lib/http.js';
import * as svc from './service.js';

const r = new Hono();
const carrierInput = z.object({ name: z.string().trim().min(1).max(60), tracking_url: z.string().trim().max(300).nullish(), remit_note: optionalText });
const row = z.object({
  tracking_code: z.string().trim().min(1).max(60),
  outcome: z.enum(['delivered', 'returned']).default('delivered'),
  cod_amount: money.default(0), ship_fee: money.default(0), cod_fee: money.default(0), return_fee: money.default(0), other_fee: money.default(0),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

r.get('/carriers', (c) => c.json({ data: svc.listCarriers({ includeArchived: c.req.query('include_archived') === '1' }) }));
r.post('/carriers', async (c) => {
  const input = await body(c, carrierInput);
  return c.json({ data: tx(() => svc.createCarrier(input)) }, 201);
});
r.patch('/carriers/:id', async (c) => {
  const input = await body(c, carrierInput.partial().extend({ archived: z.boolean().optional() }));
  return c.json({ data: tx(() => svc.updateCarrier(c.req.param('id'), input)) });
});

r.get('/shipments', (c) => {
  const q = query(c, z.object({ bucket: z.enum(['in_transit', 'unreconciled', 'returned', 'done']).optional(), carrier_id: z.string().optional(), q: z.string().trim().max(80).optional(), shop_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }));
  return c.json({ data: svc.listShipments({ bucket: q.bucket, carrierId: q.carrier_id, q: q.q, shopIds: q.shop_id ? q.shop_id.split(',') : null, limit: q.limit }) });
});
r.get('/shipments/summary', (c) => {
  const q = query(c, z.object({ carrier_id: z.string().optional(), shop_id: z.string().optional() }));
  return c.json({ data: svc.shipmentSummary({ carrierId: q.carrier_id, shopIds: q.shop_id ? q.shop_id.split(',') : null }) });
});
r.post('/shipments/:id/status', async (c) => {
  const input = await body(c, z.object({ status: z.enum(['delivered', 'returned', 'lost', 'in_transit']) }));
  return c.json({ data: tx(() => svc.setShipmentStatus(c.req.param('id'), input, c.get('actor'))) });
});

r.post('/carrier-statements/preview', async (c) => {
  const input = await body(c, z.object({ carrier_id: z.string(), rows: z.array(row).min(1).max(2000) }));
  return c.json({ data: svc.previewStatement({ carrierId: input.carrier_id, rows: input.rows }) });
});
r.post('/carrier-statements', async (c) => {
  const input = await body(c, z.object({ carrier_id: z.string(), date: date.optional(), note: optionalText, rows: z.array(row).min(1).max(2000) }));
  return c.json({ data: tx(() => svc.createStatement({ carrierId: input.carrier_id, date: input.date, rows: input.rows, note: input.note }, c.get('actor'))) }, 201);
});
r.get('/carrier-statements', (c) => c.json({ data: svc.listStatements({ carrierId: c.req.query('carrier_id') }) }));
r.get('/carrier-statements/:id/void-preview', (c) => c.json({ data: svc.previewVoidStatement(c.req.param('id')) }));
r.post('/carrier-statements/:id/void', async (c) => {
  const input = await body(c, z.object({ reason: z.string().trim().min(3, 'Cần ghi lý do huỷ phiếu đối soát').max(300) }));
  return c.json({ data: tx(() => svc.voidStatement(c.req.param('id'), input, c.get('actor'))) });
});
r.get('/carrier-statements/:id', (c) => c.json({ data: svc.getStatement(c.req.param('id')) }));

export default r;
