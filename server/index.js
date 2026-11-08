import os from 'node:os';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './lib/config.js';
import { bootstrapTenancy, getMaster } from './db/tenancy.js';
import { startBackupScheduler } from './jobs/backup.js';
import { startRecurringScheduler } from './jobs/recurring.js';
import { startNotificationScheduler } from './jobs/notify.js';
import { startWebhookWorker } from './jobs/webhooks.js';

getMaster(); // mở sổ tài khoản + chạy migration
const boot = bootstrapTenancy(); // cài đặt cũ một file → tài khoản đầu tiên
if (boot.migrated) console.log(`Đã chuyển dữ liệu cũ thành tài khoản "${boot.username}" (giữ nguyên tên đăng nhập và mật khẩu).`);
const app = createApp();
startBackupScheduler();
startRecurringScheduler();
startNotificationScheduler();
startWebhookWorker();

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`Mở Sổ đang chạy:`);
  console.log(`  Máy này:    http://localhost:${config.port}`);
  for (const ip of lan) console.log(`  Điện thoại: http://${ip}:${config.port}`);
});
