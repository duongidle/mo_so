import { METRICS, SCOPES, TIME_LABEL } from './metrics.js';

// Chuyển dữ liệu một tab báo cáo thành các bảng để xuất Excel. Hàm thuần: đúng cái đang thấy trên màn hình.
// Tiền là số nguyên đồng, tỷ lệ là số (không chuỗi) để Excel cộng trừ được.
const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');

/** @returns {{ name: string, headers: string[], rows: any[][] }[]} */
export function reportTables(tab, d, { range, shopName } = {}) {
  const head = [['Báo cáo', tab], ['Từ ngày', dmy(range?.from)], ['Đến ngày', dmy(range?.to)], ['Shop', shopName || 'Tất cả shop']];
  const info = { name: 'Thông tin', headers: ['Mục', 'Giá trị'], rows: head };
  const T = (name, headers, rows) => ({ name, headers, rows });
  if (tab === 'revenue') {
    const [{ data: ov }, series] = d;
    const c = ov.current;
    return [
      info,
      T('Tổng quan', ['Chỉ số', 'Giá trị'], [['Doanh thu gộp (tiền hàng)', c.gross_revenue], ['Giảm giá', c.discount_amount], ['Hàng trả', c.returned_amount], ['Doanh thu thuần', c.net_revenue], ['Số đơn', c.order_count], ['Giá trị đơn trung bình', c.aov], ['Tỷ lệ huỷ (%)', c.cancel_rate_pct], ['Tỷ lệ hoàn (%)', c.return_rate_pct]]),
      T('Theo ngày', ['Ngày', 'Số đơn', 'Doanh thu thuần', 'Lợi nhuận gộp'], series.data.map((r) => [dmy(r.date), r.order_count, r.net_revenue, r.gross_profit])),
    ];
  }
  if (tab === 'profit') {
    const [{ data: ov }, shops] = d;
    const c = ov.current;
    const out = [
      info,
      T('Lợi nhuận', ['Khoản', 'Số tiền'], [['Doanh thu thuần', c.net_revenue], ['Phí ship khách trả (sau hoàn ship)', c.shipping_fee], ['Phí trả hàng thu được', c.return_fee], ['Cọc giữ lại (đơn huỷ)', c.forfeit ?? 0], ['Phí sàn', -c.platform_fee], ['Ship shop chịu', -c.seller_shipping], ['Phí ship chiều về (trả hàng)', -c.return_shipping_cost], ['Giá vốn', -c.cogs], ['Lợi nhuận gộp', c.gross_profit], ['Biên lợi nhuận gộp (%)', c.gross_margin_pct], ['Chi phí', -c.expenses_amount], ...(c.other_profit_adjustment ? [['Điều chỉnh kho và kiểm đếm quỹ', c.other_profit_adjustment]] : []), ['Lợi nhuận ròng ước tính (trước thuế)', c.net_profit_estimate]]),
      T('Theo shop', ['Shop', 'Doanh thu thuần', 'Lợi nhuận gộp', 'Chi phí', 'Lợi nhuận ròng ước tính'], shops.data.map((s) => [s.shop_name, s.net_revenue, s.gross_profit, s.expenses_amount, s.net_profit_estimate])),
    ];
    if (ov.tax?.applicable) out.push(T('Ước tính thuế', ['Khoản thuế', 'Tỷ lệ (%)', 'Cơ sở tính', 'Ngưỡng miễn thuế cả năm', 'Số tiền chịu thuế trong kỳ', 'Thuế ước tính'], ov.tax.items.map((i) => [i.name, i.rate_pct, i.base_label, i.exempt_threshold_year, i.taxable_amount, i.tax])));
    return out;
  }
  if (tab === 'channels') return [info, T('Theo kênh', ['Kênh', 'Số đơn', 'Doanh thu thuần', 'Phí sàn', 'Lợi nhuận gộp', 'Biên (%)', 'Tỷ lệ huỷ (%)'], d.data.map((c) => [c.channel_name, c.order_count, c.net_revenue, c.platform_fee, c.gross_profit, c.gross_margin_pct, c.cancel_rate_pct]))];
  if (tab === 'products') {
    const out = [info, T('Theo sản phẩm', ['SKU', 'Sản phẩm', 'Loại', 'Đã bán', 'Qua combo', 'Doanh thu', 'Giá vốn', 'Lợi nhuận gộp', 'Biên (%)'], d[0].data.map((p) => [p.sku, `${p.product_name}${p.variant_name ? ` — ${p.variant_name}` : ''}`, p.is_bundle ? 'Combo' : 'Đơn', p.qty_sold, p.is_bundle ? null : p.qty_in_combos ?? 0, p.revenue, p.cogs, p.gross_profit, p.margin_pct]))];
    if (d[1]?.data?.length) out.push(T('Theo ngũ hành', ['Ngũ hành', 'Doanh thu', 'Số lượng'], d[1].data.map((e) => [e.element || 'Chưa gán', e.revenue, e.qty])));
    return out;
  }
  if (tab === 'customers') {
    const c = d.data;
    return [info, T('Tổng quan', ['Chỉ số', 'Giá trị'], [['Khách mua trong kỳ', c.buyers], ['Khách mới', c.new_customers], ['Khách quay lại', c.returning_customers], ['Tỷ lệ mua lại (%)', c.repeat_rate_pct]]), T('Khách chi nhiều nhất', ['Mã', 'Tên', 'Điện thoại', 'Số đơn', 'Doanh thu thuần'], c.top_customers.map((t) => [t.code, t.name, t.phone, t.order_count, t.net_revenue]))];
  }
  if (tab === 'inventory') {
    const i = d.data;
    return [
      info,
      T('Tổng quan', ['Chỉ số', 'Giá trị'], [['Giá trị tồn', i.stock_value], ['Số ngày tồn', i.days_of_inventory], ['Số SKU', i.sku_count]]),
      T('Sắp hết', ['SKU', 'Sản phẩm', 'Tồn'], i.low_stock.map((x) => [x.sku, x.product_name, x.on_hand])),
      T('Bán chậm', ['SKU', 'Sản phẩm', 'Tồn', 'Giá trị tồn'], i.slow_moving.map((x) => [x.sku, x.product_name, x.on_hand, x.stock_value])),
    ];
  }
  if (tab === 'shrinkage') {
    const r = d.data;
    const rc = r.reasons.map((x) => x.code);
    return [
      info,
      T('Theo lý do', ['Lý do', 'Số sản phẩm', 'Giá trị hao hụt'], r.reasons.map((x) => [x.label, r.totals[x.code].qty_lines, r.totals[x.code].value]).concat([['Tổng', '', r.total_value]])),
      T('Theo sản phẩm', ['SKU', 'Sản phẩm', 'Đơn vị', ...r.reasons.flatMap((x) => [`${x.label} (SL)`, `${x.label} (giá trị)`]), 'Tổng số lượng', 'Tổng giá trị', 'Nhập trong kỳ', 'Tỷ lệ hao hụt (%)'],
        r.items.map((i) => [i.sku, i.product_name, i.unit, ...rc.flatMap((c) => [i.by_reason[c].qty, i.by_reason[c].value]), i.qty, i.value, i.received_qty, i.shrink_rate === null ? '' : Math.round(i.shrink_rate * 10000) / 100])),
    ];
  }
  if (tab === 'cash') {
    const [cf, aging, accounts] = d;
    const c = cf.data;
    const ag = (key, label) => aging.data[key].buckets.map((b) => [label, b.label, b.count, b.amount]);
    return [
      info,
      T('Dòng tiền', ['Chỉ số', 'Giá trị'], [['Đã thu', c.cash_in], ['Đã chi (gồm chi phí)', c.cash_out], ['  trong đó chi phí', c.cash_out_expenses], ['Ròng', c.net_cash], ['Khách còn nợ', c.customer_receivable], ['Nợ phải trả khách (trả hàng)', c.customer_refund_owed], ['Sàn đang treo', c.marketplace_pending], ['Nợ nhà cung cấp', c.supplier_payable]]),
      T('Số dư quỹ', ['Quỹ', 'Loại', 'Số dư', 'Tại ngày'], accounts.data.map((a) => [a.name, a.kind, a.balance, dmy(accounts.as_of)])),
      T('Tuổi nợ', ['Loại nợ', 'Độ tuổi', 'Số khoản', 'Số tiền'], [...ag('customer', 'Khách nợ'), ...ag('marketplace', 'Sàn chưa trả'), ...ag('supplier', 'Nợ nhà cung cấp')]),
    ];
  }
  if (tab === 'expenses') {
    const e = d.data;
    return [
      info,
      T('Tổng quan', ['Chỉ số', 'Giá trị'], [['Tổng chi phí', e.total], ['  của shop', e.direct], ['  chi phí chung đã phân bổ', e.shared], ['Kỳ trước', e.previous_total], ['Chi phí / doanh thu thuần (%)', e.expense_ratio_pct]]),
      T('Theo danh mục', ['Danh mục', 'Số tiền', 'Của shop', 'Chung phân bổ', 'Tỷ trọng (%)', 'Kỳ trước', 'Thay đổi (%)'], e.by_category.map((c) => [c.name, c.amount, c.direct, c.shared, c.share_pct, c.previous_amount, c.change_pct])),
      T('Theo shop', ['Shop', 'Số tiền', 'Tỷ trọng (%)'], e.by_shop.map((s) => [s.shop_name, s.amount, s.share_pct])),
      T('Khoản chi lớn nhất', ['Ngày', 'Danh mục', 'Shop', 'Người nhận', 'Số tiền'], e.largest.map((x) => [dmy(x.expense_date), x.category_name, x.shop_name || 'Chung', x.payee || '', x.amount])),
    ];
  }
  if (tab === 'custom') return [info, T('Chỉ số tuỳ chỉnh', ['Chỉ số', 'Giá trị', 'Lỗi'], d.data.map((m) => [m.name, m.value, m.error || '']))];
  return [info, T('Sức khoẻ kinh doanh', ['Chỉ số', 'Giá trị', 'Mức', 'Ngưỡng vàng', 'Ngưỡng đỏ'], d.data.map((h) => [h.label, h.value, { green: 'Xanh', yellow: 'Vàng', red: 'Đỏ' }[h.status] || 'Chưa có dữ liệu', h.threshold.warn, h.threshold.bad]))];
}

