import { Hono } from 'hono';
import { z } from 'zod';
import { tx } from '../../db/index.js';
import { body, query } from '../../lib/http.js';
import { forbidden } from '../../lib/errors.js';
import * as svc from './service.js';

const r = new Hono();
r.use('*', async (c, next) => {
  if (c.get('actor')?.type !== 'user') throw forbidden('Chỉ chủ shop đăng nhập mới dùng được thông báo');
  return next();
});

r.get('/', (c) => {
  const q = query(c, z.object({ unread: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }));
  return c.json(svc.listNotifications({ unreadOnly: q.unread === '1', limit: q.limit }));
});
r.post('/read', async (c) => {
  const i = await body(c, z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() }));
  return c.json({ data: { unread: tx(() => svc.markRead(i)) } });
});
r.get('/config', (c) => c.json({ data: svc.getConfig() }));
r.put('/config', async (c) => {
  const i = await body(c, z.object({
    telegram: z.object({ bot_token: z.string().max(200).optional(), chat_id: z.string().max(60).optional(), clear_token: z.boolean().optional() }).optional(),
    rules: z.record(z.string(), z.object({ enabled: z.boolean().optional(), channels: z.array(z.enum(['inapp', 'telegram', 'webhook'])).optional(), days: z.number().optional(), hour: z.number().optional() })).optional(),
  }));
  return c.json({ data: tx(() => svc.saveConfig(i, c.get('actor'))) });
});
r.post('/test', async (c) => {
  const i = await body(c, z.object({ channels: z.array(z.enum(['inapp', 'telegram', 'webhook'])).default(['inapp']) }));
  return c.json({ data: await svc.sendTest({ channels: i.channels }) });
});
r.post('/run', async (c) => c.json({ data: await svc.runNotifications() }));

export default r;
