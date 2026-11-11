import { Hono } from 'hono';
import { z } from 'zod';
import { body, money, optionalText, query, patchOf, stockQty } from '../../lib/http.js';
import { tx } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import * as svc from './service.js';
import * as bulk from './bulk.js';
import { productRemovalImpact, removeProduct, restoreProduct } from './removal.js';

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
  opening_qty: stockQty.optional(),
  opening_cost: money.optional(),
  opening_warehouse_id: z.string().optional(),
});

const optionsInput = z.array(z.object({ name: z.string().trim().min(1).max(40), values: z.array(z.string().max(60)).min(1).max(100) })).max(3);
const imagesInput = z.array(z.object({ id: z.string(), variant_id: z.string().optional(), variant_sku: z.string().optional() })).max(20);

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  item_type: z.enum(['product', 'service', 'packaging', 'supply']).default('product'),
  default_supplier_id: z.string().nullish(),
  description: optionalText,
  category_id: z.string().nullish(),
  unit: z.string().trim().min(1).max(20).default('cái'),
  image_url: optionalText,
  brand: optionalText,
  consumption_days: z.coerce.number().int().positive().nullish(),
  warranty_days: z.coerce.number().int().positive().max(3650).nullish(), // bảo hành tính từ ngày hoàn thành đơn
  options: optionsInput.nullish(),
  // Đổi nhãn thuộc tính/giá trị (giữ id biến thể): [{ from, to, values: { cũ: mới } }]
  option_renames: z.array(z.object({ from: z.string().min(1), to: z.string().trim().min(1).max(40), values: z.record(z.string(), z.string().trim().min(1)).optional() })).max(3).optional(),
  tags: z.array(z.string()).default([]),
  variants: z.array(variantInput).min(1),
  shop_ids: z.array(z.string()).default([]),
  images: imagesInput.optional(),
  opening_warehouse_id: z.string().optional(),
  // Giá trị trường tuỳ chỉnh của sản phẩm (ví dụ ngu_hanh) theo shop `custom_shop_id`
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
      item_type: z.enum(['product', 'service', 'packaging', 'supply']).optional(),
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
      itemType: q.item_type,
      includeArchived: q.archived === '1' || q.archived === 'only',
      archivedOnly: q.archived === 'only',
      includeUnlisted: q.unlisted === '1' || q.unlisted === 'only',
      unlistedOnly: q.unlisted === 'only',
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
// Gỡ sản phẩm: xem trước hậu quả, gỡ (xoá hẳn nếu chưa từng dùng, ngược lại ngừng kinh doanh), khôi phục
r.get('/products/:id/removal-impact', (c) => c.json({ data: productRemovalImpact(c.req.param('id')) }));
r.post('/products/:id/remove', async (c) => {
  const input = await body(c, z.object({ confirm: z.boolean().default(false), write_off: z.boolean().default(false) }));
  return c.json({ data: tx(() => removeProduct(c.req.param('id'), { confirm: input.confirm, writeOff: input.write_off }, c.get('actor'))) });
});
r.post('/products/:id/restore', (c) => c.json({ data: tx(() => restoreProduct(c.req.param('id'), c.get('actor'))) }));
const importRow = z.object({
  name: z.string().max(200).nullish(), sku: z.string().max(64).nullish(), variant_name: z.string().max(200).nullish(),
  price: z.union([z.number(), z.string()]).nullish(), cost: z.union([z.number(), z.string()]).nullish(), qty: z.union([z.number(), z.string()]).nullish(),
  warehouse: z.string().max(100).nullish(), category: z.string().max(100).nullish(), brand: z.string().max(100).nullish(), unit: z.string().max(20).nullish(),
  barcode: z.string().max(64).nullish(), min_stock: z.union([z.number(), z.string()]).nullish(), warranty_days: z.union([z.number(), z.string()]).nullish(),
  description: z.string().max(2000).nullish(), item_type: z.string().max(30).nullish(),
});
const importBody = z.object({ rows: z.array(importRow).min(1).max(2000), warehouse_id: z.string().nullish(), shop_ids: z.array(z.string()).max(50).default([]) });
r.post('/products/import/preview', async (c) => {
  const input = await body(c, importBody);
  return c.json({ data: bulk.planImport(input.rows, { warehouseId: input.warehouse_id, shopIds: input.shop_ids }) });
});
r.post('/products/import', async (c) => {
  const input = await body(c, importBody);
  return c.json({ data: tx(() => bulk.runImport(input.rows, { warehouseId: input.warehouse_id, shopIds: input.shop_ids }, c.get('actor'))) }, 201);
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
  if (input.archived === true) throw badRequest('USE_REMOVE', 'Không đổi trạng thái ngừng kinh doanh trực tiếp. Dùng chức năng Xoá sản phẩm để hệ thống kiểm tra tồn kho, combo và đơn nháp trước khi gỡ.');
  if (input.archived === false) throw badRequest('USE_RESTORE', 'Không đổi trạng thái trực tiếp. Dùng nút Khôi phục ở tab Đã ngừng kinh doanh.');
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
      channel_id: z.string().optional(), // giá riêng của kênh này (nếu đã đặt) thay giá niêm yết
      limit: z.coerce.number().int().min(1).max(200).default(30),
    }),
  );
  return c.json({ data: svc.searchVariants({ shopId: q.shop_id, warehouseId: q.warehouse_id, q: q.q, categoryId: q.category_id, limit: q.limit, onlyListed: q.all !== '1', channelId: q.channel_id }) });
});

// Giá theo kênh
r.get('/channel-prices', (c) => {
  const q = query(c, z.object({ product_id: z.string().optional(), variant_id: z.string().optional(), shop_id: z.string().optional() }));
  return c.json({ data: svc.listChannelPrices({ productId: q.product_id, variantId: q.variant_id, shopId: q.shop_id }) });
});
r.put('/channel-prices', async (c) => {
  const items = await body(c, z.array(z.object({ shop_id: z.string(), channel_id: z.string(), variant_id: z.string(), price: money.nullable() })).min(1).max(500));
  return c.json({ data: { updated: tx(() => svc.setChannelPrices(items, c.get('actor'))) } });
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