const VOUCHER_TYPES = { receipt: 'Phiếu thu khác', payment: 'Phiếu chi khác', journal: 'Bút toán tổng hợp' };
const FREQ = { monthly: 'Hằng tháng', weekly: 'Hằng tuần', yearly: 'Hằng năm' };
const ASSET_STATUS = { active: 'Đang khấu hao', done: 'Đã khấu hao hết', disposed: 'Đã thanh lý', voided: 'Đã huỷ' };

/** Bảng xuất Excel cho các tab của Sổ kế toán. d = dữ liệu API của tab. */
export function accountingTables(tab, d, { range, shopName } = {}) {
  const T = (name, headers, rows) => ({ name, headers, rows });
  const info = T('Thông tin', ['Mục', 'Giá trị'], [['Báo cáo', tab], ['Từ ngày', dmy(range?.from)], ['Đến ngày', dmy(range?.to)], ['Shop', shopName || 'Tất cả shop']]);
  if (tab === 'journal') return [info, T('Sổ nhật ký', ['Mã', 'Ngày', 'Diễn giải', 'Tài khoản', 'Tên tài khoản', 'Nợ', 'Có', 'Ghi chú'], d.data.flatMap((e) => e.lines.map((l) => [e.code, dmy(e.entry_date), e.description, l.account_code, l.account_name, l.debit, l.credit, l.memo || ''])))];
  if (tab === 'ledger') return [info, T('Sổ cái', ['Mã', 'Ngày', 'Diễn giải', 'Nợ', 'Có', 'Số dư'], [['', '', 'Số dư đầu', '', '', d.opening_balance], ...d.data.map((r) => [r.entry_code, dmy(r.entry_date), r.description, r.debit, r.credit, r.balance]), ['', '', 'Số dư cuối', d.debit, d.credit, d.closing_balance]])];
  if (tab === 'trial') return [info, T('Cân đối phát sinh', ['Tài khoản', 'Tên', 'Đầu kỳ Nợ', 'Đầu kỳ Có', 'Phát sinh Nợ', 'Phát sinh Có', 'Cuối kỳ Nợ', 'Cuối kỳ Có'], [...d.data.map((r) => [r.code, r.name, r.opening_debit, r.opening_credit, r.debit, r.credit, r.closing_debit, r.closing_credit]), ['', 'Tổng', d.totals.opening_debit, d.totals.opening_credit, d.totals.debit, d.totals.credit, d.totals.closing_debit, d.totals.closing_credit]])];
  if (tab === 'income') {
    const rows = [['Doanh thu bán hàng (5111)', d.revenue_goods], ['Doanh thu phí vận chuyển (5113)', d.revenue_shipping], ['Hàng bán bị trả lại (5212)', -d.returns], ...(d.revenue_return_fee ? [['Doanh thu khác: phí trả hàng (5118)', d.revenue_return_fee]] : []), ...(d.revenue_forfeit ? [['Doanh thu khác: cọc giữ lại (5119)', d.revenue_forfeit]] : []), ['Doanh thu thuần', d.net_revenue], ['Giá vốn hàng bán (632)', -d.cogs], ['Lãi gộp', d.gross_profit],
      ...d.selling_expenses.map((r) => [`${r.name} (${r.code})`, -r.amount]), ...d.admin_expenses.map((r) => [`${r.name} (${r.code})`, -r.amount]), ...(d.depreciation_total ? [['Lãi thuần trước khấu hao', d.operating_profit_before_depreciation], ...d.depreciation.map((r) => [`Khấu hao/phân bổ: ${r.name} (${r.code})`, -r.amount])] : []), ['Lãi thuần từ kinh doanh', d.operating_profit], ['Thu nhập khác (711)', d.other_income], ['Chi phí khác (811)', -d.other_expense], ['Lợi nhuận trước thuế', d.profit_before_tax]];
    return [info, T('Kết quả kinh doanh', ['Khoản', 'Số tiền'], rows)];
  }
  if (tab === 'balance') return [T('Thông tin', ['Mục', 'Giá trị'], [['Báo cáo', 'Cân đối kế toán'], ['Đến ngày', dmy(d.as_of)], ['Phạm vi', 'Toàn tài khoản']]), T('Cân đối kế toán', ['Khoản', 'Số tiền'], [['TÀI SẢN', ''], ...d.assets.map((r) => [`${r.name} (${r.code})`, r.balance]), ['Tổng tài sản', d.total_assets], ['NỢ PHẢI TRẢ', ''], ...d.liabilities.map((r) => [`${r.name} (${r.code})`, r.balance]), ['Tổng nợ phải trả', d.total_liabilities], ['VỐN CHỦ SỞ HỮU', ''], ...d.equity.map((r) => [`${r.name} (${r.code})`, r.balance]), ['421 – Lợi nhuận kỳ này (chưa kết chuyển)', d.current_profit], ['Tổng vốn', d.total_equity], ['Tổng nợ và vốn', d.total_liabilities_equity]])];
  if (tab === 'cashflow') return [info, T('Lưu chuyển tiền', ['Khoản', 'Thu', 'Chi', 'Ròng'], [['Số dư đầu kỳ', '', '', d.opening_balance], ...d.data.map((g) => [g.label, g.inflow, g.outflow, g.net]), ['Tăng/giảm tiền trong kỳ', '', '', d.net_change], ['Số dư cuối kỳ', '', '', d.closing_balance]])];
  if (tab === 'vouchers') return [T('Chứng từ', ['Mã', 'Loại', 'Ngày', 'Diễn giải', 'Shop', 'Số tiền', 'Tình trạng', 'Tài khoản', 'Nợ', 'Có'], d.flatMap((v) => v.lines.map((l, i) => [i ? '' : v.code, i ? '' : VOUCHER_TYPES[v.type], i ? '' : dmy(v.voucher_date), i ? '' : v.description, i ? '' : v.shop_name || '', i ? '' : v.total_amount, i ? '' : v.voided_at ? 'Đã huỷ' : '', `${l.account_code} ${l.account_name}`, l.debit, l.credit])))];
  if (tab === 'assets') return [T('Tài sản & phân bổ', ['Tên', 'Loại', 'Ngày mua', 'Số tháng', 'Nguyên giá', 'Đã khấu hao/phân bổ', 'Giá trị còn lại', 'Shop', 'Tình trạng'], d.map((a) => [a.name, a.kind === 'fixed_asset' ? 'Tài sản cố định' : 'Chi phí trả trước', dmy(a.start_date), a.months, a.cost, a.accumulated, a.remaining, a.shop_name || 'Chung', ASSET_STATUS[a.status]]))];
  if (tab === 'accounts') return [T('Hệ thống tài khoản', ['Mã', 'Tên', 'Loại', 'Bên bình thường', 'Số dư'], d.map((a) => [a.code, a.name, a.type, a.normal_side === 'debit' ? 'Nợ' : 'Có', a.balance]))];
  return [info];
}

