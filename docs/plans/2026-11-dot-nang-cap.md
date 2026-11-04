# Plan: đợt nâng cấp lớn Mở Sổ (đơn hàng, nhiều kho, sản phẩm, nền tảng, trường tuỳ chỉnh, báo cáo, kế toán)

## Context

Chủ shop dùng thử thấy nhiều chỗ thiếu/khó dùng:
- Tạo đơn chỉ có POS (`web/src/pages/Pos.jsx`), xấu, và không chọn được khách có sẵn. Server đã nhận `customer_id`, nhưng UI chỉ gửi `{phone, name}`, và `lookup()` vứt id đi. Khách chỉ có tên thì mỗi lần tạo lại một hồ sơ trùng.
- Mỗi đơn chỉ trừ từ một kho (`orders.warehouse_id`).
- Sản phẩm không có ảnh (có cột `products.image_url` nhưng không có upload và không hiển thị). Không có UI danh mục. Combo bị giấu trong ô "Loại" của biến thể. Tạo biến thể phải thêm từng dòng tay.
- Ngũ hành là cột cứng `products.elements`, chưa theo mô hình "trường theo ngành/shop" như khách hàng.
- Đối soát và phương thức thanh toán đang code cứng Shopee. Chưa có khái niệm nền tảng bật/tắt.
- Trường tuỳ chỉnh: Cài đặt không cho chọn đối tượng khách. Khách không tạo được công thức. Ô công thức không có gợi ý. Không sửa được trường.
- Sidebar không tự thu lại sau khi click, do `:focus-within` ở `web/src/styles.css:60-62`.
- Theme phong thuỷ cần nền sáng hơn một tông.
- Cần module Kế toán kép, tự hạch toán. Chủ shop đã chọn mức này. CLAUDE.md đang ghi kế toán là ngoài phạm vi, nên phải sửa thiết kế và ghi vào nhật ký quyết định.
- Chỉ số báo cáo không rõ nghĩa, nguồn và phạm vi (shop nào hay toàn hệ thống).

Quyết định đã chốt với chủ shop:
- Kế toán kép, tự sinh bút toán từ chứng từ có sẵn.
- Nhiều kho: tự chia theo thứ tự ưu tiên kho của shop, sửa tay được trước khi xác nhận.
- Nền tảng bản đầu: Shopee, TikTok Shop, Facebook, Zalo.
- Ảnh tải lên và lưu trên máy.
- Biến thể dạng ma trận: tạo một sản phẩm, tick "có biến thể", điền thuộc tính (Mùi, Size…), hệ thống sinh bảng biến thể để điền SKU/giá/tồn ngay trong form. Mỗi biến thể là một SKU có tồn riêng.

## Cách thực hiện (giao cho Sonnet)

- Làm trên branch mới `feat/dot-nang-cap-2026-11` từ `main`.
- Chạy **tuần tự từng phase**. Mỗi phase giao cho một agent Sonnet (effort medium) với ngữ cảnh mới. Agent đọc CLAUDE.md, PROGRESS.md và phase tương ứng trong file này.
- Cuối mỗi phase:
  - `npm test && npm run test:web` xanh (và `npm run build`).
  - Cập nhật PROGRESS.md, và CLAUDE.md nếu thiết kế đổi (thêm dòng nhật ký quyết định).
  - Commit một lần, message tiếng Việt.
- Không chạy song song: các phase cùng đụng migrations, `Products.jsx`, `orders/service.js`.
- Số migration đã đặt trước theo phase (bên dưới) để tránh trùng.
- Tuân thủ quy ước mục 4 CLAUDE.md:
  - Tiền là số nguyên. Chia tiền bằng `allocate()`. PATCH dùng `patchOf`.
  - Ghi nhiều bảng thì chạy trong `tx`. Thao tác quan trọng thì `audit` + `emit`.
  - Không xoá cứng. Migration chỉ thêm file mới.
- Giao diện:
  - Chỉ dùng biến CSS, không viết cứng màu.
  - Không dùng ngôi cậu/tớ; dùng câu mệnh lệnh hoặc "bạn".
  - Nút cao ≥ 44px trên điện thoại.
  - Phẳng: không đổ bóng (mục 7A).

---

## Phase 1: Sửa nhanh giao diện (không migration)

1. **Sidebar** (`web/src/styles.css:60-62`):
   - Đổi `.sidebar:focus-within` thành `.sidebar:has(:focus-visible)` ở cả hai luật, để chỉ mở rộng khi dùng bàn phím.
   - Trong `Shell` (`web/src/App.jsx:71-135`), thêm `onClick` ở NavLink gọi `e.currentTarget.blur()` khi `e.detail > 0` (click chuột). Lý do: Safari cũ không có `:has`.
   - Thêm smoke e2e: click menu, rê chuột ra ngoài, kiểm tra width sidebar trở về thu gọn.
2. **Nền phong thuỷ sáng hơn một tông** (`[data-theme=phongthuy]`, styles.css:340-346):
   - Thêm `--bg: #F6F0E4; --paper: #FCF9F3;`.
   - Kiểm tra Walnut/bg ≥ 12:1, Terracotta/bg ≥ 4.5:1. Chỉnh nhẹ nếu thiếu.
   - Ghi dòng nhật ký quyết định (cạnh dòng "Nền trang web sáng hơn Linen gốc nửa tông").

## Phase 2: Nền tảng bán hàng dạng plugin (migration 019)

