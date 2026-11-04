# Nhật ký thực hiện

> Ghi theo module trong `CLAUDE.md` mục 8. Mỗi phiên làm việc: đọc mục "Việc tiếp theo" trước, cập nhật file này khi xong.

## Tổng quan

| # | Module | Backend | Giao diện | Test | Ghi chú |
|---|---|---|---|---|---|
| M0 | Nền tảng | ✅ | — | ✅ | |
| M1 | Shop, kho, kênh, cài đặt, tài khoản | ✅ | ✅ | ✅ | Nhiều tài khoản, mỗi tài khoản một DB riêng; đăng ký; thiết lập lần đầu (shop → kho → sản phẩm) |
| M2 | Sản phẩm, niêm yết, đồng bộ | ✅ | ✅ | ✅ | Combo xong (tồn khả dụng theo thành phần) |
| M3 | Tồn kho, nhập hàng, NCC | ✅ | ✅ | ✅ | Kiểm kê nhiều bước, chuyển kho, điều chỉnh nhanh |
| M4 | Khách hàng chung, thông tin riêng theo shop | ✅ | ✅ | ✅ | Gộp khách trùng. Danh sách khách theo shop, xoá khỏi một shop, nhãn theo shop, xuất danh sách khách (Excel/CSV) |
| M5 | Đơn bán, trả hàng, phiếu | ✅ | ✅ | ✅ | POS, chi tiết đơn, thu tiền, trả hàng, in phiếu |
| M6 | Import đơn | ✅ | ✅ | ✅ | Nút "Nhập từ file" ngay trang Đơn hàng (không còn trang riêng; `/import` chuyển hướng về đó). Đọc Excel/CSV trong trình duyệt (SheetJS). Có trình sửa mẫu map cột (gợi ý cột từ file, ánh xạ trạng thái) |
| M7 | Chi phí, đối soát sàn (Shopee, TikTok Shop…), quỹ tiền | ✅ | ✅ | ✅ | Chi phí huỷ mềm, có phương thức trả; đối soát theo lô; quỹ tiền (chuyển quỹ, kiểm đếm, sổ quỹ) |
| M8 | Báo cáo, sức khoẻ | ✅ | ✅ | ✅ | `daily_stats` bằng trigger; báo cáo chi phí, tuổi nợ, thuế ước tính, xuất Excel, trang Cách đọc số liệu |
| M9 | Loyalty & Campaign | ✅ | ✅ | ✅ | Một module `/loyalty`: hôm nay (nhắc mua lại, sinh nhật), gợi ý theo mệnh (shop phong thuỷ), hạng khách, mẫu tin nhắn (soạn + sao chép, không tự gửi). Tự động hoá: chưa làm |
| M10 | Trường tuỳ chỉnh, công thức | ✅ | ✅ | ✅ | Ô nhập giá trị trong chi tiết đơn, form sản phẩm, phiếu nhập; trường khách theo shop ở trang Khách hàng |
| M11 | API key, webhook | ✅ | ✅ | ✅ | Quản lý key, webhook ký HMAC, retry 1p/5p/30p/2h/12h, nhật ký, gửi lại, `/api/v1/docs` |
| M12 | Sao lưu, xuất CSV | ✅ | ✅ | ✅ | Tự động mỗi ngày (14 ngày + 8 tuần), tải bản sao lưu, xuất CSV, `scripts/restore.js` |
| M13 | Giao diện web | | ✅ | ✅ | Đủ màn hình, điện thoại + máy tính. Test: API 76, vitest 91, smoke e2e 10 |

✅ xong · 🟡 một phần · ⬜ chưa làm

---

## Nhật ký

### 2026-11-04 — Đợt nâng cấp, Phase 4: một đơn lấy hàng từ nhiều kho

- Migration `022_multi_warehouse.sql`: `shop_warehouses` (seed từ kho mặc định, ưu tiên 1), `order_line_allocations`, `order_lines.cogs_amount` và `planned_allocations`. Backfill đơn cũ: phân bổ từ `orders.warehouse_id` + `unit_cost`/`order_line_components`; đơn huỷ sau khi từng xác nhận có phân bổ đã hoàn hết; tổng giá vốn không đổi (có test).
- Server: `orders/allocation.js` (`planAllocation`); `deductStock`/`putBackLine`/`restoreStock`/`createReturn` làm theo phân bổ (LIFO khi trả một phần, chọn được kho nhận); `POST /orders/allocation-preview`; `lines[].allocations` khi tạo/sửa đơn nháp; `GET/PUT /shops/:id/warehouses` (có audit); `/variants` thêm `on_hand_total`, `stock_by_warehouse`, tồn nhất quán khi không truyền `warehouse_id`.
- Giá vốn đổi sang `SUM(cogs_amount)`: `refreshDerived` (đơn, nguồn của `daily_stats`), báo cáo sản phẩm, `inventoryMetrics` (theo kho: cộng từ phân bổ của kho đó).
- Mới: `server/modules/inventory/verify.js` + `npm run check-stock` (tồn vs sổ kho, `cogs_amount` vs phân bổ, phân bổ vs sổ kho).
- Giao diện: Cài đặt → Shop & kho có danh sách kho xếp thứ tự (thêm/bỏ/lên/xuống); chi tiết đơn hiện kho từng dòng lấy từ; POS tồn theo tổng kho của shop và báo khi có hàng lấy từ kho phụ. Trình soạn phân bổ tay đầy đủ để Phase 5.
- Test: `tests/multi_warehouse.test.js` 8 test. `npm test` 111/111, `npm run test:web` 128/128, build qua.
- Còn mở: phiếu trả không ghi hàng trả thuộc phân bổ nào nên LIFO là quy ước; cột "Giá vốn / cái" trong file xuất đơn là số làm tròn (tổng đúng nằm ở `Giá vốn` của đơn); chưa thử trên trình duyệt thật.

