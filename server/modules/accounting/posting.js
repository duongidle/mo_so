import { businessDate } from '../../lib/time.js';
import { lineAmount } from '../../lib/money.js';
import { depreciationSchedule, postedPeriods } from '../../lib/schedule.js';

/**
 * Quy tắc hạch toán: mỗi loại chứng từ một hàm THUẦN (không đụng DB) từ ảnh chụp chứng từ → danh sách bút toán.
 * Quy tắc số liệu: bút toán đơn/trả hàng/chi phí phải khớp ĐÚNG cách báo cáo (reports/stats.js, service.js) đếm từng khoản và vào ngày nào:
 * - Đơn tính khi đã xác nhận trở đi (COUNTED), vào ngày của đơn (business_date). Trả hàng cũng vào ngày của đơn gốc.
 * - Doanh thu hàng = goods_revenue (đã trừ giảm giá); phí ship khách trả riêng (5113, trừ ship hoàn ở phiếu trả); đơn sàn trả hàng được hoàn phí sàn theo phiếu (Có 6411), kênh khác không hoàn.
 * - Phiếu trả (và phiếu giảm giá sau bán, không có hàng quay về): Nợ 5212 hàng, Nợ 5113 ship hoàn, Có 131 (hoặc 1388) phần còn lại sau phí trả hàng và phí sàn được hoàn, Có 6411 phí sàn được hoàn, Có 5118 phí trả hàng, Nợ 6412 / Có 3388 ship chiều về.
 * - Giá vốn = cogs_amount của đơn (đã trừ phần nhập lại kho) + giá vốn đã nhập lại ở các phiếu trả (chụp lúc xuất).
 * Mỗi bút toán phải cân (Σ Nợ = Σ Có), nếu không ném lỗi.
 */
export const COUNTED = new Set(['confirmed', 'shipping', 'completed', 'returned']);
export const FALLBACK_EXPENSE_ACCOUNT = '6428';
const EARLIEST = '1970-01-01';

/** Dòng bên Nợ; số âm tự chuyển sang bên Có (và ngược lại), số 0 bỏ qua */
export const dr = (account, amount, extra = {}) => (amount > 0 ? { account, debit: amount, credit: 0, ...extra } : amount < 0 ? { account, debit: 0, credit: -amount, ...extra } : null);
export const cr = (account, amount, extra = {}) => (amount > 0 ? { account, debit: 0, credit: amount, ...extra } : amount < 0 ? { account, debit: -amount, credit: 0, ...extra } : null);

export function balanced(lines) {
  return lines.reduce((a, l) => a + l.debit, 0) === lines.reduce((a, l) => a + l.credit, 0);
}

/** Dựng một bút toán; mọi dòng mang shop của bút toán nếu dòng không tự ghi shop. Không có dòng nào thì trả null. */
function entry({ source_type, source_id, date, description, shop_id = null }, lines) {
  const ls = lines.filter(Boolean).map((l, i) => ({ channel_id: null, partner_type: null, partner_id: null, memo: null, shop_id, ...l, sort_order: i }));
  if (!ls.length) return null;
  if (!balanced(ls)) throw new Error(`Bút toán không cân (${source_type} ${source_id}): ${JSON.stringify(ls)}`);
  return { source_type, source_id, date, description, shop_id, lines: ls };
}

/**
 * ctx: { cashAccountFor(method, date) → mã tài khoản tiền, cashLeg(accountRow, date) → mã tài khoản, expenseAccount(categoryId) }
 * Phương thức chưa gán quỹ → 1131. Thu chi trước ngày mở sổ của quỹ: số dư đầu đã gồm, nên phía tiền đối ứng với 411.
 */
export function postingsFor(type, src, ctx) {
  const fn = POSTERS[type];
  if (!fn || !src) return [];
  return fn(src, ctx).filter(Boolean);
}

const recvAccount = (marketplace) => (marketplace ? '1388' : '131');