**Danh mục nền tảng** `server/lib/platforms.js` (giống `industries.js`):
- Mỗi nền tảng có: `{ id, name, channel: {id, name, is_marketplace}, payout_method?, import_profile?, features: ['reconciliation','import'] }`.
- `shopee`: kênh sàn, `shopee_payout`, `imp_shopee` (đã có).
- `tiktok`: kênh `tiktok` "TikTok Shop", sàn, `tiktok_payout`, mẫu `imp_tiktok`.
  - Map cột theo file xuất đơn của TikTok Seller Center: Order ID, Order Status, Seller SKU, Quantity, SKU Unit Original Price, SKU Seller Discount, Shipping Fee, Order Amount, Recipient, Phone #, Created Time…
  - Ghi chú rõ là mẫu khởi đầu, sửa được bằng `ProfileEditor`.
- `facebook`, `zalo`: kênh thường, không có payout, dùng mẫu import chuẩn.

**Migration 019**:
- Seed kênh `tiktok`, `zalo` với `archived_at` đặt sẵn (tắt).
- Seed profile `imp_tiktok`.
- Thêm `tiktok_payout` vào methods của quỹ ngân hàng (`cac_bank`).
- Setting `enabled_platforms`:
  - Tài khoản cũ: bật `shopee` và `facebook` (giữ hành vi cũ).
  - Tài khoản mới: thêm default vào `DEFAULT_SETTINGS` (`server/modules/settings/service.js`), cũng `['shopee','facebook']`. Chủ shop tự tắt.

**Service** `server/modules/platforms/` (routes + service):
- `GET /platforms`: danh mục kèm trạng thái bật.
- `POST /platforms/:id/enable`:
  - Bỏ `archived_at` kênh, bảo đảm profile import tồn tại.
  - Bảo đảm payout method đã gán vào một quỹ (mặc định `cac_bank`).
  - Thêm id vào `enabled_platforms`.
- `POST /platforms/:id/disable`: lưu trữ kênh (ẩn khỏi bộ chọn). Giữ nguyên dữ liệu. Audit.
- Kênh `direct` và `other` luôn bật.

**Kênh tuỳ chỉnh**: thêm `POST/PATCH /channels` (tên, `is_marketplace`, lưu trữ), id dạng `ch_…`. Hiện chỉ có GET ở `server/modules/settings/routes.js:20`.

**Bỏ code cứng Shopee**:
- `payments/service.js:6` `PAYMENT_METHODS`: thay bằng `paymentMethods()` = phương thức gốc + `payout_method` của các nền tảng. Validate theo danh sách này. Chỗ nào dùng hằng cũ đều đổi.
- `imports/service.js:61`: `paidMethod` lấy từ `platformByChannel(channelId)?.payout_method ?? 'bank'`.
- Đối soát:
  - `expenses/service.js:94-120` `pendingPayouts`/`recordPayouts` và routes `expenses/routes.js:46-61` nhận `channel_id`.
  - `method` mặc định là payout method của nền tảng đó.
- Web:
  - `Expenses.jsx`: tab đổi tên "Đối soát sàn", có bộ chọn nền tảng (chỉ các sàn đang bật). Ẩn tab nếu không bật sàn nào.
  - `Dashboard.jsx:94` "Tiền sàn đang treo", tách theo nền tảng.
  - `Orders.jsx:49` nút "Nhập từ file" chung, chọn mẫu theo nền tảng.
  - `Import.jsx:60` mặc định theo nền tảng đầu tiên đang bật.
  - `lib.js:23` METHODS lấy nhãn động.
  - `Reports.jsx:196`: sửa chữ.
  - `guide.js:150`: sửa chữ.

**UI**: Cài đặt có tab mới "Nền tảng bán hàng".
- Mỗi nền tảng là một thẻ (tên, mô tả, các chức năng sẽ bật) với công tắc "Kết nối".
- Bên dưới là danh sách kênh tuỳ chỉnh.
- Session (`web/src/session.jsx`) nạp `platforms`, cung cấp `platformEnabled(id)`.

**Test**:
- `tests/platforms.test.js`: bật/tắt, kênh ẩn/hiện. Payout method mới hợp lệ ở thanh toán. Đối soát TikTok tách riêng Shopee.
- `core.test.js:30` đang khẳng định thứ tự kênh: sửa cho khớp danh sách kênh đang bật.

## Phase 3: Sản phẩm: danh mục, ảnh, biến thể ma trận, combo, ngũ hành theo ngành (migrations 020–021)

### 3a. Danh mục
- Server:
  - Tách CTE con cháu ở `reports/service.js:37` thành `categoryWithDescendants(id)` trong `server/lib/categories.js`. Dùng lại cho `listProducts` (`catalog/service.js:80`, hiện chỉ so khớp đúng), `/variants`, `/stock`.
  - `PATCH /categories/:id` chặn vòng lặp cha-con (`CATEGORY_CYCLE`).
  - Lưu trữ danh mục còn sản phẩm: chặn (`CATEGORY_IN_USE`) hoặc yêu cầu chuyển sang danh mục khác.
- UI: trang Sản phẩm có tab "Danh mục".
  - Cây danh mục: thêm, đổi tên, chọn cha, sắp thứ tự, lưu trữ. Hiện số sản phẩm mỗi mục.
  - Danh sách sản phẩm có bộ lọc danh mục (gồm con) và bộ lọc loại (Sản phẩm / Combo).
  - Kho (`Stock.jsx`) cũng có bộ lọc danh mục.

### 3b. Ảnh sản phẩm (migration 020)
- Bảng `product_images(id img_, product_id, variant_id NULL, file_name, width, height, size_bytes, sort_order, created_at, archived_at)`.
- Upload: `POST /uploads/images`.
  - Body là ảnh thô (`Content-Type: image/webp|jpeg|png`), tối đa 3 MB.
  - Kiểm tra magic bytes, không tin Content-Type.
  - Lưu `data/uploads/<accountId>/<img_id>.<ext>`. Trả `{id, url}`.
