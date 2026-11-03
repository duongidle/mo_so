// Sao lưu tay (an toàn khi server đang mở): npm run backup — sao lưu mọi tài khoản và sổ tài khoản
import path from 'node:path';
import { runBackup } from '../server/jobs/backup.js';
import { bootstrapTenancy, forEachAccount, getMaster } from '../server/db/tenancy.js';
import { config } from '../server/lib/config.js';

bootstrapTenancy();
let n = 0;
await forEachAccount(async (a) => {
  const r = await runBackup();
  console.log(`[${a.username}] ${r.file}${r.pruned.length ? ` (dọn ${r.pruned.length} bản cũ)` : ''}`);
  n++;
});
const m = await runBackup(new Date(), { conn: getMaster(), dir: path.join(config.dataDir, 'backups', '_master') });
console.log(`[sổ tài khoản] ${m.file}`);
console.log(`Đã sao lưu ${n} tài khoản. Nên copy thư mục data/backups lên Google Drive/iCloud để phòng mất máy.`);