function orderEntry({ o, returns, marketplace }) {
  // Đơn huỷ mà shop giữ cọc: khoản đã thu (131 có dư Có) chuyển thành doanh thu khác 5119, ghi vào ngày của đơn (cùng cách báo cáo đếm)
  if (o.status === 'cancelled' && o.forfeited_amount > 0 && !marketplace) {
    const sc = { shop_id: o.shop_id, channel_id: o.channel_id };
    const cust = o.customer_id ? { partner_type: 'customer', partner_id: o.customer_id } : {};
    return entry({ source_type: 'order', source_id: o.id, date: o.business_date, description: `Giữ cọc đơn huỷ ${o.code}`, shop_id: o.shop_id }, [dr('131', o.forfeited_amount, { ...sc, ...cust }), cr('5119', o.forfeited_amount, { ...sc, memo: 'Cọc khách bỏ, shop giữ lại' })]);
  }
  if (!COUNTED.has(o.status)) return null;
  const sc = { shop_id: o.shop_id, channel_id: o.channel_id };
  const cust = o.customer_id ? { partner_type: 'customer', partner_id: o.customer_id } : {};
  const grossCogs = o.cogs_amount + returns.reduce((a, r) => a + r.restored_cost, 0);
  const lines = [];
  if (marketplace) {
    // Sàn thu tiền khách rồi trả shop sau khi trừ phí → phải thu của sàn = net_amount
    lines.push(dr('1388', o.net_amount, { ...sc, ...cust }), dr('6411', o.platform_fee_amount, sc), dr('6412', o.seller_shipping_amount, sc));
  } else {
    // Khách trả thẳng: phải thu = total. Phí sàn/ship shop chịu là khoản chi riêng, chưa chi tiền nên ghi phải trả khác
    lines.push(dr('131', o.total_amount, { ...sc, ...cust }), dr('6411', o.platform_fee_amount, sc), dr('6412', o.seller_shipping_amount, sc), cr('3388', o.platform_fee_amount + o.seller_shipping_amount, { ...sc, memo: 'Phí sàn / ship shop chịu' }));
  }
  lines.push(cr('5111', o.goods_revenue, sc), cr('5113', o.shipping_fee, sc), dr('632', grossCogs, sc), cr('156', grossCogs, sc));
  return entry({ source_type: 'order', source_id: o.id, date: o.business_date, description: `Bán hàng ${o.code}`, shop_id: o.shop_id }, lines);
}

function returnEntry({ ret, o, marketplace }) {
  if (!o || !COUNTED.has(o.status)) return null;
  const sc = { shop_id: o.shop_id, channel_id: o.channel_id };
  const cust = o.customer_id ? { partner_type: 'customer', partner_id: o.customer_id } : {};
  const restored = ret.lines.reduce((a, l) => a + (l.restock ? l.restored_cost || 0 : 0), 0);
  const memo = `Trả hàng ngày ${ret.business_date}`;
  const recv = recvAccount(marketplace);
  const shipRefund = ret.shipping_refund_amount ?? 0;
  const fee = ret.return_fee_amount ?? 0;
  const shipCost = ret.return_shipping_cost ?? 0;
  const feeBack = ret.platform_fee_refund_amount ?? 0; // phí sàn được hoàn: giảm chi phí 6411, giảm phần sàn còn nợ shop (1388) tương ứng
  // Hàng trả (hoặc giảm giá sau bán) giảm 5212; ship hoàn giảm 5113; phí trả hàng là doanh thu khác 5118 (cấn vào công nợ khách); ship chiều về là chi phí như ship shop chịu
  return entry(
    { source_type: 'return', source_id: ret.id, date: o.business_date, description: `Trả hàng ${ret.code} (đơn ${o.code})`, shop_id: o.shop_id },
    [
      dr('5212', ret.goods_amount, { ...sc, memo }),
      dr('5113', shipRefund, { ...sc, memo }),
      cr(recv, ret.goods_amount + shipRefund - fee - feeBack, { ...sc, ...cust }),
      cr('6411', feeBack, { ...sc, memo: 'Sàn hoàn phí khi trả hàng' }),
      cr('5118', fee, { ...sc, memo: 'Phí trả hàng shop giữ lại' }),
      dr('156', restored, sc),
      cr('632', restored, sc),
      dr('6412', shipCost, sc),
      cr('3388', shipCost, { ...sc, memo: 'Ship chiều về shop chịu' }),
    ],
  );
}

