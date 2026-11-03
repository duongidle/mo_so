// Khôi phục dữ liệu MỘT tài khoản từ bản sao lưu. TẮT SERVER trước khi chạy.
//   node scripts/restore.js <file-sao-lưu.db> [tên_đăng_nhập]
// Không ghi tên đăng nhập: dùng tài khoản duy nhất (nếu chỉ có một).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../server/lib/config.js';
import { listAccounts, getMaster } from '../server/db/tenancy.js';

const [src, username] = process.argv.slice(2);
if (!src || !fs.existsSync(src)) {
  console.error('Cách dùng: node scripts/restore.js <file-sao-lưu.db> [tên_đăng_nhập]');
  process.exit(1);
}
const accounts = listAccounts();
const acc = username ? accounts.find((a) => a.username === username.toLowerCase()) : accounts.length === 1 ? accounts[0] : null;
if (!acc) {
  console.error(accounts.length > 1 ? `Có ${accounts.length} tài khoản, hãy ghi rõ tên đăng nhập: ${accounts.map((a) => a.username).join(', ')}` : 'Không tìm thấy tài khoản.');
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
const target = path.join(config.dataDir, acc.db_file);
if (fs.existsSync(target)) {
  const keep = `${target}.before-restore-${Date.now()}`;
  fs.copyFileSync(target, keep);
  console.log(`Đã giữ bản hiện tại tại: ${keep}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(target + ext, { force: true });
fs.copyFileSync(src, target);
getMaster().close();
console.log(`Đã khôi phục dữ liệu của "${acc.username}" từ ${src}. Khởi động lại server.`);