### 2026-11-04 — Phase 3 bổ sung: chuyển sản phẩm đã tạo sang ma trận

- Server: `updateProduct` nhận `option_renames`; `relabelVariants` đổi nhãn mọi biến thể (kể cả đã lưu trữ) giữ id; `settleOptions` bỏ khoá thuộc tính đã xoá và kiểm ánh xạ 1-1 (`OPTION_INCOMPLETE`, `OPTIONS_CONFLICT`) trong cùng transaction; tên tự đặt đi theo giá trị mới, tên đặt tay giữ nguyên; audit ghi `option_renames` và `options_before`.
- Giao diện: sản phẩm một biến thể hoặc cũ nhiều biến thể tick "Có biến thể"; ô "Biến thể hiện có là…" cho từng biến thể đã có; thêm/xoá thuộc tính, đổi tên thuộc tính và giá trị (bấm vào thẻ); nút Lưu khoá khi hai biến thể trùng tổ hợp. Hàm thuần `reconcile`, `assignCombo`, `noteAttrRename`, `noteValueRename` trong `web/src/lib/matrix.js`.
- Test: 5 test server mới trong `tests/catalog_matrix.test.js`, `matrix-convert.test.js` và 2 test form. `npm test` 103/103, `npm run test:web` 128/128, build qua.
- Còn mở: sản phẩm đã có ma trận không quay lại "không biến thể" được; chuyển đổi chưa thử trên trình duyệt thật.

### 2026-11-04 — Đợt nâng cấp, Phase 3: sản phẩm (danh mục, ảnh, ma trận, combo, ngũ hành theo ngành)

- Migration `020` (`product_images`, `variants.image_id`) và `021` (`products.options`, `variants.option_values`, chỉ mục khoá trường sản phẩm theo shop, tạo trường `ngu_hanh` cho shop phong thuỷ có sẵn và chép `products.elements` sang giá trị trường).
- Server: `server/lib/categories.js` (con cháu dùng chung cho sản phẩm, `/variants`, `/stock`, báo cáo); `CATEGORY_CYCLE`, `CATEGORY_IN_USE`, `CATEGORY_HAS_CHILDREN`, `GET /categories?tree=1`; `createProduct`/`updateProduct` nhận `options`, `option_values`, `opening_*`, `active`, `remove`, `images`, `custom`; SKU trùng báo đúng dòng; `PUT /products/:id/images`; `POST /uploads/images`, `GET /files/images/:id`; backup chép ảnh; ngũ hành chuyển sang trường sản phẩm theo shop (báo cáo + gợi ý theo mệnh đọc theo shop), `productInput` bỏ `elements`.
- Giao diện: `ProductForm` mới (`web/src/pages/products/`), `ComboForm`, tab Danh mục, lọc loại/danh mục, `ProductThumb` ở danh sách sản phẩm, POS, Kho, dòng đơn; Kho có lọc danh mục; `web/src/lib/{matrix,image,categories}.js`.
- Test: `catalog_matrix`, `uploads`, `categories` (mới); sửa `finance_integrity`, `loyalty`, `reports`, `finance`, `business` cho ngũ hành mới; vitest `matrix.test.js`, `product-form.test.jsx`.
- Còn mở: ảnh tải lên chưa gắn sản phẩm chưa có việc dọn; chưa thử thu nhỏ ảnh trên trình duyệt thật (canvas WebP chỉ chạy được trong trình duyệt, vitest không phủ `resizeImage`); thứ tự danh mục chỉ đổi bằng nút lên/xuống.

### 2026-11-04 — Đợt nâng cấp, phase 1: sửa nhanh giao diện

- Thanh bên không còn kẹt mở sau khi click chuột: `:focus-within` đổi thành `:has(:focus-visible)` (luật riêng), thêm blur khi click chuột ở menu, nút ghim, đăng xuất.
- Nền theme phong thuỷ sáng hơn một tông (`#F6F0E4` / `#FCF9F3`), tương phản đã kiểm, ghi vào nhật ký quyết định.
- Thêm smoke e2e cho thanh bên tự thu gọn. Kế hoạch cả đợt: `docs/plans/2026-11-dot-nang-cap.md`.

### 2026-11-04 — Đợt nâng cấp, Phase 2: nền tảng bán hàng dạng plugin

