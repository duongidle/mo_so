// Từ điển chỉ số dùng chung cho Báo cáo, Tổng quan và trang "Cách đọc số liệu".
// Mỗi định nghĩa phải đúng với SQL trong server/modules/reports (service.js, stats.js). Sửa công thức ở server thì sửa ở đây.
//
// scope:
//   'filter'           theo shop & kênh đang lọc
//   'shop_plus_shared' shop đang xem + phần chi phí chung được chia về shop
//   'account'          toàn tài khoản (mọi shop), không đổi theo bộ lọc shop
//   'warehouse'        theo kho của shop (tồn kho thật, tính đến hôm nay)
// time: 'range' (mặc định, theo khoảng ngày đang chọn) | 'today' (số tính đến hôm nay, không theo khoảng ngày)

export const SCOPES = {
  filter: 'Theo shop & kênh đang lọc',
  shop_plus_shared: 'Shop đang xem + phần chi phí chung được chia',
  account: 'Toàn tài khoản (mọi shop)',
  warehouse: 'Theo kho của shop',
};
export const TIME_LABEL = { today: 'Tính đến hôm nay' };

const COUNTED_TXT = 'Chỉ đơn đã xác nhận trở đi (xác nhận, đang giao, hoàn thành, trả toàn phần). Đơn nháp và đơn huỷ không tính.';
const BY_DATE = 'Đơn tính theo ngày đặt (giờ Việt Nam).';
const ORDERS_NOTE = 'Danh sách đơn có cả đơn nháp và đơn huỷ: bỏ chúng đi khi đối chiếu.';

const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const COUNTED_STATUS = 'confirmed,shipping,completed,returned';
// f = { from, to, channel }. Shop lấy từ shop đang chọn của phiên nên không cần truyền.
const ordersLink = (status) => (f) => `/orders?${q({ status, from: f.from, to: f.to, channel: f.channel })}`;
const ordersCounted = ordersLink(COUNTED_STATUS);

const M = (key, name, o) => ({ key, name, scope: 'filter', time: 'range', ...o });

