import crypto from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { getDb, runInTenant } from '../db/index.js';
import { getMaster, storeFor } from '../db/tenancy.js';
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
 * Gắn c.get('actor') = { type: 'user'|'api_key', id, accountId, scopes }, rồi chạy phần còn lại của yêu cầu
 * TRONG cơ sở dữ liệu của tài khoản đó. Đây là điểm duy nhất quyết định yêu cầu thấy dữ liệu của ai.
 */
export function requireAuth() {
  return async (c, next) => {
    const m = getMaster();
    const authz = c.req.header('authorization');
    if (authz?.startsWith('Bearer ')) {
      const hash = sha256(authz.slice(7).trim());
      const idx = m.prepare('SELECT account_id FROM api_key_index WHERE key_hash = ?').get(hash);
      const account = idx && m.prepare('SELECT * FROM accounts WHERE id = ? AND disabled_at IS NULL').get(idx.account_id);
      if (!account) throw unauthorized('API key không hợp lệ');
      return runInTenant(storeFor(account), () => {
        const db = getDb();
        const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(hash);
        if (!row) throw unauthorized('API key không hợp lệ');
        db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
        const scopes = JSON.parse(row.scopes);
        const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
        if (isWrite && !scopes.includes('write')) throw forbidden('API key chỉ có quyền đọc');
        c.set('actor', { type: 'api_key', id: row.id, accountId: account.id, scopes });
        return next();
      });
    }
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw unauthorized();
    const s = m
      .prepare(
        `SELECT s.account_id, a.username, a.display_name FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.id = ? AND s.expires_at > ? AND a.disabled_at IS NULL`,
      )
      .get(sha256(token), nowIso());
    if (!s) throw unauthorized('Phiên đăng nhập đã hết hạn');
    const account = m.prepare('SELECT * FROM accounts WHERE id = ?').get(s.account_id);
    c.set('actor', { type: 'user', id: s.account_id, accountId: s.account_id, role: 'owner', username: s.username, displayName: s.display_name });
    return runInTenant(storeFor(account), () => next());
  };
}
