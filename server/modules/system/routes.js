import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { body, query, patchOf } from '../../lib/http.js';
import { newId, randomToken } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { sha256 } from '../../lib/auth.js';
import { indexApiKey, unindexApiKey } from '../../db/tenancy.js';
import { audit } from '../../lib/events.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { runBackup, listBackups, backupDir } from '../../jobs/backup.js';
import { processDue, deliver } from '../../jobs/webhooks.js';
import { toCsv, EXPORTS } from './export.js';
import { EVENT_TYPES } from './events.js';

const r = new Hono();
const db = () => getDb();

// Quản trị khoá, webhook, sao lưu chỉ dành cho người đăng nhập — API key không được tự cấp quyền cho mình
r.use('*', async (c, next) => {
  if (c.get('actor')?.type !== 'user') throw forbidden('Chỉ chủ shop đăng nhập mới dùng được chức năng này');
  return next();
});

// ---------- API key ----------
r.get('/api-keys', (c) =>
  c.json({ data: db().prepare('SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys ORDER BY created_at DESC').all().map((k) => ({ ...k, scopes: JSON.parse(k.scopes) })) }),
);
r.post('/api-keys', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(['read', 'write'])).min(1).default(['read']) }));
  const key = `tk_live_${randomToken(32)}`;
  const id = newId('key');
  db()
    .prepare('INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, input.name, key.slice(0, 12), sha256(key), JSON.stringify(input.scopes), nowIso());
  indexApiKey(sha256(key), c.get('actor').accountId); // để xác thực biết key thuộc tài khoản nào
  audit(c.get('actor'), 'api_key.created', 'api_key', id, null, { name: input.name, scopes: input.scopes });
  // Khoá đầy đủ chỉ hiện đúng 1 lần này
  return c.json({ data: { id, name: input.name, prefix: key.slice(0, 12), scopes: input.scopes, key } }, 201);
});
r.delete('/api-keys/:id', (c) => {
  const id = c.req.param('id');
  if (!db().prepare('SELECT 1 FROM api_keys WHERE id = ?').get(id)) throw notFound('API key');
  db().prepare('UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(nowIso(), id);
  const row = db().prepare('SELECT key_hash FROM api_keys WHERE id = ?').get(id);
  if (row) unindexApiKey(row.key_hash);
  audit(c.get('actor'), 'api_key.revoked', 'api_key', id);
  return c.json({ data: { id, revoked: true } });
});

// ---------- Webhook ----------
const hookInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'Chỉ chấp nhận http/https'),
  event_types: z
    .array(z.string())
    .min(1)
    .refine((a) => a.every((t) => t === '*' || t.endsWith('.*') || EVENT_TYPES.includes(t)), 'Có loại sự kiện không hợp lệ')
    .default(['*']),
  active: z.boolean().default(true),
});
const shapeHook = (h, withSecret = false) => ({ ...h, event_types: JSON.parse(h.event_types), active: !!h.active, secret: withSecret ? h.secret : `${h.secret.slice(0, 10)}…` });

