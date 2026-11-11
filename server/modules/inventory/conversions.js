import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { allocate, lineAmount, qty3 } from '../../lib/money.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, emit } from '../../lib/events.js';
import { runningCode } from '../../lib/codes.js';
import { assertUnlocked } from '../../lib/period.js';
import { applyMovement } from './service.js';
import { costingMethod } from './costing.js';
import { addLot } from './lots.js';
import { getPackagingSpec } from './materials.js';

/**
 * Phiếu đóng gói / chuyển đổi hàng (DG-…), một transaction:
 *  - XUẤT các dòng nguồn (hàng bán, bao bì, vật tư; số lẻ được; chọn lô hoặc FEFO) bằng biến động `transfer_out` (ref_type 'conversion');
 *  - NHẬP các dòng thành phẩm bằng `transfer_in`. Cùng loại với chuyển kho nên KHÔNG có bút toán: 156 chỉ chuyển từ mã này sang mã khác, không lãi lỗ.
 *
 * Giá vốn: T = Σ giá trị các biến động xuất thật (bình quân, hoặc từng lớp FIFO). T chia cho các thành phẩm bằng allocate() theo trọng số
 * (người dùng nhập; mặc định SL × hệ số "đóng từ" nếu mọi thành phẩm có, không thì SL × giá bán, không thì SL). Σ phần = T đúng từng đồng.
 * Đơn giá nhập phải là số nguyên: phần A của một thành phẩm SL M (nguyên) ghi thành HAI biến động: (M − r) cái ở floor(A/M) và r cái ở floor(A/M)+1,
 * với r = A − M × floor(A/M). Khi đó Σ SL × đơn giá = A đúng, không sinh/mất đồng nào (không cần "dòng dư" làm tròn).
 * Hao hụt khi đóng (20 kg ra 39 hộp thay vì 40) nằm sẵn trong giá vốn hộp vì T chia cho 39 hộp.
 */
const db = () => getDb();
const parse = (s, d = []) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};

const VARIANT_SQL = `SELECT v.id, v.sku, v.name AS variant_name, v.kind, v.default_price, v.archived_at AS v_archived, p.name AS product_name, p.unit, p.item_type, p.is_service, p.archived_at AS p_archived, p.id AS product_id
  FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`;

function variantInfo(id, role) {
  const v = db().prepare(VARIANT_SQL).get(id);
  if (!v) throw notFound('Mặt hàng');
  if (v.v_archived || v.p_archived) throw badRequest('VARIANT_ARCHIVED', `${v.sku} đã ngừng kinh doanh`, { variant_id: id });
  if (v.kind === 'bundle') throw badRequest('BUNDLE_NO_STOCK', 'Combo không có tồn kho riêng nên không tham gia phiếu đóng gói', { variant_id: id });
  if (v.is_service) throw badRequest('SERVICE_NO_STOCK', 'Dịch vụ không có tồn kho nên không tham gia phiếu đóng gói', { variant_id: id });
  if (role === 'output' && v.item_type !== 'product') throw badRequest('OUTPUT_NOT_PRODUCT', `${v.sku} không phải hàng bán nên không làm thành phẩm`, { variant_id: id });
  return v;
}

// ---------- Công thức "đóng từ" ----------
export function getRecipe(variantId) {
  return db().prepare('SELECT r.*, s.sku AS source_sku, sp.name AS source_name, sp.unit AS source_unit FROM conversion_recipes r JOIN variants s ON s.id = r.source_variant_id JOIN products sp ON sp.id = s.product_id WHERE r.variant_id = ?').get(variantId) ?? null;
}

export function listRecipes(productId) {
  return db()
    .prepare('SELECT r.*, s.sku AS source_sku, sp.name AS source_name, sp.unit AS source_unit FROM conversion_recipes r JOIN variants s ON s.id = r.source_variant_id JOIN products sp ON sp.id = s.product_id JOIN variants v ON v.id = r.variant_id WHERE v.product_id = ? ORDER BY r.rowid')
    .all(productId);
}

export function saveRecipe(variantId, { source_variant_id, qty_per_unit }, actor) {
  variantInfo(variantId, 'output');
  if (source_variant_id === variantId) throw badRequest('RECIPE_SELF', 'Hàng nguồn phải khác thành phẩm');
  variantInfo(source_variant_id, 'source');
  const before = getRecipe(variantId);
  db()
    .prepare('INSERT INTO conversion_recipes (variant_id, source_variant_id, qty_per_unit, updated_at) VALUES (?,?,?,?) ON CONFLICT(variant_id) DO UPDATE SET source_variant_id = excluded.source_variant_id, qty_per_unit = excluded.qty_per_unit, updated_at = excluded.updated_at')
    .run(variantId, source_variant_id, qty_per_unit, nowIso());
  audit(actor, 'inventory.conversion_recipe.saved', 'variant', variantId, before, { source_variant_id, qty_per_unit });
  return getRecipe(variantId);
}

