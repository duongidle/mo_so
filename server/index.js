import os from 'node:os';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './lib/config.js';
import { getDb } from './db/index.js';

getDb(); // mở DB + chạy migration
const app = createApp();

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`Mở Sổ đang chạy:`);
  console.log(`  Máy này:    http://localhost:${config.port}`);
  for (const ip of lan) console.log(`  Điện thoại: http://${ip}:${config.port}`);
});
