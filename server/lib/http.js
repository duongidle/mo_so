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

/**
 * Schema dùng cho PATCH: mọi trường đều tuỳ chọn và trường vắng mặt thì KHÔNG có giá trị.
 * Không dùng `.partial()` trực tiếp: trong zod 4 nó vẫn áp giá trị mặc định (`.default(0)`) cho trường vắng,
 * nên sửa một ô sẽ âm thầm đặt phí ship, phí sàn, đơn vị… về mặc định.
 */
export function patchOf(schema) {
  const shape = {};
  for (const [k, f] of Object.entries(schema.shape)) shape[k] = (f instanceof z.ZodDefault ? f.unwrap() : f).optional();
  return z.object(shape);
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
// Quantities use the item's base unit; allow up to 3 decimals (e.g. 0.5 m).
const validQty = (n) => Number.isFinite(n) && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7;
export const qty = z.coerce.number().positive().refine(validQty, 'Số lượng tối đa 3 chữ số thập phân');
export const stockQty = z.coerce.number().nonnegative().refine(validQty, 'Số lượng tối đa 3 chữ số thập phân');
export const signedQty = z.coerce.number().refine(validQty, 'Số lượng tối đa 3 chữ số thập phân');
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