export function deleteRecipe(variantId, actor) {
  const before = getRecipe(variantId);
  if (!before) throw notFound('Công thức đóng từ');
  db().prepare('DELETE FROM conversion_recipes WHERE variant_id = ?').run(variantId);
  audit(actor, 'inventory.conversion_recipe.deleted', 'variant', variantId, before, null);
  return { deleted: true };
}

/** Định mức nguồn theo công thức: Map variant_id nguồn → SL (hàng nguồn theo "đóng từ" + bao bì theo định mức đóng gói của sản phẩm thành phẩm). */
function norms(outputs) {
  const out = new Map();
  const add = (id, q, kind) => {
    const cur = out.get(id) ?? { qty: 0, kind };
    cur.qty = qty3(cur.qty + q);
    out.set(id, cur);
  };
  for (const o of outputs) {
    const r = db().prepare('SELECT source_variant_id, qty_per_unit FROM conversion_recipes WHERE variant_id = ?').get(o.variant_id);
    if (r) add(r.source_variant_id, o.qty * r.qty_per_unit, 'recipe');
    const pid = db().prepare('SELECT product_id FROM variants WHERE id = ?').get(o.variant_id)?.product_id;
    if (pid) for (const sp of getPackagingSpec(pid)) add(sp.material_variant_id, o.qty * sp.qty, 'packaging');
  }
  return out;
}

