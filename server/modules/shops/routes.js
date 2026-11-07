import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, optionalText } from '../../lib/http.js';
import { INDUSTRY_IDS } from '../../lib/industries.js';
import { createShop, getShop, listShops, updateShop, shopWarehouses, setShopWarehouses } from './service.js';

const r = new Hono();

const shopInput = z.object({
  code: z.string().trim().min(1).max(6).regex(/^[A-Za-z0-9]+$/, 'Mã shop chỉ gồm chữ và số'),
  name: z.string().trim().min(1).max(100),
  description: optionalText,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  default_warehouse_id: z.string().nullish(),
  phone: optionalText,
  address: optionalText,
  receipt_footer: optionalText,
  industry: z.enum(INDUSTRY_IDS).optional(),
  // Màu giao diện riêng của shop; null = về màu mặc định của chủ đề
  ui_colors: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish() }).nullable().optional(),
});

r.get('/', (c) => c.json({ data: listShops({ includeArchived: c.req.query('archived') === '1' }) }));
r.get('/:id', (c) => c.json({ data: getShop(c.req.param('id')) }));
r.post('/', async (c) => c.json({ data: createShop(await body(c, shopInput), c.get('actor')) }, 201));
r.patch('/:id', async (c) => {
  const input = await body(c, shopInput.partial().extend({ archived: z.boolean().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: updateShop(c.req.param('id'), input, c.get('actor')) });
});

r.get('/:id/warehouses', (c) => {
  getShop(c.req.param('id'));
  return c.json({ data: shopWarehouses(c.req.param('id')) });
});
// Thay cả danh sách kho của shop, theo thứ tự ưu tiên (kho đầu = kho chính)
r.put('/:id/warehouses', async (c) => {
  const input = await body(c, z.object({ warehouse_ids: z.array(z.string()).max(50) }));
  return c.json({ data: tx(() => setShopWarehouses(c.req.param('id'), input.warehouse_ids, c.get('actor'))) });
});

export default r;