const LIST = [
  // ---------- Doanh thu ----------
  M('gross_revenue', 'Doanh thu gộp (tiền hàng)', {
    group: 'Doanh thu và lãi', what: 'Tổng tiền hàng theo giá niêm yết trên đơn, trước khi trừ giảm giá và hàng trả.',
    formula: 'Σ (đơn giá × số lượng) của các dòng đơn',
    source: `${COUNTED_TXT} ${BY_DATE}`, tip: 'Số này lớn hơn doanh thu thuần. Dùng để thấy giảm giá và hàng trả đang lấy đi bao nhiêu.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('discount_amount', 'Giảm giá', {
    group: 'Doanh thu và lãi', what: 'Tiền hàng đã giảm cho khách, gồm giảm giá từng dòng và giảm giá cả đơn.',
    formula: 'Σ (giảm giá dòng + giảm giá đơn)', source: `${COUNTED_TXT} ${BY_DATE}`,
    tip: 'Giảm giá tăng mà số đơn không tăng theo: khuyến mãi đang không có tác dụng.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('returned_amount', 'Hàng trả', {
    group: 'Doanh thu và lãi', what: 'Tiền hàng khách đã trả lại (một phần hoặc toàn bộ), theo giá khách thực mua (đã trừ giảm giá dòng và phần giảm giá đơn chia cho dòng đó).',
    formula: 'Σ giá trị hàng ghi trên phiếu trả của các đơn trong kỳ (không gồm hoàn phí ship và phí trả hàng)',
    source: `${COUNTED_TXT} Hàng trả được tính vào ngày của đơn gốc, không phải ngày khách trả, nên doanh thu một ngày đã chốt không đổi ngược về sau.`,
    tip: 'Cao bất thường: kiểm tra chất lượng, mô tả sản phẩm, đóng gói.', drill: ordersLink('returned'),
  }),
  M('net_revenue', 'Doanh thu thuần', {
    group: 'Doanh thu và lãi', what: 'Tiền hàng thật sự bán được: tiền hàng trừ giảm giá và hàng khách trả lại. Chưa gồm phí ship khách trả và phí trả hàng thu được (hai khoản đó hiện riêng).',
    formula: 'Tiền hàng − giảm giá − hàng trả', source: `${COUNTED_TXT} ${BY_DATE} Hàng trả tính vào ngày đơn gốc.`,
    tip: 'Dùng số này để so sánh các tháng với nhau, không dùng tổng tiền khách trả (có lẫn phí ship).', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('order_count', 'Số đơn', {
    group: 'Đơn hàng và khách', what: 'Số đơn đã bán trong kỳ.', formula: 'Đếm đơn có trạng thái xác nhận, đang giao, hoàn thành hoặc trả toàn phần',
    source: `${COUNTED_TXT} ${BY_DATE}`, tip: 'Xem cùng giá trị đơn trung bình: doanh thu tăng có thể do nhiều đơn hơn hoặc đơn lớn hơn.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('aov', 'Giá trị đơn trung bình', {
    group: 'Đơn hàng và khách', what: 'Mỗi đơn trung bình thu về bao nhiêu doanh thu thuần.', formula: 'Doanh thu thuần ÷ số đơn (làm tròn đồng)',
    source: 'Từ doanh thu thuần và số đơn cùng kỳ, cùng bộ lọc.', tip: 'Muốn tăng: bán kèm, combo, miễn ship từ một mức giá.',
  }),
  M('cancel_rate_pct', 'Tỷ lệ huỷ đơn (%)', {
    group: 'Đơn hàng và khách', what: 'Trong 100 đơn đặt, bao nhiêu đơn bị huỷ.', formula: 'Đơn huỷ ÷ (đơn đã bán + đơn huỷ) × 100',
    source: `Đơn huỷ là đơn trạng thái “đã huỷ” (đã từng xác nhận hoặc nhập từ sàn); đơn nháp không tính. ${BY_DATE}`,
    tip: 'Cao: hết hàng, giao chậm hoặc khách đổi ý. Tìm nguyên nhân phổ biến nhất.', drill: ordersLink('cancelled'),
  }),
  M('return_rate_pct', 'Tỷ lệ hoàn trả (%)', {
    group: 'Đơn hàng và khách', what: 'Trong 100 đơn đã bán, bao nhiêu đơn có khách trả lại hàng (một phần hoặc toàn bộ).', formula: 'Đơn có hàng trả ÷ số đơn đã bán × 100',
    source: `${COUNTED_TXT} ${BY_DATE}`, tip: 'Cao: kiểm tra chất lượng, mô tả sản phẩm, đóng gói.', drill: ordersLink('returned'), drillNote: 'Chỉ liệt kê đơn trả toàn phần; đơn trả một phần vẫn ở trạng thái hoàn thành.',
  }),
  M('revenue_by_day', 'Doanh thu theo ngày', {
    group: 'Doanh thu và lãi', what: 'Doanh thu thuần của từng ngày trong kỳ.', formula: 'Doanh thu thuần, cộng riêng từng ngày',
    source: `${COUNTED_TXT} ${BY_DATE} Cộng các ngày lại bằng đúng doanh thu thuần của kỳ.`, tip: 'Tìm ngày bất thường (đột biến hoặc trống) rồi mở danh sách đơn của ngày đó.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),

  // ---------- Lợi nhuận ----------
  M('shipping_fee', 'Phí ship khách trả', {
    group: 'Doanh thu và lãi', what: 'Tiền ship khách trả thêm trên đơn, đã trừ phần ship hoàn lại cho khách khi trả hàng.', formula: 'Σ (phí ship khách trả − phí ship đã hoàn khách)', source: `${COUNTED_TXT} ${BY_DATE}`,
    tip: 'Được cộng vào lợi nhuận gộp, nhưng không nằm trong doanh thu thuần.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('return_fee', 'Phí trả hàng thu được', {
    group: 'Doanh thu và lãi', what: 'Tiền shop giữ lại khi khách trả hàng (phí trả hàng, hoặc giữ toàn bộ tiền khách đã trả). Là doanh thu khác, cộng vào lợi nhuận gộp, không nằm trong doanh thu thuần.',
    formula: 'Σ phí trả hàng ghi trên phiếu trả', source: `${COUNTED_TXT} ${BY_DATE} Tính vào ngày của đơn gốc. Khớp tài khoản 5118 trong sổ kế toán.`,
    tip: 'Lợi nhuận gộp chỉ giữ nguyên khi khách trả hàng nếu shop thu phí này. Không thu thì doanh thu và lãi của đơn mất theo hàng trả.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('return_shipping_cost', 'Phí ship chiều về (trả hàng)', {
    group: 'Doanh thu và lãi', what: 'Tiền ship shop trả để nhận hàng khách gửi lại (hoặc đơn bị khách từ chối nhận).', formula: 'Σ phí ship chiều về ghi trên phiếu trả',
    source: `${COUNTED_TXT} ${BY_DATE} Tính vào ngày của đơn gốc. Ghi vào chi phí vận chuyển (6412) trong sổ kế toán.`, tip: 'Cao: xem lại chính sách đổi trả, hoặc thu phí trả hàng để bù.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('platform_fee', 'Phí sàn', {
    group: 'Doanh thu và lãi', what: 'Hoa hồng, phí thanh toán, phí dịch vụ sàn thu trên đơn.', formula: 'Σ phí sàn ghi trên đơn',
    source: `${COUNTED_TXT} ${BY_DATE} Khi khách trả hàng, app giả định sàn không hoàn lại phí sàn.`, tip: 'Phí sàn ăn nhiều: xem lại giá bán trên sàn hoặc chương trình tham gia.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('seller_shipping', 'Ship shop chịu', {
    group: 'Doanh thu và lãi', what: 'Tiền ship shop tự trả (khách không trả).', formula: 'Σ phí ship shop chịu ghi trên đơn', source: `${COUNTED_TXT} ${BY_DATE}`,
    tip: 'Cân nhắc miễn ship từ một mức đơn thay vì chịu mọi đơn.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('cogs', 'Giá vốn', {
    group: 'Doanh thu và lãi', what: 'Giá nhập của hàng đã bán, chụp lúc bán.', formula: 'Σ giá vốn các dòng đơn = số lượng × giá vốn bình quân của kho xuất (đơn lấy từ nhiều kho cộng theo từng phần)',
    source: `${COUNTED_TXT} ${BY_DATE} Giá vốn được chụp lúc xác nhận đơn, không tính lại về sau. Hàng khách trả đã nhập lại kho thì được trừ khỏi giá vốn. Combo: tổng giá vốn thành phần.`,
    tip: 'Giá vốn sai thì lợi nhuận sai mà trông vẫn hợp lý. Nhập đủ phí nhập hàng để giá vốn đúng.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('gross_profit', 'Lợi nhuận gộp', {
    group: 'Doanh thu và lãi', what: 'Tiền còn lại sau khi trừ giá nhập của hàng đã bán, phí sàn, ship shop chịu và ship chiều về. Gồm phí ship khách trả (đã trừ hoàn ship) và phí trả hàng thu được. Chưa trừ chi phí vận hành.',
    formula: 'Doanh thu thuần + phí ship khách trả + phí trả hàng thu được − phí sàn − ship shop chịu − ship chiều về − giá vốn', source: `${COUNTED_TXT} ${BY_DATE}`,
    tip: 'Đây là số cho biết “bán hàng có lời không” trước khi tính tiền thuê, quảng cáo…', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('gross_margin_pct', 'Biên lợi nhuận gộp (%)', {
    group: 'Doanh thu và lãi', health: true, what: 'Cứ 100 đồng doanh thu thì giữ lại được bao nhiêu đồng lãi gộp.', formula: 'Lợi nhuận gộp ÷ doanh thu thuần × 100',
    source: 'Từ lợi nhuận gộp và doanh thu thuần cùng kỳ, cùng bộ lọc. Ngưỡng vàng/đỏ do bạn đặt ở Cài đặt.',
    tip: 'Thấp: giá bán chưa đủ cao so với giá nhập, hoặc phí sàn/giảm giá đang ăn hết lãi. Xem tab Sản phẩm để biết sản phẩm nào biên thấp.',
  }),
  M('expenses_amount', 'Chi phí', {
    group: 'Doanh thu và lãi', scope: 'shop_plus_shared', what: 'Các khoản chi vận hành đã ghi ở trang Chi phí (quảng cáo, bao bì, thuê mặt bằng…), đã quy về shop đang xem.',
    formula: 'Chi phí của shop + phần chi phí chung chia về shop',
    source: 'Chi phí chưa huỷ, tính theo ngày chi. Chi phí không gắn shop nào được chia cho các shop đang hoạt động theo quy tắc ở Cài đặt (theo doanh thu thuần của mọi shop và mọi kênh, chia đều, hoặc tỷ lệ cố định). Chi phí của shop đã lưu trữ vẫn tính vào tổng.',
    tip: 'Nhìn tỷ lệ chi phí trên doanh thu và khoản nào tăng nhanh nhất, đừng chỉ nhìn tổng.', drill: () => '/expenses',
  }),
  M('net_profit_estimate', 'Lợi nhuận ròng ước tính', {
    group: 'Doanh thu và lãi', scope: 'shop_plus_shared', what: 'Lãi gộp trừ chi phí. Gọi là “ước tính” vì chưa tính thuế và các khoản không ghi vào sổ.',
    formula: 'Lợi nhuận gộp − chi phí (đã gồm phần chi phí chung chia về)', source: 'Lợi nhuận gộp (đơn tính theo ngày đặt) trừ chi phí cùng kỳ (tính theo ngày chi, chia chi phí chung theo quy tắc ở Cài đặt).',
    tip: 'Âm nghĩa là kỳ đó đang lỗ sau chi phí.',
  }),
  M('tax_estimate', 'Thuế ước tính', {
    group: 'Doanh thu và lãi', scope: 'account', what: 'Chỉ có khi bạn bật và tự nhập mức thuế ở Cài đặt → Thuế. Để thấy lợi nhuận sau thuế, không phải tờ khai.',
    formula: 'Theo từng khoản bạn đặt: tỷ lệ % × (cơ sở cộng dồn từ đầu năm − ngưỡng miễn thuế), trừ phần đã tính trước kỳ',
    source: 'Tính cho cả hộ kinh doanh trên mọi shop và mọi kênh, cộng dồn từ đầu năm dương lịch. Khi lọc theo một shop thì không hiện vì thuế không chia theo shop.',
    tip: 'Mức thuế thay đổi theo thời kỳ, hãy hỏi kế toán trước khi đặt.', drill: () => '/settings',
  }),
  M('profit_after_tax_estimate', 'Lợi nhuận sau thuế ước tính', {
    group: 'Doanh thu và lãi', scope: 'account', what: 'Lợi nhuận ròng ước tính trừ thuế ước tính.', formula: 'Lợi nhuận ròng ước tính − thuế ước tính',
    source: 'Chỉ có khi bật thuế và không lọc shop/kênh (thuế tính cho cả hộ).', tip: 'Chỉ để hình dung, không phải số trên tờ khai.',
  }),

  // ---------- Chi phí ----------
  M('expenses_total', 'Tổng chi phí', {
    group: 'Chi phí', scope: 'shop_plus_shared', what: 'Tổng chi phí trong kỳ của shop đang xem, gồm phần chi phí chung chia về.', formula: 'Chi phí của shop + phần chung đã chia',
    source: 'Chi phí chưa huỷ, tính theo ngày chi. Phần chung chia theo quy tắc ở Cài đặt; phép chia dùng cách chia không lệch đồng nên cộng các shop lại bằng đúng số gốc. Tất cả shop: tổng chi phí của tài khoản.',
    tip: 'So với kỳ trước và với doanh thu, đừng chỉ nhìn tổng.', drill: () => '/expenses',
  }),
  M('expense_ratio_pct', 'Chi phí / doanh thu thuần (%)', {
    group: 'Chi phí', scope: 'shop_plus_shared', what: 'Chi phí chiếm bao nhiêu phần trăm doanh thu thuần.', formula: 'Tổng chi phí ÷ doanh thu thuần × 100',
    source: 'Tổng chi phí (đã gồm phần chung chia về) và doanh thu thuần cùng kỳ, cùng bộ lọc.', tip: 'Tăng liên tục qua các kỳ: chi phí đang lớn nhanh hơn doanh thu.',
  }),
  M('expenses_direct', 'Chi phí của riêng shop', {
    group: 'Chi phí', what: 'Chi phí đã ghi thẳng cho shop đang xem.', formula: 'Σ chi phí có shop = shop đang xem', source: 'Chi phí chưa huỷ, tính theo ngày chi.', tip: 'Đây là phần chắc chắn của shop, không phụ thuộc cách chia.', drill: () => '/expenses',
  }),
  M('expenses_shared', 'Chi phí chung đã chia', {
    group: 'Chi phí', scope: 'shop_plus_shared', what: 'Phần chi phí không gắn shop nào, được chia về shop đang xem.', formula: 'Chi phí chung × tỷ lệ của shop theo quy tắc chia',
    source: 'Quy tắc chia ở Cài đặt: theo doanh thu thuần (mọi shop, mọi kênh), chia đều hoặc tỷ lệ cố định. Chỉ chia cho shop đang hoạt động.', tip: 'Đổi quy tắc chia ở Cài đặt nếu thấy tỷ lệ không hợp lý.', drill: () => '/settings',
  }),
  M('expense_share_pct', 'Tỷ trọng danh mục (%)', {
    group: 'Chi phí', scope: 'shop_plus_shared', what: 'Danh mục này chiếm bao nhiêu phần trăm tổng chi phí.', formula: 'Chi phí của danh mục ÷ tổng chi phí × 100', source: 'Cùng nguồn với Tổng chi phí.', tip: 'Tập trung vào 2 đến 3 danh mục lớn nhất.',
  }),
  M('expense_change_pct', 'Thay đổi chi phí so kỳ trước (%)', {
    group: 'Chi phí', scope: 'shop_plus_shared', what: 'Chi phí danh mục tăng hay giảm bao nhiêu so với kỳ liền trước có cùng số ngày.', formula: '(kỳ này − kỳ trước) ÷ kỳ trước × 100',
    source: 'Kỳ trước là khoảng ngay trước khoảng đang chọn, dài bằng nhau. Không tính được khi kỳ trước bằng 0.', tip: 'Trên 20% hiện màu đỏ: xem khoản tăng đó có hợp lý không.',
  }),
  M('expense_largest', 'Khoản chi lớn nhất', {
    group: 'Chi phí', what: 'Năm khoản chi đơn lẻ lớn nhất trong kỳ.', formula: 'Sắp xếp từng khoản chi theo số tiền giảm dần, lấy 5',
    source: 'Từng khoản chi chưa huỷ trong kỳ, gồm chi phí của shop đang xem và chi phí chung (chưa chia, hiện đủ số tiền).', tip: 'Tìm khoản bất thường hoặc nhập nhầm.', drill: () => '/expenses',
  }),

  // ---------- Kênh / sản phẩm ----------
  M('channel_table', 'Số liệu theo kênh', {
    group: 'Doanh thu và lãi', what: 'Mỗi dòng là một kênh bán (Shopee, Facebook, trực tiếp…).', formula: 'Cùng công thức doanh thu thuần, lợi nhuận gộp… nhưng cộng riêng từng kênh',
    source: `${COUNTED_TXT} ${BY_DATE} Lợi nhuận gộp theo kênh chưa trừ chi phí vận hành (chi phí không chia theo kênh ở bảng này).`, tip: 'So biên lợi nhuận giữa các kênh để biết kênh nào đáng đầu tư.', drill: ordersCounted, drillNote: ORDERS_NOTE,
  }),
  M('qty_sold', 'Số lượng đã bán', {
    group: 'Sản phẩm', what: 'Số đơn vị sản phẩm đã bán, đã trừ hàng trả.', formula: 'Σ (số lượng − số lượng đã trả) của các dòng đơn', source: `${COUNTED_TXT} ${BY_DATE} Combo tính ở dòng combo; thành phần bán qua combo không cộng vào cột này.`, tip: 'Sản phẩm bán nhiều nhưng biên thấp thì bán càng nhiều càng ít lãi.',
  }),
  M('qty_in_combos', 'Số lượng qua combo', {
    group: 'Sản phẩm', what: 'Số đơn vị của sản phẩm này đã bán nằm trong combo.', formula: 'Σ (số lượng mỗi combo × số combo đã bán, trừ combo trả)', source: `${COUNTED_TXT} ${BY_DATE} Không cộng vào số lượng đã bán để không đếm hai lần.`, tip: 'Cộng với số lượng đã bán để biết tổng hàng thật đã xuất.',
  }),
  M('product_revenue', 'Doanh thu theo sản phẩm', {
    group: 'Sản phẩm', what: 'Tiền hàng của sản phẩm sau giảm giá và hàng trả.', formula: 'Σ (thành tiền dòng − phần giảm giá đơn chia cho dòng − hàng trả của dòng)',
    source: `${COUNTED_TXT} ${BY_DATE} Đã trừ hàng trả theo từng dòng nên cộng các sản phẩm lại khớp doanh thu thuần của đơn (chưa gồm phí ship). Lọc danh mục áp dụng ở tab này.`,
    tip: 'Xếp giảm dần theo doanh thu, tối đa 50 dòng.',
  }),
  M('product_cogs', 'Giá vốn theo sản phẩm', {
    group: 'Sản phẩm', what: 'Giá nhập của số hàng đã bán của sản phẩm.', formula: 'Σ giá vốn các dòng đơn của sản phẩm', source: `${COUNTED_TXT} Giá vốn chụp lúc bán; combo là tổng giá vốn thành phần.`, tip: 'Giá vốn đổi theo mỗi lần nhập; giá vốn cũ không bị tính lại.',
  }),
  M('product_gross_profit', 'Lợi nhuận gộp theo sản phẩm', {
    group: 'Sản phẩm', what: 'Doanh thu trừ giá vốn của sản phẩm.', formula: 'Doanh thu − giá vốn', source: 'Chưa trừ phí sàn, ship shop chịu và chi phí vận hành (những khoản này thuộc cả đơn, không chia theo sản phẩm).', tip: 'Dùng để chọn sản phẩm nên đẩy bán hoặc ngừng nhập.',
  }),
  M('product_margin_pct', 'Biên theo sản phẩm (%)', {
    group: 'Sản phẩm', what: 'Lãi gộp của sản phẩm trên mỗi 100 đồng doanh thu.', formula: 'Lợi nhuận gộp ÷ doanh thu × 100', source: 'Từ doanh thu và giá vốn của sản phẩm ở cột bên cạnh.', tip: 'Thấp: tăng giá, đổi nhà cung cấp hoặc bớt giảm giá.',
  }),
  M('element_revenue', 'Doanh thu theo ngũ hành', {
    group: 'Sản phẩm', what: 'Doanh thu chia theo hành của sản phẩm (shop phong thuỷ).', formula: 'Doanh thu từng sản phẩm; sản phẩm hợp nhiều hành chia đều cho các hành đó',
    source: `${COUNTED_TXT} Hành đọc từ trường “ngũ hành” của sản phẩm ở đúng shop của đơn; chưa gán hoặc shop không có trường này thì vào “chưa gán”. Tổng 5 hành + chưa gán = doanh thu hàng.`, tip: 'Hành nào ít bán: có thể thiếu hàng hợp hành đó.',
  }),
  M('combo_qty', 'Combo đã bán', {
    group: 'Sản phẩm', what: 'Số combo đã bán trong kỳ.', formula: 'Σ (số lượng − số lượng trả) của các dòng combo', source: `${COUNTED_TXT} ${BY_DATE}`, tip: 'Combo không có tồn riêng, bán combo là trừ kho từng thành phần.',
  }),
  M('combo_revenue', 'Doanh thu combo', {
    group: 'Sản phẩm', what: 'Doanh thu của mọi combo.', formula: 'Tổng doanh thu theo sản phẩm của các dòng combo', source: `${COUNTED_TXT} ${BY_DATE}`, tip: 'So với doanh thu tổng để biết combo đóng góp bao nhiêu.',
  }),
  M('combo_cogs', 'Giá vốn combo', {
    group: 'Sản phẩm', what: 'Tổng giá vốn thành phần của các combo đã bán.', formula: 'Σ số lượng × giá vốn từng thành phần lúc bán', source: 'Ảnh chụp thành phần và giá vốn lưu trên dòng đơn, nên đúng cả khi công thức combo đổi sau này.', tip: 'Combo lãi ít hơn bán lẻ: xem lại giá combo.',
  }),
  M('combo_gross_profit', 'Lợi nhuận gộp combo', {
    group: 'Sản phẩm', what: 'Doanh thu combo trừ giá vốn combo.', formula: 'Doanh thu combo − giá vốn combo', source: 'Chưa trừ phí sàn, ship shop chịu và chi phí vận hành.', tip: 'Dùng để quyết định có nên giữ combo.',
  }),

  // ---------- Khách ----------
  M('buyers', 'Khách mua trong kỳ', {
    group: 'Đơn hàng và khách', what: 'Số khách khác nhau có đơn trong kỳ.', formula: 'Đếm khách (không trùng) có ít nhất một đơn đã bán', source: `${COUNTED_TXT} Chỉ đơn có gắn khách; khách lẻ không tính. ${BY_DATE}`, tip: 'So với số đơn: ít khách mà nhiều đơn là khách quen mua nhiều.',
  }),
  M('new_customers', 'Khách mới', {
    group: 'Đơn hàng và khách', what: 'Khách mua trong kỳ mà trước kỳ chưa từng mua.', formula: 'Khách có đơn trong kỳ và không có đơn đã bán nào trước ngày bắt đầu kỳ',
    source: 'Xét lịch sử mua trên toàn hệ thống (mọi shop), không chỉ shop đang xem: khách đã mua ở shop khác vẫn tính là khách cũ.', tip: 'Ít khách mới: xem lại quảng cáo và kênh bán.',
  }),
  M('returning_customers', 'Khách quay lại', {
    group: 'Đơn hàng và khách', what: 'Khách mua trong kỳ mà đã có đơn trước đó.', formula: 'Khách có đơn trong kỳ và có một đơn đã bán khác đặt sớm hơn', source: 'Xét lịch sử trên toàn hệ thống (mọi shop).', tip: 'Khách cũ rẻ hơn khách mới nhiều lần: chăm họ bằng Loyalty & Campaign.',
  }),
  M('repeat_rate_pct', 'Tỷ lệ khách mua lại (%)', {
    group: 'Đơn hàng và khách', health: true, what: 'Trong số khách mua trong kỳ, bao nhiêu người đã từng mua trước đó.', formula: 'Khách quay lại ÷ khách mua trong kỳ × 100',
    source: 'Khách quay lại và khách mua trong kỳ như hai chỉ số trên; lịch sử xét toàn hệ thống.', tip: 'Thấp: dùng Loyalty & Campaign để nhắc mua lại và chăm khách cũ.',
  }),
  M('top_customers', 'Khách chi nhiều nhất', {
    group: 'Đơn hàng và khách', what: 'Mười khách có doanh thu thuần cao nhất trong kỳ.', formula: 'Σ doanh thu thuần các đơn của từng khách, xếp giảm dần', source: `${COUNTED_TXT} Theo shop đang xem.`, tip: 'Nên chăm sóc riêng nhóm này.', drill: () => '/customers',
  }),

  // ---------- Kho ----------
  M('stock_value', 'Giá trị tồn', {
    group: 'Kho', scope: 'warehouse', time: 'today', what: 'Tiền đang nằm trong hàng chưa bán, tính theo giá vốn.', formula: 'Σ số lượng tồn × giá vốn bình quân (tồn âm tính bằng 0)',
    source: 'Tồn kho hiện tại của các sản phẩm đang niêm yết ở shop đang xem, cộng mọi kho. Tất cả shop: toàn bộ sản phẩm. Không phụ thuộc khoảng ngày. Combo không có tồn riêng nên không cộng.',
    tip: 'Tồn nhiều là tiền chết: không sinh lời mà còn có thể hỏng, lỗi mốt.', drill: () => '/stock',
  }),
  M('days_of_inventory', 'Số ngày tồn', {
    group: 'Kho', scope: 'warehouse', time: 'today', health: true, what: 'Với tốc độ bán 30 ngày gần nhất, hàng đang có đủ bán bao nhiêu ngày.', formula: 'Giá trị tồn ÷ (giá vốn bán ra 30 ngày ÷ 30)',
    source: 'Giá trị tồn hiện tại chia cho giá vốn của đơn đã bán trong 30 ngày gần nhất, tính trên cùng phạm vi với giá trị tồn (đúng shop đang xem). Không có bán trong 30 ngày thì để trống. Ở mục Sức khoẻ: chỉ tính theo shop khi chọn đúng một shop, còn lại tính toàn tài khoản.',
    tip: 'Cao: nhập quá nhiều. Quá thấp: sắp hết hàng. Mỗi ngành có mức hợp lý khác nhau nên ngưỡng do bạn đặt.', drill: () => '/stock',
  }),
  M('sku_count', 'Số SKU', {
    group: 'Kho', scope: 'warehouse', time: 'today', what: 'Số biến thể (SKU) đang theo dõi tồn.', formula: 'Đếm biến thể chưa lưu trữ (kể cả combo) niêm yết ở shop đang xem', source: 'Danh sách tồn kho hiện tại.', tip: 'Nhiều SKU bán chậm làm kẹt vốn.', drill: () => '/stock',
  }),
  M('low_stock', 'Sắp hết', {
    group: 'Kho', scope: 'warehouse', time: 'today', what: 'Sản phẩm tồn ít, nên nhập thêm.', formula: 'Tồn ≤ mức tối thiểu của sản phẩm, hoặc số ngày còn bán được < số ngày bạn đặt ở Cài đặt',
    source: 'Tồn hiện tại và tốc độ bán 30 ngày gần nhất (sổ cái kho).', tip: 'Nhập thêm trước khi hết hàng bán.', drill: () => '/stock?filter=low',
  }),
  M('slow_moving', 'Bán chậm', {
    group: 'Kho', scope: 'warehouse', time: 'today', what: 'Sản phẩm còn tồn nhưng lâu không xuất.', formula: 'Tồn > 0 và lần xuất gần nhất cách đây quá số ngày bạn đặt ở Cài đặt (hoặc chưa từng xuất)', source: 'Sổ cái kho.', tip: 'Giảm giá, làm combo hoặc ngừng nhập.', drill: () => '/stock?filter=slow',
  }),

  // ---------- Tiền & công nợ ----------
  M('fund_balance', 'Số dư quỹ', {
    group: 'Tiền và công nợ', scope: 'account', time: 'today', what: 'Tiền thật đang có trong két, tài khoản ngân hàng, ví. App tự tính từ thu chi, bạn kiểm đếm để khớp.',
    formula: 'Số dư đầu + thu − chi − chi phí ± chuyển quỹ ± điều chỉnh kiểm đếm', source: 'Sổ quỹ của cả tài khoản, tính đến hôm nay, không theo shop và không theo khoảng ngày. Số dư không lưu sẵn, luôn tính lại từ sổ.',
    tip: 'Chênh với tiền thật: có khoản thu chi chưa ghi. Kiểm đếm hằng tuần.', drill: () => '/expenses?tab=cash',
  }),
  M('cash_in', 'Đã thu trong kỳ', {
    group: 'Tiền và công nợ', what: 'Tiền đã thu vào trong kỳ.', formula: 'Σ thanh toán thu (từ đơn) chưa huỷ, theo ngày thu',
    source: 'Theo bảng thanh toán, không phải theo đơn: đơn bán tháng trước thu tháng này tính vào tháng này. Lọc shop: chỉ khoản thu của đơn thuộc shop đó.', tip: 'Lệch nhiều so với doanh thu: có công nợ khách hoặc tiền sàn chưa về.', drill: () => '/orders',
  }),
  M('cash_out', 'Đã chi trong kỳ', {
    group: 'Tiền và công nợ', what: 'Tiền đã chi ra trong kỳ.', formula: 'Σ thanh toán chi (trả nhà cung cấp, hoàn tiền khách) + chi phí, theo ngày chi',
    source: 'Gồm chi phí vận hành làm tiền ra. Lọc shop: chỉ chi phí của đúng shop; chi phí chung không thuộc shop nào nên không tính (số đó hiện riêng ở dòng cảnh báo).', tip: 'Chi phí nằm trong số này: xem chi tiết ở tab Chi phí.', drill: () => '/expenses',
  }),
  M('net_cash', 'Ròng trong kỳ', {
    group: 'Tiền và công nợ', what: 'Tiền vào trừ tiền ra trong kỳ.', formula: 'Đã thu − đã chi', source: 'Cùng phạm vi với hai số trên. Không phải số dư quỹ.', tip: 'Âm nhiều kỳ liền: đang đốt tiền, xem chi phí và tiền nhập hàng.',
  }),
  M('customer_receivable', 'Khách còn nợ', {
    group: 'Tiền và công nợ', time: 'today', what: 'Đơn bán trực tiếp/Facebook đã xác nhận mà khách chưa trả đủ.', formula: 'Σ (khách phải trả − giảm do trả hàng − đã thu)',
    source: 'Đơn kênh không phải sàn, đã xác nhận trở đi, còn thiếu tiền. Tính đến hôm nay, không theo khoảng ngày; lọc shop thì chỉ đơn của shop đó.', tip: 'Xem tuổi nợ: nợ càng lâu càng khó đòi.', drill: () => '/orders?status=confirmed,shipping,completed',
    drillNote: 'Danh sách có cả đơn đã thu đủ; xem cột “Thu tiền”.',
  }),
  M('customer_refund_owed', 'Nợ phải trả khách (trả hàng)', {
    group: 'Tiền và công nợ', time: 'today', what: 'Khách đã trả tiền, sau đó trả hàng, nhưng shop chưa hoàn đủ tiền.', formula: 'Σ max(0, đã thu − số phải thu sau trả hàng)',
    source: 'Đơn kênh không phải sàn, đã xác nhận trở đi (kể cả đã trả toàn phần). Tính đến hôm nay; lọc shop thì chỉ đơn của shop đó. Đơn sàn không tính vì sàn tự hoàn tiền cho người mua. Bằng số dư Có của tài khoản 131 trong sổ kế toán.',
    tip: 'Hoàn bằng nút “Hoàn tiền” ở đơn. Nếu shop giữ tiền, ghi phí trả hàng lúc lập phiếu trả để khoản này không còn là nợ.', drill: () => '/orders?status=completed,returned',
    drillNote: 'Danh sách có cả đơn không nợ; mở từng đơn xem “Còn phải trả khách”.',
  }),
  M('marketplace_pending', 'Sàn đang treo', {
    group: 'Tiền và công nợ', time: 'today', what: 'Đơn trên sàn (Shopee, TikTok Shop…) đã hoàn thành nhưng chưa ghi nhận tiền sàn trả về.', formula: 'Σ (tiền shop thực nhận − hàng trả − đã nhận)',
    source: 'Đơn kênh sàn trạng thái hoàn thành còn thiếu tiền. Tính đến hôm nay; lọc shop thì chỉ đơn của shop đó.', tip: 'Đối chiếu với bảng kê ví của từng sàn, rồi ghi nhận ở Chi phí & đối soát.', drill: () => '/expenses?tab=reconcile',
  }),
  M('supplier_payable', 'Nợ nhà cung cấp', {
    group: 'Tiền và công nợ', scope: 'account', time: 'today', what: 'Hàng đã nhập nhưng chưa trả đủ tiền.', formula: 'Σ (tổng phiếu nhập − đã trả)',
    source: 'Phiếu nhập đã nhận hàng còn nợ. Phiếu nhập thuộc cả tài khoản (không gắn shop) nên số này không đổi khi lọc shop. Tính đến hôm nay.', tip: 'Ưu tiên trả các khoản quá hạn để giữ uy tín và giá tốt.', drill: () => '/purchases',
  }),
  M('aging_customer', 'Tuổi nợ khách', {
    group: 'Tiền và công nợ', time: 'today', what: 'Khách nợ đã bao nhiêu ngày, chia nhóm 0–7, 8–30, 31–60, 61–90, trên 90.', formula: 'Hôm nay − ngày đặt đơn', source: 'Cùng nguồn với “Khách còn nợ”; lọc shop thì theo shop.', tip: 'Tập trung vào nhóm trên 30 ngày.',
  }),
  M('aging_marketplace', 'Tuổi tiền sàn chưa về', {
    group: 'Tiền và công nợ', time: 'today', what: 'Tiền sàn treo đã bao nhiêu ngày.', formula: 'Hôm nay − ngày đặt đơn', source: 'Cùng nguồn với “Sàn đang treo”; lọc shop thì theo shop.', tip: 'Treo quá 30 ngày: đối chiếu bảng kê ví của sàn.',
  }),
  M('aging_supplier', 'Tuổi nợ nhà cung cấp', {
    group: 'Tiền và công nợ', scope: 'account', time: 'today', what: 'Nợ nhà cung cấp đã bao nhiêu ngày.', formula: 'Hôm nay − ngày nhận hàng', source: 'Phiếu nhập đã nhận còn nợ, toàn tài khoản (không lọc shop).', tip: 'Ưu tiên nhóm trên 30 ngày.', drill: () => '/purchases',
  }),

  // ---------- Kế toán (sổ cái) ----------
  M('acc_cash', 'Tiền (sổ cái)', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Tổng tiền đang có ở các quỹ (tiền mặt, ngân hàng, ví) theo sổ kế toán.', formula: 'Số dư Nợ − Có của các tài khoản 111x và 112x',
    source: 'Sổ cái tự sinh từ thu chi, chi phí, chuyển quỹ, kiểm đếm. Luôn bằng tổng số dư các quỹ ở Chi phí & quỹ.', tip: 'Lệch với tiền thật: kiểm đếm quỹ để ghi phần chênh.', drill: () => '/expenses?tab=cash',
  }),
  M('acc_receivable', 'Phải thu (sổ cái)', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Khách và sàn còn nợ shop theo sổ kế toán (tài khoản 131 và 1388).', formula: 'Số dư Nợ − Có của 131 + 1388',
    source: 'Mỗi đơn đã xác nhận ghi phải thu; thu tiền và hàng trả giảm đi. Khác “Khách còn nợ” ở Báo cáo: sổ cái giữ cả số dư có của từng đơn (đơn sàn trả toàn phần, sàn không hoàn phí).', tip: 'Số âm nghĩa là shop đang nợ lại khách hoặc sàn.',
  }),
  M('acc_payable', 'Phải trả người bán (sổ cái)', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Tiền còn nợ nhà cung cấp theo sổ kế toán (tài khoản 331).', formula: 'Số dư Có − Nợ của 331', source: 'Phiếu nhập đã nhận ghi nợ; trả NCC và NCC hoàn tiền giảm/tăng. Bằng “Nợ nhà cung cấp” ở Báo cáo.', tip: 'Ưu tiên trả khoản quá hạn.',
  }),
  M('acc_inventory', 'Hàng hoá (sổ cái)', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Giá trị hàng tồn theo sổ kế toán (tài khoản 156).', formula: 'Nhập hàng + tồn đầu + điều chỉnh tăng − giá vốn bán − hao hụt',
    source: 'Gần bằng Σ tồn × giá vốn bình quân; chênh vài đồng do làm tròn giá vốn bình quân về đồng nguyên.', tip: 'Chênh lớn: chạy kiểm tra sổ (npm run check-journal) và kiểm kê kho.', drill: () => '/stock',
  }),
  M('acc_net_revenue', 'Doanh thu thuần (KQKD)', {
    group: 'Kế toán', what: 'Doanh thu bán hàng cộng phí ship khách trả (đã trừ ship hoàn) và phí trả hàng thu được, trừ hàng bán bị trả lại.', formula: '5111 + 5113 + 5118 − 5212',
    source: 'Từ sổ cái, đơn tính theo ngày đặt, cùng quy tắc với báo cáo. Phần hàng (5111 − 5212) bằng “Doanh thu thuần” ở Báo cáo; 5113 bằng phí ship khách trả; 5118 bằng “Phí trả hàng thu được”.', tip: 'So với tab Doanh thu ở Báo cáo để đối chiếu.', drill: () => '/reports?tab=profit',
  }),
  M('acc_cogs', 'Giá vốn hàng bán (KQKD)', {
    group: 'Kế toán', what: 'Giá vốn của hàng đã bán (tài khoản 632).', formula: 'Σ giá vốn đã chụp lúc xuất kho, trừ phần hàng trả được nhập lại', source: 'Từ sổ cái; bằng “Giá vốn” ở Báo cáo.', tip: 'Giá vốn sai thì lợi nhuận sai mà trông vẫn hợp lý.',
  }),
  M('acc_gross_profit', 'Lãi gộp (KQKD)', {
    group: 'Kế toán', what: 'Doanh thu thuần trừ giá vốn. Chưa trừ phí sàn, ship shop chịu và chi phí (các khoản này nằm ở chi phí bán hàng).', formula: 'Doanh thu thuần − 632',
    source: 'Từ sổ cái. Khác “Lợi nhuận gộp” ở Báo cáo (báo cáo đã trừ phí sàn và ship shop chịu).', tip: 'Xem cùng chi phí bán hàng bên dưới.',
  }),
  M('acc_expenses', 'Chi phí bán hàng và quản lý (KQKD)', {
    group: 'Kế toán', what: 'Phí sàn, vận chuyển, quảng cáo, bao bì, mặt bằng, chi phí khác (tài khoản 641x, 642x).', formula: 'Σ số dư Nợ các tài khoản 641x và 642x',
    source: 'Từ phí sàn và ship shop chịu trên đơn, cộng chi phí đã ghi theo danh mục. Lọc shop: chi phí chung được chia về shop theo cùng quy tắc với báo cáo.', tip: 'Đổi tài khoản của một danh mục chi phí nếu muốn hạch toán khác.',
  }),
  M('acc_profit', 'Lợi nhuận trước thuế (KQKD)', {
    group: 'Kế toán', what: 'Lãi thuần từ bán hàng cộng thu nhập khác trừ chi phí khác (hao hụt, tiền phạt, chênh lệch kiểm đếm).', formula: 'Lãi gộp − chi phí 641x/642x − khấu hao/phân bổ + 711 − 811',
    source: 'Từ sổ cái. Chênh lệch kho và kiểm đếm quỹ không thuộc shop nào nên chỉ có khi xem tất cả shop. Trừ các khoản đó và trừ khấu hao/phân bổ tài sản, bằng “Lợi nhuận ròng ước tính” ở Báo cáo (chi phí định kỳ có ở cả hai vì là chi phí thật).', tip: 'Âm nhiều kỳ: xem chi phí và giá vốn.', drill: () => '/reports?tab=profit',
  }),
  M('acc_depreciation', 'Khấu hao và phân bổ (KQKD)', {
    group: 'Kế toán', what: 'Phần nguyên giá tài sản cố định và chi phí trả trước được tính vào chi phí của kỳ (mỗi tháng một khoản, ghi vào ngày cuối tháng).', formula: 'Nguyên giá chia đều theo số tháng (khoản dư rải từ tháng đầu); chỉ tính các tháng đã qua',
    source: 'Từ danh sách Tài sản & phân bổ. KHÔNG phải một khoản chi phí ở Chi phí & quỹ nên KHÔNG có trong “Lợi nhuận ròng ước tính” của Báo cáo: lợi nhuận trước thuế ở Sổ kế toán thấp hơn Báo cáo đúng bằng khoản này (cộng chênh lệch kho/quỹ và thu/chi khác). Chi phí định kỳ thì khác: nó là khoản chi thật nên có ở cả hai nơi.',
    tip: 'Muốn thấy lãi như Báo cáo: xem dòng “Lãi thuần trước khấu hao”.', drill: () => '/accounting?tab=assets',
  }),
  M('acc_other', 'Thu nhập khác và chi phí khác (KQKD)', {
    group: 'Kế toán', what: 'Khoản ngoài bán hàng: thu nhập khác (711: kiểm đếm thừa, điều chỉnh tăng, thu khác) và chi phí khác (811: tiền phạt, hao hụt, kiểm đếm thiếu, giá trị còn lại khi thanh lý tài sản).', formula: '711 và 811',
    source: 'Từ sổ cái, gồm cả phiếu thu/chi khác bạn lập tay. Báo cáo không có các khoản này (trừ tiền phạt nhập qua danh mục chi phí “Tiền phạt”).', tip: 'Góp vốn hay rút vốn (411) KHÔNG phải thu chi khác: không vào lợi nhuận.', drill: () => '/accounting?tab=vouchers',
  }),
  M('acc_lock', 'Khoá sổ', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Từ ngày khoá trở về trước, chứng từ tay, chi phí, thanh toán, chuyển quỹ và tài sản không tạo, sửa, huỷ được.', formula: 'Chứng từ có ngày ≤ ngày khoá bị chặn (PERIOD_LOCKED)',
    source: 'Đơn bán và phiếu nhập trong kỳ đã khoá vẫn sửa được (đơn sàn import muộn là chuyện bình thường); khi đó số kỳ đã khoá đổi và app cảnh báo so với ảnh chụp lúc khoá.', tip: 'Khoá sau khi chốt số cuối tháng; có cảnh báo thì xem kỹ những tài khoản bị đổi.',
  }),
  M('acc_assets', 'Tổng tài sản', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Tiền, phải thu, hàng tồn, tài sản cố định, chi phí trả trước.', formula: 'Σ số dư các tài khoản tài sản (đã trừ hao mòn)', source: 'Toàn tài khoản, không lọc shop, tính đến ngày chọn.', tip: 'Phải bằng nợ phải trả cộng vốn cộng lợi nhuận.',
  }),
  M('acc_equity', 'Vốn và lợi nhuận kỳ này', {
    group: 'Kế toán', scope: 'account', time: 'today', what: 'Vốn chủ sở hữu (gồm số dư đầu các quỹ và tồn đầu kỳ) cộng lợi nhuận mọi kỳ đến ngày chọn, chưa kết chuyển.', formula: '411 + 421 + lợi nhuận lũy kế (hiện thành dòng “421 – lợi nhuận kỳ này”)', source: 'Toàn tài khoản; chưa có bút toán kết chuyển cuối kỳ nên lợi nhuận được cộng thẳng vào đây.', tip: 'Bảng cân đối không cân là lỗi: báo để kiểm tra sổ.',
  }),
  M('acc_trial', 'Cân đối phát sinh', {
    group: 'Kế toán', scope: 'account', what: 'Số dư đầu, phát sinh Nợ/Có và số dư cuối của từng tài khoản trong kỳ.', formula: 'Tổng Nợ phải bằng tổng Có ở cả ba cặp cột', source: 'Toàn tài khoản (không lọc shop).', tip: 'Lệch giữa Nợ và Có là dấu hiệu sổ bị sửa ngoài luồng.',
  }),
  M('acc_cashflow', 'Lưu chuyển tiền trực tiếp', {
    group: 'Kế toán', what: 'Tiền vào và ra trong kỳ, chia theo nguồn: thu khách, sàn trả về, trả NCC, chi phí, chênh lệch kiểm đếm, vốn.', formula: 'Số dư đầu + Σ (Nợ − Có) trên 111x/112x = số dư cuối', source: 'Từ các tài khoản tiền, phân loại theo tài khoản đối ứng. Chuyển quỹ nội bộ luôn bằng 0. Phương thức chưa gán quỹ (1131) không nằm trong tiền.', tip: 'Thu chi trước ngày mở sổ của một quỹ nằm trong số dư đầu (dòng “Vốn”).',
  }),

  // ---------- Khác ----------
  M('custom_metric', 'Chỉ số tuỳ chỉnh', {
    group: 'Chỉ số tuỳ chỉnh', what: 'Chỉ số do bạn tự đặt bằng công thức trên các chỉ số tổng hợp.', formula: 'Công thức bạn viết ở Cài đặt, ví dụ {net_revenue} / {order_count}',
    source: 'Tính trên cùng bộ số với tab Doanh thu và Lợi nhuận (đúng shop và khoảng ngày đang xem). Thiếu dữ liệu hoặc chia cho 0 thì để trống.', tip: 'Sửa công thức ở Cài đặt → Chỉ số tuỳ chỉnh.', drill: () => '/settings',
  }),
  M('health_status', 'Màu sức khoẻ', {
    group: 'Tiền và công nợ', what: 'Xanh, vàng, đỏ cho từng chỉ số tỷ lệ.', formula: 'So giá trị với ngưỡng vàng và đỏ bạn đặt', source: 'Ngưỡng ở Cài đặt → Ngưỡng & kho. App không tự bịa ngưỡng.', tip: 'Chỉnh ngưỡng cho hợp ngành của bạn.', drill: () => '/settings',
  }),

  // ---------- Tổng quan ----------
  M('today_revenue', 'Doanh thu hôm nay', {
    group: 'Doanh thu và lãi', what: 'Doanh thu thuần của riêng ngày hôm nay.', formula: 'Doanh thu thuần với khoảng ngày = hôm nay', source: `${COUNTED_TXT} ${BY_DATE} Theo shop đang chọn.`, tip: 'Hôm nay chưa hết ngày nên số còn tăng.', drill: (f) => `/orders?${q({ status: COUNTED_STATUS, from: f.today, to: f.today })}`, drillNote: ORDERS_NOTE,
  }),
  M('pending_orders', 'Đơn đang chờ xử lý', {
    group: 'Đơn hàng và khách', time: 'today', what: 'Số đơn nháp, đã xác nhận, đang giao chưa hoàn tất.', formula: 'Đếm đơn theo trạng thái nháp, đã xác nhận, đang giao', source: 'Mọi đơn đang ở các trạng thái đó, bất kể ngày đặt. Theo shop đang chọn.', tip: 'Đơn xác nhận lâu mà chưa giao: kiểm tra có bị quên không.', drill: () => '/orders?status=confirmed',
  }),
];

