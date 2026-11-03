import { Hono } from 'hono';
import { z } from 'zod';
import { body, money, optionalText, query } from '../../lib/http.js';
import { tx } from '../../db/index.js';
import * as svc from './service.js';

const r = new Hono();
const ELEMENTS = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];

// Danh mục
r.get('/categories', (c) => c.json({ data: svc.listCategories() }));
r.post('/categories', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1), parent_id: z.string().nullish(), sort_order: z.number().int().optional() }));
  return c.json({ data: svc.createCategory(input, c.get('actor')) }, 201);
});
r.patch('/categories/:id', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).optional(), parent_id: z.string().nullish(), sort_order: z.number().int().optional(), archived: z.boolean().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: svc.updateCategory(c.req.param('id'), input, c.get('actor')) });
});

// Sản phẩm
const variantInput = z.object({
  id: z.string().optional(),
  sku: z.string().trim().min(1).max(64),
  name: optionalText,
  barcode: optionalText,
  default_price: money.default(0),
  min_stock: z.coerce.number().int().min(0).default(0),
  weight_gram: z.coerce.number().int().min(0).nullish(),
  kind: z.enum(['single', 'bundle']).optional(),
  components: z.array(z.object({ variant_id: z.string(), qty: z.coerce.number().int().positive() })).optional(),
});

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  category_id: z.string().nullish(),
  unit: z.string().trim().min(1).max(20).default('cái'),
  image_url: optionalText,
  brand: optionalText,
  consumption_days: z.coerce.number().int().positive().nullish(),
  elements: z.array(z.enum(ELEMENTS)).default([]),
  tags: z.array(z.string()).default([]),
  variants: z.array(variantInput).min(1),
  shop_ids: z.array(z.string()).default([]),
});

r.get('/products', (c) => {
  const q = query(
    c,
    z.object({
      shop_id: z.string().optional(),
      q: z.string().optional(),
      category_id: z.string().optional(),
      archived: z.string().optional(),
      unlisted: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().optional(),
    }),
  );
  return c.json(
    svc.listProducts({
      shopId: q.shop_id,
      q: q.q,
      categoryId: q.category_id,
      includeArchived: q.archived === '1',
      includeUnlisted: q.unlisted === '1',
      limit: q.limit,
      cursor: q.cursor,
    }),
  );
});
r.get('/products/:id', (c) => c.json({ data: svc.getProduct(c.req.param('id')) }));
r.post('/products', async (c) => {
  const input = await body(c, productInput);
  return c.json({ data: tx(() => svc.createProduct(input, c.get('actor'))) }, 201);
});
r.patch('/products/:id', async (c) => {
  const input = await body(
    c,
    productInput
      .omit({ variants: true, shop_ids: true })
      .partial()
      .extend({ variants: z.array(variantInput.partial().extend({ archived_at: z.string().nullish() })).optional(), archived: z.boolean().optional() }),
  );
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: tx(() => svc.updateProduct(c.req.param('id'), input, c.get('actor'))) });
});

// Tra cứu biến thể để bán
r.get('/variants', (c) => {
  const q = query(
    c,
    z.object({
      shop_id: z.string().optional(),
      warehouse_id: z.string().optional(),
      q: z.string().optional(),
      all: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(30),
    }),
  );
  return c.json({ data: svc.searchVariants({ shopId: q.shop_id, warehouseId: q.warehouse_id, q: q.q, limit: q.limit, onlyListed: q.all !== '1' }) });
});

// Niêm yết theo shop
r.put('/listings', async (c) => {
  const items = await body(
    c,
    z.array(z.object({ shop_id: z.string(), variant_id: z.string(), price: money, active: z.boolean().default(true) })).min(1),
  );
  return c.json({ data: tx(() => svc.setListings(items, c.get('actor'))) });
});

r.post('/listings/sync', async (c) => {
  const input = await body(
    c,
    z.object({
      from_shop_id: z.string(),
      to_shop_id: z.string(),
      variant_ids: z.array(z.string()).nullish(),
      product_ids: z.array(z.string()).nullish(),
      overwrite_price: z.boolean().default(false),
    }),
  );
  const res = tx(() =>
    svc.syncListings(
      { fromShopId: input.from_shop_id, toShopId: input.to_shop_id, variantIds: input.variant_ids, productIds: input.product_ids, overwritePrice: input.overwrite_price },
      c.get('actor'),
    ),
  );
  return c.json({ data: res });
});

export default r;