export const ACCOUNTING_TAB_METRICS = {
  overview: ['acc_cash', 'acc_receivable', 'acc_payable', 'acc_inventory', 'acc_profit'],
  trial: ['acc_trial'],
  income: ['acc_net_revenue', 'acc_cogs', 'acc_gross_profit', 'acc_expenses', 'acc_depreciation', 'acc_other', 'acc_profit'],
  assets: ['acc_depreciation'],
  vouchers: ['acc_other'],
  lock: ['acc_lock'],
  balance: ['acc_assets', 'acc_equity'],
  cashflow: ['acc_cashflow', 'acc_cash'],
};

/** Tên sheet Excel: tối đa 31 ký tự, không chứa : \ / ? * [ ] */
export const sheetName = (s) => s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

// Chỉ số của từng tab, để sheet "Giải thích" liệt kê đúng những gì file đang chứa
export const TAB_METRICS = {
  revenue: ['gross_revenue', 'discount_amount', 'returned_amount', 'net_revenue', 'order_count', 'aov', 'cancel_rate_pct', 'return_rate_pct'],
  profit: ['net_revenue', 'shipping_fee', 'return_fee', 'forfeit', 'platform_fee', 'seller_shipping', 'return_shipping_cost', 'cogs', 'gross_profit', 'gross_margin_pct', 'expenses_amount', 'net_profit_estimate', 'tax_estimate', 'profit_after_tax_estimate'],
  expenses: ['expenses_total', 'expense_ratio_pct', 'expenses_direct', 'expenses_shared', 'expense_share_pct', 'expense_change_pct', 'expense_largest'],
  channels: ['channel_table', 'order_count', 'net_revenue', 'platform_fee', 'gross_profit', 'gross_margin_pct', 'cancel_rate_pct'],
  products: ['qty_sold', 'qty_in_combos', 'product_revenue', 'product_cogs', 'product_gross_profit', 'product_margin_pct', 'element_revenue'],
  customers: ['buyers', 'new_customers', 'returning_customers', 'repeat_rate_pct', 'top_customers'],
  inventory: ['stock_value', 'days_of_inventory', 'sku_count', 'low_stock', 'slow_moving'],
  shrinkage: ['shrink_value', 'shrink_rate', 'shrink_by_reason'],
  cash: ['fund_balance', 'cash_in', 'cash_out', 'net_cash', 'customer_receivable', 'customer_refund_owed', 'marketplace_pending', 'supplier_payable', 'aging_customer', 'aging_marketplace', 'aging_supplier'],
  custom: ['custom_metric'],
  health: ['gross_margin_pct', 'cancel_rate_pct', 'return_rate_pct', 'days_of_inventory', 'repeat_rate_pct', 'health_status'],
};

/** Sheet "Giải thích": nghĩa, cách tính, nguồn và phạm vi của các chỉ số trong tab */
export function explainTable(tab) {
  const rows = (TAB_METRICS[tab] || ACCOUNTING_TAB_METRICS[tab] || []).map((k) => METRICS[k]).filter(Boolean).map((m) => [m.name, m.what, m.formula, m.source, [SCOPES[m.scope], m.time === 'today' ? TIME_LABEL.today : null].filter(Boolean).join(' · ')]);
  return { name: 'Giải thích', headers: ['Chỉ số', 'Là gì', 'Cách tính', 'Lấy từ đâu', 'Phạm vi'], rows };
}