- Phục vụ file: `GET /api/v1/files/images/:id`.
  - Bắt buộc đăng nhập.
  - Tra trong DB của tài khoản đang đăng nhập, nên không đọc được ảnh của tài khoản khác.
  - Header `Cache-Control: private, max-age=31536000, immutable`.
- Trình duyệt thu nhỏ ảnh trước khi gửi (canvas → WebP, cạnh dài 1200px, chất lượng 0.82). Đặt trong `web/src/lib/image.js`.
- Gắn ảnh: `PUT /products/:id/images` với `[{id, variant_id?, sort_order}]`.
  - Ảnh đầu tiên được ghi vào `products.image_url` để code cũ vẫn chạy (`searchVariants` đã trả trường này).
- Sao lưu: job sao lưu đồng bộ `data/uploads/<id>/` sang `data/backups/<id>/uploads/` (chỉ chép file mới). "Tải bản sao lưu" vẫn là file DB, ghi chú ảnh nằm trong thư mục backups.
- Hiển thị ảnh thu nhỏ ở danh sách sản phẩm, kết quả tìm ở POS/form đơn, dòng đơn, Kho.
- Thêm `ProductThumb` vào `web/src/components/` (ô vuông có chữ cái đầu khi không có ảnh).

### 3c. Biến thể dạng ma trận (migration 021)
- Thêm cột:
  - `products.options TEXT` (JSON `[{name:'Mùi', values:['Cam','Chanh']}, …]`, tối đa 3 thuộc tính).
  - `variants.option_values TEXT` (JSON `{"Mùi":"Cam","Size":"10ml"}`).
- Form sản phẩm mới viết lại `ProductForm` (`web/src/pages/Products.jsx:47-92`). Có thể tách ra `web/src/pages/products/ProductForm.jsx`.
  - Thông tin chung: tên, danh mục, thương hiệu, đơn vị, mô tả, ảnh (kéo thả, nhiều ảnh), chu kỳ dùng hết, shop niêm yết.
  - Hiện form chỉ gửi một phần trường; nay gửi đủ.
  - **Không tick "Có biến thể"**: một khối gồm SKU, giá bán, giá vốn, mã vạch, tồn tối thiểu, **tồn đầu kỳ + kho**.
  - **Tick "Có biến thể"**: trình sửa thuộc tính (tên + ô nhập giá trị dạng thẻ, Enter để thêm). Sinh bảng tổ hợp, mỗi dòng có:
    - Ảnh (chọn từ ảnh sản phẩm).
    - SKU tự sinh `MAGOC-CAM-10ML` (slug không dấu, viết hoa, sửa được).
    - Giá bán, giá vốn, tồn đầu kỳ, mã vạch, công tắc bán/ngừng.
    - Có dòng "Áp dụng cho tất cả" để điền hàng loạt giá, giá vốn, tồn.
  - Sửa sản phẩm: thêm giá trị thì sinh dòng mới.
    - Bỏ giá trị mà biến thể có lịch sử kho/đơn → lưu trữ biến thể.
    - Chưa có lịch sử → xoá (theo quy ước 6, đây là dữ liệu nháp).
- Server:
  - `createProduct`/`updateProduct` (`catalog/service.js:131,153`) nhận `options` và `variants[].option_values`, `opening_qty`, `opening_cost`, `opening_warehouse_id`.
  - Tồn đầu kỳ ghi bằng `applyMovement({type:'opening'})` trong cùng transaction.
  - Kiểm tra SKU trùng trong cả lô trước khi ghi, trả lỗi chỉ đúng dòng.
  - Tên biến thể tự đặt = các giá trị nối bằng " / " nếu người dùng không đặt.

### 3d. Combo
- Nút "+ Combo" riêng ở trang Sản phẩm, mở `ComboForm`:
  - Tên, ảnh, SKU, giá bán, danh mục, shop niêm yết.
  - Thành phần: dùng lại `ComponentPicker` ở `Products.jsx:112-136`, kèm số lượng.
  - Hiện giá vốn ước tính (Σ SL × avg_cost) và số bán được (min theo thành phần).
- Backend đã đủ (`catalog/bundles.js`). Combo là sản phẩm có một biến thể `kind='bundle'`.
- Bỏ ô "Loại" trong bảng biến thể của form sản phẩm thường.

### 3e. Ngũ hành thành trường sản phẩm theo ngành
- Trong `server/lib/industries.js` thêm `product_fields`. Ngành `phong_thuy` có `{key:'ngu_hanh', label:'Ngũ hành hợp', type:'multiselect', options: ELEMENTS, role:'element'}`.
- `applyIndustry` (`server/modules/shops/industry.js`) tạo trường sản phẩm **riêng shop đó** (`custom_fields.shop_id`), giống trường khách.
- Migration (nằm trong 021):
  - Với mỗi shop ngành `phong_thuy`, tạo trường nếu chưa có.
  - Chép `products.elements` sang `custom_values` cho các sản phẩm niêm yết ở shop đó.
  - Giữ cột cũ (không xoá dữ liệu), ngừng ghi.
- Đổi chỗ đọc: báo cáo ngũ hành (`reports/service.js`, phần elements) và gợi ý theo mệnh (`loyalty/service.js:160,196`) đọc qua `roleValues` của trường role `element` của shop.
  - "Tất cả shop" thì gộp theo từng shop phong thuỷ.
- Server bỏ `elements` khỏi `productInput`. Form sản phẩm hiện trường này qua `CustomFieldsPanel` với shop đang chọn.
- Test `tests/finance_integrity.test.js` (tổng ngũ hành = doanh thu hàng) phải vẫn xanh.
- Sửa CLAUDE.md 5.2 và 5.14, thêm dòng nhật ký.