- Migration `019`: kênh `tiktok` (TikTok Shop, sàn) và `zalo` seed ở trạng thái tắt; mẫu `imp_tiktok` (mẫu khởi đầu, chưa kiểm với file thật); `tiktok_payout` vào quỹ ngân hàng; cài đặt `enabled_platforms` = Shopee + Facebook (tài khoản cũ giữ hành vi).
- `server/lib/platforms.js`: danh mục nền tảng. `paymentMethods()` thay hằng cũ ở thanh toán, chi phí, quỹ. Import lấy phương thức tiền về theo kênh (`payoutMethodOf`).
- Module `platforms`: `GET /platforms`, `POST /platforms/:id/enable|disable`; `POST/PATCH /channels` (kênh tuỳ chỉnh `ch_…`); `GET /channels?include_archived=1`. Tạo đơn ở kênh đã tắt bị chặn (`CHANNEL_DISABLED`).
- Đối soát nhận `channel_id`; báo cáo dòng tiền thêm `marketplace_by_channel`.
- Giao diện: Cài đặt → Nền tảng bán hàng; tab "Đối soát sàn" có bộ chọn sàn (ẩn khi không có sàn); Tổng quan tách tiền sàn treo theo sàn; Import mặc định theo nền tảng đầu tiên đang bật; session có `platforms`, `platformEnabled`, `marketplaces`, `allChannels`.
- Test: `tests/platforms.test.js` (6 nhóm), `web/src/__tests__/platforms.test.jsx`. `npm test` 82/82, `npm run test:web` 96/96, build qua.
- Còn mở: mẫu TikTok cần file xuất thật để kiểm tên cột và cột phí; chưa có `platformEnabled` test riêng ở SessionProvider.

### 2026-11-03 — Phiên 11: rà soát báo cáo và tài chính

Đánh giá cho thấy doanh thu, lợi nhuận gộp, đối soát Shopee ổn nhưng chi phí và dòng tiền có lỗi số liệu. Đã chạy thử từng nghi vấn trước khi sửa.

**Lỗi tìm thấy và đã sửa** (mỗi lỗi có test)
- Chi phí chung chia lệch 1 đồng (làm tròn từng shop): nay chia bằng `allocate()`. Chi phí của shop đã lưu trữ biến mất khỏi tổng.
- Dòng tiền không tính chi phí (cash_out = 0 dù đã chi).
- Lọc theo kênh cộng lặp chi phí chung ở mọi kênh (nay chia theo doanh thu kênh, cộng lại đúng tổng).
- Số ngày tồn theo shop dùng giá vốn của mọi shop (shop NH hiện 60 ngày, đúng là 120).
- Danh sách chi phí lọc theo shop không hiện chi phí chung.
- **Báo cáo theo sản phẩm và ngũ hành không trừ hàng trả** (lệch đúng bằng tổng hàng trả) — bắt được nhờ bộ test đối chiếu.
- Huỷ phiếu nhập đã trả tiền NCC: tiền đã chi nằm đó không hàng, không công nợ → nay bắt buộc ghi nhận NCC hoàn tiền.
- **PATCH áp giá trị mặc định** (zod 4 `.partial()`): sửa đơn nháp qua API xoá phí ship/phí sàn/giảm giá/ship shop chịu; sửa đơn đã chốt luôn 409 (không sửa được phí sàn khi sàn trả tiền); cùng lỗi ở chi phí (đổi phương thức về tiền mặt), phiếu nhập, sản phẩm (đơn vị, ngũ hành, nhãn, giá), webhook (bật lại hook đã tắt). Nay dùng `patchOf`.
- Giao diện Báo cáo sập khi đổi tab (tab mới vẽ bằng dữ liệu tab cũ lúc đang tải) — lỗi có từ trước.

**Thêm mới**
- Báo cáo chi phí theo danh mục, phân bổ chi phí chung theo tỷ lệ cố định, lọc danh mục sản phẩm, tuổi nợ (khách, sàn, NCC), xuất Excel từng tab báo cáo.
- `daily_stats` bằng trigger SQLite + tính lại ô bẩn khi đọc; `npm run check-stats`.
- Quỹ tiền (két, ngân hàng, ví): số dư tính từ sổ, chuyển quỹ, kiểm đếm, sổ quỹ. Chi phí có phương thức trả.
- Ước tính thuế do người dùng tự nhập, mặc định tắt (không tự đặt mức thuế vì các nguồn tra cứu mâu thuẫn nhau).
- Trang **Cách đọc số liệu** trong menu: 5 câu hỏi xanh/vàng/đỏ kèm việc nên làm, từ điển các con số.
- Bộ test đối chiếu `tests/finance_integrity.test.js`, `tests/finance.test.js`, `tests/cash.test.js`, `tests/daily_stats.test.js`.

**Còn lại / cần quyết định**
- Phí sàn khi khách trả hàng được giả định sàn không hoàn; nếu Shopee có hoàn một phần thì cần ô nhập phí sàn hoàn trên phiếu trả hàng.
- Mức thuế thực tế do chủ shop/kế toán nhập ở Cài đặt → Thuế.
- Chưa có chi phí định kỳ tự sinh (tiền thuê mặt bằng hằng tháng): hiện nhập tay mỗi tháng.
- Số dư đầu của quỹ cần nhập một lần để khớp tiền thật (mặc định tính từ toàn bộ lịch sử nên quỹ ngân hàng có thể âm).

