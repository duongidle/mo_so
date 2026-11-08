import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { query } from '../../lib/http.js';

const r = new Hono();
const TYPES = ['order', 'purchase', 'return', 'write_off', 'transfer', 'adjustment', 'count'];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Danh sách chứng từ gộp: đơn bán, phiếu nhập, phiếu trả hàng, phiếu hàng huỷ, chuyển kho, điều chỉnh, kiểm kê.
 * Mỗi dòng: loại, mã, ngày (giờ VN), shop (nếu có), kho, số tiền, trạng thái. Chuyển kho/điều chỉnh/kiểm kê thuộc kho nên khi lọc shop
 * lấy theo các kho của shop đó.
 */
r.get('/documents', (c) => {
  const q = query(c, z.object({ type: z.enum(TYPES).optional(), q: z.string().trim().max(80).optional(), from: date.optional(), to: date.optional(), shop_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }));
  const day = (col) => `date(${col}, '+7 hours')`;
  const sel = (type, id, code, date, at, shop, wh, amount, status, orderId, from) =>
    `SELECT '${type}' AS type, ${id} AS id, ${code} AS code, ${date} AS date, ${at} AS at, ${shop} AS shop_id, ${wh} AS warehouse_id, ${amount} AS amount, ${status} AS status, ${orderId} AS order_id FROM ${from}`;
  const parts = [
    { type: 'order', sql: sel('order', 'o.id', 'o.code', day('o.created_at'), 'o.created_at', 'o.shop_id', 'o.warehouse_id', 'o.total_amount', 'o.status', 'o.id', 'orders o'), shop: 'o.shop_id', d: day('o.created_at'), alias: 'o' },
    { type: 'purchase', sql: sel('purchase', 'p.id', 'p.code', day('p.ordered_at'), 'p.ordered_at', 'p.shop_id', 'p.warehouse_id', 'p.total_amount', 'p.status', 'NULL', 'purchases p'), shop: 'p.shop_id', d: day('p.ordered_at'), alias: 'p' },
    { type: 'return', sql: sel('return', 't.id', 't.code', 't.business_date', 't.returned_at', 't.shop_id', 'o.warehouse_id', 't.goods_amount', "CASE WHEN t.goods_received_at IS NULL THEN 'awaiting' ELSE 'done' END", 't.order_id', 'order_returns t JOIN orders o ON o.id = t.order_id'), shop: 't.shop_id', d: 't.business_date', alias: 't' },
    { type: 'write_off', sql: sel('write_off', 'w.id', 'w.code', 'w.business_date', 'w.created_at', 'w.shop_id', 'w.warehouse_id', 'w.total_cost', "'done'", 'w.order_id', 'return_write_offs w'), shop: 'w.shop_id', d: 'w.business_date', alias: 'w' },
    { type: 'transfer', sql: sel('transfer', 'x.id', 'x.code', day('x.created_at'), 'x.created_at', 'NULL', 'x.from_warehouse_id', 'NULL', "'done'", 'NULL', 'stock_transfers x'), wh: 'x.from_warehouse_id', wh2: 'x.to_warehouse_id', d: day('x.created_at'), alias: 'x' },
    { type: 'adjustment', sql: sel('adjustment', 'a.id', 'a.code', day('a.created_at'), 'a.created_at', 'NULL', 'a.warehouse_id', 'NULL', 'a.kind', 'NULL', 'stock_adjustments a'), wh: 'a.warehouse_id', d: day('a.created_at'), alias: 'a' },
    { type: 'count', sql: sel('count', 'k.id', 'k.code', day('k.created_at'), 'k.created_at', 'NULL', 'k.warehouse_id', 'NULL', 'k.status', 'NULL', 'stock_counts k'), wh: 'k.warehouse_id', d: day('k.created_at'), alias: 'k' },
  ].filter((p) => !q.type || p.type === q.type);
  const params = [];
  const selects = parts.map((p) => {
    const where = [];
    if (q.from) { where.push(`${p.d} >= ?`); params.push(q.from); }
    if (q.to) { where.push(`${p.d} <= ?`); params.push(q.to); }
    if (q.q) { where.push(`${p.alias}.code LIKE ?`); params.push(`%${q.q}%`); }
    if (q.shop_id) {
      const ids = q.shop_id.split(',');
      const ph = ids.map(() => '?').join(',');
      if (p.shop) { where.push(`${p.shop} IN (${ph})`); params.push(...ids); }
      else {
        const cond = [p.wh, p.wh2].filter(Boolean).map((w) => `${w} IN (SELECT warehouse_id FROM shop_warehouses WHERE shop_id IN (${ph}))`).join(' OR ');
        where.push(`(${cond})`);
        for (const _ of [p.wh, p.wh2].filter(Boolean)) params.push(...ids);
      }
    }
    return `${p.sql}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  });
  const db = getDb();
  const union = selects.join(' UNION ALL ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get(...params).n;
  const rows = db
    .prepare(`SELECT u.*, s.name AS shop_name, w.name AS warehouse_name FROM (${union}) u LEFT JOIN shops s ON s.id = u.shop_id LEFT JOIN warehouses w ON w.id = u.warehouse_id ORDER BY u.at DESC, u.code DESC LIMIT ? OFFSET ?`)
    .all(...params, q.limit, q.offset);
  return c.json({ data: rows, total, has_more: q.offset + rows.length < total });
});

export default r;
