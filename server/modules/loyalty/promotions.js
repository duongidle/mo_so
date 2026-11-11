import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { allocate, lineAmount } from '../../lib/money.js';
import { categoryClause } from '../../lib/categories.js';
import { customerLoyalty } from './service.js';

const db = () => getDb();
const J = (v) => (v ? JSON.stringify(v) : null);
const P = (v) => (v ? JSON.parse(v) : null);
export const KINDS = {
  order_percent: 'Giảm % trên đơn',
  order_amount: 'Giảm số tiền trên đơn',
  item_percent: 'Giảm % theo sản phẩm',
  buy_x_get_y: 'Mua X tặng Y',
  tier_percent: 'Ưu đãi theo hạng khách',
  gift: 'Tặng quà kèm',
};

const hydrate = (r) => r && ({ ...r, variant_ids: P(r.variant_ids), category_ids: P(r.category_ids), shop_ids: P(r.shop_ids), channel_ids: P(r.channel_ids), stackable: !!r.stackable, active: !!r.active });

function validate(input) {
  if (!KINDS[input.kind]) throw badRequest('INVALID_KIND', 'Loại khuyến mãi không hợp lệ');
  if (['order_percent', 'item_percent'].includes(input.kind) && !(input.value > 0 && input.value <= 100)) throw badRequest('INVALID_VALUE', 'Phần trăm giảm phải từ 1 tới 100');
  if (input.kind === 'order_amount' && !(input.value > 0)) throw badRequest('INVALID_VALUE', 'Số tiền giảm phải lớn hơn 0');
  if (input.kind === 'buy_x_get_y' && !(input.buy_qty >= 1 && input.free_qty >= 1)) throw badRequest('INVALID_VALUE', 'Mua X tặng Y: X và Y phải từ 1 trở lên');
  if (input.kind === 'item_percent' && !input.variant_ids?.length && !input.category_ids?.length) throw badRequest('SCOPE_REQUIRED', 'Giảm theo sản phẩm cần chọn sản phẩm hoặc danh mục');
  if (input.kind === 'buy_x_get_y' && !input.variant_ids?.length && !input.category_ids?.length) throw badRequest('SCOPE_REQUIRED', 'Mua X tặng Y cần chọn sản phẩm hoặc danh mục áp dụng');
  if (input.kind === 'gift') {
    if (!input.gift_variant_id) throw badRequest('GIFT_REQUIRED', 'Chọn sản phẩm làm quà tặng');
    const g = db().prepare("SELECT v.kind, p.item_type FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.archived_at IS NULL").get(input.gift_variant_id);
    if (!g) throw badRequest('GIFT_NOT_FOUND', 'Sản phẩm quà tặng không tồn tại hoặc đã ngừng kinh doanh');
    if (g.item_type !== 'product') throw badRequest('GIFT_NOT_SELLABLE', 'Quà tặng phải là sản phẩm bán được, không phải vật tư kho');
    if (!(input.gift_qty >= 1)) throw badRequest('INVALID_VALUE', 'Số lượng quà tặng phải từ 1 trở lên');
    if (!(input.min_subtotal > 0) && !input.variant_ids?.length && !input.category_ids?.length) throw badRequest('CONDITION_REQUIRED', 'Quà tặng cần có điều kiện: đơn tối thiểu hoặc sản phẩm/danh mục phải mua, nếu không đơn nào cũng được tặng');
  }
  if (input.starts_on && input.ends_on && input.starts_on > input.ends_on) throw badRequest('INVALID_DATES', 'Ngày bắt đầu phải trước ngày kết thúc');
}

const cols = (i) => [i.name.trim(), i.kind, i.code ? i.code.trim().toUpperCase() : null, i.value ?? 0, i.buy_qty ?? null, i.free_qty ?? null, i.min_subtotal ?? 0, i.max_discount ?? null, J(i.variant_ids?.length ? i.variant_ids : null), J(i.category_ids?.length ? i.category_ids : null), J(i.shop_ids?.length ? i.shop_ids : null), J(i.channel_ids?.length ? i.channel_ids : null), i.starts_on ?? null, i.ends_on ?? null, i.usage_limit ?? null, i.per_customer_limit ?? null, i.stackable ? 1 : 0, i.active === false ? 0 : 1, i.kind === 'gift' ? i.gift_variant_id : null, i.kind === 'gift' ? i.gift_qty : null];