### 2026-11-03 — Phiên 10: nhiều tài khoản, tách ngành nước hoa, khách theo shop, Loyalty & Campaign

- **Nhiều tài khoản**: mỗi tài khoản một file SQLite riêng (`data/accounts/<id>.db`) + `data/master.db` giữ tài khoản/phiên/chỉ mục API key. Request chạy trong ngữ cảnh DB của tài khoản (`AsyncLocalStorage`); `getDb()` ngoài ngữ cảnh báo lỗi. Đăng ký (`/auth/register`, đóng được bằng `REGISTRATION=closed`), giới hạn đăng ký theo IP. Bản cài cũ (`moso.db`) tự thành tài khoản đầu tiên. Sao lưu/webhook/script chạy theo từng tài khoản. Cả 33 test cũ chạy nguyên trên helper mới; thêm 7 test cách ly.
- **Thiết lập lần đầu**: đăng ký → tạo shop (4 ngành) → popup tạo kho → tạo sản phẩm đầu tiên; trang chủ nhắc tiếp nếu còn thiếu.
- **Tách ngành**: `nuoc_hoa_o_to` (theme `oto`: xám than + hổ phách, đồng hồ tốc độ) và `nuoc_hoa` (theme `nuochoa`: mận + hồng đồng, vòng lan toả; trường nhóm hương, nồng độ, thương hiệu, phong cách, dịp dùng, ngân sách, sinh nhật). Migration 015 chuyển shop `nuoc_hoa` cũ sang `nuoc_hoa_o_to`. Chỉnh terracotta của `oto` cho đạt AA (4.1 → 4.7).
- **Khách theo shop** (migration 016): `customer_shops` (thành viên, kèm `removed_at`) và `customer_tags`. Xoá khách = xoá khỏi một shop (mất thông tin riêng/nhãn/ghi chú của shop đó; giữ hồ sơ, shop khác, lịch sử đơn); hồ sơ không còn shop nào và chưa có đơn thì lưu trữ, tạo lại cùng SĐT dùng lại hồ sơ cũ. Nhãn riêng từng shop (UI: thẻ nhãn ở hồ sơ khách, bộ lọc nhãn ở danh sách). Thêm khách vào shop từ SĐT trùng. Nhắc mua lại không nhắc khách đã xoá khỏi shop.
- **Xuất danh sách khách**: `GET /customers/export` dùng chung bộ lọc với danh sách; theo shop có đủ trường riêng + nhãn + mệnh + số liệu tại shop, không chọn shop thì chỉ thông tin chung. Excel/CSV, chống công thức độc.
- **Loyalty & Campaign**: gộp Chăm sóc, Gợi ý theo mệnh, Hạng khách (chuyển từ Cài đặt), Mẫu tin nhắn (thêm sửa/xoá) thành `/loyalty`; `/care` chuyển hướng. API mới `GET /loyalty/element-campaign`, `DELETE /loyalty/templates/:id`. Tab Tự động hoá chỉ ghi rõ là chưa làm.
- Test: API 48, giao diện 80, smoke e2e 9. Đã chụp màn hình kiểm tra bằng mắt: đăng ký, tạo shop, theme nước hoa/ô tô, danh sách + hồ sơ khách, hộp xuất file, Loyalty.

**Cần chủ shop quyết định / chưa làm**
- Tự động nhắn tin và tự động nâng hạng: cần chọn kênh gửi (Zalo OA, SMS…) và quy định tin nhắn quảng cáo trước.
- Nhân viên trong một tài khoản (phân quyền): chưa làm; mỗi tài khoản hiện là một chủ.
- Chưa có "quên mật khẩu" qua email (không có email trong hồ sơ tài khoản); dùng `npm run reset-password -- <tên_đăng_nhập> <mật_khẩu_mới>` trên máy chủ.
- Cột `customers.tags` cũ (chung mọi shop, chưa từng có giao diện nhập) không còn dùng; dữ liệu nếu có vẫn nằm trong DB.

### 2026-11-03 — Phiên 9: xuất đơn hàng

- **Xuất đơn** ở trang Đơn hàng ("Xuất file"): theo đúng bộ lọc đang xem, hai kiểu (mỗi đơn một dòng: tiền, phí sàn, thực nhận, giá vốn, lợi nhuận; mỗi sản phẩm một dòng: SKU, SL, giá, giá vốn), hai định dạng (Excel dựng ở trình duyệt, CSV tải thẳng từ server). Có đếm trước số dòng, báo khi không có đơn hoặc vượt 50.000 dòng. API `GET /orders/export` (`layout`, `format=csv|json|count`), API key chỉ đọc dùng được.
- Bộ lọc đơn tách thành `orderFilter` dùng chung với danh sách; test đối chiếu số dòng file với danh sách cho 9 kiểu lọc.
- Test: API 32, giao diện 55, smoke e2e 7 (tải thật CSV và Excel về rồi đọc nội dung). Test giao diện bắt được lỗi tên file Excel ("tatca" thay vì "tat-ca") và một test theme đua thời gian (đã sửa, chạy 15 lần liên tiếp không hỏng).

### 2026-11-03 — Phiên 8: các việc còn lại trong danh sách

