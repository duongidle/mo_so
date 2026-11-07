import { Hono } from 'hono';
import { z } from 'zod';
import { body, optionalText } from '../../lib/http.js';
import { tx } from '../../db/index.js';
import { createWarehouse, getWarehouse, listWarehouses, updateWarehouse, warehouseImpact, removeWarehouse } from './service.js';

const r = new Hono();

const input = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9]+$/),
  name: z.string().trim().min(1).max(100),
  address: optionalText,
  note: optionalText,
});

r.get('/', (c) => c.json({ data: listWarehouses({ includeArchived: c.req.query('archived') === '1' }) }));
r.get('/:id', (c) => c.json({ data: getWarehouse(c.req.param('id')) }));
r.get('/:id/impact', (c) => c.json({ data: warehouseImpact(c.req.param('id')) }));
r.post('/:id/remove', async (c) => {
  const data = await body(c, z.object({ transfer_to: z.string().nullish(), confirm: z.boolean().default(false) }));
  return c.json({ data: tx(() => removeWarehouse(c.req.param('id'), { transferTo: data.transfer_to ?? null, confirm: data.confirm }, c.get('actor'))) });
});
r.post('/', async (c) => c.json({ data: createWarehouse(await body(c, input), c.get('actor')) }, 201));
r.patch('/:id', async (c) => {
  const data = await body(c, input.partial().extend({ archived: z.boolean().optional(), force: z.boolean().optional() }));
  const force = !!data.force;
  delete data.force;
  if (data.archived !== undefined) data.archived_at = data.archived ? new Date().toISOString() : null;
  delete data.archived;
  return c.json({ data: updateWarehouse(c.req.param('id'), data, c.get('actor'), { force }) });
});

export default r;