function paymentEntry({ p, order, purchase, marketplace }, ctx) {
  if (p.voided_at) return null;
  const cash = ctx.cashAccountFor(p.method, p.business_date);
  const sc = { shop_id: p.shop_id };
  let counter = '3388';
  let extra = {};
  let what = 'Thanh toán khác';
  if (p.ref_type === 'order') {
    counter = recvAccount(marketplace);
    extra = { channel_id: order?.channel_id ?? null, ...(order?.customer_id ? { partner_type: 'customer', partner_id: order.customer_id } : {}) };
    what = p.method === 'customer_credit'
      ? (p.direction === 'in' ? `Dùng tiền khách gửi đơn ${order?.code ?? p.ref_id}` : `Chuyển hoàn thành tiền khách gửi ${order?.code ?? p.ref_id}`)
      : p.direction === 'in' ? `Thu tiền đơn ${order?.code ?? p.ref_id}` : `Hoàn tiền khách đơn ${order?.code ?? p.ref_id}`;
  } else if (p.ref_type === 'purchase') {
    counter = '331';
    extra = purchase?.supplier_id ? { partner_type: 'supplier', partner_id: purchase.supplier_id } : {};
    what = p.direction === 'in' ? `NCC hoàn tiền phiếu ${purchase?.code ?? p.ref_id}` : `Trả NCC phiếu ${purchase?.code ?? p.ref_id}`;
  } else if (p.ref_type === 'order_seller_shipping') {
    // Ship shop chịu trả hãng vận chuyển: bù khoản phải trả khác (3388) đã ghi lúc bán
    what = `Trả ship đơn ${order?.code ?? p.ref_id}`;
  } else if (p.ref_type === 'purchase_carrier') {
    // Ship nhập trả bên vận chuyển: bù khoản phải trả khác (3388) đã ghi lúc nhận hàng
    what = p.direction === 'in' ? `Hoàn tiền ship nhập phiếu ${purchase?.code ?? p.ref_id}` : `Trả ship nhập phiếu ${purchase?.code ?? p.ref_id}`;
  }
  const lines = p.method === 'customer_credit'
    ? (p.direction === 'in'
        ? [dr('3388', p.amount, sc), cr(counter, p.amount, { ...sc, ...extra })]
        : [dr(counter, p.amount, { ...sc, ...extra }), cr('3388', p.amount, sc)])
    : p.direction === 'in' ? [dr(cash, p.amount, sc), cr(counter, p.amount, { ...sc, ...extra })] : [dr(counter, p.amount, { ...sc, ...extra }), cr(cash, p.amount, sc)];
  return entry({ source_type: 'payment', source_id: p.id, date: p.business_date, description: what, shop_id: p.shop_id }, lines);
}

function purchaseEntry({ pu }) {
  if (pu.status !== 'received' || !pu.received_at || pu.total_amount + (pu.carrier_amount || 0) <= 0) return null;
  const sc = { shop_id: pu.shop_id };
  return entry(
    { source_type: 'purchase', source_id: pu.id, date: businessDate(pu.received_at), description: `Nhập hàng ${pu.code}`, shop_id: pu.shop_id },
    [
      dr('156', pu.total_amount + (pu.carrier_amount || 0), sc),
      ...(pu.total_amount > 0 ? [cr('331', pu.total_amount, { ...sc, ...(pu.supplier_id ? { partner_type: 'supplier', partner_id: pu.supplier_id } : {}) })] : []),
      ...(pu.carrier_amount > 0 ? [cr('3388', pu.carrier_amount, sc)] : []),
    ],
  );
}

/**
 * Trả hàng nhập: Nợ 331 (NCC trả lại theo giá mua, đã trừ chiết khấu) / Có 156 (giá trị xuất kho thực tế).
 * Chênh lệch = phí nhập đã phân bổ vào hàng trả mà NCC không hoàn (và chênh giá bình quân khi kho về 0): Nợ 811, hoặc Có 711 nếu âm. Ghi vào ngày lập phiếu trả.
 */
