import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, patchOf } from '../../lib/http.js';
import * as svc from './service.js';

const r = new Hono();
r.get('/', (c) => c.json({ data: svc.listPlatforms() }));
r.post('/:id/enable', (c) => c.json({ data: tx(() => svc.enablePlatform(c.req.param('id'), c.get('actor'))) }));
r.post('/:id/disable', (c) => c.json({ data: tx(() => svc.disablePlatform(c.req.param('id'), c.get('actor'))) }));

export const channelRoutes = new Hono();
const channelInput = z.object({
  name: z.string().trim().min(1).max(60),
  is_marketplace: z.boolean().default(false),
  archived: z.boolean().optional(),
});
// Mặc định chỉ kênh đang bật; ?include_archived=1 để đọc tên kênh của đơn cũ
channelRoutes.get('/', (c) => c.json({ data: svc.listChannels({ includeArchived: c.req.query('include_archived') === '1' }) }));
channelRoutes.post('/', async (c) => {
  const input = await body(c, channelInput.omit({ archived: true }));
  return c.json({ data: tx(() => svc.createChannel(input, c.get('actor'))) }, 201);
});
channelRoutes.patch('/:id', async (c) => {
  const input = await body(c, patchOf(channelInput));
  return c.json({ data: tx(() => svc.updateChannel(c.req.param('id'), input, c.get('actor'))) });
});

export default r;
