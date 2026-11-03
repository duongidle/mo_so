import { Hono } from 'hono';
import { z } from 'zod';
import { body, optionalText } from '../../lib/http.js';
import { INDUSTRY_IDS } from '../../lib/industries.js';
import { createShop, getShop, listShops, updateShop } from './service.js';

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

export default r;
