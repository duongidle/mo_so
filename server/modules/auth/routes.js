import { Hono } from 'hono';
import { z } from 'zod';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { getDb, tx } from '../../db/index.js';
import { hashPassword, verifyPassword, sha256, SESSION_COOKIE, requireAuth } from '../../lib/auth.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { body } from '../../lib/http.js';
import { newId, randomToken } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { config } from '../../lib/config.js';
import { audit } from '../../lib/events.js';
import { createWarehouse } from '../warehouses/service.js';
import { createShop } from '../shops/service.js';
import { INDUSTRY_IDS } from '../../lib/industries.js';

const r = new Hono();

const isSetUp = () => getDb().prepare('SELECT COUNT(*) n FROM users').get().n > 0;

function startSession(c, userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)')
    .run(sha256(token), userId, nowIso(), expires, c.req.header('user-agent') || null);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookie,
    path: '/',
    maxAge: config.sessionDays * 86400,
  });
}

r.get('/status', (c) => c.json({ setup_required: !isSetUp() }));

/** Thiết lập lần đầu: tạo chủ shop, kho đầu tiên, shop đầu tiên */
r.post('/setup', async (c) => {
  if (isSetUp()) throw conflict('ALREADY_SETUP', 'Hệ thống đã được thiết lập');
  const input = await body(
    c,
    z.object({
      username: z.string().trim().min(3).max(50),
      display_name: z.string().trim().min(1).max(100),
      password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200),
      warehouse_name: z.string().trim().min(1).default('Kho chính'),
      shops: z
        .array(z.object({ name: z.string().trim().min(1), code: z.string().trim().min(1).max(6), industry: z.enum(INDUSTRY_IDS).optional() }))
        .min(1)
        .default([{ name: 'Shop chính', code: 'S1' }]),
    }),
  );
  const userId = newId('usr');
  tx(() => {
    const at = nowIso();
    getDb()
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at)
         VALUES (?,?,?,?, 'owner', ?, ?)`,
      )
      .run(userId, input.username.toLowerCase(), input.display_name, hashPassword(input.password), at, at);
    const actor = { type: 'user', id: userId };
    const wh = createWarehouse({ code: 'K1', name: input.warehouse_name }, actor);
    for (const s of input.shops) createShop({ ...s, default_warehouse_id: wh.id }, actor);
  });
  startSession(c, userId);
  return c.json({ ok: true }, 201);
});

r.post('/login', async (c) => {
  const input = await body(c, z.object({ username: z.string().trim(), password: z.string() }));
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username.toLowerCase());
  if (!user) throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  if (user.locked_until && user.locked_until > nowIso()) {
    throw unauthorized('Đăng nhập sai quá nhiều lần, thử lại sau 15 phút');
  }
  if (!verifyPassword(input.password, user.password_hash)) {
    const fails = user.failed_logins + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
    throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  startSession(c, user.id);
  return c.json({ ok: true });
});

r.post('/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

r.get('/me', requireAuth(), (c) => c.json({ data: c.get('actor') }));

r.post('/change-password', requireAuth(), async (c) => {
  const actor = c.get('actor');
  if (actor.type !== 'user') throw badRequest('NOT_USER', 'Chỉ đổi được mật khẩu khi đăng nhập bằng tài khoản');
  const input = await body(c, z.object({ current_password: z.string(), new_password: z.string().min(8).max(200) }));
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(actor.id);
  if (!verifyPassword(input.current_password, user.password_hash)) throw badRequest('WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng');
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(input.new_password), nowIso(), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    audit(actor, 'user.password_changed', 'user', user.id);
  });
  startSession(c, user.id);
  return c.json({ ok: true });
});

export default r;
