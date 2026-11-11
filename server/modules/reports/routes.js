import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../../lib/http.js';
import * as svc from './service.js';
import { shrinkageReport } from './shrinkage.js';
import { evaluateMetrics } from '../custom/service.js';

const r = new Hono();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterSchema = z.object({ from: date.optional(), to: date.optional(), shop_id: z.string().optional(), channel: z.string().optional(), category_id: z.string().optional() });
const f = (c) => {
  const q = query(c, filterSchema);
  return { from: q.from, to: q.to, shopIds: q.shop_id ? q.shop_id.split(',') : null, channel: q.channel, categoryId: q.category_id };
};

r.get('/dashboard', (c) => c.json({ data: svc.dashboard(f(c)) }));
r.get('/custom-metrics', (c) => {
  const flt = f(c);
  const ov = svc.overview(flt).current;
  // Thêm vài chỉ số đã tính sẵn để công thức dùng được: {expenses_amount}, {net_profit_estimate}...
  return c.json({ data: evaluateMetrics(ov, flt.shopIds), filter: svc.normalizeFilter(flt) });
});
// `meta.scope` (chỉ thêm, không đổi số): cho giao diện biết con số nào có phạm vi khác bộ lọc đang chọn
const shopFiltered = (flt) => Boolean(flt.shopIds?.length);
r.get('/overview', (c) => {
  const flt = f(c);
  const data = svc.overview(flt);
  return c.json({ data, meta: { scope: { shop_filtered: shopFiltered(flt), channel_filtered: Boolean(flt.channel), tax: 'household', tax_hidden: Boolean(data.tax && !data.tax.applicable), expenses: 'shop_plus_shared' } } });
});
r.get('/revenue', (c) => c.json(svc.revenueSeries(f(c))));
r.get('/shops', (c) => c.json(svc.byShop(f(c))));
r.get('/channels', (c) => c.json(svc.byChannel(f(c))));
r.get('/products', (c) => c.json(svc.byProduct(f(c), { limit: Number(c.req.query('limit')) || 50 })));
r.get('/elements', (c) => c.json(svc.byElement(f(c))));
r.get('/customers', (c) => c.json({ data: svc.customerMetrics(f(c)) }));
r.get('/inventory', (c) => {
  const shopId = c.req.query('shop_id');
  const warehouseId = c.req.query('warehouse_id');
  return c.json({ data: svc.inventoryMetrics({ shopId, warehouseId }), meta: { scope: { shop_filtered: Boolean(shopId), warehouse_filtered: Boolean(warehouseId), as_of: 'today' } } });
});
r.get('/cashflow', (c) => {
  const flt = f(c);
  const data = svc.cashflow(flt);
  return c.json({ data, meta: { scope: { shop_filtered: shopFiltered(flt), shared_expenses_included: !shopFiltered(flt), shared_expenses_not_included: data.shared_expenses_not_included, supplier_payable: 'account', receivables: shopFiltered(flt) ? 'shop' : 'account', receivables_as_of: 'today' } } });
});
r.get('/return-reasons', (c) => c.json({ data: svc.returnReasons(f(c)) }));
r.get('/shrinkage', (c) => {
  const flt = f(c);
  return c.json({ data: shrinkageReport(flt), meta: { scope: { shop_filtered: shopFiltered(flt), warehouse: 'shop_warehouses' } } });
});
r.get('/expenses', (c) => c.json({ data: svc.expenseReport(f(c)) }));
r.get('/aging', (c) => {
  const flt = f(c);
  return c.json({ data: svc.aging(flt), meta: { scope: { shop_filtered: shopFiltered(flt), customer: shopFiltered(flt) ? 'shop' : 'account', marketplace: shopFiltered(flt) ? 'shop' : 'account', supplier: 'account', as_of: 'today' } } });
});
r.get('/health', (c) => {
  const flt = f(c);
  return c.json({ ...svc.health(flt), meta: { scope: { shop_filtered: shopFiltered(flt), days_of_inventory: flt.shopIds?.length === 1 ? 'shop' : 'account' } } });
});

export default r;
