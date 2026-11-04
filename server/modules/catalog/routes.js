import { Hono } from 'hono';
import { z } from 'zod';
import { body, money, optionalText, query, patchOf } from '../../lib/http.js';
import { tx } from '../../db/index.js';
import * as svc from './service.js';

const r = new Hono();

// Danh mục
r.get('/categories', (c) => c.json({ data: c.req.query('tree') === '1' ? svc.listCategoryTree({ includeArchived: c.req.query('archived') === '1' }) : svc.listCategories() }));
r.post('/categories', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1), parent_id: z.string().nullish(), sort_order: z.number().int().optional() }));
  return c.json({ data: tx(() => svc.createCategory(input, c.get('actor'))) }, 201);
});
r.patch('/categories/:id', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).optional(), parent_id: z.string().nullish(), sort_order: z.number().int().optional(), archived: z.boolean().optional(), move_products_to: z.string().optional() }));
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: tx(() => svc.updateCategory(c.req.param('id'), input, c.get('actor'))) });
});

// Sản phẩm
const optionValues = z.record(z.string(), z.string().trim().min(1)).nullish();
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
  option_values: optionValues,
  image_id: z.string().nullish(),
  active: z.boolean().optional(),
  // Tồn đầu kỳ (chỉ khi tạo biến thể mới): ghi bằng biến động 'opening' trong cùng giao dịch
  opening_qty: z.coerce.number().int().min(0).optional(),
  opening_cost: money.optional(),
  opening_warehouse_id: z.string().optional(),
});

const optionsInput = z.array(z.object({ name: z.string().trim().min(1).max(40), values: z.array(z.string().max(60)).min(1).max(100) })).max(3);
const imagesInput = z.array(z.object({ id: z.string(), variant_id: z.string().optional(), variant_sku: z.string().optional() })).max(20);

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  category_id: z.string().nullish(),
  unit: z.string().trim().min(1).max(20).default('cái'),
  image_url: optionalText,
  brand: optionalText,
  consumption_days: z.coerce.number().int().positive().nullish(),
  options: optionsInput.nullish(),
  // Đổi nhãn thuộc tính/giá trị (giữ id biến thể): [{ from, to, values: { cũ: mới } }]
  option_renames: z.array(z.object({ from: z.string().min(1), to: z.string().trim().min(1).max(40), values: z.record(z.string(), z.string().trim().min(1)).optional() })).max(3).optional(),
  tags: z.array(z.string()).default([]),
  variants: z.array(variantInput).min(1),
  shop_ids: z.array(z.string()).default([]),
  images: imagesInput.optional(),
  opening_warehouse_id: z.string().optional(),
  // Giá trị trường tuỳ chỉnh của sản phẩm (vd ngu_hanh) theo shop `custom_shop_id`
  custom: z.record(z.string(), z.any()).optional(),
  custom_shop_id: z.string().optional(),
});

r.get('/products', (c) => {
  const q = query(
    c,
    z.object({
      shop_id: z.string().optional(),
      q: z.string().optional(),
      category_id: z.string().optional(),
      type: z.enum(['single', 'combo']).optional(),
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
      type: q.type,
      includeArchived: q.archived === '1',
      includeUnlisted: q.unlisted === '1',
      limit: q.limit,
      cursor: q.cursor,
    }),
  );
});
r.get('/products/:id', (c) => c.json({ data: svc.getProduct(c.req.param('id')) }));
// Xem trước bỏ biến thể: cái nào sẽ bị xoá hẳn (chưa có lịch sử), cái nào chỉ lưu trữ. Không ghi gì.
r.post('/products/:id/removal-preview', async (c) => {
  const input = await body(c, z.object({ variant_ids: z.array(z.string()).max(500) }));
  return c.json({ data: svc.previewVariantRemoval(c.req.param('id'), input.variant_ids) });
});
r.post('/products', async (c) => {
  const input = await body(c, productInput);
  return c.json({ data: tx(() => svc.createProduct(input, c.get('actor'))) }, 201);
});
r.patch('/products/:id', async (c) => {
  const input = await body(
    c,
    patchOf(productInput.omit({ variants: true, shop_ids: true })).extend({ variants: z.array(patchOf(variantInput).extend({ archived_at: z.string().nullish(), remove: z.boolean().optional() })).optional(), archived: z.boolean().optional() }),
  );
  if (input.archived !== undefined) input.archived_at = input.archived ? new Date().toISOString() : null;
  delete input.archived;
  return c.json({ data: tx(() => svc.updateProduct(c.req.param('id'), input, c.get('actor'))) });
});

r.put('/products/:id/images', async (c) => {
  const items = await body(c, imagesInput);
  tx(() => svc.setProductImages(c.req.param('id'), items));
  return c.json({ data: svc.getProduct(c.req.param('id')).images });
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
      category_id: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(30),
    }),
  );
  return c.json({ data: svc.searchVariants({ shopId: q.shop_id, warehouseId: q.warehouse_id, q: q.q, categoryId: q.category_id, limit: q.limit, onlyListed: q.all !== '1' }) });
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
