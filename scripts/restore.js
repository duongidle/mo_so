// Khôi phục DB từ một bản sao lưu. TẮT SERVER trước khi chạy.
//   node scripts/restore.js data/backups/moso-20261103-0900.db
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../server/lib/config.js';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Cách dùng: node scripts/restore.js <file-sao-lưu.db>');
  process.exit(1);
}
// Kiểm tra file là SQLite hợp lệ và có đủ bảng chính trước khi đè lên dữ liệu đang dùng
let valid = false;
try {
  const probe = new Database(src, { readonly: true });
  valid = probe.pragma('integrity_check', { simple: true }) === 'ok' && !!probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'orders'").get();
  probe.close();
} catch {
  valid = false; // không phải file SQLite
}
if (!valid) {
  console.error('File sao lưu không hợp lệ (không phải DB của Mở Sổ hoặc bị hỏng). Không khôi phục, dữ liệu hiện tại giữ nguyên.');
  process.exit(1);
}
const target = path.join(config.dataDir, 'moso.db');
if (fs.existsSync(target)) {
  const keep = `${target}.before-restore-${Date.now()}`;
  fs.copyFileSync(target, keep);
  console.log(`Đã giữ bản hiện tại tại: ${keep}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(target + ext, { force: true });
fs.copyFileSync(src, target);
console.log(`Đã khôi phục từ ${src}. Khởi động lại server.`);
