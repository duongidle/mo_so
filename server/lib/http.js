import { z } from 'zod';
import { getDb } from '../db/index.js';
import { nowIso } from './time.js';

/** Đọc body JSON và kiểm tra theo schema zod */
export async function body(c, schema) {
  let data;
  try {
    data = await c.req.json();
  } catch {
    data = {};
  }
  return schema.parse(data);
}

export function query(c, schema) {
  return schema.parse(c.req.query());
}

/** Phân trang con trỏ dựa trên id (ULID tăng dần theo thời gian) — lấy mới nhất trước */
export const pageSchema = {
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
};

export function paginate(rows, limit) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

// Kiểu dữ liệu dùng lại
export const money = z.coerce.number().int().min(0);
export const signedMoney = z.coerce.number().int();
export const qty = z.coerce.number().int().positive();
export const optionalText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v === '' ? null : v ?? null));

/**
 * Chống tạo trùng qua API: nếu client gửi Idempotency-Key đã dùng, trả lại kết quả cũ.
 */
export function idempotent(handler) {
  return async (c) => {
    const key = c.req.header('idempotency-key');
    if (!key) return handler(c);
    const db = getDb();
    const route = `${c.req.method} ${c.req.path}`;
    const hit = db.prepare('SELECT * FROM idempotency_keys WHERE key = ? AND route = ?').get(key, route);
    if (hit) return c.json(JSON.parse(hit.response), hit.status);
    const res = await handler(c);
    if (res.status < 500) {
      const text = await res.clone().text();
      db.prepare('INSERT OR IGNORE INTO idempotency_keys (key, route, response, status, created_at) VALUES (?,?,?,?,?)').run(
        key,
        route,
        text,
        res.status,
        nowIso(),
      );
    }
    return res;
  };
}
