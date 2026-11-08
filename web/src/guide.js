// Trang "Cách đọc sức khoẻ kinh doanh": biến số liệu báo cáo thành 5 câu hỏi có trả lời xanh/vàng/đỏ + việc nên làm.
// Hàm thuần (không gọi API) để kiểm thử được. Không tự bịa ngưỡng: chỉ dùng ngưỡng người dùng đã đặt, hoặc quy tắc tự nhiên (âm tiền, lỗ).
import { vnd, num, pct } from './lib.js';

const ORDER = { red: 0, yellow: 1, green: 2 };
const worst = (list) => list.filter(Boolean).sort((a, b) => ORDER[a] - ORDER[b])[0] || null;

const hv = (health, key) => health.data.find((h) => h.key === key);
const stale = (g, minDays) => g.buckets.filter((b) => b.min >= minDays).reduce((a, b) => ({ amount: a.amount + b.amount, count: a.count + b.count }), { amount: 0, count: 0 });

/**
 * @param {{ health, overview, cash, aging, accounts, inventory, expense }} d  dữ liệu từ các API báo cáo cùng một kỳ
 * @returns {{ id, question, status, headline, facts: {label, value}[], todo: string[], link: string, linkLabel: string }[]}
 */
export function buildChecks(d) {
  const c = d.overview.current;
  const noSales = c.order_count === 0;
  const out = [];

  // 1. Tiền
  {
    const todo = [];
    const flags = [];
    const negative = d.accounts.data.filter((a) => a.balance < 0);
    if (negative.length) { flags.push('red'); todo.push(`Quỹ ${negative.map((a) => `“${a.name}”`).join(', ')} đang âm: có khoản chi chưa gắn đúng quỹ, hoặc thiếu số dư đầu. Vào Quỹ tiền để kiểm đếm và nhập số dư đầu.`); }
    const refundOwed = d.cash.customer_refund_owed ?? 0;
    if (refundOwed > 0) { flags.push('yellow'); todo.push(`Shop còn nợ khách ${vnd(refundOwed)} do trả hàng mà chưa hoàn tiền (${d.cash.customer_refund_owed_orders ?? 0} đơn): mở đơn và nhấn “Hoàn tiền”, hoặc ghi phí trả hàng nếu shop giữ lại tiền.`); }
    const oldCustomer = stale(d.aging.customer, 31);
    if (oldCustomer.count) { flags.push('yellow'); todo.push(`${oldCustomer.count} khoản khách nợ quá 30 ngày (${vnd(oldCustomer.amount)}): liên hệ đòi hoặc xác nhận đã thu mà chưa ghi.`); }
    const oldMarket = stale(d.aging.marketplace, 31);
    if (oldMarket.count) { flags.push('yellow'); todo.push(`${oldMarket.count} đơn sàn chưa nhận tiền quá 30 ngày (${vnd(oldMarket.amount)}): đối chiếu với bảng kê ví của sàn. Có thể sàn đã trả mà chưa ghi.`); }
    const oldSupplier = stale(d.aging.supplier, 31);
    if (oldSupplier.count) { flags.push('yellow'); todo.push(`${oldSupplier.count} phiếu nhập còn nợ nhà cung cấp quá 30 ngày (${vnd(oldSupplier.amount)}).`); }
    if (d.accounts.unassigned.has_activity) { flags.push('yellow'); todo.push('Có tiền ở phương thức chưa gán quỹ nào nên số dư các quỹ chưa đủ. Gán ở Quỹ tiền.'); }
    const status = worst(flags) || 'green';
    out.push({
      id: 'money', question: 'Tiền có đủ không?', status,
      headline: `Các quỹ đang có ${vnd(d.accounts.total_balance)}. Còn phải thu ${vnd(d.cash.customer_receivable + d.cash.marketplace_pending)}, còn nợ nhà cung cấp ${vnd(d.cash.supplier_payable)}.`,
      facts: [{ label: 'Tiền trong các quỹ', value: vnd(d.accounts.total_balance) }, { label: 'Khách còn nợ', value: vnd(d.cash.customer_receivable) }, { label: 'Sàn chưa trả', value: vnd(d.cash.marketplace_pending) }, { label: 'Nợ nhà cung cấp', value: vnd(d.cash.supplier_payable) }, ...(refundOwed > 0 ? [{ label: 'Nợ phải trả khách (trả hàng)', value: vnd(refundOwed) }] : [])],
      todo: status === 'green' ? ['Không có gì cần làm gấp. Mỗi tuần vẫn nên đếm két và so với số dư ngân hàng.'] : todo,
      link: '/reports?tab=cash', linkLabel: 'Xem tiền & công nợ',
    });
  }

  // 2. Lãi
  {
    const m = hv(d.health, 'gross_margin_pct');
    const flags = [m?.status];
    const todo = [];
    if (!noSales && c.net_profit_estimate < 0) { flags.push('red'); todo.push(`Sau chi phí đang lỗ ${vnd(-c.net_profit_estimate)}. Xem chi phí nào lớn nhất ở câu hỏi “Chi phí có phình ra không?”.`); }
    if (m?.status === 'red' || m?.status === 'yellow') todo.push('Biên lợi nhuận thấp: kiểm tra giá bán so với giá vốn của các sản phẩm bán nhiều, phí sàn và chương trình giảm giá.');
    const status = noSales ? null : worst(flags) || 'green';
    out.push({
      id: 'profit', question: 'Bán có lời không?', status,
      headline: noSales ? 'Chưa có đơn nào trong kỳ để đánh giá.' : `Lợi nhuận gộp ${vnd(c.gross_profit)} (biên ${pct(c.gross_margin_pct)}). Sau chi phí còn ${vnd(c.net_profit_estimate)} (ước tính, chưa tính thuế).`,
      facts: [{ label: 'Doanh thu thuần', value: vnd(c.net_revenue) }, { label: 'Lợi nhuận gộp', value: vnd(c.gross_profit) }, { label: 'Biên lợi nhuận gộp', value: pct(c.gross_margin_pct) }, { label: 'Lợi nhuận ròng ước tính', value: vnd(c.net_profit_estimate) }],
      todo: noSales ? [] : status === 'green' ? ['Đang ổn. Chỉ cần để mắt biên lợi nhuận khi đổi giá hoặc chạy khuyến mãi.'] : todo,
      link: '/reports?tab=profit', linkLabel: 'Xem lợi nhuận',
    });
  }

  // 3. Hàng
  {
    const doi = hv(d.health, 'days_of_inventory');
    const inv = d.inventory;
    const flags = [doi?.status];
    const todo = [];
    if (inv.negative.length) { flags.push('yellow'); todo.push(`${inv.negative.length} sản phẩm đang tồn âm: số trong hệ thống lệch với hàng thật. Kiểm kê lại những sản phẩm này.`); }
    if (inv.low_stock.length) { flags.push('yellow'); todo.push(`${inv.low_stock.length} sản phẩm sắp hết: nhập thêm trước khi hết hàng bán.`); }
    if (doi?.status === 'red' || doi?.status === 'yellow') todo.push('Số ngày tồn cao: tiền đang nằm trong hàng. Giảm nhập thêm, đẩy hàng bán chậm (giảm giá, combo).');
    if (inv.slow_moving.length) todo.push(`${inv.slow_moving.length} sản phẩm bán chậm (tồn ${vnd(inv.slow_moving.reduce((a, x) => a + x.stock_value, 0))}): cân nhắc xả hàng hoặc ngừng nhập.`);
    const status = inv.sku_count === 0 ? null : worst(flags) || 'green';
    out.push({
      id: 'stock', question: 'Hàng có bị kẹt hoặc sắp hết không?', status,
      headline: inv.sku_count === 0 ? 'Chưa có sản phẩm.' : `Tồn kho trị giá ${vnd(inv.stock_value)}${inv.days_of_inventory === null ? '' : `, đủ bán khoảng ${num(inv.days_of_inventory)} ngày`}.`,
      facts: [{ label: 'Giá trị tồn', value: vnd(inv.stock_value) }, { label: 'Số ngày tồn', value: inv.days_of_inventory === null ? '—' : `${num(inv.days_of_inventory)} ngày` }, { label: 'Sắp hết', value: `${inv.low_stock.length} sản phẩm` }, { label: 'Bán chậm', value: `${inv.slow_moving.length} sản phẩm` }],
      todo: status === 'green' && !todo.length ? ['Tồn kho ổn.'] : todo,
      link: '/reports?tab=inventory', linkLabel: 'Xem kho',
    });
  }

  // 4. Khách
  {
    const keys = ['repeat_rate_pct', 'cancel_rate_pct', 'return_rate_pct'];
    const hs = keys.map((k) => hv(d.health, k));
    const todo = [];
    const repeat = hs[0];
    if (repeat?.status === 'red' || repeat?.status === 'yellow') todo.push('Ít khách mua lại: dùng trang Loyalty & Campaign để nhắc khách sắp hết hàng và chăm khách cũ.');
    if (hs[1]?.status === 'red' || hs[1]?.status === 'yellow') todo.push('Nhiều đơn huỷ: xem lý do (hết hàng, khách đổi ý, giao chậm) và sửa ở khâu gây ra.');
    if (hs[2]?.status === 'red' || hs[2]?.status === 'yellow') todo.push('Nhiều đơn hoàn trả: kiểm tra chất lượng, mô tả sản phẩm và đóng gói.');
    const status = noSales ? null : worst(hs.map((h) => h?.status)) || 'green';
    out.push({
      id: 'customers', question: 'Khách có quay lại không?', status,
      headline: noSales ? 'Chưa có đơn nào trong kỳ để đánh giá.' : `Tỷ lệ khách mua lại ${pct(repeat?.value ?? null)}, đơn huỷ ${pct(hs[1]?.value ?? null)}, đơn hoàn trả ${pct(hs[2]?.value ?? null)}.`,
      facts: [{ label: 'Khách mua lại', value: pct(repeat?.value ?? null) }, { label: 'Tỷ lệ huỷ đơn', value: pct(hs[1]?.value ?? null) }, { label: 'Tỷ lệ hoàn trả', value: pct(hs[2]?.value ?? null) }],
      todo: noSales ? [] : status === 'green' ? ['Khách đang ổn.'] : todo,
      link: '/loyalty', linkLabel: 'Mở Loyalty & Campaign',
    });
  }

  // 5. Chi phí
  {
    const e = d.expense;
    const flags = [];
    const todo = [];
    if (!noSales && c.net_profit_estimate < 0) { flags.push('red'); todo.push('Chi phí đang lớn hơn lợi nhuận gộp nên đang lỗ. Cắt hoặc tăng giá/biên lợi nhuận.'); }
    const jump = e.by_category.filter((x) => x.change_pct !== null && x.change_pct > 20 && x.amount - x.previous_amount > 0).sort((a, b) => b.amount - b.previous_amount - (a.amount - a.previous_amount))[0];
    if (jump) { flags.push('yellow'); todo.push(`“${jump.name}” tăng ${String(jump.change_pct).replace('.', ',')}% so với kỳ trước (${vnd(jump.previous_amount)} → ${vnd(jump.amount)}). Xem có hợp lý không.`); }
    const status = !e.total && !e.previous_total ? null : worst(flags) || 'green';
    out.push({
      id: 'expenses', question: 'Chi phí có đang phình ra không?', status,
      headline: !e.total && !e.previous_total ? 'Chưa có chi phí nào được ghi trong kỳ.' : `Chi phí ${vnd(e.total)}${e.expense_ratio_pct === null ? '' : `, bằng ${pct(e.expense_ratio_pct)} doanh thu thuần`}${e.change_pct === null ? '' : `; ${e.change_pct >= 0 ? 'tăng' : 'giảm'} ${String(Math.abs(e.change_pct)).replace('.', ',')}% so với kỳ trước`}.`,
      facts: [{ label: 'Tổng chi phí', value: vnd(e.total) }, { label: 'So với doanh thu thuần', value: pct(e.expense_ratio_pct) }, { label: 'Khoản lớn nhất', value: e.by_category[0] ? `${e.by_category[0].name} ${vnd(e.by_category[0].amount)}` : '—' }],
      todo: status === 'green' ? ['Chi phí đang ổn so với kỳ trước.'] : todo,
      link: '/reports?tab=expenses', linkLabel: 'Xem chi phí',
    });
  }
  return out;
}

export function summarize(checks) {
  const red = checks.filter((c) => c.status === 'red').length;
  const yellow = checks.filter((c) => c.status === 'yellow').length;
  const none = checks.filter((c) => c.status === null).length;
  return { red, yellow, green: checks.length - red - yellow - none, none, first: [...checks].filter((c) => c.status).sort((a, b) => ORDER[a.status] - ORDER[b.status])[0] || null };
}

// Từ điển chỉ số nằm ở metrics.js (một nguồn cho Báo cáo, Tổng quan và trang này)
export { GLOSSARY } from './metrics.js';

export const COLOR_MEANING = [
  { status: 'green', label: 'Xanh', text: 'Ổn, không cần làm gì thêm.' },
  { status: 'yellow', label: 'Vàng', text: 'Bắt đầu lệch. Xem trong tuần này, chưa cần bỏ việc.' },
  { status: 'red', label: 'Đỏ', text: 'Cần xử lý hôm nay hoặc ngày mai.' },
];
