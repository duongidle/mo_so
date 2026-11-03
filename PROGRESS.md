# Nhật ký thực hiện

> Ghi theo module trong `CLAUDE.md` mục 8. Mỗi phiên làm việc: đọc mục "Việc tiếp theo" trước, cập nhật file này khi xong.

## Tổng quan

| # | Module | Backend | Giao diện | Test | Ghi chú |
|---|---|---|---|---|---|
| M0 | Nền tảng | ✅ | — | ✅ | |
| M1 | Shop, kho, kênh, cài đặt | ✅ | ⬜ | ✅ | |
| M2 | Sản phẩm, niêm yết, đồng bộ | ✅ | ⬜ | ✅ | Combo chưa làm |
| M3 | Tồn kho, nhập hàng, NCC | ✅ | ⬜ | ✅ | Kiểm kê dạng phiếu nhiều bước chưa làm (đang là điều chỉnh 1 bước) |
| M4 | Khách hàng chung, mệnh | ✅ | ⬜ | ✅ | |
| M5 | Đơn bán, trả hàng, phiếu | ✅ | ⬜ | ✅ | Phiếu bán hàng HTML đã có |
| M6 | Import đơn | ✅ | ⬜ | ✅ | Đọc file Excel/CSV làm ở giao diện (trình duyệt) |
| M7 | Chi phí, đối soát Shopee | ⬜ | ⬜ | ⬜ | Bảng `payments` đã có |
| M8 | Báo cáo, sức khoẻ | ⬜ | ⬜ | ⬜ | Ngưỡng sức khoẻ đã có trong settings |
| M9 | Loyalty, nhắc mua lại | ⬜ | ⬜ | ⬜ | `consumption_days`, mệnh khách đã có dữ liệu |
| M10 | Trường tuỳ chỉnh, công thức | ⬜ | ⬜ | ⬜ | |
| M11 | API key, webhook | 🟡 | ⬜ | ⬜ | Auth API key + ghi outbox sự kiện xong; chưa có route quản lý key/webhook, chưa có worker gửi |
| M12 | Sao lưu | 🟡 | ⬜ | ⬜ | Có `npm run backup` chạy tay; chưa tự động |
| M13 | Giao diện web | ⬜ | | | |

✅ xong · 🟡 một phần · ⬜ chưa làm

---

## Nhật ký

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