export function savePromotion(id, input, actor) {
  validate(input);
  const code = input.code ? input.code.trim().toUpperCase() : null;
  if (code && db().prepare('SELECT 1 FROM promotions WHERE code = ? AND archived_at IS NULL AND id != ?').get(code, id ?? '')) throw badRequest('DUPLICATE_CODE', `Mã ${code} đã dùng cho khuyến mãi khác`);
  const at = nowIso();
  if (!id) {
    id = newId('prm');
    db().prepare('INSERT INTO promotions (id, name, kind, code, value, buy_qty, free_qty, min_subtotal, max_discount, variant_ids, category_ids, shop_ids, channel_ids, starts_on, ends_on, usage_limit, per_customer_limit, stackable, active, gift_variant_id, gift_qty, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, ...cols({ ...input, code }), at, at);
    audit(actor, 'promotion.created', 'promotion', id, null, input);
  } else {
    if (!db().prepare('SELECT 1 FROM promotions WHERE id = ?').get(id)) throw notFound('Khuyến mãi');
    db().prepare('UPDATE promotions SET name=?, kind=?, code=?, value=?, buy_qty=?, free_qty=?, min_subtotal=?, max_discount=?, variant_ids=?, category_ids=?, shop_ids=?, channel_ids=?, starts_on=?, ends_on=?, usage_limit=?, per_customer_limit=?, stackable=?, active=?, gift_variant_id=?, gift_qty=?, updated_at=? WHERE id=?')
      .run(...cols({ ...input, code }), at, id);
    audit(actor, 'promotion.updated', 'promotion', id, null, input);
  }
  return getPromotion(id);
}

export function archivePromotion(id, actor) {
  if (!db().prepare('SELECT 1 FROM promotions WHERE id = ?').get(id)) throw notFound('Khuyến mãi');
  db().prepare('UPDATE promotions SET archived_at = ?, active = 0, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  audit(actor, 'promotion.archived', 'promotion', id);
  return getPromotion(id);
}

const STATS = `(SELECT COUNT(*) FROM promotion_uses u JOIN orders o ON o.id = u.order_id WHERE u.promotion_id = p.id AND o.status != 'cancelled') AS uses,
  (SELECT COALESCE(SUM(u.amount),0) FROM promotion_uses u JOIN orders o ON o.id = u.order_id WHERE u.promotion_id = p.id AND o.status != 'cancelled') AS discount_given,
  (SELECT COALESCE(SUM(o.net_revenue),0) FROM promotion_uses u JOIN orders o ON o.id = u.order_id WHERE u.promotion_id = p.id AND o.status != 'cancelled') AS revenue`;

export const getPromotion = (id) => hydrate(db().prepare(`SELECT p.*, ${STATS} FROM promotions p WHERE p.id = ?`).get(id));
export const listPromotions = ({ includeArchived = false } = {}) =>
  db().prepare(`SELECT p.*, ${STATS} FROM promotions p ${includeArchived ? '' : 'WHERE p.archived_at IS NULL'} ORDER BY p.active DESC, p.created_at DESC`).all().map(hydrate);

// ---------- Tính khuyến mãi cho một giỏ hàng ----------
const gross = (l) => lineAmount(l.qty, l.unit_price);
const inScope = (p, l, catVariants) => (!p.variant_ids && !p.category_ids) || p.variant_ids?.includes(l.variant_id) || (p.category_ids && catVariants.get(p)?.has(l.variant_id));

function usageOf(promoId, customerId) {
  const base = "FROM promotion_uses u JOIN orders o ON o.id = u.order_id WHERE u.promotion_id = ? AND o.status != 'cancelled'";
  const total = db().prepare(`SELECT COUNT(*) AS n ${base}`).get(promoId).n;
  const mine = customerId ? db().prepare(`SELECT COUNT(*) AS n ${base} AND u.customer_id = ?`).get(promoId, customerId).n : 0;
  return { total, mine };
}

/** Giảm giá của MỘT khuyến mãi trên giỏ `lines` (đã trừ phần khuyến mãi khác ở `lineDisc`). Trả về { line: số giảm từng dòng, order: giảm cả đơn }. */
function compute(p, lines, lineDisc, ctx) {
  const line = lines.map(() => 0);
  let order = 0;
  const net = (i) => gross(lines[i]) - lineDisc[i] - line[i];
  if (p.kind === 'item_percent') {
    lines.forEach((l, i) => { if (inScope(p, l, ctx.cat)) line[i] = Math.round((net(i) * p.value) / 100); });
  } else if (p.kind === 'buy_x_get_y') {
    lines.forEach((l, i) => {
      if (!inScope(p, l, ctx.cat)) return;
      const sets = Math.floor(l.qty / (p.buy_qty + p.free_qty));
      line[i] = Math.min(net(i), sets * p.free_qty * l.unit_price);
    });
  } else {
    const base = lines.reduce((a, l, i) => a + (inScope(p, l, ctx.cat) ? net(i) : 0), 0);
    if (p.kind === 'order_percent') order = Math.round((base * p.value) / 100);
    else if (p.kind === 'order_amount') order = Math.min(p.value, base);
    else if (p.kind === 'tier_percent') order = Math.round((base * (ctx.tierPct || 0)) / 100);
  }
  const total = line.reduce((a, b) => a + b, 0) + order;
  if (p.max_discount != null && total > p.max_discount) {
    // Trần giảm: co đều các phần theo tỷ lệ
    const parts = allocate(p.max_discount, [...line, order].map((x) => x || 0));
    return { line: parts.slice(0, line.length), order: parts[line.length] };
  }
  return { line, order };
}

/**
 * Xem khuyến mãi nào áp dụng cho giỏ hàng và giảm bao nhiêu. Không ghi gì.
 * input: { shop_id, channel_id, customer_id?, code?, lines: [{ variant_id, qty, unit_price, discount_amount? }] }
 * Khuyến mãi không cộng dồn (stackable = 0): chọn cái giảm nhiều nhất. Khuyến mãi cộng dồn: áp thêm lần lượt.
 */
export function evaluate(input) {
  const today = businessDate(nowIso());
  const code = input.code ? String(input.code).trim().toUpperCase() : null;
  const lines = input.lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty, unit_price: l.unit_price, discount: l.discount_amount ?? 0 }));
  const subtotal = lines.reduce((a, l) => a + gross(l) - l.discount, 0);
  const rejected = [];
  let codeStatus = null;
  const eligible = [];
  const all = db().prepare('SELECT * FROM promotions WHERE archived_at IS NULL AND active = 1').all().map(hydrate);
  if (code && !all.some((p) => p.code === code)) codeStatus = { ok: false, reason: 'Mã khuyến mãi không tồn tại hoặc đã tắt' };
  const tierPct = input.customer_id ? customerLoyalty(input.customer_id).tier?.discount_pct ?? 0 : 0;
  const cat = new Map();
  for (const p of all) {
    const why = (reason) => { rejected.push({ id: p.id, name: p.name, code: p.code, reason }); if (code && p.code === code) codeStatus = { ok: false, reason }; };
    if (p.code && p.code !== code) continue; // mã voucher chỉ áp khi khách nhập đúng mã
    if (p.starts_on && today < p.starts_on) { why(`Chưa tới ngày bắt đầu (${p.starts_on})`); continue; }
    if (p.ends_on && today > p.ends_on) { why(`Đã hết hạn (${p.ends_on})`); continue; }
    if (p.shop_ids && !p.shop_ids.includes(input.shop_id)) { why('Không áp dụng cho shop này'); continue; }
    if (p.channel_ids && !p.channel_ids.includes(input.channel_id)) { why('Không áp dụng cho kênh này'); continue; }
    if (p.kind === 'tier_percent' && !tierPct) { why('Khách chưa có hạng được ưu đãi'); continue; }
    if (subtotal < p.min_subtotal) { why(`Đơn chưa đạt tối thiểu ${p.min_subtotal}`); continue; }
    const u = usageOf(p.id, input.customer_id);
    if (p.usage_limit != null && u.total >= p.usage_limit) { why('Đã hết lượt sử dụng'); continue; }
    if (p.per_customer_limit != null && input.customer_id && u.mine >= p.per_customer_limit) { why('Khách đã dùng hết số lần cho phép'); continue; }
    if (p.category_ids) {
      const ids = new Set();
      for (const cid of p.category_ids) {
        const cl = categoryClause(cid, 'p2.category_id');
        for (const r of db().prepare(`SELECT v.id FROM variants v JOIN products p2 ON p2.id = v.product_id WHERE ${cl.sql}`).all(...cl.params)) ids.add(r.id);
      }
      cat.set(p, ids);
    }
    eligible.push(p);
  }
  const ctx = { cat, tierPct };
  const zero = lines.map(() => 0);
  const applied = [];
  const lineDisc = lines.map((l) => l.discount);
  let orderDisc = 0;
  const apply = (p, r) => {
    r.line.forEach((x, i) => { lineDisc[i] += x; });
    orderDisc += r.order;
    applied.push({ id: p.id, name: p.name, code: p.code, kind: p.kind, amount: r.line.reduce((a, b) => a + b, 0) + r.order, line_discounts: r.line, order_discount: r.order });
  };
  // Quà tặng luôn cộng thêm (không loại trừ nhau): đủ điều kiện và còn hàng thì tặng
  const gifts = [];
  for (const p of eligible.filter((x) => x.kind === 'gift')) {
    const inScopeQty = lines.reduce((a, l) => a + (inScope(p, l, ctx.cat) ? l.qty : 0), 0);
    if ((p.variant_ids || p.category_ids) && inScopeQty < (p.buy_qty || 1)) { rejected.push({ id: p.id, name: p.name, code: p.code, reason: `Cần mua tối thiểu ${p.buy_qty || 1} sản phẩm thuộc chương trình` }); continue; }
    const g = db().prepare('SELECT v.id, v.sku, v.name AS vname, p.name AS pname, COALESCE(l.price, v.default_price) AS price FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN shop_listings l ON l.variant_id = v.id AND l.shop_id = ? WHERE v.id = ? AND v.archived_at IS NULL').get(input.shop_id, p.gift_variant_id);
    if (!g) { rejected.push({ id: p.id, name: p.name, code: p.code, reason: 'Sản phẩm quà tặng không còn bán' }); continue; }
    const wh = db().prepare('SELECT warehouse_id FROM shop_warehouses WHERE shop_id = ?').all(input.shop_id).map((x) => x.warehouse_id);
    const have = wh.length ? db().prepare(`SELECT COALESCE(SUM(on_hand),0) AS n FROM stock_levels WHERE variant_id = ? AND warehouse_id IN (${wh.map(() => '?').join(',')})`).get(g.id, ...wh).n : 0;
    // Các quà cùng sản phẩm trong cùng đơn cũng trừ vào số còn lại
    const already = gifts.filter((x) => x.variant_id === g.id).reduce((a, x) => a + x.qty, 0);
    const inCart = lines.filter((l) => l.variant_id === g.id).reduce((a, l) => a + l.qty, 0);
    if (have - already - inCart < p.gift_qty) { rejected.push({ id: p.id, name: p.name, code: p.code, reason: `Quà tặng ${g.sku} đã hết hàng` }); continue; }
    gifts.push({ promotion_id: p.id, name: p.name, variant_id: g.id, sku: g.sku, product_name: [g.pname, g.vname].filter(Boolean).join(' – '), qty: p.gift_qty, value: g.price * p.gift_qty });
    applied.push({ id: p.id, name: p.name, code: p.code, kind: 'gift', amount: 0, gift_value: g.price * p.gift_qty, line_discounts: lines.map(() => 0), order_discount: 0 });
  }
  // Một khuyến mãi không cộng dồn tốt nhất (nếu có), sau đó các khuyến mãi cộng dồn
  const solo = eligible.filter((p) => !p.stackable && p.kind !== 'gift').map((p) => ({ p, r: compute(p, lines, lines.map((l) => l.discount), ctx) })).filter((x) => x.r.line.some((v) => v > 0) || x.r.order > 0);
  solo.sort((a, b) => (b.r.line.reduce((s, v) => s + v, 0) + b.r.order) - (a.r.line.reduce((s, v) => s + v, 0) + a.r.order));
  if (solo[0]) apply(solo[0].p, solo[0].r);
  for (const x of solo.slice(1)) rejected.push({ id: x.p.id, name: x.p.name, code: x.p.code, reason: 'Không cộng dồn, đã chọn khuyến mãi giảm nhiều hơn' });
  for (const p of eligible.filter((p) => p.stackable && p.kind !== 'gift')) {
    const r = compute(p, lines, lineDisc, ctx);
    if (r.line.some((v) => v > 0) || r.order > 0) apply(p, r);
  }
  if (code && !codeStatus) codeStatus = applied.some((a) => a.code === code) ? { ok: true } : { ok: false, reason: rejected.find((x) => x.code === code)?.reason ?? 'Mã chưa áp dụng được cho giỏ hàng này' };
  const lineTotal = zero.map((_, i) => lineDisc[i] - lines[i].discount);
  const total = applied.reduce((a, x) => a + x.amount, 0);
  return { applied, gifts, rejected, code_status: codeStatus, line_discounts: lineTotal, order_discount: orderDisc, total_discount: total };
}

export function recordUses(orderId, customerId, applied) {
  const ins = db().prepare('INSERT INTO promotion_uses (id, promotion_id, order_id, customer_id, amount, created_at) VALUES (?,?,?,?,?,?)');
  for (const a of applied) ins.run(newId('pru'), a.id, orderId, customerId ?? null, a.kind === 'gift' ? a.gift_value : a.amount, nowIso());
}