function purchaseReturnEntry({ ret, purchase }) {
  if (!ret || ret.voided_at) return null;
  const sc = { shop_id: ret.shop_id };
  const sup = ret.supplier_id ? { partner_type: 'supplier', partner_id: ret.supplier_id } : {};
  const diff = ret.stock_value - ret.goods_amount;
  return entry(
    { source_type: 'purchase_return', source_id: ret.id, date: ret.business_date, description: `Trả hàng nhập ${ret.code}${purchase ? ` (phiếu ${purchase.code})` : ''}`, shop_id: ret.shop_id },
    [dr('331', ret.goods_amount, { ...sc, ...sup }), cr('156', ret.stock_value, sc), diff > 0 ? dr('811', diff, { ...sc, memo: 'Phí nhập của hàng trả, NCC không hoàn' }) : cr('711', -diff, { ...sc, memo: 'Chênh giá xuất kho so với giá NCC hoàn' })],
  );
}

/**
 * Giảm giá sau nhận: Nợ 331 / Có 156 phần ứng với hàng còn tồn (giảm giá vốn tồn kho) / Có 711 phần ứng với hàng đã bán (giá vốn đã chụp trên đơn không sửa).
 */
function purchaseAllowanceEntry({ al, purchase }) {
  if (!al || al.voided_at) return null;
  const sc = { shop_id: al.shop_id };
  const sup = al.supplier_id ? { partner_type: 'supplier', partner_id: al.supplier_id } : {};
  return entry(
    { source_type: 'purchase_allowance', source_id: al.id, date: al.business_date, description: `NCC giảm giá sau nhận ${al.code}${purchase ? ` (phiếu ${purchase.code})` : ''}`, shop_id: al.shop_id },
    [dr('331', al.amount, { ...sc, ...sup }), cr('156', al.stock_amount, sc), cr('711', al.sold_amount, { ...sc, memo: 'Giảm giá phần hàng đã bán' })],
  );
}

function expenseEntry({ e }, ctx) {
  if (e.voided_at) return null;
  const account = ctx.expenseAccount(e.category_id);
  const pay = e.method ? ctx.cashAccountFor(e.method, e.expense_date) : '3388'; // chưa trả thì ghi phải trả khác
  return entry(
    { source_type: 'expense', source_id: e.id, date: e.expense_date, description: `Chi phí ${e.category_name || ''}${e.payee ? ' – ' + e.payee : ''}`.trim(), shop_id: e.shop_id },
    [dr(account, e.amount, { channel_id: e.channel_id ?? null }), cr(pay, e.amount)],
  );
}

function stockEntry({ movements, label }) {
  if (!movements.length) return null;
  const sum = (types) => movements.filter((m) => types.includes(m.type)).reduce((a, m) => a + lineAmount(Math.abs(m.qty), m.unit_cost), 0);
  const inV = sum(['adjust_in']);
  const outMovements = movements.filter((m) => ['adjust_out', 'damage_out'].includes(m.type));
  const materialOut = outMovements.filter((m) => ['packaging_run','material_issue'].includes(m.ref_type));
  const outV = outMovements.filter((m) => !['packaging_run','material_issue'].includes(m.ref_type)).reduce((a,m)=>a+lineAmount(Math.abs(m.qty), m.unit_cost),0);
  const materialByAccount = new Map();
  for (const m of materialOut) {
    const account = m.expense_account_code || '6428';
    materialByAccount.set(account, (materialByAccount.get(account) || 0) + lineAmount(Math.abs(m.qty), m.unit_cost));
  }
  const openV = sum(['opening']);
  const first = movements[0];
  return entry(
    { source_type: 'stock', source_id: first.ref_id ?? first.id, date: first.business_date, description: label || 'Điều chỉnh kho', shop_id: null },
    [dr('156', inV), cr('711', inV, { memo: 'Điều chỉnh tăng' }), dr('811', outV, { memo: 'Điều chỉnh giảm / hỏng' }), ...[...materialByAccount].map(([account, amount]) => dr(account, amount, { memo: 'Tiêu hao vật tư kho' })), cr('156', outV + [...materialByAccount.values()].reduce((a,v)=>a+v,0)), dr('156', openV), cr('411', openV, { memo: 'Tồn đầu kỳ' })],
  );
}

