import { Hono } from 'hono';
import { z } from 'zod';
import { tx, getDb } from '../../db/index.js';
import { body, money, query } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { getCustomer } from '../customers/service.js';
import * as svc from './service.js';

const r = new Hono();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

r.get('/tiers', (c) => c.json({ data: svc.listTiers() }));
r.put('/tiers', async (c) => {
  const input = await body(c, z.array(z.object({ id: z.string().optional(), name: z.string().trim().min(1), min_spent: money, discount_pct: z.coerce.number().int().min(0).max(100) })).min(1));
  return c.json({ data: tx(() => svc.replaceTiers(input)) });
});
r.get('/customers/:id', (c) => c.json({ data: svc.customerLoyalty(c.req.param('id')) }));
r.get('/customers/:id/suggestions', (c) => c.json(svc.elementSuggestions(c.req.param('id'), { shopId: c.req.query('shop_id'), limit: Number(c.req.query('limit')) || 10 })));

r.get('/element-campaign', (c) => {
  const q = query(c, z.object({ shop_id: z.string().min(1), per_customer: z.coerce.number().int().min(1).max(10).default(3), limit: z.coerce.number().int().min(1).max(500).default(100) }));
  return c.json(svc.elementCampaign({ shopId: q.shop_id, perCustomer: q.per_customer, limit: q.limit }));
});

r.get('/today', (c) => {
  const q = query(c, z.object({ shop_id: z.string().optional(), lookahead_days: z.coerce.number().int().min(0).max(30).default(3), birthday_days: z.coerce.number().int().min(0).max(60).default(7) }));
  return c.json({ data: { reminders: svc.dueReminders({ shopId: q.shop_id, lookaheadDays: q.lookahead_days }), birthdays: svc.upcomingBirthdays({ withinDays: q.birthday_days, shopId: q.shop_id }) } });
});
r.post('/reminders/action', async (c) => {
  const i = await body(c, z.object({ customer_id: z.string(), product_id: z.string(), base_date: date, action: z.enum(['done', 'dismiss', 'snooze']), snooze_days: z.coerce.number().int().min(1).max(60).default(3) }));
  return c.json({ data: svc.actOnReminder({ customerId: i.customer_id, productId: i.product_id, baseDate: i.base_date, action: i.action, snoozeDays: i.snooze_days }) });
});

const tplInput = z.object({ name: z.string().trim().min(1), kind: z.enum(['reorder', 'birthday', 'general']).default('general'), body: z.string().trim().min(1).max(1000) });
r.get('/templates', (c) => c.json({ data: svc.listTemplates(c.req.query('kind')) }));
r.post('/templates', async (c) => c.json({ data: svc.saveTemplate(null, await body(c, tplInput)) }, 201));
r.put('/templates/:id', async (c) => c.json({ data: svc.saveTemplate(c.req.param('id'), await body(c, tplInput)) }));
r.delete('/templates/:id', (c) => (svc.deleteTemplate(c.req.param('id')), c.json({ data: { deleted: true } })));
r.post('/render', async (c) => {
  const i = await body(c, z.object({ template_id: z.string(), customer_id: z.string(), product_id: z.string().optional(), shop_id: z.string().optional() }));
  const tpl = getDb().prepare('SELECT * FROM message_templates WHERE id = ?').get(i.template_id);
  if (!tpl) throw notFound('Mẫu tin nhắn');
  const cust = getCustomer(i.customer_id);
  const prod = i.product_id ? getDb().prepare('SELECT name FROM products WHERE id = ?').get(i.product_id) : null;
  const shop = i.shop_id ? getDb().prepare('SELECT name FROM shops WHERE id = ?').get(i.shop_id) : null;
  // Xưng "anh/chị" thay vì lấy nguyên họ tên đầy đủ: lấy tên gọi (từ cuối) cho tự nhiên
  const givenName = cust.name.trim().split(/\s+/).slice(-1)[0];
  const message = svc.renderTemplate(tpl.body, { ten: givenName, san_pham: prod?.name, shop: shop?.name });
  return c.json({ data: { message, unresolved: [...message.matchAll(/\{(ten|san_pham|shop)\}/g)].map((m) => m[1]) } });
});

export default r;
