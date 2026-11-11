import { getDb } from '../../db/index.js';
import { allocate } from '../../lib/money.js';

const q3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Trạng thái từng dòng phiếu nhập đã nhận sau khi có phiếu trả hàng nhập và giảm giá sau nhận (chỉ tính phiếu chưa huỷ):
 *  - net_value: giá trị mua của dòng sau chiết khấu phiếu (chiết khấu chia theo giá trị dòng bằng allocate);
 *  - returned_qty / returned_goods: đã trả NCC; allowance_amount / allowance_stock: NCC đã bớt (và phần ứng với hàng còn tồn);
 *  - net_qty: số lượng chưa trả; remaining_value: giá trị mua còn lại = net_value − đã trả − đã bớt.
 */
export function lineStates(purchaseId, lines, discountAmount) {
  const db = getDb();
  const disc = allocate(discountAmount || 0, lines.map((l) => l.line_total));
  const ret = new Map(
    db
      .prepare(
        `SELECT rl.purchase_line_id AS id, SUM(rl.qty) AS q, SUM(rl.goods_amount) AS g FROM purchase_return_lines rl
         JOIN purchase_returns r ON r.id = rl.return_id WHERE r.purchase_id = ? AND r.voided_at IS NULL GROUP BY 1`,
      )
      .all(purchaseId)
      .map((r) => [r.id, r]),
  );
  const alw = new Map(
    db
      .prepare(
        `SELECT al.purchase_line_id AS id, SUM(al.amount) AS a, SUM(al.stock_amount) AS s FROM purchase_allowance_lines al
         JOIN purchase_allowances x ON x.id = al.allowance_id WHERE x.purchase_id = ? AND x.voided_at IS NULL GROUP BY 1`,
      )
      .all(purchaseId)
      .map((r) => [r.id, r]),
  );
  const out = new Map();
  lines.forEach((l, i) => {
    const r = ret.get(l.id);
    const a = alw.get(l.id);
    const net = l.line_total - disc[i];
    const returnedGoods = r?.g ?? 0;
    const allowance = a?.a ?? 0;
    out.set(l.id, {
      net_value: net,
      returned_qty: q3(r?.q ?? 0),
      returned_goods: returnedGoods,
      allowance_amount: allowance,
      allowance_stock: a?.s ?? 0,
      net_qty: q3(l.qty - (r?.q ?? 0)),
      remaining_value: net - returnedGoods - allowance,
    });
  });
  return out;
}

/** Nợ NCC còn lại (≥ 0) và số NCC còn nợ shop (≥ 0, khi đã trả nhiều hơn số phải trả sau khi trừ hàng trả / giảm giá) */
export function supplierBalance(p) {
  const due = p.total_amount - (p.returned_amount || 0) - (p.allowance_amount || 0) - p.paid_amount;
  return { debt: Math.max(0, due), supplier_owes: Math.max(0, -due) };
}