**Test**:
- `tests/catalog_matrix.test.js`: tạo ma trận 2×2 có tồn đầu kỳ, sửa thêm/bỏ giá trị, SKU trùng.
- `tests/uploads.test.js`: upload, đọc, tài khoản khác bị 404, sai magic bytes bị 400.
- `tests/categories.test.js`: lọc gồm con, chặn vòng lặp.
- Vitest cho bảng sinh tổ hợp và slug SKU.

## Phase 4: Một đơn lấy hàng từ nhiều kho (migration 022)

**Dữ liệu**:
- `shop_warehouses(shop_id, warehouse_id, priority, PRIMARY KEY(shop_id, warehouse_id))`.
  - Migration seed từ `shops.default_warehouse_id` với priority 1.
  - `default_warehouse_id` giữ đồng bộ = kho priority 1 (code cũ vẫn đúng).
- `order_line_allocations(id ola_, order_line_id, variant_id, warehouse_id, qty, unit_cost, restocked_qty DEFAULT 0, created_at)`.
  - `variant_id` là biến thể đơn có tồn: chính dòng đơn, hoặc thành phần nếu dòng là combo.
- `order_lines.cogs_amount INTEGER NOT NULL DEFAULT 0`: giá vốn còn hiệu lực của dòng.
  - Backfill bằng `(qty - restocked_qty) * unit_cost`.
  - Lý do: chia nhiều kho thì đơn giá vốn trung bình không còn là số nguyên. Lưu tổng thì giá vốn đúng từng đồng.
  - `unit_cost` giữ để hiển thị (`round(tổng / qty)`).
- Migrate đơn cũ đã trừ kho: sinh allocation từ `orders.warehouse_id` + `unit_cost` (và `order_line_components` cho combo), `restocked_qty` tính tương ứng.
- `orders.warehouse_id` đổi nghĩa thành "kho chính" (ưu tiên đầu), vẫn NOT NULL.

**Thuật toán** `server/modules/orders/allocation.js`:
- `planAllocation(shopId, lines, {overrides})`:
  - Với mỗi biến thể có tồn (combo được tách thành thành phần × SL), lấy hết từ kho priority 1, thiếu thì kho kế tiếp…
  - Hết tồn mọi kho: phần còn lại dồn vào kho priority 1 và đánh dấu `short`. Bị chặn `STOCK_NOT_ENOUGH` trừ khi được phép âm; đơn import vẫn được phép như hiện tại.
- `overrides` là phân bổ tay `[{variant_id, warehouse_id, qty}]` cho từng dòng.
  - Validate tổng = SL cần, và kho thuộc `shop_warehouses` hoặc là kho bất kỳ.
  - Cho phép mọi kho, nhưng cảnh báo khi kho ngoài danh sách.
- `deductStock` (`orders/service.js:175-202`):
  - Gọi `applyMovement` cho từng allocation với kho của nó.
  - Ghi `unit_cost` vào allocation.
  - `cogs_amount` của dòng = Σ qty × unit_cost.
  - Combo: `order_line_components.unit_cost` = trung bình theo allocation, chỉ để hiển thị.
- `putBackLine`/`restoreStock`/`createReturn` (205-215, 453):
  - Hoàn theo allocation, mỗi phần về đúng kho và đúng giá vốn đã chụp.
  - Trả một phần thì hoàn từ allocation tạo sau cùng trước (LIFO), có thể chọn kho trong phiếu trả.
  - Giảm `cogs_amount` đúng bằng giá vốn đã hoàn.
- Đổi các chỗ tính giá vốn sang `SUM(l.cogs_amount)`:
  - `computeHeader` (`orders/service.js:159`)
  - `reports/service.js:283`
  - `reports/service.js:389`. Lọc theo kho: join allocations theo `warehouse_id`.
  - Tìm thêm mọi chỗ có `restocked_qty) * l.unit_cost`.
- API:
  - `POST /orders/allocation-preview {shop_id, lines}` trả phân bổ đề xuất kèm tồn từng kho.
  - `POST /orders` và `PATCH` (đơn nháp) nhận `lines[].allocations` tuỳ chọn.
  - `GET /orders/:id` trả allocations cho từng dòng.
  - `/variants` thêm `stock_by_warehouse` (theo các kho của shop) và `on_hand_total`.
  - Sửa luôn chỗ thiếu nhất quán: không truyền `warehouse_id` thì dùng tổng mọi kho (hiện biến thể đơn luôn ra 0).
- Cài đặt → Shop & kho: thay ô "Kho mặc định" bằng danh sách kho của shop (thêm/bỏ, kéo hoặc mũi tên đổi ưu tiên).

**Test** `tests/multi_warehouse.test.js`:
- Kho A thiếu thì lấy từ kho B. Giá vốn bình quân khác nhau giữa hai kho thì `cogs_amount` đúng tổng.
- Huỷ đơn hoàn đúng từng kho. Trả một phần.
- Combo có thành phần ở hai kho.
- Đơn import âm kho.
- Phân bổ tay.
- `check-stock` và `check-stats` sạch sau tất cả.
- Đối chiếu tổng giá vốn báo cáo = Σ allocation.

## Phase 5: Form tạo đơn mới + chọn khách có sẵn (không migration)

