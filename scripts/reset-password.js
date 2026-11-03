// Đặt lại mật khẩu khi quên: npm run reset-password -- <tên_đăng_nhập> <mật_khẩu_mới>
import { getMaster } from '../server/db/tenancy.js';
import { hashPassword } from '../server/lib/auth.js';
import { nowIso } from '../server/lib/time.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.log('Cách dùng: npm run reset-password -- <tên_đăng_nhập> <mật_khẩu_mới ≥ 8 ký tự>');
  process.exit(1);
}
const m = getMaster();
const acc = m.prepare('SELECT id FROM accounts WHERE username = ?').get(username.toLowerCase());
if (!acc) {
  console.log(`Không có tài khoản "${username}"`);
  process.exit(1);
}
m.prepare('UPDATE accounts SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(hashPassword(password), nowIso(), acc.id);
m.prepare('DELETE FROM sessions WHERE account_id = ?').run(acc.id);
console.log('Đã đặt lại mật khẩu. Các phiên đăng nhập cũ đã bị đăng xuất.');