- **Trường khách hiện thành cột ở danh sách khách** (migration 014): mỗi trường khách của shop có cờ "Cột", bật trong "Thông tin khách của shop" hoặc lúc thêm trường. Tối đa 4 cột mỗi shop (`TOO_MANY_COLUMNS`), chỉ trường khách mới có cột, trường công thức không hiện cột. Chỉ hiện khi xem theo một shop; xem "Tất cả shop" thì không có cột và không lộ giá trị.
- **Báo cáo combo**: tab Sản phẩm có thẻ tổng riêng cho combo (số bán, doanh thu, giá vốn = tổng thành phần, LN gộp), dòng combo có nhãn, thêm cột "Qua combo" cho sản phẩm đơn (số đơn vị bán nằm trong combo, không cộng vào "Đã bán" để khỏi đếm hai lần). Thành phần chỉ bán qua combo vẫn hiện.
- **Nợ kỹ thuật đã trả**: (1) lọc khách theo mệnh nay lọc trước khi phân trang, không bỏ sót khách ở trang sau; (2) đơn import từ sàn ghi biến động kho theo ngày đặt (không phải lúc bấm import) và không kéo "lần xuất/nhập gần nhất" về quá khứ, nên tốc độ bán 30 ngày không bị đơn cũ làm sai.
- **Trống đồng** nay dùng ở trạng thái trống của theme phong thuỷ; nước hoa dùng vòng lan toả; theme chung giữ cuốn sổ mở.
- Test: API 29, giao diện 47, smoke e2e 6. Test e2e cũ có một chỗ chờ sai (chữ "Thông tin riêng" cũng nằm ở phụ đề trang danh sách) nên chỉ qua nhờ may về thời gian; đã sửa.
- **Cố ý không làm** (xem phần dưới): thử iPhone thật, kiểm tra file Shopee thật, `daily_stats`, tính hoàn trả theo ngày trả hàng, ngành thứ tư.

### 2026-11-03 — Phiên 7: làm nốt các việc còn thiếu

- **Combo**: biến thể `bundle` (migration 012). Tồn khả dụng = min theo thành phần; bán trừ kho từng thành phần, giá vốn = tổng thành phần lúc bán; huỷ đơn/trả hàng hoàn đúng theo ảnh chụp (`order_line_components`) kể cả khi công thức combo hay giá vốn đổi sau. Chặn nhập/điều chỉnh/chuyển kho/kiểm kê trên combo. UI: tạo combo trong form sản phẩm (chọn thành phần + SL), POS và Kho hiện "combo, bán được N".
- **Kiểm kê nhiều bước** (migration 013): phiếu → đếm dần → hoàn tất. Chênh lệch tính theo tồn tại lúc nhập số đếm từng dòng. Tab "Kiểm kê" trong Kho; nút cũ đổi tên "Điều chỉnh nhanh".
- **Trường tuỳ chỉnh có ô nhập** trong chi tiết đơn, form sản phẩm (khi sửa), phiếu nhập (component `CustomFieldsPanel`; công thức chỉ đọc). Sửa luôn lỗi hiển thị số công thức thiếu dấu phân cách nghìn.
- **Gộp khách trùng**: danh sách nghi trùng, so sánh hai hồ sơ, gộp (không hoàn tác); gộp thủ công từ hồ sơ khách.
- **Chuyển kho** (nút ở trang Kho, hiện khi có từ 2 kho). **Trình sửa mẫu import**: gợi ý cột từ file đang mở, cảnh báo cột mất, lấy sẵn giá trị trạng thái từ file.
- **Test giao diện**: vitest + Testing Library (43 test: hàm thuần, gom dòng import, trình sửa mẫu, panel trường tuỳ chỉnh, theme/tính năng theo shop) và smoke e2e bằng Chromium thật (5 luồng). Tổng cộng test API 25.
- **Lỗi bắt được nhờ test**: trang sập khi chuyển sang "Tất cả shop" lúc đang xem hồ sơ khách (dữ liệu cũ của shop + shop rỗng). Đã sửa.
- Còn lại: trường khách chưa hiện thành cột ở danh sách khách; trống đồng chưa dùng; chưa thử iPhone thật; combo chưa có báo cáo riêng (doanh thu tính theo combo, giá vốn theo thành phần).

### 2026-11-03 — Phiên 6: ngành bán, giao diện và trường khách theo shop

- **Ngành bán** cho shop (Cài đặt → Shop & kho): Bán lẻ chung, Phong thuỷ, Nước hoa. Danh mục ở `server/lib/industries.js`. Mỗi ngành có theme, tính năng (`feng_shui`) và trường khách tạo sẵn.
- **Trường khách theo shop**: trường khách bắt buộc thuộc một shop, giá trị luôn đọc/ghi kèm `shop_id`; cùng một khách ở hai shop có hai bộ thông tin tách biệt (có test). Mệnh/ngày sinh chuyển thành trường của shop phong thuỷ; chép giá trị cũ khi bật ngành; gộp khách giữ thông tin theo shop. Migration `011`.
- **Giao diện đổi theo shop**: `html[data-theme]` đặt theo shop đang chọn. `phongthuy` (la bàn, lôi văn, ngũ hành, âm lịch), `nuochoa` (mực đen + hổ phách + rượu vang, vòng lan toả), `general` (kẻ sổ cái; cũng dùng cho "Tất cả shop" và đăng nhập). Mệnh, ngũ hành, âm lịch, gợi ý theo mệnh chỉ hiện ở shop có tính năng `feng_shui`.
- **Trang Khách hàng**: nút "Thông tin khách của shop" (thêm/sửa/ẩn trường), hồ sơ có thẻ "Thông tin riêng · <shop>" để nhập giá trị. Form khách chung chỉ còn thông tin chung.
- Sinh nhật nhắc ở Chăm sóc nay đọc từ trường `birth_date` của từng shop (shop nước hoa có "Sinh nhật").
- Việc còn lại: trống đồng vẫn chưa dùng; trường khách chưa hiện thành cột ở danh sách khách; chưa có ngành thứ tư (thêm ở `industries.js`).