export const METRICS = Object.fromEntries(LIST.map((m) => [m.key, m]));
export const metricOf = (key) => METRICS[key] || null;
export const scopeLabel = (m) => SCOPES[m.scope];

// Mục lục từ điển ở trang "Cách đọc số liệu": nhóm → khoá chỉ số, theo thứ tự hiển thị
const GROUP_KEYS = [
  ['Doanh thu và lãi', ['net_revenue', 'gross_profit', 'gross_margin_pct', 'expenses_amount', 'net_profit_estimate', 'tax_estimate']],
  ['Đơn hàng và khách', ['aov', 'cancel_rate_pct', 'return_rate_pct', 'repeat_rate_pct']],
  ['Kho', ['stock_value', 'days_of_inventory', 'low_stock']],
  ['Tiền và công nợ', ['fund_balance', 'customer_receivable', 'customer_refund_owed', 'marketplace_pending', 'supplier_payable', 'aging_customer']],
];
// GLOSSARY giữ dạng cũ { name, key?, what, how, tip } để trang hướng dẫn và test cũ chạy nguyên; thêm source/scope.
export const GLOSSARY = GROUP_KEYS.map(([group, keys]) => ({
  group,
  items: keys.map((k) => {
    const m = METRICS[k];
    return { name: m.name, ...(m.health ? { key: m.key } : {}), metric: m.key, what: m.what, how: m.formula, source: m.source, scope: m.scope, tip: m.tip };
  }),
}));