**`web/src/components/CustomerPicker.jsx`** (dùng chung):
- Ô tìm theo tên, SĐT, mã khách, gọi `GET /customers?q=&shop_id=&limit=8`. Theo mẫu `MergeInto` ở `Customers.jsx:65-76`.
- Mỗi kết quả: tên, SĐT, mã, hạng, số đơn, đơn gần nhất. Ưu tiên khách của shop đang chọn, sau đó "khách ở shop khác".
- Chọn xong hiện thẻ khách (đổi/bỏ), địa chỉ mặc định, hạng và % giảm gợi ý.
- "+ Khách mới" mở nhanh form tên, SĐT, địa chỉ, Facebook. Gõ SĐT trùng thì gợi ý khách sẵn có thay vì tạo mới.
- Luôn gửi `customer_id` khi đã chọn.

**Trang `/orders/new` và `/orders/:id/edit`** (đơn nháp): `web/src/pages/OrderForm.jsx`, bố cục 7:5 trên máy tính, một cột trên điện thoại.
- Trái: tìm sản phẩm (ảnh, SKU, giá, tồn tổng + theo kho, combo), bảng dòng (ảnh, tên/biến thể, SL, đơn giá, giảm dòng, thành tiền), ghi chú.
- Phải:
  - Kênh (chỉ kênh đang bật) và mã đơn kênh.
  - Khách (CustomerPicker) và địa chỉ giao.
  - Tiền: giảm giá đơn, phí ship khách trả, phí sàn và phí ship shop chịu (chỉ hiện với kênh sàn).
  - Tổng: tạm tính, khách phải trả, shop thực nhận, lãi gộp ước tính.
  - Khối "Lấy hàng từ kho": kết quả `allocation-preview`, sửa tay SL theo kho từng dòng, cảnh báo thiếu.
  - Thanh toán: số tiền, phương thức.
  - Nút: "Lưu nháp" · "Xác nhận đơn" · "Bán xong" (hoàn thành + thu đủ).
- `Orders.jsx:38,49`: "Đơn mới" trỏ về `/orders/new` thay vì `/pos`.
- `OrderDetail` có nút "Sửa" cho đơn nháp, và hiện phân bổ kho từng dòng.

**POS** (`Pos.jsx`):
- Thay hai ô SĐT/Tên bằng CustomerPicker (chế độ gọn).
- Thêm ảnh sản phẩm. Giữ luồng "Bán ngay" < 30 giây.
- Tự phân bổ kho, chỉ hiện cảnh báo khi phải lấy từ kho khác.

**Test vitest**:
- `customer-picker.test.jsx`: tìm, chọn thì gửi `customer_id`; SĐT trùng thì gợi ý.
- `order-form.test.jsx`: tính tổng, chỉnh phân bổ, payload.
- Smoke e2e: tạo đơn với khách có sẵn.

## Phase 6: Hoàn thiện trường tuỳ chỉnh (migration 023 nếu cần)

**Server** (`server/modules/custom/`):
- `GET /custom/variables?entity_type&shop_id` trả danh sách biến có nhãn tiếng Việt và kiểu dữ liệu, thay vì toàn bộ cột từ `PRAGMA`.
  - Bỏ cột kỹ thuật (`id`, `*_at` nội bộ, JSON, cột khách cũ không dùng: birth_date, birth_year, element_override, gender, tags).
  - Thêm biến dẫn xuất cho khách theo shop: `shop_order_count`, `shop_total_spent`, `shop_last_order_at`. Tính trong `getValues`.
  - Gồm cả trường tuỳ chỉnh `{custom.key}`.
- `parseFormula` (`custom/service.js:39`) chỉ chấp nhận biến trong danh sách này.
- `createMetric` (`custom/service.js:247`) cũng validate tham chiếu theo danh sách biến báo cáo. Đặt danh sách ở một hằng `REPORT_VARIABLES`, kèm nhãn, trong `reports/service.js`.
- `POST /custom/formula/preview {entity_type, shop_id, formula, entity_id?}`:
  - Trả `{value}` hoặc `{error:{message, position}}`.
  - Không có `entity_id` thì lấy bản ghi gần nhất làm mẫu.
  - Metric thì tính trên tổng quan tháng này.
- `fieldInput` (`custom/routes.js:12-22`) nhận `role` (validate theo `ROLES`, đúng đối tượng). `PATCH` sửa được thêm `options`, `required`.
- Bỏ lời gọi cố định trong `formula.js` FUNCS. Thêm hàm `CONCAT`, `YEAR`, `MONTH`, `COALESCE` vì công thức khách/đơn hay cần. Có test.

**UI**:
- `web/src/components/FormulaEditor.jsx` dùng cho trường công thức và chỉ số báo cáo:
  - Textarea. Gõ `{` thì mở danh sách biến (lọc khi gõ, mũi tên/Enter để chèn, hiện nhãn + kiểu).
  - Gõ chữ cái thì gợi ý hàm kèm cú pháp và ví dụ.
  - Panel "Biến có thể dùng" và "Hàm" có thể bấm để chèn.
  - Xem trước kết quả trực tiếp (debounce 400ms) và báo lỗi đúng vị trí.
  - Các mẫu công thức hay dùng theo đối tượng, ví dụ lãi đơn `{net_amount} - {cogs_amount}`, tuổi khách `YEAR(TODAY()) - {custom.nam_sinh}`.
- Cài đặt → Trường tuỳ chỉnh (`Settings.jsx:133-171`):
  - Thêm đối tượng **Khách hàng**: bắt buộc chọn shop, mặc định shop đang chọn.
  - Danh sách trường có nút **Sửa** (nhãn, lựa chọn, công thức, hiện ở danh sách, vai trò, thứ tự) ngoài Ẩn.
  - Trình sửa lựa chọn cho select/multiselect dạng thẻ.
- `ShopFieldsManager` ở `Customers.jsx:264-301`: thêm kiểu `formula` vào `TYPES` (dòng 79), dùng FormulaEditor.
  - Hoặc chuyển hẳn sang dùng chung component quản lý trường với Cài đặt; nên dùng chung để không có hai bản.