### 2026-11-03 — Phiên 5: phong thuỷ trong giao diện

- Chủ shop chọn cả 4 hướng (ngũ hành, không gian Á Đông, hoa văn truyền thống, chất liệu) nên đã sửa mục 7A của `CLAUDE.md` cho phép, có giới hạn.
- **Ngũ hành thành dữ liệu**: ký hiệu 金木水火土 + màu cho mệnh khách (danh sách, hồ sơ, gợi ý), hành sản phẩm; thẻ "Bán theo ngũ hành" ở Tổng quan và tab Sản phẩm của Báo cáo (API mới `GET /reports/elements`, có test).
- **Âm lịch + can chi ngày** ở thanh trên (đã kiểm: 1/1/2000 = 25/11 Kỷ Mão, ngày Mậu Ngọ; 10/2/2024 = mùng 1 Giáp Thìn).
- **Họa tiết**: la bàn bát quái (hero, đăng nhập), lôi văn (dưới tiêu đề trang, đáy hero), trống đồng (có sẵn component, chưa dùng), dấu triện "MỞ SỔ" ở đăng nhập, dấu "ĐÃ CHỐT" trên đơn đã thu đủ.
- **Chất liệu phẳng**: vân giấy dó mờ trên nền, vân gỗ trên sidebar/hero/thanh tab.
- **Bố cục**: Tổng quan chia lệch 7:5, nhãn chữ dọc ở hero, trang đăng nhập hai nửa.
- Còn lại: các trang Sản phẩm/Kho/Cài đặt mới chỉ ăn theo nền và họa tiết chung; chưa dùng trống đồng.

### 2026-11-03 — Phiên 4: gộp Import vào Đơn hàng, làm lại giao diện

- **Import** nay là cửa sổ mở từ nút "Nhập từ file" ở trang Đơn hàng (cũng hiện ở trạng thái trống). Bỏ mục menu riêng.
- **Giao diện làm lại** vì bản đầu trông như bài tập: thẻ viền mỏng giống hệt nhau, chữ hệ thống, không có điểm nhấn. Bản mới:
  - Chữ: Noto Serif (cùng họ với logo) cho tiêu đề và số lớn, Be Vietnam Pro cho giao diện. Đóng gói trong app (`@fontsource`, chỉ subset latin + vietnamese) nên chạy được khi không có mạng.
  - Bề mặt: nền Linen có hạt giấy rất nhẹ, tờ giấy nổi bằng bóng ấm, bảng kiểu sổ cái (kẻ đôi dưới tiêu đề, dòng kẻ chấm), tab gạch chân, trạng thái dạng chấm + nền nhạt.
  - Tổng quan có thẻ chính màu Walnut viền Champagne mảnh (gợi ép kim) với doanh thu tháng và biểu đồ 30 ngày; đơn hôm nay; sức khoẻ; tiền.
  - Sidebar nhóm theo việc, có icon; bộ chọn shop là menu riêng (thay select mặc định); điện thoại có thanh tab nổi dạng viên thuốc, bảng đơn thành danh sách thẻ.
  - Biểu đồ dùng đường thẳng, không làm mượt: đường cong làm "phình" giữa các ngày doanh thu 0 và gây hiểu nhầm.
  - Màu nhận diện shop mới (trong tông thương hiệu). Shop đã tạo trước đó giữ màu cũ, đổi được bằng API `PATCH /shops/:id {color}`.
- Sidebar đổi từ cột walnut kín 252px thành dải icon nổi 68px bo tròn; rê chuột/focus thì bung ra 236px đè lên nội dung (không đẩy layout); nút "Ghim thanh bên" giữ luôn mở, nhớ qua lần tải lại.
- Chạy lại toàn bộ luồng bằng trình duyệt (POS bán ngay trên điện thoại, sửa sản phẩm, import Excel từ trang Đơn, đối soát, menu shop): không lỗi.

### 2026-11-03 — Phiên 3: M7–M13