/** Gợi ý nguồn cho "đóng N thành phẩm": chỉ là gợi ý, số thực tế người dùng sửa rồi mới ghi sổ. */
export function suggest({ warehouseId, outputs }) {
  for (const o of outputs) variantInfo(o.variant_id, 'output');
  const n = norms(outputs);
  const sources = [...n].map(([variantId, x]) => {
    const v = db().prepare(VARIANT_SQL).get(variantId);
    const on = db().prepare('SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(warehouseId, variantId)?.on_hand ?? 0;
    return { variant_id: variantId, sku: v?.sku, product_name: v?.product_name, variant_name: v?.variant_name, unit: v?.unit, qty: x.qty, kind: x.kind, on_hand: on, enough: on >= x.qty };
  });
  return { sources };
}

// ---------- Lập phiếu ----------
function defaultWeights(outputs, infos) {
  const rec = outputs.map((o) => db().prepare('SELECT qty_per_unit FROM conversion_recipes WHERE variant_id = ?').get(o.variant_id)?.qty_per_unit);
  if (rec.every((x) => x > 0)) return outputs.map((o, i) => o.qty * rec[i]);
  if (infos.every((v) => v.default_price > 0)) return outputs.map((o, i) => o.qty * infos[i].default_price);
  return outputs.map((o) => o.qty);
}

export function createConversion({ warehouseId, shopId, note, sources, outputs }, actor) {
  if (!db().prepare('SELECT 1 FROM warehouses WHERE id = ?').get(warehouseId)) throw notFound('Kho');
  if (!sources?.length) throw badRequest('CONVERSION_NO_SOURCE', 'Cần ít nhất một dòng hàng nguồn');
  if (!outputs?.length) throw badRequest('CONVERSION_NO_OUTPUT', 'Cần ít nhất một dòng thành phẩm');
  const outIds = new Set();
  const infos = outputs.map((o) => {
    if (outIds.has(o.variant_id)) throw badRequest('DUPLICATE_OUTPUT', 'Mỗi thành phẩm chỉ một dòng', { variant_id: o.variant_id });
    outIds.add(o.variant_id);
    if (!Number.isInteger(o.qty)) throw badRequest('OUTPUT_QTY_INTEGER', 'Số lượng thành phẩm phải là số nguyên (hộp, túi, cái…). Muốn đóng thành đơn vị lẻ thì tạo thành phẩm có quy cách riêng.', { variant_id: o.variant_id });
    return variantInfo(o.variant_id, 'output');
  });
  for (const s of sources) {
    variantInfo(s.variant_id, 'source');
    if (outIds.has(s.variant_id)) throw badRequest('SOURCE_IS_OUTPUT', 'Hàng nguồn và thành phẩm không được trùng nhau', { variant_id: s.variant_id });
    if (s.lot_id) {
      const lot = db().prepare('SELECT * FROM stock_lots WHERE id = ? AND warehouse_id = ? AND variant_id = ?').get(s.lot_id, warehouseId, s.variant_id);
      if (!lot) throw notFound('Lô hàng');
      if (lot.qty + 0.0005 < s.qty) throw conflict('LOT_NOT_ENOUGH', `Lô ${lot.lot_no ?? ''} chỉ còn ${lot.qty}, không đủ ${s.qty}`, { lot_id: s.lot_id, available: lot.qty, required: s.qty });
    }
  }
  const at = nowIso();
  const date = businessDate(at);
  assertUnlocked(date, 'Phiếu đóng gói');
  const id = newId('cnv');
  const code = runningCode('DG', 5);
  db()
    .prepare('INSERT INTO stock_conversions (id, code, warehouse_id, shop_id, note, source_value, output_value, converted_at, business_date, actor_id, created_at) VALUES (?,?,?,?,?,0,0,?,?,?,?)')
    .run(id, code, warehouseId, shopId ?? null, note ?? null, at, date, actor?.id ?? null, at);

  const normMap = norms(outputs);
  const insLine = db().prepare('INSERT INTO stock_conversion_lines (id, conversion_id, side, position, variant_id, qty, amount, unit_cost, weight, norm_qty, lot_no, expiry_date, slices, lots) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');

  // 1. Xuất nguồn
  let total = 0;
  const srcDone = [];
  const normUsed = new Set();
  const lotInfo = []; // lô của hàng bán đã tiêu, để đặt lô/hạn mặc định cho thành phẩm
  sources.forEach((s, i) => {
    const lineId = newId('cnl');
    const res = applyMovement({ warehouseId, variantId: s.variant_id, type: 'transfer_out', qty: s.qty, refType: 'conversion', refId: id, refLineId: lineId, shopId: shopId ?? null, note: `Đóng gói ${code}`, actorId: actor?.id, allowNegative: false, lotId: s.lot_id ?? undefined, at });
    total += res.totalCost;
    const info = db().prepare(VARIANT_SQL).get(s.variant_id);
    if (info.item_type === 'product') lotInfo.push(...res.lots);
    const norm = !normUsed.has(s.variant_id) && normMap.has(s.variant_id) ? normMap.get(s.variant_id).qty : null;
    if (norm !== null) normUsed.add(s.variant_id);
    insLine.run(lineId, id, 'source', i, s.variant_id, s.qty, res.totalCost, res.unitCost, null, norm, null, null, JSON.stringify(res.slices), JSON.stringify(res.lots));
    srcDone.push({ variant_id: s.variant_id, qty: s.qty, amount: res.totalCost });
  });

  // 2. Chia giá vốn và nhập thành phẩm
  let weights = outputs.map((o, i) => (o.weight != null && o.weight > 0 ? o.weight : null));
  if (weights.some((w) => w === null)) {
    const def = defaultWeights(outputs, infos);
    weights = weights.map((w, i) => w ?? def[i]);
  }
  const amounts = allocate(total, weights);
  const srcLotNos = [...new Set(lotInfo.map((l) => l.lot_no).filter(Boolean))];
  const srcExpiries = lotInfo.map((l) => l.expiry_date).filter(Boolean).sort();
  const outDone = [];
  outputs.forEach((o, i) => {
    const A = amounts[i];
    const M = o.qty;
    const f = Math.floor(A / M);
    const r = A - f * M;
    const slices = [];
    if (M - r > 0) slices.push({ qty: M - r, unitCost: f });
    if (r > 0) slices.push({ qty: r, unitCost: f + 1 });
    const lineId = newId('cnl');
    for (const sl of slices) applyMovement({ warehouseId, variantId: o.variant_id, type: 'transfer_in', qty: sl.qty, unitCost: sl.unitCost, refType: 'conversion', refId: id, refLineId: lineId, shopId: shopId ?? null, note: `Đóng gói ${code}`, actorId: actor?.id, at });
    const lotNo = o.lot_no !== undefined ? o.lot_no : srcLotNos.length ? srcLotNos.join(', ').slice(0, 60) : null;
    const expiry = o.expiry_date !== undefined ? o.expiry_date : srcExpiries[0] ?? null;
    addLot({ warehouseId, variantId: o.variant_id, qty: M, lotNo, expiryDate: expiry, receivedAt: at, refType: 'conversion', refId: id, refLineId: lineId });
    insLine.run(lineId, id, 'output', i, o.variant_id, M, A, Math.round(A / M), weights[i], null, lotNo, expiry, JSON.stringify(slices), null);
    outDone.push({ variant_id: o.variant_id, qty: M, amount: A, unit_cost: Math.round(A / M) });
  });

  db().prepare('UPDATE stock_conversions SET source_value = ?, output_value = ? WHERE id = ?').run(total, amounts.reduce((a, x) => a + x, 0), id);
  const result = getConversion(id);
  audit(actor, 'inventory.conversion.created', 'stock_conversion', id, null, { code, sources: srcDone, outputs: outDone, value: total });
  emit('conversion.created', { entityType: 'stock_conversion', entityId: id, shopId: shopId ?? null, data: { code, warehouse_id: warehouseId, value: total, sources: srcDone, outputs: outDone } });
  return result;
}

/** Xem trước giá vốn thành phẩm (không ghi): nguồn lấy theo giá bình quân/lớp hiện tại. Chỉ ước tính để người dùng thấy trước. */
export function preview({ warehouseId, sources, outputs }) {
  const fifo = costingMethod() === 'fifo';
  let total = 0;
  const srcRows = sources.map((s) => {
    const lvl = db().prepare('SELECT on_hand, avg_cost FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(warehouseId, s.variant_id);
    let amount = 0;
    if (fifo) {
      let need = s.qty;
      for (const l of db().prepare('SELECT qty, unit_cost FROM stock_layers WHERE warehouse_id = ? AND variant_id = ? ORDER BY received_at, rowid').all(warehouseId, s.variant_id)) {
        if (need <= 0) break;
        const take = Math.min(need, l.qty);
        amount += lineAmount(take, l.unit_cost);
        need = qty3(need - take);
      }
      if (need > 0) amount += lineAmount(need, lvl?.avg_cost ?? 0);
    } else amount = lineAmount(s.qty, lvl?.avg_cost ?? 0);
    total += amount;
    return { variant_id: s.variant_id, qty: s.qty, amount, on_hand: lvl?.on_hand ?? 0, enough: (lvl?.on_hand ?? 0) >= s.qty };
  });
  const infos = outputs.map((o) => variantInfo(o.variant_id, 'output'));
  let w = outputs.map((o) => (o.weight != null && o.weight > 0 ? o.weight : null));
  if (w.some((x) => x === null)) {
    const def = defaultWeights(outputs, infos);
    w = w.map((x, i) => x ?? def[i]);
  }
  const amounts = allocate(total, w);
  return { source_value: total, sources: srcRows, outputs: outputs.map((o, i) => ({ variant_id: o.variant_id, qty: o.qty, weight: w[i], amount: amounts[i], unit_cost: o.qty > 0 ? Math.round(amounts[i] / o.qty) : 0 })) };
}

export function getConversion(id) {
  const c = db().prepare('SELECT c.*, w.name AS warehouse_name, s.name AS shop_name FROM stock_conversions c JOIN warehouses w ON w.id = c.warehouse_id LEFT JOIN shops s ON s.id = c.shop_id WHERE c.id = ?').get(id);
  if (!c) throw notFound('Phiếu đóng gói');
  const lines = db()
    .prepare(`SELECT l.*, v.sku, v.name AS variant_name, p.name AS product_name, p.unit, p.item_type FROM stock_conversion_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id WHERE l.conversion_id = ? ORDER BY l.side DESC, l.position`)
    .all(id)
    .map((l) => ({ ...l, slices: parse(l.slices), lots: parse(l.lots) }));
  c.sources = lines.filter((l) => l.side === 'source').map((l) => ({ ...l, norm_diff: l.norm_qty == null ? null : qty3(l.qty - l.norm_qty) }));
  c.outputs = lines.filter((l) => l.side === 'output');
  return c;
}

export function listConversions({ warehouseId, shopId, limit = 50, cursor } = {}) {
  const where = [];
  const params = [];
  if (warehouseId) (where.push('c.warehouse_id = ?'), params.push(warehouseId));
  if (shopId) (where.push('(c.shop_id = ? OR c.warehouse_id IN (SELECT warehouse_id FROM shop_warehouses WHERE shop_id = ?))'), params.push(shopId, shopId));
  if (cursor) (where.push('c.id < ?'), params.push(cursor));
  const rows = db()
    .prepare(`SELECT c.*, w.name AS warehouse_name,
        (SELECT group_concat(v.sku || ' ×' || l.qty, ', ') FROM stock_conversion_lines l JOIN variants v ON v.id = l.variant_id WHERE l.conversion_id = c.id AND l.side = 'source') AS sources_text,
        (SELECT group_concat(v.sku || ' ×' || l.qty, ', ') FROM stock_conversion_lines l JOIN variants v ON v.id = l.variant_id WHERE l.conversion_id = c.id AND l.side = 'output') AS outputs_text
      FROM stock_conversions c JOIN warehouses w ON w.id = c.warehouse_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT ?`)
    .all(...params, limit + 1);
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, next_cursor: more ? data[data.length - 1].id : null };
}

// ---------- Huỷ phiếu ----------
/**
 * Huỷ phiếu: chỉ khi thành phẩm còn đủ trong kho (chưa bán, chưa chuyển đi). Rút thành phẩm đúng giá đã nhập (FIFO: đúng lớp của phiếu; lô của phiếu),
 * rồi nhập lại nguồn đúng giá (từng phần/lớp, giữ tuổi lớp) và đúng lô đã rút.
 */
export function voidConversion(id, reason, actor) {
  const c = getConversion(id);
  if (c.voided_at) throw conflict('ALREADY_VOIDED', 'Phiếu đóng gói này đã huỷ');
  const at = nowIso();
  assertUnlocked([businessDate(at), c.business_date], 'Phiếu đóng gói');
  const fifo = costingMethod() === 'fifo';
  const used = [];
  for (const o of c.outputs) {
    const on = db().prepare('SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(c.warehouse_id, o.variant_id)?.on_hand ?? 0;
    let intact = on + 0.0005 >= o.qty;
    if (intact && (o.lot_no || o.expiry_date)) intact = (db().prepare("SELECT COALESCE(SUM(qty),0) n FROM stock_lots WHERE ref_type = 'conversion' AND ref_id = ? AND ref_line_id = ?").get(id, o.id).n) + 0.0005 >= o.qty;
    if (!intact) used.push({ variant_id: o.variant_id, sku: o.sku, need: o.qty, on_hand: on });
  }
  if (used.length) throw conflict('CONVERSION_OUTPUT_USED', `Không huỷ được ${c.code}: thành phẩm đã bán hoặc chuyển đi nên không còn đủ trong kho (${used.map((u) => `${u.sku} cần ${u.need}, còn ${u.on_hand}`).join('; ')}).`, { items: used });
  for (const o of c.outputs) {
    if (fifo) applyMovement({ warehouseId: c.warehouse_id, variantId: o.variant_id, type: 'transfer_out', qty: o.qty, refType: 'conversion_void', refId: id, refLineId: o.id, preferRef: { refId: id, refLineId: o.id }, shopId: c.shop_id, note: `Huỷ ${c.code}`, actorId: actor?.id, allowNegative: false, at });
    else for (const sl of o.slices) applyMovement({ warehouseId: c.warehouse_id, variantId: o.variant_id, type: 'transfer_out', qty: sl.qty, unitCost: sl.unitCost, exactCost: true, refType: 'conversion_void', refId: id, refLineId: o.id, preferRef: { refId: id, refLineId: o.id }, shopId: c.shop_id, note: `Huỷ ${c.code}`, actorId: actor?.id, allowNegative: false, at });
  }
  for (const s of c.sources) {
    for (const sl of s.slices) applyMovement({ warehouseId: c.warehouse_id, variantId: s.variant_id, type: 'transfer_in', qty: sl.qty, unitCost: sl.unitCost, layerAt: sl.receivedAt, refType: 'conversion_void', refId: id, refLineId: s.id, shopId: c.shop_id, note: `Huỷ ${c.code}`, actorId: actor?.id, at });
    for (const lt of s.lots) addLot({ warehouseId: c.warehouse_id, variantId: s.variant_id, qty: lt.qty, lotNo: lt.lot_no, expiryDate: lt.expiry_date, receivedAt: lt.received_at, refType: lt.ref_type, refId: lt.ref_id, refLineId: lt.ref_line_id });
  }
  db().prepare('UPDATE stock_conversions SET voided_at = ?, void_reason = ?, voided_by = ? WHERE id = ?').run(at, reason, actor?.id ?? null, id);
  const after = getConversion(id);
  audit(actor, 'inventory.conversion.voided', 'stock_conversion', id, { code: c.code }, { reason });
  emit('conversion.voided', { entityType: 'stock_conversion', entityId: id, shopId: c.shop_id, data: { code: c.code, reason } });
  return after;
}