- Chỉ số báo cáo (Settings `Metrics`): dùng FormulaEditor với `REPORT_VARIABLES`.

**Test**: biến dẫn xuất theo shop, công thức tham chiếu sai bị chặn, preview, metric tham chiếu sai bị chặn, vitest cho autocomplete.

## Phase 7: Báo cáo dễ hiểu (không migration)

- Từ điển chỉ số dùng chung `web/src/metrics.js`, gộp `GLOSSARY` từ `web/src/guide.js:127`. Guide import từ đây.
  - Mỗi chỉ số có: `key`, `name`, `what` (nghĩa), `formula` (bằng chữ và bằng biến), `source` (lấy từ đâu: đơn trạng thái nào, theo ngày đặt, đã trừ hàng trả…), `scope`, `tip`, `drill`.
  - `scope` thuộc một trong:
    - `'filter'`: theo shop/kênh đang lọc.
    - `'shop_plus_shared'`: shop đang xem + phần chi phí chung đã chia.
    - `'account'`: toàn tài khoản, ví dụ công nợ NCC, thuế ước tính.
    - `'warehouse'`: theo kho của shop.
  - `drill` là link sang danh sách gốc, ví dụ `/orders?status=cancelled&from=…`.
- `Kpi` (`components/ui.jsx:93`) nhận `metric="key"`, hiện nút ⓘ mở popover (phẳng, viền champagne) với nghĩa, cách tính, nguồn, phạm vi và link "Xem các đơn tạo nên con số này". Áp dụng tương tự cho `Row` và tiêu đề cột bảng ở `Reports.jsx`.
- Đầu trang Báo cáo có dải phạm vi luôn hiện: "Đang xem: **Shop X** (hoặc Tất cả shop) · 01/11–30/11/2026 · Tất cả kênh · so với 01/10–31/10".
  - Chỉ số có phạm vi khác bộ lọc thì có nhãn nhỏ, ví dụ "Toàn tài khoản".
- Mỗi tab có một câu mở đầu ngắn: tab này trả lời câu hỏi gì.
- Server trả thêm `meta.scope` ở các endpoint có phạm vi đặc biệt (`cashflow` báo `shared_expenses_not_included`, `aging` NCC không lọc shop) để UI hiển thị đúng.
- Vitest: mọi `metric=` dùng trong `Reports.jsx`, `Dashboard.jsx` đều có trong từ điển; mọi chỉ số có `scope` và `source`.

## Phase 8: Kế toán kép (migrations 024–026). Chia 8a, 8b

**Nguyên tắc**: bút toán tự động là **dữ liệu dẫn xuất** từ chứng từ gốc, dùng cùng mẫu với `daily_stats` (đã được kiểm chứng trong dự án):
- Trigger SQLite trên `orders`, `order_returns`, `order_line_allocations`, `purchases`, `payments`, `expenses`, `cash_entries`, `cash_accounts`, `stock_movements` (loại adjust/damage/opening/count), `assets`.
- Trigger đánh dấu `(source_type, source_id)` vào `journal_dirty`.
- Đọc báo cáo kế toán thì gọi `flushJournal()`: với mỗi chứng từ bẩn, xoá bút toán tự động cũ của nó và sinh lại từ trạng thái hiện tại. Có `verifyJournal()` và `npm run check-journal [-- --fix]`.
- Không phụ thuộc việc code nghiệp vụ có nhớ gọi.
- Bút toán tay (`source_type='manual'`) không bao giờ bị sinh lại.

### 8a. Lõi sổ cái (migration 024)
- `accounts`: hệ thống tài khoản `(code PK, name, type asset|liability|equity|revenue|contra_revenue|expense, parent_code, normal_side, is_system, archived_at)`. Seed theo hệ thống tài khoản rút gọn cho hộ/doanh nghiệp nhỏ:
  - 111 Tiền mặt, 112 Tiền gửi ngân hàng/ví (mỗi `cash_account` một tài khoản con 111x/112x)
  - 131 Phải thu khách hàng, 1388 Phải thu sàn TMĐT (tiền sàn đang treo)
  - 156 Hàng hoá, 242 Chi phí trả trước, 211 TSCĐ, 214 Hao mòn TSCĐ
  - 331 Phải trả người bán, 3388 Phải trả khác
  - 411 Vốn chủ sở hữu, 421 Lợi nhuận chưa phân phối
  - 5111 Doanh thu bán hàng, 5113 Doanh thu phí vận chuyển, 5212 Hàng bán bị trả lại
  - 632 Giá vốn hàng bán
  - 6411 Phí sàn, 6412 Vận chuyển, 6413 Quảng cáo, 6414 Bao bì, 6418 Chi phí bán hàng khác
  - 6422 Mặt bằng/điện nước, 6428 Chi phí quản lý khác
  - 711 Thu nhập khác, 811 Chi phí khác (tiền phạt, hao hụt)
  - Người dùng thêm được tài khoản con. Tài khoản hệ thống không xoá/đổi mã.
- `journal_entries(id je_, code BT-…, entry_date, business_date, description, source_type, source_id, shop_id NULL, is_auto, voided_at, created_at)` và `journal_lines(id, entry_id, account_code, debit, credit, shop_id NULL, channel_id NULL, partner_type, partner_id, memo)`.
  - Mỗi bút toán phải Σ Nợ = Σ Có. Chặn trong service và kiểm trong `verifyJournal`.
