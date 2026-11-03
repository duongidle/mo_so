import crypto from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { getDb } from '../db/index.js';
import { unauthorized, forbidden } from './errors.js';
import { nowIso } from './time.js';

export const SESSION_COOKIE = 'moso_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Middleware xác thực: chấp nhận cookie phiên (web) hoặc Bearer API key.
 * Gắn c.get('actor') = { type: 'user'|'api_key', id, scopes }
 */
export function requireAuth() {
  return async (c, next) => {
    const db = getDb();
    const authz = c.req.header('authorization');
    if (authz?.startsWith('Bearer ')) {
      const key = authz.slice(7).trim();
      const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(sha256(key));
      if (!row) throw unauthorized('API key không hợp lệ');
      db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
      const scopes = JSON.parse(row.scopes);
      const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
      if (isWrite && !scopes.includes('write')) throw forbidden('API key chỉ có quyền đọc');
      c.set('actor', { type: 'api_key', id: row.id, scopes });
      return next();
    }
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw unauthorized();
    const s = db
      .prepare(
        `SELECT s.*, u.username, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), nowIso());
    if (!s) throw unauthorized('Phiên đăng nhập đã hết hạn');
    c.set('actor', { type: 'user', id: s.user_id, role: s.role, username: s.username, displayName: s.display_name });
    return next();
  };
}
