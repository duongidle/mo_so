/**
 * Mô tả tay cho từng đường dẫn API. Danh sách route thật vẫn dựng từ code (luôn đủ);
 * file này thêm tên nhóm, mô tả tiếng Việt, tham số lọc và ví dụ. Có test bắt buộc mọi route đều có mô tả ở đây.
 * Mỗi dòng: "METHOD /đường-dẫn | mô tả | tham số truy vấn (tuỳ chọn)".
 */
export const GROUPS = [
  { id: 'auth', title: 'Đăng nhập & tài khoản', intro: 'Dành cho giao diện web (cookie phiên). Ứng dụng ngoài dùng API key, không cần các route này.', session: true, routes: `
GET /auth/status | Có tài khoản nào chưa, có đang cho đăng ký không (không cần đăng nhập)
POST /auth/register | Đăng ký tài khoản mới (mỗi tài khoản một cơ sở dữ liệu riêng)
POST /auth/login | Đăng nhập, đặt cookie phiên 30 ngày
POST /auth/logout | Đăng xuất, xoá phiên
GET /auth/me | Thông tin người đang đăng nhập
POST /auth/change-password | Đổi mật khẩu` },
  { id: 'catalog-setup', title: 'Shop, kho, kênh, cài đặt', intro: 'Cấu trúc nền: shop (mảng kinh doanh), kho, kênh bán và các cài đặt chung.', routes: `
GET /shops | Danh sách shop
GET /shops/:id | Chi tiết shop
POST /shops | Tạo shop (chọn ngành bán để có sẵn trường thông tin khách/sản phẩm)
PATCH /shops/:id | Sửa shop, đổi ngành, lưu trữ
GET /shops/:id/warehouses | Danh sách kho của shop theo thứ tự ưu tiên (kho đầu là kho chính)
PUT /shops/:id/warehouses | Đặt lại danh sách và thứ tự kho của shop
GET /warehouses | Danh sách kho (kho đã đóng bị ẩn)
GET /warehouses/:id | Chi tiết kho
POST /warehouses | Tạo kho
GET /warehouses/:id/impact | Xem trước việc gỡ kho: hàng còn trong kho, shop đang dùng, việc dở dang, kho đã có lịch sử chưa
POST /warehouses/:id/remove | Gỡ kho: chuyển hàng sang kho khác, gỡ khỏi shop, rồi xoá hẳn (kho chưa từng dùng) hoặc đóng (kho đã có lịch sử)
PATCH /warehouses/:id | Sửa kho. Đóng kho (archived) cần kho hết hàng, không còn kiểm kê hoặc phiếu nhập nháp
GET /channels | Kênh bán đang bật (include_archived=1 để lấy cả kênh đã tắt) | include_archived
POST /channels | Tạo kênh tuỳ chỉnh
PATCH /channels/:id | Sửa hoặc tắt kênh tuỳ chỉnh
GET /platforms | Nền tảng bán hàng (Shopee, TikTok Shop, Facebook, Zalo) và trạng thái kết nối
POST /platforms/:id/enable | Bật nền tảng: mở kênh, mẫu import, quỹ nhận tiền
POST /platforms/:id/disable | Tắt nền tảng (chỉ lưu trữ kênh, không xoá dữ liệu)
GET /settings | Đọc toàn bộ cài đặt
PATCH /settings | Sửa cài đặt (chỉ các khoá được phép)
GET /industries | Danh mục ngành bán và tính năng đi kèm` },
  { id: 'products', title: 'Sản phẩm', intro: 'Sản phẩm gốc, biến thể (SKU), danh mục, niêm yết theo shop, combo, định mức đóng gói.', routes: `
GET /categories | Cây danh mục sản phẩm
POST /categories | Tạo danh mục
PATCH /categories/:id | Đổi tên, đổi cha, sắp xếp, lưu trữ (có thể chuyển sản phẩm sang danh mục khác)
GET /products | Danh sách sản phẩm (archived=1 gồm cả sản phẩm đã ngừng kinh doanh, archived=only chỉ các sản phẩm đó; unlisted=1 bỏ lọc niêm yết theo shop, unlisted=only chỉ sản phẩm chưa gắn vào shop nào) | shop_id, q, category_id, type, item_type, archived, unlisted, limit, cursor
GET /products/:id | Chi tiết sản phẩm, biến thể, ảnh, niêm yết
GET /products/:id/removal-impact | Xem trước việc gỡ sản phẩm: tồn còn lại, combo/đơn nháp đang dùng, đã có lịch sử chưa
POST /products/:id/remove | Gỡ sản phẩm: xoá hẳn nếu chưa từng dùng, ngược lại ngừng kinh doanh (ẩn, khôi phục được). Còn hàng thì cần write_off
POST /products/:id/restore | Khôi phục sản phẩm đã ngừng kinh doanh
POST /products/:id/removal-preview | Xem trước việc bỏ biến thể: cái nào xoá hẳn, cái nào lưu trữ
POST /products | Tạo sản phẩm (một hoặc nhiều biến thể, combo, tồn đầu kỳ)
PATCH /products/:id | Sửa sản phẩm, thêm/đổi/bỏ biến thể và thuộc tính
PUT /products/:id/images | Đặt thứ tự ảnh sản phẩm và gán ảnh cho biến thể
GET /variants | Tìm biến thể để bán/nhập (kèm tồn, giá theo shop) | shop_id, warehouse_id, q, all, category_id, limit
PUT /listings | Niêm yết biến thể ở shop, đặt giá riêng và trạng thái bán
POST /listings/sync | Đồng bộ niêm yết từ shop này sang shop khác
POST /uploads/images | Tải ảnh lên (thân thô, tối đa 3 MB, webp/jpeg/png)
GET /files/images/:id | Tải ảnh đã lưu (cần đăng nhập, chỉ ảnh của tài khoản mình)
GET /packaging-specs/:productId | Định mức vật tư đóng gói của một sản phẩm
PUT /packaging-specs/:productId | Lưu định mức đóng gói
GET /orders/:orderId/packaging-plan | Kế hoạch vật tư cần dùng cho một đơn
POST /orders/:orderId/packaging-confirm | Xác nhận vật tư thực tế dùng cho đơn, trừ kho` },
  { id: 'stock', title: 'Tồn kho', intro: 'Mọi thay đổi tồn kho đi qua sổ kho (stock_movements). Số dư không sửa tay.', routes: `
GET /stock | Tồn từng biến thể (số lượng, giá vốn bình quân, giá trị, ngày còn bán) | warehouse_id, shop_id, q, category_id, filter, limit
GET /stock-movements | Sổ biến động kho | variant_id, warehouse_id, ref_type, ref_id, limit, cursor
GET /stock-adjustments | Danh sách phiếu điều chỉnh kho
POST /stock-adjustments | Điều chỉnh tồn (kiểm đếm, hàng hỏng, tồn đầu kỳ)
POST /transfers | Chuyển hàng giữa hai kho, giữ nguyên giá vốn
GET /stock-integrity | Đối chiếu tồn với sổ kho, báo lệch nếu có
GET /stock-counts | Danh sách phiếu kiểm kê
GET /stock-counts/:id | Chi tiết phiếu kiểm kê
POST /stock-counts | Tạo phiếu kiểm kê (chụp tồn hệ thống)
PATCH /stock-counts/:id | Nhập số đếm, lưu giữa chừng
POST /stock-counts/:id/complete | Hoàn tất kiểm kê, sinh điều chỉnh theo chênh lệch
POST /stock-counts/:id/cancel | Huỷ phiếu kiểm kê
GET /inventory-reports | Báo cáo kho theo kỳ: tồn đầu, nhập, xuất, tồn cuối | from, to, warehouse_id
GET /inventory-reports/export | Xuất báo cáo kho ra CSV | from, to, warehouse_id
GET /material-consumption | Báo cáo tiêu hao vật tư | from, to, warehouse_id
GET /material-consumption/export | Xuất tiêu hao vật tư ra CSV
POST /material-issues | Xuất vật tư dùng cho vận hành (hạch toán chi phí)` },
  { id: 'stock-close', title: 'Chốt kỳ kho', intro: 'Chốt kho đến hết một ngày: khoá biến động kho có ngày ≤ ngày chốt, chụp tồn từng kho × biến thể. Chỉ chốt được đến hết ngày hôm qua. Đơn import đặt trong kỳ đã chốt vẫn trừ kho nhưng được ghi vào ngày đầu của kỳ mở. Mở lại cần lý do và được ghi nhật ký.', routes: `
GET /stock-close | Trạng thái chốt kho: ngày chốt, lần chốt đang hiệu lực, có thay đổi sau chốt không
GET /stock-close/preview | Xem trước một ngày chốt: việc chặn, cảnh báo, tồn sẽ chụp | date
POST /stock-close | Chốt kho đến hết ngày (kèm ghi chú), chụp tồn
POST /stock-close/reopen | Mở lại: lùi ngày chốt về trước hoặc bỏ chốt, cần lý do
GET /stock-closes | Lịch sử các lần chốt
GET /stock-closes/:id | Chi tiết một lần chốt, gồm tồn từng dòng đã chụp` },
  { id: 'purchases', title: 'Nhập hàng & nhà cung cấp', intro: 'Phiếu nhập chỉ cộng kho khi đã nhận. Phí ship, phí khác và chiết khấu được chia vào giá vốn từng dòng.', routes: `
GET /suppliers | Danh sách nhà cung cấp kèm công nợ
POST /suppliers | Tạo nhà cung cấp
PATCH /suppliers/:id | Sửa hoặc lưu trữ nhà cung cấp
GET /purchases | Danh sách phiếu nhập | status, supplier_id, shop_id, limit, cursor
GET /purchases/:id | Chi tiết phiếu nhập, thanh toán và công nợ
POST /purchases | Tạo phiếu nhập (receive=true để nhận hàng luôn; shipping_payee=carrier nếu ship trả bên vận chuyển)
PATCH /purchases/:id | Sửa phiếu nháp
POST /purchases/:id/receive | Nhận hàng, cộng kho theo giá vốn đã phân bổ phí
POST /purchases/:id/cancel | Huỷ phiếu (đã trả tiền thì cần phương thức hoàn)
POST /purchases/:id/payments | Ghi trả tiền nhà cung cấp
POST /purchases/:id/carrier-payments | Ghi trả tiền ship cho bên vận chuyển` },
  { id: 'customers', title: 'Khách hàng', intro: 'Hồ sơ khách dùng chung cả tài khoản, danh sách và thông tin riêng theo từng shop.', routes: `
GET /customers/export | Xuất danh sách khách (CSV/JSON) theo đúng bộ lọc danh sách | q, shop_id, tag, element, sort, format
GET /customers | Danh sách khách | q, shop_id, tag, element, sort, limit, cursor
GET /customers/tags | Các nhãn khách đang dùng ở một shop (kèm số khách) | shop_id
GET /customers/lookup | Tìm khách theo số điện thoại | phone
GET /customers/duplicates | Gợi ý hồ sơ khách trùng để gộp
GET /customers/:id | Hồ sơ khách: đơn, chi tiêu, hạng, nhãn, thông tin riêng
POST /customers | Tạo khách (số điện thoại được chuẩn hoá, trùng thì dùng lại hồ sơ cũ)
PATCH /customers/:id | Sửa hồ sơ khách
PUT /customers/:id/tags | Đặt nhãn khách của một shop
POST /customers/:id/shops | Thêm khách vào danh sách một shop
DELETE /customers/:id | Xoá khách khỏi một shop (shop_id bắt buộc), không đụng hồ sơ chung và lịch sử đơn | shop_id
POST /customers/:id/merge | Gộp hồ sơ trùng vào hồ sơ này
POST /customers/:id/notes | Thêm ghi chú về khách` },
  { id: 'orders', title: 'Đơn hàng', intro: 'Đơn thuộc một shop và một kênh. Xác nhận đơn thì trừ kho và chụp giá vốn. Gửi header Idempotency-Key khi tạo đơn để chống trùng.', routes: `
GET /orders | Danh sách đơn | shop_id, status, channel, payment_status, customer_id, from, to, q, limit, cursor
GET /orders/status-counts | Số đơn theo từng trạng thái (dùng cùng bộ lọc danh sách)
GET /orders/export | Xuất đơn CSV/JSON theo đúng bộ lọc danh sách (layout=orders: mỗi đơn một dòng, layout=lines: mỗi sản phẩm một dòng, format=count để đếm trước) | layout, format, và các bộ lọc như danh sách
POST /orders/allocation-preview | Xem trước đơn sẽ lấy hàng từ kho nào, không ghi gì
GET /orders/:id | Chi tiết đơn: dòng hàng, thanh toán, phân bổ kho, phiếu trả
GET /orders/:id/receipt | Dữ liệu in phiếu bán hàng
POST /orders | Tạo đơn (nháp, xác nhận hoặc hoàn thành ngay)
PATCH /orders/:id | Sửa đơn nháp, hoặc các trường được phép sửa sau khi chốt
POST /orders/:id/status | Đổi trạng thái: xác nhận, giao, hoàn thành, huỷ (huỷ thì hoàn kho đúng giá vốn đã chụp)
POST /orders/:id/payments | Ghi nhận thanh toán, nhiều lần được
POST /orders/:id/returns | Tạo phiếu trả hàng (một phần hoặc toàn phần, hoàn ship, phí trả hàng)
POST /orders/:id/returns/:returnId/receive | Xác nhận hàng trả từ sàn đã về kho
POST /orders/:id/exchange | Đổi hàng
POST /imports/orders/preview | Import đơn: chạy thử, báo sẽ tạo/cập nhật/lỗi
POST /imports/orders/commit | Import đơn: ghi thật, đơn đã có thì cập nhật theo (shop, kênh, mã đơn kênh)
GET /imports/profiles | Mẫu map cột import
POST /imports/profiles | Tạo mẫu map cột
PUT /imports/profiles/:id | Sửa mẫu map cột
GET /imports/batches | Lịch sử các lần import
GET /imports/batches/:id | Chi tiết một lần import
GET /imports/template.csv | Tải file mẫu chuẩn của app` },
  { id: 'money', title: 'Chi phí, quỹ tiền, đối soát', intro: 'Chi phí là tiền ra theo phương thức trả. Mỗi phương thức thanh toán thuộc đúng một quỹ. Số dư quỹ luôn tính từ sổ, không lưu.', routes: `
GET /expense-categories | Danh mục chi phí
POST /expense-categories | Tạo danh mục chi phí
GET /expenses | Danh sách chi phí | shop_id, category_id, from, to, include_voided, include_shared, limit, cursor
GET /expenses/:id | Chi tiết chi phí
POST /expenses | Ghi chi phí
PATCH /expenses/:id | Sửa chi phí
DELETE /expenses/:id | Huỷ chi phí (không xoá cứng)
GET /recurring-expenses | Chi phí định kỳ | include_archived
POST /recurring-expenses | Tạo chi phí định kỳ (tuần, tháng, năm)
GET /recurring-expenses/:id | Chi tiết chi phí định kỳ
PATCH /recurring-expenses/:id | Sửa chi phí định kỳ
DELETE /recurring-expenses/:id | Lưu trữ chi phí định kỳ
POST /recurring-expenses/:id/pause | Tạm dừng
POST /recurring-expenses/:id/resume | Tiếp tục (không tạo bù thời gian tạm dừng)
POST /recurring-expenses/:id/run | Tạo ngay kỳ đến hạn
GET /recurring-expenses/:id/preview | Xem các kỳ sắp tới | count
GET /payments | Sổ thanh toán thu/chi | direction, ref_type, method, shop_id, from, to, limit, cursor
GET /reconciliation/pending | Tiền sàn đang treo (đơn hoàn thành chưa ghi nhận tiền về) | channel_id, shop_id, from, to
POST /reconciliation/payouts | Ghi nhận sàn đã chuyển tiền về
GET /cash/accounts | Các quỹ tiền và số dư | as_of, include_archived
POST /cash/accounts | Tạo quỹ
PATCH /cash/accounts/:id | Sửa quỹ, đổi phương thức thuộc quỹ
GET /cash/accounts/:id/ledger | Sổ quỹ | from, to, limit
POST /cash/accounts/:id/count | Kiểm đếm quỹ, phần chênh ghi thành dòng điều chỉnh
POST /cash/transfers | Chuyển tiền giữa hai quỹ
DELETE /cash/entries/:id | Huỷ dòng chuyển quỹ hoặc điều chỉnh` },
  { id: 'reports', title: 'Báo cáo', intro: 'Bộ lọc chung: from, to (YYYY-MM-DD), shop_id (nhiều shop cách nhau bằng dấu phẩy), channel, category_id (chỉ báo cáo sản phẩm và ngũ hành). Số tổng theo shop, kênh, ngày, sản phẩm luôn khớp tổng quan.', routes: `
GET /reports/dashboard | Dữ liệu trang Tổng quan | from, to, shop_id, channel
GET /reports/overview | Doanh thu, lợi nhuận, đơn, so với kỳ trước | from, to, shop_id, channel
GET /reports/revenue | Doanh thu theo ngày | from, to, shop_id, channel
GET /reports/shops | Theo từng shop
GET /reports/channels | Theo từng kênh
GET /reports/products | Theo sản phẩm | category_id
GET /reports/elements | Theo ngũ hành (shop ngành phong thuỷ)
GET /reports/customers | Khách mới, khách quay lại, top khách
GET /reports/inventory | Giá trị tồn, số ngày tồn, hàng bán chậm, sắp hết
GET /reports/cashflow | Dòng tiền, tiền sàn treo, công nợ
GET /reports/expenses | Chi phí theo danh mục
GET /reports/aging | Tuổi nợ khách, sàn, nhà cung cấp
GET /reports/health | Sức khoẻ kinh doanh theo ngưỡng đã đặt
GET /reports/custom-metrics | Chỉ số tuỳ chỉnh đã tính` },
  { id: 'accounting', title: 'Kế toán', intro: 'Sổ cái kép dẫn xuất từ chứng từ (trigger đánh dấu, sinh lại khi đọc). Chứng từ tay không bao giờ bị sinh lại. Khoá sổ chặn chứng từ tay, chi phí, thanh toán, quỹ, tài sản có ngày ≤ ngày khoá (PERIOD_LOCKED).', routes: `
GET /accounting/accounts | Hệ thống tài khoản, kèm số dư khi balances=1 | as_of, balances
POST /accounting/accounts | Thêm tài khoản con
PATCH /accounting/accounts/:code | Sửa tài khoản (tài khoản hệ thống không sửa được)
PATCH /accounting/expense-categories/:id | Gán danh mục chi phí vào tài khoản chi phí
GET /accounting/journal | Sổ nhật ký | from, to, shop_id, account, source_type, q, limit, cursor
GET /accounting/ledger/:code | Sổ cái một tài khoản | from, to, shop_id, limit
GET /accounting/trial-balance | Cân đối phát sinh | from, to, shop_id
GET /accounting/income-statement | Kết quả kinh doanh | from, to, shop_id
GET /accounting/balance-sheet | Cân đối kế toán (luôn toàn tài khoản) | as_of
GET /accounting/cash-flow | Lưu chuyển tiền trực tiếp | from, to, shop_id
GET /accounting/overview | Tổng quan kế toán và cảnh báo | as_of, shop_id
GET /accounting/verify | Đối chiếu sổ đã lưu với sổ dựng lại từ chứng từ
GET /accounting/vouchers | Chứng từ tay | from, to, shop_id, type, q, include_voided, limit, cursor
GET /accounting/vouchers/:id | Chi tiết chứng từ tay
POST /accounting/vouchers | Lập phiếu thu, phiếu chi hoặc bút toán tổng hợp
PATCH /accounting/vouchers/:id | Sửa chứng từ tay
DELETE /accounting/vouchers/:id | Huỷ chứng từ tay (đánh dấu, không xoá)
GET /accounting/assets | Tài sản cố định và chi phí trả trước | include_voided
POST /accounting/assets | Ghi nhận mua tài sản
GET /accounting/assets/:id | Chi tiết và lịch khấu hao
PATCH /accounting/assets/:id | Sửa tài sản
POST /accounting/assets/:id/dispose | Thanh lý tài sản
DELETE /accounting/assets/:id | Huỷ bản ghi nhập nhầm
GET /accounting/lock | Trạng thái khoá sổ và thay đổi sau khoá
POST /accounting/lock | Đặt hoặc bỏ ngày khoá sổ (chụp số dư các tài khoản)` },
  { id: 'loyalty', title: 'Chăm khách (Loyalty)', intro: 'Hạng khách, nhắc mua lại, sinh nhật, gợi ý theo mệnh và mẫu tin nhắn. Việc gửi tin vẫn do người dùng thực hiện.', routes: `
GET /loyalty/tiers | Các hạng khách và ngưỡng chi tiêu
PUT /loyalty/tiers | Đặt lại các hạng
GET /loyalty/customers/:id | Hạng và chỉ số chăm sóc của một khách
GET /loyalty/customers/:id/suggestions | Gợi ý sản phẩm cho một khách
GET /loyalty/element-campaign | Gợi ý theo mệnh cho cả shop phong thuỷ | shop_id, per_customer, limit
GET /loyalty/today | Việc hôm nay: nhắc mua lại, sinh nhật | shop_id, lookahead_days, birthday_days
POST /loyalty/reminders/action | Đánh dấu đã xử lý hoặc hoãn một nhắc nhở
GET /loyalty/templates | Mẫu tin nhắn
POST /loyalty/templates | Tạo mẫu tin nhắn
PUT /loyalty/templates/:id | Sửa mẫu
DELETE /loyalty/templates/:id | Xoá mẫu
POST /loyalty/render | Điền thông tin khách vào mẫu tin nhắn` },
  { id: 'custom', title: 'Trường tuỳ chỉnh & công thức', intro: 'Thêm trường vào khách, sản phẩm, đơn, phiếu nhập; trường công thức dùng biểu thức an toàn (không eval) và chỉ số báo cáo tự đặt.', routes: `
GET /custom/fields | Danh sách trường | entity_type, shop_id, archived
POST /custom/fields | Tạo trường (text, số, tiền, ngày, chọn, công thức…)
PATCH /custom/fields/:id | Sửa, ẩn hoặc hiện lại trường
GET /custom/fields/:id/usage | Trường đang có bao nhiêu giá trị và công thức nào dùng
DELETE /custom/fields/:id | Xoá hẳn trường (có bản sao vào nhật ký, cần xác nhận nếu đã có dữ liệu)
GET /custom/variables | Biến dùng được trong công thức của một đối tượng | entity_type, shop_id
GET /custom/metric-variables | Biến dùng được trong chỉ số báo cáo
GET /custom/functions | Hàm dùng được trong công thức
POST /custom/formula/preview | Tính thử công thức trên bản ghi mẫu, báo lỗi kèm vị trí
GET /custom/values/:entity/:id | Đọc giá trị trường của một bản ghi | shop_id, meta
PUT /custom/values/:entity/:id | Ghi giá trị trường của một bản ghi
GET /custom/metrics | Chỉ số báo cáo tuỳ chỉnh
POST /custom/metrics | Tạo chỉ số báo cáo từ công thức
DELETE /custom/metrics/:id | Xoá chỉ số báo cáo tuỳ chỉnh` },
  { id: 'system', title: 'Hệ thống: API key, webhook, sao lưu', intro: 'Chỉ chủ shop đăng nhập mới dùng được nhóm này. API key không được tự cấp quyền cho mình hay tải cả cơ sở dữ liệu.', session: true, routes: `
GET /system/api-keys | Danh sách API key (không hiện lại khoá thật)
POST /system/api-keys | Tạo API key (quyền read, write). Khoá thật chỉ hiện một lần
DELETE /system/api-keys/:id | Thu hồi API key
GET /system/webhook-events | Danh sách sự kiện có thể đăng ký
GET /system/webhooks | Danh sách webhook
POST /system/webhooks | Đăng ký webhook (trả về secret ký chữ ký, chỉ hiện lúc tạo)
PATCH /system/webhooks/:id | Sửa webhook, bật/tắt
DELETE /system/webhooks/:id | Xoá webhook
GET /system/webhooks/:id/deliveries | Log các lần gửi | status, limit
POST /system/webhook-deliveries/:id/retry | Gửi lại một lần đã thất bại
POST /system/webhooks/process | Chạy ngay hàng đợi gửi
GET /system/events | Nhật ký sự kiện | type, shop_id, after, limit
GET /system/backups | Danh sách bản sao lưu
POST /system/backups | Tạo bản sao lưu ngay
GET /system/backups/:name | Tải một bản sao lưu
GET /system/backup/download | Tạo và tải bản sao lưu mới
GET /system/export | Danh sách bảng xuất được
GET /system/export/:table | Xuất bản sao thô một bảng ra CSV` },
  { id: 'docs', title: 'Tài liệu', intro: 'Chính trang này.', routes: `
GET /docs | Trang tài liệu này
GET /docs/openapi.json | Đặc tả OpenAPI 3.0 (nhập vào Postman, Insomnia, Swagger)` },
];

