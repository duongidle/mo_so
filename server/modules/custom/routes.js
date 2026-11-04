import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, patchOf } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { FUNCTION_DOCS } from '../../lib/formula.js';
import * as svc from './service.js';

const r = new Hono();
const entity = z.enum(svc.ENTITY_TYPES);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Khoá chỉ gồm a-z, 0-9, _ và bắt đầu bằng chữ');

const fieldInput = z.object({
  entity_type: entity,
  key,
  label: z.string().trim().min(1).max(80),
  type: z.enum(svc.FIELD_TYPES),
  options: z.array(z.string().min(1)).optional(),
  formula: z.string().trim().min(1).optional(),
  shop_id: z.string().nullish(),
  sort_order: z.number().int().optional(),
  show_in_list: z.boolean().optional(),
  required: z.boolean().optional(),
  role: z.string().nullish(),
});

r.get('/fields', (c) => c.json({ data: svc.listFields(c.req.query('entity_type'), { shopId: c.req.query('shop_id'), archived: c.req.query('archived') === '1' }) }));
r.post('/fields', async (c) => {
  const input = await body(c, fieldInput);
  return c.json({ data: tx(() => svc.createField(input)) }, 201);
});
r.patch('/fields/:id', async (c) => {
  const patch = await body(c, patchOf(fieldInput.pick({ label: true, options: true, formula: true, sort_order: true, show_in_list: true, required: true, role: true }).extend({ archived: z.boolean() })));
  return c.json({ data: tx(() => svc.updateField(c.req.param('id'), patch)) });
});

r.get('/variables', (c) => {
  const e = entity.safeParse(c.req.query('entity_type'));
  if (!e.success) throw badRequest('INVALID_ENTITY', 'entity_type phải là product | customer | order | purchase');
  return c.json({ data: svc.listVariables(e.data, { shopId: c.req.query('shop_id') }) });
});
r.get('/metric-variables', (c) => c.json({ data: svc.listMetricVariables() }));
r.get('/functions', (c) => c.json({ data: FUNCTION_DOCS }));
r.post('/formula/preview', async (c) => {
  const input = await body(c, z.object({ entity_type: z.enum([...svc.ENTITY_TYPES, 'metric']), shop_id: z.string().nullish(), formula: z.string(), entity_id: z.string().nullish(), field_key: z.string().nullish() }));
  return c.json({ data: svc.previewFormula({ entityType: input.entity_type, shopId: input.shop_id || null, formula: input.formula, entityId: input.entity_id || null, fieldKey: input.field_key || null }) });
});

r.get('/values/:entity/:id', (c) => {
  const e = entity.safeParse(c.req.param('entity'));
  if (!e.success) throw badRequest('INVALID_ENTITY', 'entity phải là product | customer | order | purchase');
  return c.json({ data: svc.getValues(e.data, c.req.param('id'), { shopId: c.req.query('shop_id') }) });
});
r.put('/values/:entity/:id', async (c) => {
  const e = entity.safeParse(c.req.param('entity'));
  if (!e.success) throw badRequest('INVALID_ENTITY', 'entity phải là product | customer | order | purchase');
  const values = await body(c, z.record(z.string(), z.any()));
  return c.json({ data: tx(() => svc.setValues(e.data, c.req.param('id'), values, { shopId: c.req.query('shop_id') })) });
});

r.get('/metrics', (c) => c.json({ data: svc.listMetrics() }));
r.post('/metrics', async (c) =>
  c.json({ data: svc.createMetric(await body(c, z.object({ key, name: z.string().trim().min(1), formula: z.string().trim().min(1), format: z.enum(['number', 'money', 'percent']).default('number'), shop_id: z.string().nullish() }))) }, 201),
);
r.delete('/metrics/:id', (c) => (svc.archiveMetric(c.req.param('id')), c.json({ data: { archived: true } })));

export default r;