**Đã làm**
- **M7** chi phí (danh mục, huỷ mềm), đối soát Shopee: danh sách đơn sàn hoàn thành còn treo tiền, ghi nhận payout theo lô (mỗi đơn báo kết quả riêng, đơn không còn treo hoặc không tìm thấy thì báo lỗi, không ghi trùng).
- **M8** báo cáo: tổng quan có so sánh kỳ trước, doanh thu theo ngày, theo shop/kênh/sản phẩm, khách (mới, quay lại, top), kho (giá trị, số ngày tồn, sắp hết, bán chậm), dòng tiền (công nợ khách, tiền sàn treo, nợ NCC), sức khoẻ xanh/vàng/đỏ theo ngưỡng. Chi phí chung chia về shop theo doanh thu thuần (hoặc chia đều); khi lọc 1 shop vẫn chia theo tỷ lệ toàn hệ thống nên số không đổi theo cách lọc.
- **M9** hạng khách (12 tháng, mọi shop), nhắc mua lại (ngày mua gần nhất + chu kỳ × số lượng, hàng đã trả không tính; trạng thái xử lý gắn với ngày mua nên khách mua lại thì nhắc cũ tự hết), sinh nhật, gợi ý vật phẩm theo mệnh (bán chéo giữa shop), mẫu tin nhắn.
- **M10** bộ tính công thức tự viết (không `eval`, giá trị thiếu → null, chia 0 → null, chặn vòng tham chiếu), trường tuỳ chỉnh theo phạm vi hệ thống/shop, chỉ số báo cáo tuỳ chỉnh.
- **M11** quản lý API key (khoá hiện 1 lần), webhook (ký HMAC, retry, nhật ký, gửi lại), kéo sự kiện `/system/events`, tài liệu API sinh từ chính danh sách route. Route quản trị chỉ cho người đăng nhập, API key không tự cấp quyền được.
- **M12** sao lưu tự động hằng ngày + dọn bản cũ, tải bản sao lưu, xuất CSV (chống CSV injection, không xuất bảng bảo mật), `scripts/restore.js`.
- **M13** giao diện React + Vite dùng `brand/tokens.css`: đăng nhập/thiết lập, tổng quan, POS, đơn (danh sách, chi tiết, thu tiền, trả hàng, in phiếu), sản phẩm + đồng bộ shop, kho (tồn, lịch sử, kiểm kê), nhập hàng + NCC, khách (hồ sơ, mệnh, hạng, gợi ý), chăm sóc, chi phí + đối soát, báo cáo, import Excel/CSV (xem thử, báo cột thiếu), cài đặt.
- Test: 16 nhóm test API qua. Giao diện đã chạy thật bằng trình duyệt với dữ liệu mẫu (POS bán ngay trên viewport điện thoại, import file Excel, đối soát), không có lỗi API.

**Chưa làm / việc tiếp theo**
1. Ô nhập trường tuỳ chỉnh trong form đơn/sản phẩm/khách (API đã có).
2. Màn hình gộp khách trùng, chuyển kho, sửa mẫu import map cột, sửa ánh xạ trạng thái Shopee.
3. Kiểm kê dạng phiếu nhiều bước; combo.
4. Giao diện chưa có test tự động (mới kiểm tay bằng trình duyệt). Nên thêm test cho `rowsToOrders` trong `web/src/pages/Import.jsx`.
5. Thử trên iPhone thật qua wifi.

**Lưu ý**
- Thư viện `xlsx` (SheetJS 0.18.5 trên npm) có cảnh báo bảo mật đã biết khi đọc file không tin cậy. Ở đây chỉ đọc file xuất của chính chủ shop, ngay trên trình duyệt của họ nên rủi ro thấp; không dùng để đọc file người lạ gửi.
- Các mục "Cần kiểm tra lại với chủ shop" của phiên 1 vẫn còn hiệu lực: tên cột file Shopee, phí ship shop chịu, chu kỳ dùng hết của từng loại nước hoa (phải điền thì mới có nhắc mua lại).

### 2026-11-03 — Phiên 2: tên và nhận diện

- Đổi tên dự án thành **Mở Sổ** (code, README, `CLAUDE.md`). File DB mới là `data/moso.db`; cookie `moso_session`.
- Thêm mục 7A trong `CLAUDE.md`: concept, bảng màu, quy tắc, độ tương phản, logo.
- Tạo `brand/`: logo mark, lockup, favicon, `tokens.css`.
- Migration `007` đổi tên mẫu import dựng sẵn.
- Đọc lại toàn bộ backend, `npm test` 7/7 qua.
- Việc tiếp theo không đổi: M13 giao diện, nhập `brand/tokens.css` ngay từ đầu.

### 2026-11-03 — Phiên 1