/** Ví dụ thân yêu cầu cho các endpoint hay dùng nhất */
export const EXAMPLES = {
  'POST /orders': { note: 'Bán trực tiếp, thu đủ tiền, khách mới', body: { shop_id: 'shp_…', channel_id: 'direct', status: 'completed', customer: { name: 'Chị Lan', phone: '0912345678' }, lines: [{ sku: 'NH-001', qty: 2 }], discount_amount: 0, shipping_fee: 0, payments: [{ amount: 500000, method: 'cash' }] } },
  'POST /orders/:id/payments': { body: { amount: 250000, method: 'bank' } },
  'POST /orders/:id/status': { body: { status: 'cancelled', note: 'Khách đổi ý' } },
  'POST /purchases': { note: 'Nhận hàng luôn, ship trả bên vận chuyển (không cộng vào nợ nhà cung cấp)', body: { supplier_id: 'sup_…', warehouse_id: 'whs_…', receive: true, shipping_fee: 1000000, shipping_payee: 'carrier', lines: [{ variant_id: 'var_…', qty: 100, unit_cost: 200000 }] } },
  'POST /purchases/:id/payments': { body: { amount: 20000000, method: 'bank' } },
  'POST /purchases/:id/carrier-payments': { body: { amount: 1000000, method: 'cash' } },
  'POST /products': { body: { name: 'Nước hoa ô tô Gỗ Đàn', variants: [{ sku: 'NH-001', default_price: 150000, opening_qty: 20, opening_cost: 60000 }], shop_ids: ['shp_…'] } },
  'POST /stock-adjustments': { body: { warehouse_id: 'whs_…', kind: 'adjust', reason: 'Đếm lại cuối tháng', lines: [{ variant_id: 'var_…', change: -2 }] } },
  'POST /transfers': { body: { from_warehouse_id: 'whs_…', to_warehouse_id: 'whs_…', lines: [{ variant_id: 'var_…', qty: 10 }] } },
  'POST /warehouses/:id/remove': { note: 'Gọi GET /warehouses/:id/impact trước. Kho còn hàng thì bắt buộc transfer_to. Kho đã có lịch sử chỉ được đóng, không xoá cứng', body: { transfer_to: 'whs_…', confirm: true } },
  'POST /products/:id/remove': { note: 'Gọi GET /products/:id/removal-impact trước. Còn hàng trong kho thì cần write_off: true (app lập phiếu hàng hỏng). Đã có lịch sử thì chỉ ngừng kinh doanh, không xoá', body: { confirm: true, write_off: false } },
  'POST /stock-close': { note: 'Chốt đến hết ngày (chỉ đến hôm qua trở về trước). Gọi GET /stock-close/preview?date=… trước để xem việc phải xong', body: { date: '2026-10-31', note: 'Chốt kho tháng 10' } },
  'POST /stock-close/reopen': { body: { date: null, reason: 'Nhập sót phiếu nhập ngày 28/10' } },
  'POST /expenses': { body: { category_id: 'exc_…', shop_id: 'shp_…', amount: 350000, expense_date: '2026-11-05', method: 'bank', payee: 'Facebook Ads' } },
  'POST /customers': { body: { name: 'Anh Tài', phone: '0911000001', shop_id: 'shp_…' } },
  'POST /imports/orders/commit': { body: { shop_id: 'shp_…', channel_id: 'shopee', orders: [{ external_id: 'SP123', status: 'completed', ordered_at: '2026-11-02T03:00:00Z', lines: [{ sku: 'NH-001', qty: 1 }], platform_fee_amount: 12000 }] } },
  'POST /system/webhooks': { body: { name: 'Kế toán', url: 'https://example.com/hook', event_types: ['order.created', 'purchase.received'] } },
  'POST /system/api-keys': { body: { name: 'Zapier', scopes: ['read', 'write'] } },
  'POST /accounting/lock': { body: { date: '2026-10-31' } },
};