function cashOpenEntry({ account }, ctx) {
  if (!account.opening_balance) return null;
  return entry(
    { source_type: 'cash_open', source_id: account.id, date: account.opening_date || EARLIEST, description: `Số dư đầu quỹ ${account.name}`, shop_id: null },
    [dr(account.account_code, account.opening_balance), cr('411', account.opening_balance)],
  );
}

function cashEntryEntry({ rows }, ctx) {
  if (!rows.length) return null;
  const first = rows[0];
  const date = first.entry_date;
  const legs = rows.map((r) => ({ r, code: ctx.cashLeg(r, r.entry_date) }));
  if (first.kind === 'transfer') {
    return entry(
      { source_type: 'cash_entry', source_id: first.pair_id ?? first.id, date, description: first.note ? `Chuyển quỹ: ${first.note}` : 'Chuyển quỹ', shop_id: null },
      legs.map(({ r, code }) => (r.amount > 0 ? dr(code, r.amount) : cr(code, -r.amount))),
    );
  }
  const { r, code } = legs[0];
  return entry(
    { source_type: 'cash_entry', source_id: first.id, date, description: first.note || 'Điều chỉnh kiểm đếm quỹ', shop_id: null },
    r.amount > 0 ? [dr(code, r.amount), cr('711', r.amount, { memo: 'Kiểm đếm thừa' })] : [dr('811', -r.amount, { memo: 'Kiểm đếm thiếu' }), cr(code, -r.amount)],
  );
}

/**
 * Tài sản cố định / chi phí trả trước: một bút toán mua, mỗi tháng đã qua một bút toán khấu hao/phân bổ (ghi vào ngày cuối tháng),
 * và một bút toán thanh lý nếu có. Phụ thuộc "hôm nay" (ctx.today) nên sổ được làm mới khi qua ngày (journal.js).
 * Thanh lý: giá trị còn lại ghi thẳng vào 811 (chưa có tiền thu về; thu tiền bán tài sản ghi bằng phiếu thu tay).
 */
function assetEntries({ a }, ctx) {
  if (a.voided_at) return [];
  const sc = { shop_id: a.shop_id };
  const fixed = a.kind === 'fixed_asset';
  const base = { source_type: 'asset', source_id: a.id, shop_id: a.shop_id };
  const out = [];
  const pay = a.paid_via === 'unpaid' ? '331' : ctx.cashAccountFor(a.paid_via, a.start_date);
  out.push(entry({ ...base, date: a.start_date, description: `${fixed ? 'Mua tài sản cố định' : 'Chi phí trả trước'}: ${a.name}` }, [dr(a.account_code, a.cost, sc), cr(pay, a.cost, sc)]));
  const posted = postedPeriods(a, ctx.today);
  for (const p of posted) {
    out.push(entry({ ...base, date: p.date, description: `${fixed ? 'Khấu hao' : 'Phân bổ'} ${p.period}: ${a.name}` }, [dr(a.expense_account_code, p.amount, sc), cr(fixed ? '214' : '242', p.amount, sc)]));
  }
  if (a.disposed_at && a.disposed_at <= ctx.today) {
    const acc = posted.reduce((s, p) => s + p.amount, 0);
    const rest = a.cost - acc;
    out.push(entry({ ...base, date: a.disposed_at, description: `Thanh lý: ${a.name}` }, fixed ? [dr('214', acc, sc), dr('811', rest, { ...sc, memo: 'Giá trị còn lại' }), cr('211', a.cost, sc)] : [dr('811', rest, { ...sc, memo: 'Giá trị còn lại' }), cr('242', rest, sc)]));
  }
  return out;
}

const POSTERS = {
  asset: (s, c) => assetEntries(s, c),
  order: (s) => [orderEntry(s)],
  return: (s) => [returnEntry(s)],
  payment: (s, c) => [paymentEntry(s, c)],
  purchase: (s) => [purchaseEntry(s)],
  purchase_return: (s) => [purchaseReturnEntry(s)],
  purchase_allowance: (s) => [purchaseAllowanceEntry(s)],
  expense: (s, c) => [expenseEntry(s, c)],
  stock: (s) => [stockEntry(s)],
  cash_open: (s, c) => [cashOpenEntry(s, c)],
  cash_entry: (s, c) => [cashEntryEntry(s, c)],
};
