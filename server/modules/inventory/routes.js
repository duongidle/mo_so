import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, money, qty, query, optionalText } from '../../lib/http.js';
import * as svc from './service.js';

const r = new Hono();

r.get('/stock', (c) => {
  const q = query(
    c,
    z.object({
      warehouse_id: z.string().optional(),
      shop_id: z.string().optional(),
      q: z.string().optional(),
      filter: z.enum(['low', 'slow', 'negative', 'in_stock']).optional(),
      limit: z.coerce.number().int().min(1).max(2000).default(500),
    }),
  );
  const data = svc.listStock({ warehouseId: q.warehouse_id, shopId: q.shop_id, q: q.q, filter: q.filter, limit: q.limit });
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
            counted: z.coerce.number().int().min(0).optional(),
            change: z.coerce.number().int().optional(),
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

r.get('/stock-integrity', (c) => {
  const issues = svc.verifyStockIntegrity();
  return c.json({ ok: issues.length === 0, issues });
});

export default r;
