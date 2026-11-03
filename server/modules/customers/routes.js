import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, optionalText, query } from '../../lib/http.js';
import { getDb } from '../../db/index.js';
import { rowsToCsv } from '../system/export.js';
import * as svc from './service.js';
import { exportCustomers, exportFileName } from './export.js';

const r = new Hono();
const ELEMENTS = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];

const customerInput = z.object({
  name: z.string().trim().min(1).max(200),
  phone: optionalText,
  phone2: optionalText,
  email: z.email().nullish().or(z.literal('')).transform((v) => v || null),
  facebook_url: optionalText,
  shopee_username: optionalText,
  address: optionalText,
  note: optionalText,
  shop_id: z.string().nullish(), // thêm thẳng vào danh sách khách của shop này
});

const filterShape = {
  q: z.string().optional(),
  tag: z.string().optional(),
  element: z.enum(ELEMENTS).optional(),
  shop_id: z.string().optional(),
  sort: z.enum(['recent', 'spent', 'last_order', 'name']).default('recent'),
};

/**
 * Xuất danh sách khách theo đúng bộ lọc của danh sách (q, shop_id, tag, element, sort).
 * format=csv (mặc định, tải về) | json (giao diện tự dựng Excel). Phải đặt trước /:id.
 */
r.get('/export', (c) => {
  const q = query(c, z.object({ ...filterShape, format: z.enum(['csv', 'json']).default('csv') }));
  const out = exportCustomers({ q: q.q, tag: q.tag, element: q.element, shopId: q.shop_id, sort: q.sort });
  if (q.format === 'json') return c.json({ data: out });
  const shop = q.shop_id ? getDb().prepare('SELECT code FROM shops WHERE id = ?').get(q.shop_id) : null;
  return new Response(rowsToCsv(out.headers, out.rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${exportFileName(shop?.code)}"` },
  });
});

r.get('/', (c) => {
  const q = query(
    c,
    z.object({
      ...filterShape,
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().optional(),
    }),
  );
  return c.json(svc.listCustomers({ ...q, shopId: q.shop_id }));
});
r.get('/tags', (c) => {
  const shopId = c.req.query('shop_id');
  if (!shopId) return c.json({ error: { code: 'SHOP_REQUIRED', message: 'Nhãn là của từng shop: cần shop_id' } }, 400);
  return c.json({ data: svc.listShopTagCounts(shopId) });
});
r.get('/lookup', (c) => c.json({ data: svc.findByPhone(c.req.query('phone')) }));
r.get('/duplicates', (c) => c.json({ data: svc.findDuplicateCandidates() }));
r.get('/:id', (c) => c.json({ data: svc.getCustomerDetail(c.req.param('id'), { shopId: c.req.query('shop_id') }) }));
r.post('/', async (c) => {
  const input = await body(c, customerInput);
  return c.json({ data: tx(() => svc.createCustomer(input, c.get('actor'), { shopId: input.shop_id || null })) }, 201);
});
r.patch('/:id', async (c) => {
  const input = await body(c, customerInput.partial().extend({ archived: z.boolean().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: tx(() => svc.updateCustomer(c.req.param('id'), input, c.get('actor'))) });
});
r.put('/:id/tags', async (c) => {
  const input = await body(c, z.object({ shop_id: z.string().min(1), tags: z.array(z.string()).max(50) }));
  return c.json({ data: tx(() => svc.setShopTags(c.req.param('id'), input.shop_id, input.tags, c.get('actor'))) });
});
r.post('/:id/shops', async (c) => {
  const input = await body(c, z.object({ shop_id: z.string().min(1) }));
  return c.json({ data: tx(() => svc.addToShop(c.req.param('id'), input.shop_id, c.get('actor'))) });
});
// Xoá khách khỏi MỘT shop (không đụng shop khác)
r.delete('/:id', (c) => {
  const shopId = c.req.query('shop_id');
  if (!shopId) return c.json({ error: { code: 'SHOP_REQUIRED', message: 'Cần shop_id: xoá khách là xoá khỏi danh sách của một shop' } }, 400);
  return c.json({ data: tx(() => svc.removeFromShop(c.req.param('id'), shopId, c.get('actor'))) });
});
r.post('/:id/merge', async (c) => {
  const { source_id } = await body(c, z.object({ source_id: z.string() }));
  return c.json({ data: tx(() => svc.mergeCustomers(c.req.param('id'), source_id, c.get('actor'))) });
});
r.post('/:id/notes', async (c) => {
  const input = await body(c, z.object({ content: z.string().trim().min(1).max(5000), shop_id: z.string().nullish() }));
  return c.json({ data: svc.addNote(c.req.param('id'), { content: input.content, shopId: input.shop_id }, c.get('actor')) }, 201);
});

export default r;
