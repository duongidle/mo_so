import { Hono } from 'hono';
import { z } from 'zod';
import { body } from '../../lib/http.js';
import * as svc from './service.js';

const r = new Hono();

const num = z.coerce.number().int().min(0);
const importOrder = z.object({
  external_id: z.union([z.string(), z.number()]).transform(String),
  status: z.string().nullish(),
  ordered_at: z.string().nullish(),
  customer: z
    .object({
      name: z.string().nullish(),
      phone: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? v : String(v))),
      address: z.string().nullish(),
      shopee_username: z.string().nullish(),
      facebook_url: z.string().nullish(),
    })
    .nullish(),
  shipping_address: z.string().nullish(),
  lines: z
    .array(
      z.object({
        sku: z.union([z.string(), z.number()]).transform(String),
        qty: z.coerce.number().int().positive(),
        unit_price: num.optional(),
        discount_amount: num.default(0),
        name: z.string().nullish(),
      }),
    )
    .min(1),
  discount_amount: num.default(0),
  shipping_fee: num.default(0),
  platform_fee_amount: num.default(0),
  seller_shipping_amount: num.default(0),
  note: z.string().nullish(),
  tracking_code: z.string().nullish(),
  carrier: z.string().nullish(),
  paid_amount: num.default(0),
});

const runInput = z.object({
  shop_id: z.string(),
  channel_id: z.string(),
  profile_id: z.string().nullish(),
  file_name: z.string().nullish(),
  orders: z.array(importOrder).min(1).max(500, 'Tối đa 500 đơn mỗi lượt'),
});

async function run(c, dryRun) {
  const input = await body(c, runInput);
  const res = svc.runImport(
    { shopId: input.shop_id, channelId: input.channel_id, profileId: input.profile_id, fileName: input.file_name, orders: input.orders, dryRun },
    c.get('actor'),
  );
  return c.json({ data: res });
}

r.post('/orders/preview', (c) => run(c, true));
r.post('/orders/commit', (c) => run(c, false));

r.get('/profiles', (c) => c.json({ data: svc.listProfiles() }));
const profileInput = z.object({
  name: z.string().trim().min(1),
  channel_id: z.string(),
  column_map: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  status_map: z.record(z.string(), z.enum(['draft', 'confirmed', 'shipping', 'completed', 'cancelled', 'returned'])).default({}),
  options: z.record(z.string(), z.any()).default({}),
});
r.post('/profiles', async (c) => c.json({ data: svc.saveProfile(await body(c, profileInput)) }, 201));
r.put('/profiles/:id', async (c) => c.json({ data: svc.saveProfile(await body(c, profileInput), c.req.param('id')) }));

r.get('/batches', (c) => c.json({ data: svc.listBatches() }));
r.get('/batches/:id', (c) => c.json({ data: svc.getBatch(c.req.param('id')) }));

r.get('/template.csv', (c) => {
  const header = svc.STANDARD_TEMPLATE_HEADER.join(',');
  const sample = [
    'FB-001,2026-11-03,completed,Nguyễn Văn A,0901234567,"12 Lê Lợi, Q1",NH-GO-10,2,150000,0,20000,30000,0,30000,Giao giờ hành chính,,310000',
    'FB-001,2026-11-03,completed,Nguyễn Văn A,0901234567,"12 Lê Lợi, Q1",NH-CAM-10,1,150000,0,,,,,,,',
  ];
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="mau-import-don-hang.csv"');
  return c.body('﻿' + [header, ...sample].join('\n'));
});

export default r;
