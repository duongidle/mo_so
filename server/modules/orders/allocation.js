import { getDb } from '../../db/index.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { getLevel } from '../inventory/service.js';
import { componentsOf } from '../catalog/bundles.js';

const db = () => getDb();

/** Kho của shop theo thứ tự ưu tiên (bỏ kho đã lưu trữ) */
export function shopWarehouseIds(shopId) {
  return db()
    .prepare(
      `SELECT sw.warehouse_id FROM shop_warehouses sw JOIN warehouses w ON w.id = sw.warehouse_id
       WHERE sw.shop_id = ? AND w.archived_at IS NULL ORDER BY sw.priority, sw.warehouse_id`,
    )
    .all(shopId)
    .map((r) => r.warehouse_id);
}

/** Những biến thể đơn thật sự có tồn mà một dòng đơn cần lấy: chính nó, hoặc từng thành phần × SL nếu là combo */
export function stockNeeds(variantId, qty) {
  const v = db().prepare('SELECT id, sku, kind FROM variants WHERE id = ?').get(variantId);
  if (!v) throw badRequest('VARIANT_NOT_FOUND', `Không tìm thấy biến thể ${variantId}`);
  if (v.kind === 'bundle') {
    const comps = componentsOf(variantId);
    if (!comps.length) throw conflict('BUNDLE_EMPTY', `Combo ${v.sku} chưa có thành phần nào`);
    return comps.map((c) => ({ variant_id: c.component_variant_id, sku: c.sku, qty: c.qty * qty }));
  }
  return [{ variant_id: v.id, sku: v.sku, qty }];
}

/**
 * Lập kế hoạch lấy hàng cho các dòng của một đơn. Không ghi gì vào DB.
 *
 * lines: [{ variant_id, qty, allocations? }]  — allocations = phân bổ tay [{ variant_id?, warehouse_id, qty }]
 * Tự động: lấy hết kho ưu tiên 1, thiếu thì kho kế tiếp… Hết tồn mọi kho thì phần còn lại dồn vào kho đầu và đánh dấu short_qty.
 * Phân bổ tay: tổng theo từng biến thể phải đúng bằng SL cần (ALLOCATION_MISMATCH); kho nào cũng được, kho ngoài danh sách của shop chỉ bị cảnh báo.
 * Tồn được trừ ảo dần qua các dòng, nên hai dòng cùng một biến thể không cùng "giành" một phần tồn.
 *
 * opts.primaryWarehouseId: kho được ưu tiên trước kho của shop (đơn chọn kho riêng).
 * opts.allowNegative=false: thiếu hàng thì ném STOCK_NOT_ENOUGH; true: chấp nhận âm kho ở kho đầu (đơn import từ sàn).
 */
