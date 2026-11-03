import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../../lib/http.js';
import * as svc from './service.js';

const r = new Hono();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterSchema = z.object({ from: date.optional(), to: date.optional(), shop_id: z.string().optional(), channel: z.string().optional() });
const f = (c) => {
  const q = query(c, filterSchema);
  return { from: q.from, to: q.to, shopIds: q.shop_id ? q.shop_id.split(',') : null, channel: q.channel };
};

r.get('/dashboard', (c) => c.json({ data: svc.dashboard(f(c)) }));
r.get('/overview', (c) => c.json({ data: svc.overview(f(c)) }));
r.get('/revenue', (c) => c.json(svc.revenueSeries(f(c))));
r.get('/shops', (c) => c.json(svc.byShop(f(c))));
r.get('/channels', (c) => c.json(svc.byChannel(f(c))));
r.get('/products', (c) => c.json(svc.byProduct(f(c), { limit: Number(c.req.query('limit')) || 50 })));
r.get('/customers', (c) => c.json({ data: svc.customerMetrics(f(c)) }));
r.get('/inventory', (c) => c.json({ data: svc.inventoryMetrics({ shopId: c.req.query('shop_id'), warehouseId: c.req.query('warehouse_id') }) }));
r.get('/cashflow', (c) => c.json({ data: svc.cashflow(f(c)) }));
r.get('/health', (c) => c.json(svc.health(f(c))));

export default r;
