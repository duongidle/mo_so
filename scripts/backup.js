// Sao lưu tay DB đang chạy (an toàn khi server đang mở): node scripts/backup.js
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from '../server/db/index.js';
import { config } from '../server/lib/config.js';

const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
const file = path.join(dir, `moso-${stamp}.db`);
await getDb().backup(file);
console.log(`Đã sao lưu: ${file}`);
console.log('Nên copy file này lên Google Drive/iCloud để phòng mất máy.');
