# Nhật ký thực hiện

> Ghi theo module trong `CLAUDE.md` mục 8. Mỗi phiên làm việc: đọc mục "Việc tiếp theo" trước, cập nhật file này khi xong.

## Tổng quan

| # | Module | Backend | Giao diện | Test | Ghi chú |
|---|---|---|---|---|---|
| M0 | Nền tảng | ✅ | — | ✅ | |
| M1 | Shop, kho, kênh, cài đặt | ✅ | ✅ | ✅ | |
| M2 | Sản phẩm, niêm yết, đồng bộ | ✅ | ✅ | ✅ | Combo chưa làm |
| M3 | Tồn kho, nhập hàng, NCC | ✅ | ✅ | ✅ | Kiểm kê dạng phiếu nhiều bước chưa làm (đang là điều chỉnh 1 bước). Chuyển kho có API, chưa có màn hình |
| M4 | Khách hàng chung, mệnh | ✅ | ✅ | ✅ | Chưa có màn hình gộp hồ sơ trùng (API có) |
| M5 | Đơn bán, trả hàng, phiếu | ✅ | ✅ | ✅ | POS, chi tiết đơn, thu tiền, trả hàng, in phiếu |
| M6 | Import đơn | ✅ | ✅ | ✅ | Nút "Nhập từ file" ngay trang Đơn hàng (không còn trang riêng; `/import` chuyển hướng về đó). Đọc Excel/CSV trong trình duyệt (SheetJS). Chưa có màn hình sửa mẫu map cột (API có) |
| M7 | Chi phí, đối soát Shopee | ✅ | ✅ | ✅ | Chi phí huỷ mềm; đối soát theo lô, báo lỗi từng đơn |
| M8 | Báo cáo, sức khoẻ | ✅ | ✅ | ✅ | Tính trực tiếp từ bảng đơn, chưa dùng `daily_stats` (xem nhật ký quyết định) |
| M9 | Loyalty, nhắc mua lại | ✅ | ✅ | ✅ | Hạng, nhắc mua lại, sinh nhật, gợi ý theo mệnh, mẫu tin nhắn (chỉ soạn + sao chép, không tự gửi) |
| M10 | Trường tuỳ chỉnh, công thức | ✅ | 🟡 | ✅ | Có màn hình tạo trường/chỉ số; chưa có ô nhập trường tuỳ chỉnh trong form đơn/sản phẩm/khách (API `/custom/values` có) |
| M11 | API key, webhook | ✅ | ✅ | ✅ | Quản lý key, webhook ký HMAC, retry 1p/5p/30p/2h/12h, nhật ký, gửi lại, `/api/v1/docs` |
| M12 | Sao lưu, xuất CSV | ✅ | ✅ | ✅ | Tự động mỗi ngày (14 ngày + 8 tuần), tải bản sao lưu, xuất CSV, `scripts/restore.js` |
| M13 | Giao diện web | | 🟡 | | Đủ các màn hình chính, chạy được trên điện thoại và máy tính. Còn các điểm ghi ở từng module |

✅ xong · 🟡 một phần · ⬜ chưa làm

---

## Nhật ký

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
- Biến động kho của đơn import dùng thời điểm import, không phải ngày đặt trên sàn. Báo cáo doanh thu dùng ngày đặt nên không sai, nhưng sổ cái kho theo ngày sẽ lệch ngày.
- Danh sách khách lọc theo mệnh đang lọc sau khi phân trang.
- Báo cáo query thẳng bảng `orders` (có index theo shop/ngày), chưa dùng `daily_stats`. Khi dữ liệu lớn mới cần.
- Hoàn trả tính vào ngày của đơn gốc, không phải ngày trả hàng.