r.get('/webhook-events', (c) => c.json({ data: EVENT_TYPES }));
r.get('/webhooks', (c) => c.json({ data: db().prepare('SELECT * FROM webhooks ORDER BY created_at').all().map((h) => shapeHook(h)) }));
r.post('/webhooks', async (c) => {
  const input = await body(c, hookInput);
  const id = newId('whk');
  const secret = `whsec_${randomToken(24)}`;
  const at = nowIso();
  db().prepare('INSERT INTO webhooks (id, name, url, secret, event_types, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, input.name, input.url, secret, JSON.stringify(input.event_types), input.active ? 1 : 0, at, at);
  audit(c.get('actor'), 'webhook.created', 'webhook', id, null, { name: input.name, url: input.url });
  return c.json({ data: shapeHook(db().prepare('SELECT * FROM webhooks WHERE id = ?').get(id), true) }, 201); // secret hiện 1 lần
});
r.patch('/webhooks/:id', async (c) => {
  const id = c.req.param('id');
  const h = db().prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  if (!h) throw notFound('Webhook');
  const input = await body(c, patchOf(hookInput));
  const m = { name: input.name ?? h.name, url: input.url ?? h.url, event_types: JSON.stringify(input.event_types ?? JSON.parse(h.event_types)), active: input.active === undefined ? h.active : input.active ? 1 : 0 };
  db().prepare('UPDATE webhooks SET name=?, url=?, event_types=?, active=?, updated_at=? WHERE id=?').run(m.name, m.url, m.event_types, m.active, nowIso(), id);
  return c.json({ data: shapeHook(db().prepare('SELECT * FROM webhooks WHERE id = ?').get(id)) });
});
r.delete('/webhooks/:id', (c) => {
  // Không xoá cứng: tắt đi, giữ log gửi
  const id = c.req.param('id');
  if (!db().prepare('SELECT 1 FROM webhooks WHERE id = ?').get(id)) throw notFound('Webhook');
  db().prepare('UPDATE webhooks SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
  return c.json({ data: { id, active: false } });
});
r.get('/webhooks/:id/deliveries', (c) => {
  const q = query(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), status: z.string().optional() }));
  const rows = db()
    .prepare(
      `SELECT d.*, e.type AS event_type FROM webhook_deliveries d JOIN events e ON e.id = d.event_id
       WHERE d.webhook_id = ? ${q.status ? 'AND d.status = ?' : ''} ORDER BY d.id DESC LIMIT ?`,
    )
    .all(...(q.status ? [c.req.param('id'), q.status, q.limit] : [c.req.param('id'), q.limit]));
  return c.json({ data: rows });
});
/** Gửi lại ngay một lượt (kể cả đã chết) */
r.post('/webhook-deliveries/:id/retry', async (c) => {
  const d = db().prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(c.req.param('id'));
  if (!d) throw notFound('Lượt gửi');
  return c.json({ data: await deliver(d) });
});
r.post('/webhooks/process', async (c) => c.json({ data: await processDue() }));

// ---------- Sự kiện (cho hệ thống ngoài kéo về thay vì chờ webhook) ----------
r.get('/events', (c) => {
  const q = query(c, z.object({ type: z.string().optional(), shop_id: z.string().optional(), after: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }));
  const where = [];
  const params = [];
  if (q.type) (where.push('type = ?'), params.push(q.type));
  if (q.shop_id) (where.push('shop_id = ?'), params.push(q.shop_id));
  if (q.after) (where.push('id > ?'), params.push(q.after));
  const rows = db().prepare(`SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id LIMIT ?`).all(...params, q.limit);
  return c.json({ data: rows.map((e) => ({ ...e, payload: JSON.parse(e.payload) })), next_after: rows.length ? rows[rows.length - 1].id : q.after ?? null });
});

// ---------- Sao lưu & xuất dữ liệu ----------
r.get('/backups', (c) => c.json({ data: listBackups() }));
r.post('/backups', async (c) => {
  const b = await runBackup();
  return c.json({ data: { name: b.name, size: b.size, pruned: b.pruned } }, 201);
});
r.get('/backups/:name', (c) => {
  const name = c.req.param('name');
  if (!listBackups().some((b) => b.name === name)) throw notFound('Bản sao lưu'); // chỉ cho tải tên có trong danh sách → chặn path traversal
  const buf = fs.readFileSync(path.join(backupDir(), name));
  return new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` } });
});
/** Tải bản sao lưu mới ngay lúc bấm (không phụ thuộc bản tự động) */
r.get('/backup/download', async (c) => {
  const b = await runBackup();
  return new Response(fs.readFileSync(b.file), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${b.name}"` } });
});
r.get('/export', (c) => c.json({ data: Object.keys(EXPORTS) }));
r.get('/export/:table', (c) => {
  const t = c.req.param('table').replace(/\.csv$/, '');
  const csv = toCsv(t);
  if (csv === null) throw badRequest('UNKNOWN_EXPORT', `Không có bảng xuất "${t}"`, { available: Object.keys(EXPORTS) });
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="moso-${t}.csv"` } });
});

export default r;