**Đã làm**
- Viết `CLAUDE.md`: tầm nhìn, nghiệp vụ, lược đồ, API, UI, lộ trình, quy ước.
- Khung dự án: Node + Hono + better-sqlite3 + zod, ESM, không cần build cho server.
- Migration `001`–`006`. Runner tự chạy khi khởi động.
- **M0**: ID dạng ULID có tiền tố, tiền nguyên VND, `allocate()` chia tiền không lệch đồng, ngày kinh doanh theo giờ VN, lỗi thống nhất, audit log, sự kiện + hàng đợi webhook, idempotency key, đăng nhập scrypt + khoá 15 phút sau 5 lần sai, API key Bearer (quyền read/write).
- **M1**: thiết lập lần đầu (tạo chủ, kho, nhiều shop), CRUD shop/kho, kênh seed sẵn, cài đặt có giá trị mặc định.
- **M2**: sản phẩm gốc + biến thể (SKU viết hoa, duy nhất), niêm yết theo shop với giá riêng, đồng bộ niêm yết (chọn sản phẩm/biến thể hoặc toàn bộ, tuỳ chọn ghi đè giá), tra cứu biến thể kèm giá shop + tồn kho để bán.
- **M3**: `applyMovement()` là cổng duy nhất thay đổi tồn kho; giá vốn bình quân di động theo kho; phiếu nhập (nháp → nhận → huỷ) với phân bổ ship/phí/chiết khấu vào giá vốn; công nợ NCC; điều chỉnh/kiểm kê/tồn đầu/hư hỏng; chuyển kho; danh sách tồn có số ngày còn đủ hàng, cờ sắp hết/bán chậm/âm; kiểm tra sổ cái khớp tồn.
- **M4**: khách hàng dùng chung, chuẩn hoá SĐT (+84, dấu chấm, khoảng trắng), mệnh nạp âm theo âm lịch chính xác (đổi lịch Hồ Ngọc Đức, đã đối chiếu Tết 7 năm), hành hợp để gợi ý vật phẩm, tìm nghi trùng, gộp hồ sơ, ghi chú theo shop, thống kê theo từng shop.
- **M5**: đơn bán với vòng đời trạng thái (nhảy cóc được, vd nháp → hoàn thành cho POS), trừ kho khi xác nhận, chụp giá vốn, huỷ hoàn kho, trả hàng một phần/toàn phần (có/không nhập lại kho), hoàn tiền, thanh toán nhiều lần, phân bổ giảm giá đơn xuống dòng, lợi nhuận gộp, phiếu bán hàng in A5/80mm.
- **M6**: import đơn chuẩn hoá JSON; xem thử (chạy thật trong transaction rồi rollback); mỗi đơn một savepoint; upsert theo (shop, kênh, mã đơn kênh); cập nhật trạng thái/phí/thanh toán; tự tạo phiếu trả khi sàn báo hoàn; ánh xạ trạng thái Shopee; 2 mẫu import dựng sẵn; file CSV mẫu chuẩn; lưu lịch sử lượt import.
- Script: `seed`, `backup`, `reset-password`.
- Test: 7 nhóm test API, tất cả qua.

**Lỗi phát hiện & đã sửa**
- Đơn sàn nhận đủ payout vẫn bị báo "thanh toán một phần" → sửa: kênh sàn cần thu = `net_amount`. Đã thêm test.

**Việc tiếp theo (theo thứ tự đề xuất)**
1. **M13 giao diện tối thiểu dùng được**: đăng nhập/thiết lập, bộ chọn shop, POS bán nhanh trên điện thoại, danh sách & chi tiết đơn, sản phẩm, tồn kho, nhập hàng, khách hàng, import (đọc Excel bằng SheetJS trên trình duyệt). Làm trước để bắt đầu dùng thật và phát hiện lỗi nghiệp vụ sớm.
2. **M7** chi phí + phân bổ chi phí chung + màn đối soát tiền Shopee đang treo.
3. **M8** `daily_stats` + báo cáo + sức khoẻ.
4. **M12** sao lưu tự động hằng ngày + xuất CSV.
5. **M9**, **M11** (route quản lý + worker gửi webhook), **M10**.

**Cần kiểm tra lại với chủ shop**
- Tên cột trong file xuất đơn của Shopee hiện tại (mẫu `imp_shopee` đang dựa trên tên cột phổ biến, có thể đã đổi).
- Phí ship shop chịu trên Shopee có bị sàn trừ vào payout không, hay trả riêng.
- Chu kỳ dùng hết thực tế của từng loại nước hoa.

**Nợ kỹ thuật**
- `listStock` tính tốc độ bán 30 ngày bằng query trực tiếp; khi dữ liệu lớn nên đọc từ `daily_stats`.
- Báo cáo query thẳng bảng `orders` (có index theo shop/ngày), chưa dùng `daily_stats`. Khi dữ liệu lớn mới cần.
- Hoàn trả tính vào ngày của đơn gốc, không phải ngày trả hàng.
- Lọc khách theo mệnh lấy hết khách khớp điều kiện rồi mới phân trang (đúng nhưng không tối ưu). Với hàng chục nghìn khách thì cần chuyển mệnh thành cột tính sẵn.
- Ngày biến động kho của đơn import là ngày đặt; huỷ/trả hàng của đơn import vẫn ghi theo lúc thao tác (không biết ngày huỷ thật trên sàn).

**Chưa làm, cần người thật hoặc quyết định của chủ shop**
- Thử trên iPhone thật qua wifi (cần thiết bị).
- Kiểm tra với file xuất Shopee thật: tên cột, phí ship shop chịu có bị trừ vào payout không (cần file thật).
- Điền "chu kỳ dùng hết" cho từng sản phẩm thì mới có nhắc mua lại.
- Chưa có ngành thứ năm: cần tên ngành và các trường khách muốn hỏi (thêm ở `server/lib/industries.js`).
- `daily_stats` và tính hoàn trả theo ngày trả hàng: đã quyết định chưa làm (xem nhật ký quyết định trong `CLAUDE.md`).
