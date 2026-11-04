import { getDb } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';

const db = () => getDb();

// Đơn tính vào doanh thu: đã xác nhận trở đi (kể cả đã trả toàn phần, khi đó net_revenue = 0 nhưng vẫn là một đơn đã bán)
export const COUNTED = `('confirmed','shipping','completed','returned')`;

const COLS = ['order_count', 'cancelled_count', 'returned_count', 'subtotal', 'discount_amount', 'goods_revenue', 'returned_amount', 'net_revenue', 'shipping_fee', 'platform_fee', 'seller_shipping', 'cogs', 'return_fee', 'return_shipping_cost'];

/**
 * Tổng hợp từ bảng đơn (nguồn sự thật). Quy ước cột trả hàng: returned_amount = tiền HÀNG đã trả; shipping_fee = phí ship khách trả SAU khi trừ ship hoàn;
 * return_fee (phí trả hàng thu được, = 5118) và return_shipping_cost (ship chiều về, phần của 6412) là hai cột riêng.
 * Dùng để dựng bảng đệm và để kiểm tra bảng đệm. Phải có bí danh `o` cho orders. */
export const AGG_SQL = `
  COUNT(CASE WHEN o.status IN ${COUNTED} THEN 1 END) AS order_count,
  COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) AS cancelled_count,
  COUNT(CASE WHEN o.status IN ${COUNTED} AND o.returned_goods_amount > 0 THEN 1 END) AS returned_count,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.subtotal END),0) AS subtotal,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.line_discount_amount + o.discount_amount END),0) AS discount_amount,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.goods_revenue END),0) AS goods_revenue,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.returned_goods_amount END),0) AS returned_amount,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.net_revenue END),0) AS net_revenue,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.shipping_fee - o.returned_shipping_amount END),0) AS shipping_fee,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.platform_fee_amount END),0) AS platform_fee,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.seller_shipping_amount END),0) AS seller_shipping,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.cogs_amount END),0) AS cogs,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.return_fee_amount END),0) AS return_fee,
  COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.return_shipping_cost END),0) AS return_shipping_cost`;

/** Tính lại các ô "bẩn" (đã có thay đổi đơn từ lần tính trước). Rẻ khi không có gì bẩn. */
export function flushStats() {
  const dirty = db().prepare('SELECT business_date, shop_id, channel_id FROM daily_stats_dirty').all();
  if (!dirty.length) return 0;
  const del = db().prepare('DELETE FROM daily_stats WHERE business_date = ? AND shop_id = ? AND channel_id = ?');
  const ins = db().prepare(
    `INSERT INTO daily_stats (business_date, shop_id, channel_id, ${COLS.join(', ')}, updated_at)
     SELECT o.business_date, o.shop_id, o.channel_id, ${AGG_SQL}, ?
     FROM orders o WHERE o.business_date = ? AND o.shop_id = ? AND o.channel_id = ? AND o.status != 'draft'
     GROUP BY o.business_date, o.shop_id, o.channel_id`,
  );
  db().transaction(() => {
    const at = nowIso();
    for (const d of dirty) {
      del.run(d.business_date, d.shop_id, d.channel_id);
      ins.run(at, d.business_date, d.shop_id, d.channel_id);
    }
    db().prepare('DELETE FROM daily_stats_dirty').run();
  })();
  return dirty.length;
}

const GROUPS = { shop: 'shop_id', channel: 'channel_id', shop_channel: "shop_id || '|' || channel_id", date: 'business_date' };

/**
 * Đọc tổng hợp theo bộ lọc từ bảng đệm. groupBy: null | 'shop' | 'channel' | 'shop_channel' | 'date'.
 * Có groupBy thì mỗi dòng có khoá `k`.
 */
export function readStats(f, groupBy = null) {
  flushStats();
  const where = ['business_date >= ?', 'business_date <= ?'];
  const params = [f.from, f.to];
  if (f.shopIds) (where.push(`shop_id IN (${f.shopIds.map(() => '?').join(',')})`), params.push(...f.shopIds));
  if (f.channel) (where.push('channel_id = ?'), params.push(f.channel));
  const sums = COLS.map((c) => `COALESCE(SUM(${c}),0) AS ${c}`).join(', ');
  const g = groupBy ? GROUPS[groupBy] : null;
  const rows = db()
    .prepare(`SELECT ${g ? `${g} AS k, ` : ''}${sums} FROM daily_stats WHERE ${where.join(' AND ')} ${g ? 'GROUP BY k ORDER BY k' : ''}`)
    .all(...params);
  return g ? rows : rows[0];
}

/** So bảng đệm với tính thẳng từ bảng đơn. Trả danh sách ô lệch (rỗng = khớp hoàn toàn). */
export function verifyStats() {
  flushStats();
  const truth = db()
    .prepare(`SELECT o.business_date, o.shop_id, o.channel_id, ${AGG_SQL} FROM orders o WHERE o.status != 'draft' GROUP BY o.business_date, o.shop_id, o.channel_id`)
    .all();
  const cached = db().prepare('SELECT * FROM daily_stats').all();
  const key = (r) => `${r.business_date}|${r.shop_id}|${r.channel_id}`;
  const cm = new Map(cached.map((r) => [key(r), r]));
  const bad = [];
  for (const t of truth) {
    const c = cm.get(key(t));
    cm.delete(key(t));
    const diff = COLS.filter((k) => !c || c[k] !== t[k]);
    if (diff.length) bad.push({ key: key(t), columns: diff, expected: Object.fromEntries(diff.map((k) => [k, t[k]])), cached: c ? Object.fromEntries(diff.map((k) => [k, c[k]])) : null });
  }
  for (const [k] of cm) bad.push({ key: k, columns: ['*'], expected: null, cached: 'ô thừa, không còn đơn nào' });
  return bad;
}

/** Dựng lại toàn bộ bảng đệm từ bảng đơn (sửa chữa; bình thường không cần) */
export function rebuildStats() {
  db().transaction(() => {
    db().prepare('DELETE FROM daily_stats').run();
    db().prepare('DELETE FROM daily_stats_dirty').run();
    db().prepare(`INSERT OR IGNORE INTO daily_stats_dirty SELECT DISTINCT business_date, shop_id, channel_id FROM orders`).run();
  })();
  return flushStats();
}