- `expense_categories.account_code` (seed: quảng cáo → 6413, phí sàn → 6411, vận chuyển → 6412, bao bì → 6414, mặt bằng → 6422, khác → 6428). Thêm danh mục "Tiền phạt" → 811 và "Vận hành" → 6428.
- `cash_accounts.account_code`: tự tạo tài khoản con khi tạo quỹ.
- **Quy tắc hạch toán** trong `server/modules/accounting/posting.js`. Mỗi loại chứng từ một hàm thuần `postingsFor(source)`, trả danh sách bút toán:
  - **Đơn** (cùng điều kiện trạng thái và cùng `business_date` mà báo cáo dùng, để KQKD khớp báo cáo):
    - Kênh thường: Nợ 131 = `total_amount` / Có 5111 hàng (sau giảm giá) / Có 5113 phí ship.
    - Kênh sàn: Nợ 1388 net / Nợ 6411 phí sàn / Nợ 6412 ship shop chịu / Có 5111 / Có 5113.
    - Phí ship shop chịu ở kênh thường: hạch toán đúng như báo cáo đang tính (đọc `reports/service.js` `finish`/`withProfit` để khớp).
    - Giá vốn: Nợ 632 / Có 156 = Σ `cogs_amount` lúc xuất.
  - **Trả hàng**: Nợ 5212 giá trị trả / Có 131 hoặc 1388. Nhập lại kho: Nợ 156 / Có 632 theo giá vốn đã chụp.
  - **Thanh toán**:
    - Thu đơn: Nợ 111x/112x (theo quỹ của phương thức) / Có 131 hoặc 1388.
    - Hoàn tiền khách: ngược lại.
    - Trả NCC: Nợ 331 / Có quỹ. NCC hoàn tiền: ngược lại.
  - **Phiếu nhập đã nhận**: Nợ 156 tổng / Có 331. Huỷ thì sinh lại thành 0, vì là dẫn xuất từ trạng thái.
  - **Chi phí**: Nợ tài khoản của danh mục / Có quỹ theo `method`. Chưa trả (method trống) thì Có 3388. Chi phí gắn shop thì ghi `shop_id` lên dòng Nợ.
  - **Kho**:
    - Điều chỉnh tăng: Nợ 156 / Có 711.
    - Điều chỉnh giảm/hỏng: Nợ 811 / Có 156.
    - Tồn đầu kỳ: Nợ 156 / Có 411.
    - Chuyển kho: không bút toán.
  - **Quỹ**:
    - Số dư đầu: Nợ quỹ / Có 411.
    - Chuyển quỹ: Nợ quỹ đích / Có quỹ nguồn.
    - Kiểm đếm thừa: Nợ quỹ / Có 711. Thiếu: Nợ 811 / Có quỹ.
  - Phương thức chưa gán quỹ thì dùng tài khoản tạm 1131 "Tiền đang chuyển" và báo ở trang kế toán.
- Báo cáo `server/modules/accounting/reports.js`, lọc kỳ và shop (lọc shop chỉ cho KQKD; cân đối kế toán luôn toàn tài khoản và ghi rõ trên giao diện):
  - Sổ nhật ký chung.
  - Sổ cái theo tài khoản: số dư đầu, phát sinh, số dư cuối, click mở chứng từ gốc.
  - Bảng cân đối phát sinh (trial balance).
  - Báo cáo kết quả kinh doanh (KQKD).
  - Bảng cân đối kế toán: lợi nhuận kỳ chưa kết chuyển hiện thành 421.
  - Lưu chuyển tiền tệ trực tiếp, từ tài khoản 111/112.
- **Test then chốt** `tests/accounting_integrity.test.js`, chạy kịch bản đủ loại thao tác như `finance_integrity`:
  - Mọi bút toán cân.
  - Trial balance tổng Nợ = tổng Có.
  - Tài sản = Nợ phải trả + Vốn + LN.
  - **KQKD (doanh thu thuần, giá vốn, chi phí, LN) = `reports/overview` cùng kỳ**, cho tất cả shop và từng shop.
  - Số dư 111x/112x = `cash/balanceOf`.
  - Số dư 156 = Σ `on_hand × avg_cost` (sai lệch làm tròn ≤ số dòng tồn, ghi rõ).
  - 131 + 1388 = công nợ khách + tiền sàn treo ở `reports/cashflow`.
  - 331 = công nợ NCC.
  - Sửa/huỷ đơn thì bút toán tự cập nhật. `check-journal` sạch.

### 8b. Nghiệp vụ kế toán bổ sung (migrations 025–026)
- **Chứng từ tay** (`vouchers` hoặc bút toán `manual`):
  - Phiếu thu khác: vốn góp → 411, thu khác → 711.
  - Phiếu chi khác: rút vốn, tiền phạt → 811.
  - Bút toán tổng hợp tự do nhiều dòng, phải cân.
  - Huỷ = `voided_at`, không xoá.
- **Chi phí định kỳ** `recurring_expenses(id, name, category_id, shop_id, channel_id, amount, method, frequency monthly|weekly|yearly, day_of_period, start_date, end_date, next_run_date, paused_at)`:
  - Job hằng ngày (cạnh job sao lưu trong `server/jobs/`) tạo `expenses` đến hạn, có `recurring_id`. Không tạo trùng (unique `(recurring_id, period_key)`).
  - Có nút "Tạo ngay kỳ này" và xem trước các kỳ sắp tới.
- **Tài sản & chi phí trả trước** `assets(id, name, kind fixed_asset|prepaid, cost, start_date, months, account_code, expense_account_code, shop_id, disposed_at)`:
  - Mua: Nợ 211/242 / Có quỹ hoặc 331.
  - Khấu hao/phân bổ hằng tháng tính dẫn xuất theo tháng: Nợ 642x/641x / Có 214/242. Chia tiền bằng `allocate()` để tổng các tháng = nguyên giá.
  - Ví dụ: kệ trưng bày, máy in, tiền thuê trả trước 12 tháng.
