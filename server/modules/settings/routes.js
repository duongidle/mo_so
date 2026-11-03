import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { body } from '../../lib/http.js';
import { getSettings, updateSettings } from './service.js';
import { audit } from '../../lib/events.js';

const r = new Hono();

r.get('/', (c) => c.json({ data: getSettings() }));
r.patch('/', async (c) => {
  const patch = await body(c, z.record(z.string(), z.any()));
  const before = getSettings();
  const after = updateSettings(patch);
  audit(c.get('actor'), 'settings.updated', 'settings', 'global', before, after);
  return c.json({ data: after });
});

export const channelRoutes = new Hono();
channelRoutes.get('/', (c) =>
  c.json({ data: getDb().prepare('SELECT * FROM channels WHERE archived_at IS NULL ORDER BY sort_order').all() }),
);

export default r;