export const ERROR_CODES = [
  ['VALIDATION_ERROR', 400, 'Dữ liệu gửi lên sai định dạng. `details` chỉ ra trường nào.'],
  ['UNAUTHORIZED', 401, 'Chưa đăng nhập hoặc API key sai/đã thu hồi.'],
  ['FORBIDDEN', 403, 'API key chỉ có quyền đọc mà gọi route ghi, hoặc route chỉ dành cho người đăng nhập.'],
  ['NOT_FOUND', 404, 'Bản ghi không tồn tại (hoặc thuộc tài khoản khác).'],
  ['STOCK_NOT_ENOUGH', 409, 'Không đủ tồn kho. `details` có sku, số đang có, số cần.'],
  ['STOCK_PERIOD_CLOSED', 409, 'Biến động kho có ngày thuộc kỳ kho đã chốt.'],
  ['CLOSE_BLOCKED', 409, 'Chưa chốt kho được: còn phiếu kiểm kê dở hoặc ngày không hợp lệ. `details.blockers` liệt kê.'],
  ['PERIOD_LOCKED', 409, 'Chứng từ có ngày thuộc kỳ đã khoá sổ kế toán.'],
  ['DUPLICATE_ORDER', 409, 'Đơn đã có theo (shop, kênh, mã đơn kênh).'],
  ['DUPLICATE_SKU', 409, 'SKU đã tồn tại.'],
  ['INVALID_STATUS', 409, 'Trạng thái hiện tại không cho thao tác này.'],
  ['INVALID_TRANSITION', 409, 'Không chuyển được trạng thái đơn theo hướng này.'],
  ['OVERPAID', 400, 'Số tiền trả vượt số còn nợ.'],
  ['PURCHASE_PAID', 409, 'Huỷ phiếu nhập đã trả tiền cần kèm phương thức NCC hoàn tiền.'],
  ['WAREHOUSE_HAS_STOCK', 409, 'Không đóng được kho còn hàng. Chuyển hoặc điều chỉnh về 0 trước.'],
  ['WAREHOUSE_IN_USE', 409, 'Kho còn nằm trong danh sách kho của shop (gửi force để gỡ).'],
  ['PRODUCT_HAS_STOCK', 409, 'Sản phẩm còn hàng trong kho: gửi `write_off: true` để xuất huỷ hoặc bán/chuyển hết trước.'],
  ['REMOVE_BLOCKED', 409, 'Chưa gỡ được kho: còn kiểm kê dở, phiếu nhập nháp, hoặc là kho duy nhất của shop. `details.blockers` liệt kê.'],
  ['WAREHOUSE_LAST', 409, 'Kho duy nhất của một shop không đóng được.'],
  ['CONFIRM_REQUIRED', 409, 'Thao tác xoá dữ liệu cần `confirm: true`.'],
];

export const parseRoutes = () => GROUPS.flatMap((g) => g.routes.trim().split('\n').map((line) => {
  const [head, summary, params] = line.split(' | ');
  const [method, path] = head.split(' ');
  return { group: g.id, method, path, summary, params: params ? params.split(',').map((s) => s.trim()).filter(Boolean) : [] };
}));
