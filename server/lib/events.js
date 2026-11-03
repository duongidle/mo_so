import { getDb } from '../db/index.js';
import { newId } from './id.js';
import { nowIso } from './time.js';

/**
 * Ghi một sự kiện nghiệp vụ và tạo lượt gửi cho các webhook đăng ký.
 * Gọi bên trong transaction của nghiệp vụ để sự kiện và dữ liệu luôn khớp nhau.
 */
export function emit(type, { entityType, entityId, shopId = null, data = {} }) {
  const db = getDb();
  const id = newId('evt');
  const at = nowIso();
  db.prepare(
    'INSERT INTO events (id, type, entity_type, entity_id, shop_id, payload, created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(id, type, entityType, entityId, shopId, JSON.stringify(data), at);

  const hooks = db.prepare('SELECT id, event_types FROM webhooks WHERE active = 1').all();
  const insert = db.prepare(
    `INSERT INTO webhook_deliveries (id, webhook_id, event_id, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?,?,?,'pending',0,?,?,?)`,
  );
  for (const h of hooks) {
    const types = JSON.parse(h.event_types);
    if (types.includes('*') || types.includes(type) || types.includes(type.split('.')[0] + '.*')) {
      insert.run(newId('whd'), h.id, id, at, at, at);
    }
  }
  return id;
}

/** Ghi nhật ký thay đổi */
export function audit(actor, action, entityType, entityId, before = null, after = null) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, before, after, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId('aud'),
      actor?.type || 'system',
      actor?.id || null,
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      nowIso(),
    );
}
