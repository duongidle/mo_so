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
      T('Lợi nhuận', ['Khoản', 'Số tiền'], [['Doanh thu thuần', c.net_revenue], ['Phí ship khách trả', c.shipping_fee], ['Phí sàn', -c.platform_fee], ['Ship shop chịu', -c.seller_shipping], ['Giá vốn', -c.cogs], ['Lợi nhuận gộp', c.gross_profit], ['Biên lợi nhuận gộp (%)', c.gross_margin_pct], ['Chi phí', -c.expenses_amount], ['Lợi nhuận ròng ước tính (trước thuế)', c.net_profit_estimate]]),
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
  if (tab === 'cash') {
    const [cf, aging, accounts] = d;
    const c = cf.data;
    const ag = (key, label) => aging.data[key].buckets.map((b) => [label, b.label, b.count, b.amount]);
    return [
      info,
      T('Dòng tiền', ['Chỉ số', 'Giá trị'], [['Đã thu', c.cash_in], ['Đã chi (gồm chi phí)', c.cash_out], ['  trong đó chi phí', c.cash_out_expenses], ['Ròng', c.net_cash], ['Khách còn nợ', c.customer_receivable], ['Sàn đang treo', c.marketplace_pending], ['Nợ nhà cung cấp', c.supplier_payable]]),
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

/** Tên sheet Excel: tối đa 31 ký tự, không chứa : \ / ? * [ ] */
export const sheetName = (s) => s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
