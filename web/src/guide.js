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
      facts: [{ label: 'Tiền trong các quỹ', value: vnd(d.accounts.total_balance) }, { label: 'Khách còn nợ', value: vnd(d.cash.customer_receivable) }, { label: 'Sàn chưa trả', value: vnd(d.cash.marketplace_pending) }, { label: 'Nợ nhà cung cấp', value: vnd(d.cash.supplier_payable) }],
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
    if (inv.negative.length) { flags.push('yellow'); todo.push(`${inv.negative.length} sản phẩm đang tồn âm: số trong app lệch với hàng thật. Kiểm kê lại những sản phẩm này.`); }
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

// Từ điển: mỗi con số là gì, tính thế nào, nên làm gì. `key` khớp khoá chỉ số sức khoẻ để gắn ngưỡng của người dùng.
export const GLOSSARY = [
  { group: 'Doanh thu và lãi', items: [
    { name: 'Doanh thu thuần', what: 'Tiền hàng thật sự bán được: tiền hàng trừ giảm giá và hàng khách trả lại. Chưa tính phí ship khách trả.', how: 'Tiền hàng − giảm giá − hàng trả', tip: 'Dùng số này để so sánh các tháng với nhau, không dùng tổng tiền khách trả (có lẫn phí ship).' },
    { name: 'Lợi nhuận gộp', what: 'Tiền còn lại sau khi trừ giá nhập của hàng đã bán, phí sàn và tiền ship shop chịu. Chưa trừ chi phí vận hành.', how: 'Doanh thu thuần + phí ship khách trả − phí sàn − ship shop chịu − giá vốn', tip: 'Đây là số cho biết “bán hàng có lời không” trước khi tính tiền thuê, quảng cáo…' },
    { name: 'Biên lợi nhuận gộp (%)', key: 'gross_margin_pct', what: 'Cứ 100 đồng doanh thu thì giữ lại được bao nhiêu đồng lãi gộp.', how: 'Lợi nhuận gộp ÷ doanh thu thuần', tip: 'Thấp: giá bán chưa đủ cao so với giá nhập, hoặc phí sàn/giảm giá đang ăn hết lãi. Xem tab Sản phẩm để biết sản phẩm nào biên thấp.' },
    { name: 'Chi phí', what: 'Các khoản chi vận hành đã ghi ở trang Chi phí (quảng cáo, bao bì, thuê mặt bằng…). Chi phí không gắn shop nào được chia về các shop theo Cài đặt.', how: 'Tổng chi phí trong kỳ (không tính khoản đã huỷ)', tip: 'Nhìn tỷ lệ chi phí trên doanh thu và khoản nào tăng nhanh nhất, đừng chỉ nhìn tổng.' },
    { name: 'Lợi nhuận ròng ước tính', what: 'Lãi gộp trừ chi phí. Gọi là “ước tính” vì chưa tính thuế và các khoản không ghi vào sổ.', how: 'Lợi nhuận gộp − chi phí', tip: 'Âm nghĩa là tháng đó đang lỗ sau chi phí.' },
    { name: 'Thuế ước tính', what: 'Chỉ có khi bạn bật và tự nhập mức thuế ở Cài đặt → Thuế. Để thấy lợi nhuận sau thuế, không phải tờ khai.', how: 'Theo quy tắc bạn đặt', tip: 'Mức thuế thay đổi theo thời kỳ, hãy hỏi kế toán trước khi đặt.' },
  ] },
  { group: 'Đơn hàng và khách', items: [
    { name: 'Giá trị đơn trung bình', what: 'Mỗi đơn trung bình thu về bao nhiêu doanh thu thuần.', how: 'Doanh thu thuần ÷ số đơn', tip: 'Muốn tăng: bán kèm, combo, miễn ship từ một mức giá.' },
    { name: 'Tỷ lệ huỷ đơn (%)', key: 'cancel_rate_pct', what: 'Trong 100 đơn đặt, bao nhiêu đơn bị huỷ.', how: 'Đơn huỷ ÷ (đơn bán + đơn huỷ)', tip: 'Cao: hết hàng, giao chậm hoặc khách đổi ý. Tìm nguyên nhân phổ biến nhất.' },
    { name: 'Tỷ lệ hoàn trả (%)', key: 'return_rate_pct', what: 'Trong 100 đơn đã bán, bao nhiêu đơn có khách trả lại hàng (một phần hoặc toàn bộ).', how: 'Đơn có hàng trả ÷ đơn bán', tip: 'Cao: kiểm tra chất lượng, mô tả sản phẩm, đóng gói.' },
    { name: 'Tỷ lệ khách mua lại (%)', key: 'repeat_rate_pct', what: 'Trong số khách mua trong kỳ, bao nhiêu người đã từng mua trước đó.', how: 'Khách có đơn trước đó ÷ khách mua trong kỳ', tip: 'Thấp: dùng Loyalty & Campaign để nhắc mua lại và chăm khách cũ. Khách cũ rẻ hơn khách mới nhiều lần.' },
  ] },
  { group: 'Kho', items: [
    { name: 'Giá trị tồn', what: 'Tiền đang nằm trong hàng chưa bán, tính theo giá vốn.', how: 'Σ số lượng tồn × giá vốn', tip: 'Tồn nhiều là tiền chết: không sinh lời mà còn có thể hỏng, lỗi mốt.' },
    { name: 'Số ngày tồn', key: 'days_of_inventory', what: 'Với tốc độ bán 30 ngày gần nhất, hàng đang có đủ bán bao nhiêu ngày.', how: 'Giá trị tồn ÷ (giá vốn bán ra 30 ngày ÷ 30)', tip: 'Cao: nhập quá nhiều. Quá thấp: sắp hết hàng. Mỗi ngành có mức hợp lý khác nhau nên ngưỡng do bạn đặt.' },
    { name: 'Sắp hết / Bán chậm', what: 'Sắp hết: tồn còn ít hơn số ngày bán đã đặt. Bán chậm: lâu không bán được cái nào.', how: 'Theo Cài đặt → Ngưỡng & kho', tip: 'Sắp hết: nhập thêm. Bán chậm: giảm giá hoặc ngừng nhập.' },
  ] },
  { group: 'Tiền và công nợ', items: [
    { name: 'Số dư quỹ', what: 'Tiền thật đang có trong két, tài khoản ngân hàng, ví. App tự tính từ thu chi, bạn kiểm đếm để khớp.', how: 'Số dư đầu + thu − chi − chi phí ± chuyển quỹ/điều chỉnh', tip: 'Chênh với tiền thật: có khoản thu chi chưa ghi. Kiểm đếm hằng tuần.' },
    { name: 'Khách còn nợ', what: 'Đơn bán trực tiếp/Facebook đã giao mà khách chưa trả đủ.', how: 'Σ (khách phải trả − hàng trả − đã thu)', tip: 'Xem tuổi nợ: nợ càng lâu càng khó đòi.' },
    { name: 'Sàn đang treo', what: 'Đơn Shopee đã hoàn thành nhưng chưa ghi nhận tiền sàn trả về.', how: 'Σ (tiền shop thực nhận − hàng trả − đã nhận)', tip: 'Đối chiếu với bảng kê ví Shopee, rồi ghi nhận ở Chi phí & đối soát. Treo quá lâu có thể sàn giữ tiền hoặc bạn quên ghi.' },
    { name: 'Nợ nhà cung cấp', what: 'Hàng đã nhập nhưng chưa trả đủ tiền.', how: 'Σ (tổng phiếu nhập − đã trả)', tip: 'Ưu tiên trả các khoản quá hạn để giữ uy tín và giá tốt.' },
    { name: 'Tuổi nợ', what: 'Một khoản nợ đã tồn tại bao nhiêu ngày: 0–7, 8–30, 31–60, 61–90, trên 90.', how: 'Hôm nay − ngày đặt đơn (hoặc ngày nhận hàng)', tip: 'Tập trung vào nhóm trên 30 ngày.' },
  ] },
];

export const COLOR_MEANING = [
  { status: 'green', label: 'Xanh', text: 'Ổn, không cần làm gì thêm.' },
  { status: 'yellow', label: 'Vàng', text: 'Bắt đầu lệch. Xem trong tuần này, chưa cần bỏ việc.' },
  { status: 'red', label: 'Đỏ', text: 'Cần xử lý hôm nay hoặc ngày mai.' },
];
