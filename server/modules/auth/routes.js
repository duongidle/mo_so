import { Hono } from 'hono';
import { z } from 'zod';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, sha256, SESSION_COOKIE, requireAuth } from '../../lib/auth.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../lib/errors.js';
import { body } from '../../lib/http.js';
import { randomToken } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { config } from '../../lib/config.js';
import { audit } from '../../lib/events.js';
import { allow } from '../../lib/ratelimit.js';
import { accountCount, createAccount, getMaster } from '../../db/tenancy.js';

const r = new Hono();

const USERNAME = z
  .string()
  .trim()
  .min(3, 'Tên đăng nhập tối thiểu 3 ký tự')
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/, 'Tên đăng nhập chỉ gồm chữ không dấu, số và . _ @ -');

function startSession(c, accountId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  getMaster()
    .prepare('INSERT INTO sessions (id, account_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)')
    .run(sha256(token), accountId, nowIso(), expires, c.req.header('user-agent') || null);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: config.secureCookie, path: '/', maxAge: config.sessionDays * 86400 });
}

const clientIp = (c) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.env?.incoming?.socket?.remoteAddress || 'unknown';

/** Cho giao diện biết nên hiện đăng ký hay đăng nhập */
r.get('/status', (c) => {
  const n = accountCount();
  return c.json({ has_accounts: n > 0, registration_open: n === 0 || config.registration === 'open' });
});

/**
 * Đăng ký tài khoản mới. Mỗi tài khoản có dữ liệu riêng hoàn toàn (shop, kho, sản phẩm, khách, đơn…).
 * Tài khoản mới chưa có shop nào: giao diện dẫn đi tạo shop đầu tiên.
 */
r.post('/register', async (c) => {
  const input = await body(c, z.object({ username: USERNAME, display_name: z.string().trim().min(1, 'Nhập tên hiển thị').max(100), password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200) }));
  if (accountCount() > 0 && config.registration !== 'open') throw forbidden('Hệ thống đang đóng đăng ký tài khoản mới');
  if (!allow(`register:${clientIp(c)}`, config.registerLimitPerHour)) throw new AppError(429, 'TOO_MANY_REQUESTS', 'Đăng ký quá nhiều lần, thử lại sau');
  const account = createAccount({ username: input.username, displayName: input.display_name, passwordHash: hashPassword(input.password) });
  startSession(c, account.id);
  return c.json({ ok: true, data: { id: account.id, username: account.username } }, 201);
});

r.post('/login', async (c) => {
  const input = await body(c, z.object({ username: z.string().trim(), password: z.string() }));
  const m = getMaster();
  const user = m.prepare('SELECT * FROM accounts WHERE username = ? AND disabled_at IS NULL').get(input.username.toLowerCase());
  if (!user) throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  if (user.locked_until && user.locked_until > nowIso()) {
    throw unauthorized('Đăng nhập sai quá nhiều lần, thử lại sau 15 phút');
  }
  if (!verifyPassword(input.password, user.password_hash)) {
    const fails = user.failed_logins + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
    m.prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
    throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  }
  m.prepare('UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  startSession(c, user.id);
  return c.json({ ok: true });
});

r.post('/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) getMaster().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

r.get('/me', requireAuth(), (c) => c.json({ data: c.get('actor') }));

r.post('/change-password', requireAuth(), async (c) => {
  const actor = c.get('actor');
  if (actor.type !== 'user') throw badRequest('NOT_USER', 'Chỉ đổi được mật khẩu khi đăng nhập bằng tài khoản');
  const input = await body(c, z.object({ current_password: z.string(), new_password: z.string().min(8).max(200) }));
  const m = getMaster();
  const user = m.prepare('SELECT * FROM accounts WHERE id = ?').get(actor.id);
  if (!verifyPassword(input.current_password, user.password_hash)) throw badRequest('WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng');
  m.transaction(() => {
    m.prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(input.new_password), nowIso(), user.id);
    m.prepare('DELETE FROM sessions WHERE account_id = ?').run(user.id);
  })();
  audit(actor, 'user.password_changed', 'user', user.id);
  startSession(c, user.id);
  return c.json({ ok: true });
});

export default r;
