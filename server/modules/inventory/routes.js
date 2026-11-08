import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, money, qty, stockQty, signedQty, query, optionalText } from '../../lib/http.js';
import * as svc from './service.js';
import * as counts from './counts.js';
import * as materials from './materials.js';
import * as close from './close.js';
import * as costing from './costing.js';
import * as lots from './lots.js';
import { shopWarehouseIds } from '../orders/allocation.js';
import { flushJournal } from '../accounting/journal.js';
import { rowsToCsv } from '../system/export.js';

const r = new Hono();

const reportFilter = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), warehouse_id: z.string().optional() });
r.get('/packaging-specs/:productId', (c) => c.json({ data: materials.getPackagingSpec(c.req.param('productId')) }));
r.put('/packaging-specs/:productId', async (c) => {
  const input = await body(c, z.object({ lines: z.array(z.object({ material_variant_id: z.string(), qty })).max(100) }));
  return c.json({ data: tx(() => materials.savePackagingSpec(c.req.param('productId'), input.lines, c.get('actor'))) });
});
r.get('/orders/:orderId/packaging-plan', (c) => c.json({ data: materials.packagingPlan(c.req.param('orderId')) }));
r.post('/orders/:orderId/packaging-confirm', async (c) => {
  const input = await body(c, z.object({ warehouse_id: z.string(), shop_id: z.string().nullish(), note: optionalText, lines: z.array(z.object({ variant_id: z.string(), qty })).min(1).max(100) }));
  return c.json({ data: tx(() => materials.confirmPackaging({ orderId: c.req.param('orderId'), warehouseId: input.warehouse_id, shopId: input.shop_id, note: input.note, lines: input.lines }, c.get('actor'))) });
});
r.post('/material-issues', async (c) => {
  const input = await body(c, z.object({ warehouse_id: z.string(), purpose: z.string().trim().min(1).max(500), expense_account_code: z.enum(['6414','6418','6422','6428']).default('6428'), shop_id: z.string().nullish(), lines: z.array(z.object({ variant_id: z.string(), qty })).min(1).max(200) }));
  return c.json({ data: tx(() => materials.issueMaterials({ warehouseId: input.warehouse_id, purpose: input.purpose, accountCode: input.expense_account_code, shopId: input.shop_id, lines: input.lines }, c.get('actor'))) }, 201);
});
r.get('/inventory-reports', (c) => {
  const f = query(c, reportFilter);
  flushJournal();
  return c.json({ data: materials.inventoryReport({ from: f.from, to: f.to, warehouseId: f.warehouse_id }) });
});
r.get('/inventory-reports/export', (c) => {
  const f = query(c, reportFilter);
  flushJournal();
  const data = materials.inventoryReport({ from: f.from, to: f.to, warehouseId: f.warehouse_id });
  const headers = ['SKU','Mặt hàng','Loại','Đơn vị','Tồn đầu kỳ','Nhập kỳ','Xuất kỳ','Tồn cuối kỳ','Giá vốn bình quân hiện tại','Giá trị tồn hiện tại','Tồn tối thiểu'];
  const rows = data.items.map((x) => [x.sku, x.product_name, x.item_type, x.unit, x.opening_qty, x.in_qty, x.out_qty, x.ending_qty, x.avg_cost, x.stock_value, x.min_stock]);
  return new Response(rowsToCsv(headers, rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bao-cao-ton-kho.csv"' } });
});
r.get('/material-consumption', (c) => {
  const f = query(c, reportFilter);
  return c.json({ data: materials.materialConsumption({ from: f.from, to: f.to, warehouseId: f.warehouse_id }) });
});
r.get('/material-consumption/export', (c) => {
  const f = query(c, reportFilter);
  const rows = materials.materialConsumption({ from: f.from, to: f.to, warehouseId: f.warehouse_id });
  const headers = ['Ngày','SKU','Vật tư','Đơn vị','Loại nghiệp vụ','Mã đơn','Mục đích','Số lượng','Giá trị','Tài khoản chi phí'];
  const data = rows.map((x) => [x.business_date, x.sku, x.product_name, x.unit, x.ref_type, x.order_code || '', x.purpose || '', Math.abs(x.qty), x.amount, x.expense_account_code]);
  return new Response(rowsToCsv(headers, data), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bao-cao-tieu-hao-vat-tu.csv"' } });
});

r.get('/stock', (c) => {
  const q = query(
    c,
    z.object({
      warehouse_id: z.string().optional(),
      shop_id: z.string().optional(),
      q: z.string().optional(),
      category_id: z.string().optional(),
      filter: z.enum(['low', 'slow', 'negative', 'in_stock']).optional(),
      limit: z.coerce.number().int().min(1).max(2000).default(500),
    }),
  );
  const data = svc.listStock({ warehouseId: q.warehouse_id, shopId: q.shop_id, q: q.q, categoryId: q.category_id, filter: q.filter, limit: q.limit });
  const total_value = data.reduce((a, r) => a + r.stock_value, 0);
  return c.json({ data, summary: { total_value, sku_count: data.length, low: data.filter((d) => d.is_low).length, slow: data.filter((d) => d.is_slow).length } });
});

r.get('/stock-movements', (c) => {
  const q = query(
    c,
    z.object({
      variant_id: z.string().optional(),
      warehouse_id: z.string().optional(),
      ref_type: z.string().optional(),
      ref_id: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      cursor: z.string().optional(),
    }),
  );
  return c.json(svc.listMovements({ variantId: q.variant_id, warehouseId: q.warehouse_id, refType: q.ref_type, refId: q.ref_id, limit: q.limit, cursor: q.cursor }));
});

r.get('/stock-adjustments', (c) => c.json({ data: svc.listAdjustments() }));
r.post('/stock-adjustments', async (c) => {
  const input = await body(
    c,
    z.object({
      warehouse_id: z.string(),
      kind: z.enum(['opening', 'count', 'adjust', 'damage']),
      reason: optionalText,
      lines: z
        .array(
          z.object({
            variant_id: z.string(),
            counted: stockQty.optional(),
            change: signedQty.optional(),
            unit_cost: money.optional(),
          }),
        )
        .min(1),
    }),
  );
  const res = tx(() => svc.createAdjustment({ warehouseId: input.warehouse_id, kind: input.kind, reason: input.reason, lines: input.lines }, c.get('actor')));
  return c.json({ data: res }, 201);
});

r.post('/transfers', async (c) => {
  const input = await body(
    c,
    z.object({
      from_warehouse_id: z.string(),
      to_warehouse_id: z.string(),
      note: optionalText,
      lines: z.array(z.object({ variant_id: z.string(), qty })).min(1),
    }),
  );
  const res = tx(() => svc.createTransfer({ fromWarehouseId: input.from_warehouse_id, toWarehouseId: input.to_warehouse_id, lines: input.lines, note: input.note }, c.get('actor')));
  return c.json({ data: res }, 201);
});

// Lô và hạn dùng
r.get('/stock-lots', (c) => {
  const q = query(c, z.object({ warehouse_id: z.string().optional(), variant_id: z.string().optional(), shop_id: z.string().optional(), within_days: z.coerce.number().int().min(0).max(3650).optional() }));
  return c.json({ data: lots.listLots({ warehouseId: q.warehouse_id, variantId: q.variant_id, withinDays: q.within_days, shopWarehouseIds: q.shop_id ? shopWarehouseIds(q.shop_id) : undefined }) });
});
r.get('/stock-lots/summary', (c) => {
  const q = query(c, z.object({ shop_id: z.string().optional() }));
  return c.json({ data: lots.lotSummary({ shopWarehouseIds: q.shop_id ? shopWarehouseIds(q.shop_id) : undefined }) });
});

// Phương pháp giá vốn
r.get('/costing-method', (c) => c.json({ data: costing.costingStatus() }));
r.put('/costing-method', async (c) => {
  const input = await body(c, z.object({ method: z.enum(['average', 'fifo']) }));
  return c.json({ data: tx(() => costing.setCostingMethod(input.method, c.get('actor'))) });
});

// Chốt kỳ kho
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
r.get('/stock-close', (c) => c.json({ data: close.closeStatus() }));
r.get('/stock-close/preview', (c) => c.json({ data: close.previewClose(query(c, z.object({ date: dateStr })).date) }));
r.post('/stock-close', async (c) => {
  const input = await body(c, z.object({ date: dateStr, note: optionalText }));
  return c.json({ data: tx(() => close.closeStock(input.date, input.note, c.get('actor'))) }, 201);
});
r.post('/stock-close/reopen', async (c) => {
  const input = await body(c, z.object({ date: dateStr.nullable(), reason: z.string().trim().min(1).max(500) }));
  return c.json({ data: tx(() => close.reopenStock(input.date, input.reason, c.get('actor'))) });
});
r.get('/stock-closes', (c) => c.json({ data: close.listCloses() }));
r.get('/stock-closes/:id', (c) => c.json({ data: close.getClose(c.req.param('id')) }));

r.get('/stock-integrity', (c) => {
  const issues = svc.verifyStockIntegrity();
  return c.json({ ok: issues.length === 0, issues });
});

// Phiếu kiểm kê nhiều bước
r.get('/stock-counts', (c) => c.json({ data: counts.listCounts() }));
r.get('/stock-counts/:id', (c) => c.json({ data: counts.getCount(c.req.param('id')) }));
r.post('/stock-counts', async (c) => {
  const input = await body(c, z.object({ warehouse_id: z.string(), note: optionalText, mode: z.enum(['in_stock', 'variants', 'empty']).default('in_stock'), variant_ids: z.array(z.string()).default([]) }));
  return c.json({ data: tx(() => counts.createCount({ warehouseId: input.warehouse_id, note: input.note, mode: input.mode, variantIds: input.variant_ids }, c.get('actor'))) }, 201);
});
r.patch('/stock-counts/:id', async (c) => {
  const input = await body(c, z.object({
    lines: z.array(z.object({ variant_id: z.string(), counted_qty: stockQty.nullable().optional(), unit_cost: money.nullable().optional(), note: optionalText.optional() })).default([]),
    add_variant_ids: z.array(z.string()).default([]),
    remove_variant_ids: z.array(z.string()).default([]),
    note: optionalText.optional(),
  }));
  return c.json({ data: tx(() => counts.updateCount(c.req.param('id'), { lines: input.lines, addVariantIds: input.add_variant_ids, removeVariantIds: input.remove_variant_ids, note: input.note })) });
});
r.post('/stock-counts/:id/complete', async (c) => {
  const input = await body(c, z.object({ uncounted: z.enum(['skip', 'zero']).default('skip') }));
  return c.json({ data: tx(() => counts.completeCount(c.req.param('id'), { uncounted: input.uncounted }, c.get('actor'))) });
});
r.post('/stock-counts/:id/cancel', (c) => c.json({ data: tx(() => counts.cancelCount(c.req.param('id'), c.get('actor'))) }));

export default r;
