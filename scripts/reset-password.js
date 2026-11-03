// Đặt lại mật khẩu khi quên: node scripts/reset-password.js <tên_đăng_nhập> <mật_khẩu_mới>
import { getDb } from '../server/db/index.js';
import { hashPassword } from '../server/lib/auth.js';
import { nowIso } from '../server/lib/time.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.log('Cách dùng: npm run reset-password -- <tên_đăng_nhập> <mật_khẩu_mới ≥ 8 ký tự>');
  process.exit(1);
}
const db = getDb();
const res = db
  .prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE username = ?')
  .run(hashPassword(password), nowIso(), username.toLowerCase());
if (!res.changes) {
  console.log(`Không có tài khoản "${username}"`);
  process.exit(1);
}
db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username.toLowerCase());
console.log('Đã đặt lại mật khẩu. Các phiên đăng nhập cũ đã bị đăng xuất.');