export function planAllocation(shopId, lines, { overrides, allowNegative = false, primaryWarehouseId } = {}) {
  const shopIds = shopWarehouseIds(shopId);
  const order = [...new Set([primaryWarehouseId, ...shopIds].filter(Boolean))];
  if (!order.length) throw badRequest('NO_WAREHOUSE', 'Shop chưa có kho nào để lấy hàng. Thêm kho ở Cài đặt → Shop & kho.');

  const remaining = new Map();
  const key = (w, v) => `${w}|${v}`;
  const left = (w, v) => {
    const k = key(w, v);
    if (!remaining.has(k)) remaining.set(k, getLevel(w, v).on_hand);
    return remaining.get(k);
  };
  const avail = (w, v) => Math.max(0, left(w, v));
  const consume = (w, v, n) => remaining.set(key(w, v), left(w, v) - n);
  const whExists = db().prepare('SELECT id FROM warehouses WHERE id = ? AND archived_at IS NULL');
  const initialTotal = (v) => order.reduce((a, w) => a + Math.max(0, getLevel(w, v).on_hand), 0);

  const result = lines.map((l, index) => ({ index, variant_id: l.variant_id, qty: l.qty, items: [], needs: stockNeeds(l.variant_id, l.qty) }));
  const done = result.map(() => new Set()); // biến thể của từng dòng đã được phân bổ tay
  const warnings = [];

  const push = (r, item) => {
    const same = r.items.find((x) => x.warehouse_id === item.warehouse_id && x.variant_id === item.variant_id);
    if (same) {
      same.qty += item.qty;
      same.short_qty += item.short_qty;
    } else r.items.push(item);
  };

  // Lượt 1: phân bổ tay (để các dòng tự động phía sau thấy phần tồn đã bị giữ)
  lines.forEach((l, i) => {
    const ov = overrides?.[i] ?? l.allocations;
    if (!ov?.length) return;
    const r = result[i];
    const need = new Map(r.needs.map((n) => [n.variant_id, n]));
    const sums = new Map();
    for (const a of ov) {
      const vid = a.variant_id ?? (r.needs.length === 1 ? r.needs[0].variant_id : null);
      if (!vid || !need.has(vid)) {
        throw badRequest('ALLOCATION_MISMATCH', 'Phân bổ kho nhắc tới sản phẩm không có trong dòng đơn', { line: i, variant_id: a.variant_id });
      }
      if (!Number.isInteger(a.qty) || a.qty <= 0) throw badRequest('INVALID_QTY', 'Số lượng phân bổ phải là số nguyên dương', { line: i });
      if (!whExists.get(a.warehouse_id)) throw badRequest('INVALID_WAREHOUSE', 'Kho phân bổ không tồn tại hoặc đã lưu trữ', { line: i, warehouse_id: a.warehouse_id });
      sums.set(vid, (sums.get(vid) ?? 0) + a.qty);
      const short = Math.max(0, a.qty - avail(a.warehouse_id, vid));
      consume(a.warehouse_id, vid, a.qty);
      if (!shopIds.includes(a.warehouse_id) && a.warehouse_id !== primaryWarehouseId) {
        warnings.push({ code: 'WAREHOUSE_OUTSIDE_SHOP', line: i, warehouse_id: a.warehouse_id, message: 'Kho này không nằm trong danh sách kho của shop' });
      }
      push(r, { variant_id: vid, sku: need.get(vid).sku, warehouse_id: a.warehouse_id, qty: a.qty, short_qty: short });
    }
    for (const [vid, sum] of sums) {
      if (sum !== need.get(vid).qty) {
        throw badRequest('ALLOCATION_MISMATCH', `Phân bổ kho của ${need.get(vid).sku} là ${sum}, đơn cần ${need.get(vid).qty}`, { line: i, variant_id: vid, allocated: sum, required: need.get(vid).qty });
      }
      done[i].add(vid);
    }
  });

  // Lượt 2: tự động theo ưu tiên
  result.forEach((r, i) => {
    for (const n of r.needs) {
      if (done[i].has(n.variant_id)) continue;
      let rest = n.qty;
      for (const w of order) {
        if (rest <= 0) break;
        const take = Math.min(rest, avail(w, n.variant_id));
        if (take <= 0) continue;
        consume(w, n.variant_id, take);
        push(r, { variant_id: n.variant_id, sku: n.sku, warehouse_id: w, qty: take, short_qty: 0 });
        rest -= take;
      }
      if (rest > 0) {
        consume(order[0], n.variant_id, rest);
        push(r, { variant_id: n.variant_id, sku: n.sku, warehouse_id: order[0], qty: rest, short_qty: rest });
      }
    }
  });

  const shortages = [];
  result.forEach((r) => {
    for (const it of r.items) if (it.short_qty > 0) shortages.push({ line: r.index, variant_id: it.variant_id, sku: it.sku, warehouse_id: it.warehouse_id, short_qty: it.short_qty, required: r.needs.find((n) => n.variant_id === it.variant_id).qty, on_hand_total: initialTotal(it.variant_id) });
  });
  if (shortages.length && !allowNegative) {
    const s = shortages[0];
    throw conflict('STOCK_NOT_ENOUGH', `Không đủ tồn kho cho ${s.sku} (còn ${s.on_hand_total}, cần ${s.required})`, {
      variant_id: s.variant_id,
      sku: s.sku,
      on_hand: s.on_hand_total,
      required: s.required,
    });
  }
  return { warehouses: order, lines: result.map(({ needs, ...r }) => r), shortages, warnings };
}