- **Khoá sổ** setting `accounting_lock_date`:
  - Chặn tạo/sửa/huỷ chứng từ tay, chi phí, thanh toán, chuyển quỹ có ngày ≤ ngày khoá (`PERIOD_LOCKED`).
  - Đơn/phiếu nhập trong kỳ đã khoá chỉ cảnh báo ở giao diện, vì đơn sàn import muộn là bình thường. Bút toán vẫn sinh lại nên số kỳ cũ có thể đổi. Báo rõ "kỳ đã khoá có thay đổi sau khoá" trên trang tổng quan kế toán.
- **Kết chuyển cuối kỳ**: không cần bút toán kết chuyển thật. Báo cáo tự tính. Ghi rõ trong CLAUDE.md.

**UI**: thanh bên có nhóm mới **Kế toán** (`NAV` ở `web/src/App.jsx:23-28`), gồm:
- "Chi phí & quỹ" (trang Expenses cũ chuyển vào đây).
- "Sổ kế toán" `/accounting` với các tab:
  - **Tổng quan**: tiền, phải thu, phải trả, LN kỳ, cảnh báo phương thức chưa gán quỹ, kỳ đã khoá có thay đổi.
  - **Chứng từ**: phiếu thu/chi khác, bút toán tay.
  - **Chi phí định kỳ**.
  - **Tài sản & phân bổ**.
  - **Sổ nhật ký**.
  - **Sổ cái**.
  - **Cân đối phát sinh**.
  - **Kết quả kinh doanh**.
  - **Cân đối kế toán**.
  - **Lưu chuyển tiền**.
  - **Hệ thống tài khoản**.
  - **Khoá sổ**.
- Mỗi báo cáo xuất Excel, dùng lại `web/src/reportTables.js`.
- Mỗi con số trong báo cáo kế toán có ⓘ dùng từ điển của Phase 7.
- Mobile `More()` tự theo `NAV`.

**CLAUDE.md**:
- Bỏ "Kế toán, sổ sách…" khỏi Ngoài phạm vi. Giữ HĐĐT và kê khai thuế là ngoài phạm vi.
- Thêm mục 5.15 Kế toán.
- Bảng mục 6: thêm các bảng mới.
- Mục 8: thêm M14 Kế toán.
- Nhật ký quyết định: "kế toán kép dẫn xuất từ chứng từ bằng trigger + sinh lại", kèm lý do.

---

## File chính sẽ đụng (đại diện)

- Server:
  - `server/modules/orders/service.js`, `orders/allocation.js` (mới)
  - `catalog/service.js`, `catalog/routes.js`
  - `inventory/service.js`, `expenses/*`, `payments/service.js`, `imports/service.js`
  - `custom/*`, `reports/service.js`, `settings/service.js`, `shops/industry.js`
  - Module mới: `platforms/`, `uploads/`, `accounting/`
  - `server/lib/platforms.js`, `lib/categories.js`, `lib/industries.js`, `lib/formula.js`
  - `server/jobs/` (chi phí định kỳ, đồng bộ ảnh vào backups)
- Migrations: `server/db/migrations/019_platforms.sql` … `026_*.sql`
- Web:
  - `web/src/App.jsx`, `styles.css`, `session.jsx`, `lib.js`, `guide.js`, `metrics.js` (mới)
  - Pages: `Pos.jsx`, `Orders.jsx`, `OrderForm.jsx` (mới), `Products.jsx` (+ `pages/products/*`), `Stock.jsx`, `Settings.jsx`, `Customers.jsx`, `Expenses.jsx`, `Reports.jsx`, `Dashboard.jsx`, `Accounting.jsx` (mới)
  - Components: `CustomerPicker`, `FormulaEditor`, `ProductThumb`, `ImageUploader`, `MetricInfo` (mới), `ui.jsx`
- Tài liệu: `CLAUDE.md`, `PROGRESS.md`

## Kiểm tra

Sau mỗi phase:
- `npm test` (API), `npm run test:web` (vitest), `npm run build`, `npm run test:e2e` (smoke).
- `node scripts/check-stock.js`, `npm run check-stats`, và sau Phase 8 `npm run check-journal`, trên DB seed (`node scripts/seed.js`).

Chạy thật bằng skill `run` hoặc `npm run dev`, rồi đi qua các luồng trên trình duyệt (Claude in Chrome):
1. Click menu sidebar rồi rê chuột ra ngoài: sidebar thu lại. Shop phong thuỷ: nền sáng hơn.
2. Bật TikTok Shop ở Cài đặt: kênh hiện ở form đơn, có tab đối soát TikTok. Tắt: kênh biến mất, đơn cũ còn nguyên.
3. Tạo sản phẩm có biến thể 2 thuộc tính, có ảnh và tồn đầu kỳ. Tạo combo. Lọc theo danh mục cha thấy sản phẩm ở danh mục con.
4. Tạo đơn mới ở `/orders/new`: chọn khách có sẵn, đơn cần nhiều hơn tồn kho A, thấy tự lấy thêm từ kho B, sửa tay, xác nhận. Huỷ đơn: tồn hai kho về đúng.
5. Tạo trường công thức cho khách ở Cài đặt: gõ `{` có gợi ý, xem trước ra giá trị.
6. Báo cáo: ⓘ ở mỗi chỉ số giải thích nguồn và phạm vi. Dải phạm vi đúng shop đang xem.
7. Kế toán: KQKD khớp tab Lợi nhuận của Báo cáo. Cân đối kế toán cân. Thêm chi phí định kỳ, chạy job tạo đúng kỳ. Ghi tiền phạt vào 811.
