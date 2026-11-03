import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, optionalText, query } from '../../lib/http.js';
import * as svc from './service.js';

const r = new Hono();
const ELEMENTS = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];

const customerInput = z.object({
  name: z.string().trim().min(1).max(200),
  phone: optionalText,
  phone2: optionalText,
  email: z.email().nullish().or(z.literal('')).transform((v) => v || null),
  facebook_url: optionalText,
  shopee_username: optionalText,
  gender: z.enum(['male', 'female', 'other']).nullish(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  birth_year: z.coerce.number().int().min(1900).max(2100).nullish(),
  element_override: z.enum(ELEMENTS).nullish(),
  address: optionalText,
  note: optionalText,
  tags: z.array(z.string().trim().min(1)).optional(),
});

r.get('/', (c) => {
  const q = query(
    c,
    z.object({
      q: z.string().optional(),
      tag: z.string().optional(),
      element: z.enum(ELEMENTS).optional(),
      sort: z.enum(['recent', 'spent', 'last_order', 'name']).default('recent'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().optional(),
    }),
  );
  return c.json(svc.listCustomers(q));
});
r.get('/lookup', (c) => c.json({ data: svc.findByPhone(c.req.query('phone')) }));
r.get('/duplicates', (c) => c.json({ data: svc.findDuplicateCandidates() }));
r.get('/:id', (c) => c.json({ data: svc.getCustomerDetail(c.req.param('id')) }));
r.post('/', async (c) => {
  const input = await body(c, customerInput);
  return c.json({ data: tx(() => svc.createCustomer(input, c.get('actor'))) }, 201);
});
r.patch('/:id', async (c) => {
  const input = await body(c, customerInput.partial().extend({ archived: z.boolean().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: tx(() => svc.updateCustomer(c.req.param('id'), input, c.get('actor'))) });
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
