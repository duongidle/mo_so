# Plan: trường tuỳ chỉnh v2 (xoá trường, ngày sinh thành thông tin chung, mệnh tự tính, công thức ngày tháng)

## Bối cảnh

Chủ shop dùng thử ngày 2026-11-04 và gặp bốn vấn đề:
1. **Không xoá được trường tuỳ chỉnh.** Hiện chỉ có "Ẩn".
2. **Ngày sinh đang là trường riêng của từng shop.** Đây là thông tin cá nhân, giống nhau ở mọi shop. Chủ shop muốn nó là thông tin mặc định của khách. Thiết kế cũ (CLAUDE.md 5.5, nhật ký quyết định "Mệnh/ngày sinh chuyển sang trường tuỳ chỉnh của từng shop") nay được sửa một phần.
3. **Trường "Mệnh (để trống = tự tính)" hiện "—"**, dù thẻ Mệnh phía trên đã tính ra "Mộc". Trường này chỉ lưu giá trị ghi đè, không hiện giá trị đang có hiệu lực.
4. **Công thức `TODAY() - {ngày sinh}` ra rỗng.** Đã kiểm: `server/lib/formula.js` trả `null` khi trừ hai ngày, không báo lỗi. Trong khi đó `YEAR(TODAY()) - YEAR(...)` ra 24, và `DAYS_BETWEEN` chạy đúng. Giao diện chỉ hiện "không có dữ liệu", nên người dùng tưởng do thứ tự tạo trường. Thực ra trường công thức luôn được tính lại khi đọc.

## A. Xoá trường tuỳ chỉnh

- `DELETE /custom/fields/:id`:
  - **Trường chưa có giá trị nào và không bị công thức khác tham chiếu:** xoá hẳn. Đây là dữ liệu nháp chưa phát sinh gì, đúng quy ước 6.
  - **Trường đã có dữ liệu:** body phải có `confirm: true`.
    - Ghi toàn bộ giá trị của trường (entity_id, value) vào `audit_log` để khôi phục tay.
    - Rồi xoá định nghĩa trường và các giá trị.
    - Tiền lệ: "xoá khách khỏi shop" ở mục 5.5 cũng ghi `audit_log` theo cách này. Ghi lý do vào nhật ký quyết định.
  - **Trường đang bị công thức khác tham chiếu:** 409 `FIELD_REFERENCED`, kèm danh sách trường đó.
  - Xoá xong thì khoá (key) được giải phóng để dùng lại. Có audit và emit.
- "Ẩn" giữ nguyên: lưu trữ, giữ dữ liệu, khôi phục được.
- **UI `FieldsManager`:**
  - Có nút "Xoá" cạnh "Ẩn".
  - Hộp xác nhận nói rõ số bản ghi đang có dữ liệu, và gợi ý "Ẩn" nếu muốn giữ.
  - Trường bị tham chiếu thì nút Xoá bị tắt, kèm lý do.

## B. Ngày sinh thành thông tin chung của khách

- Dùng lại cột `customers.birth_date` và `customers.birth_year` (năm sinh khi chưa biết ngày) làm thông tin hồ sơ chung, giống tên, SĐT, địa chỉ.
- Giới tính và các trường khác vẫn là trường riêng của shop.
- **Migration 028** (thêm file, không sửa file cũ):
  1. Với mỗi khách, gom giá trị từ các trường vai trò `birth_date` và `birth_year` của mọi shop (các ngành phong thuỷ, nước hoa, nước hoa ô tô đều có trường ngày sinh).
     - Chọn giá trị cập nhật gần nhất. Kiểm `custom_values` có cột thời gian không. Nếu không có thì ưu tiên shop phong thuỷ, rồi giá trị khác rỗng.
     - Nếu `customers.birth_date` cũ đã có thì chỉ ghi đè khi có giá trị từ trường shop.
     - Các shop có giá trị khác nhau: ghi `audit_log`, và báo ra bằng script `npm run check-birthdates`.
  2. Lưu trữ (ẩn) các trường vai trò `birth_date` và `birth_year` cũ. Giữ giá trị, không xoá.
  3. Công thức đang tham chiếu `{custom.<khoá trường ngày sinh>}` được viết lại thành `{birth_date}` (hoặc `{birth_year}`). Liệt kê các công thức đã viết lại trong `audit_log` và trong báo cáo.

  Phần nào không làm được bằng SQL thuần thì theo đúng mẫu migration hoặc backfill đã có trong dự án (xem cách 021 và 022 làm).
- `server/lib/industries.js`: bỏ preset trường ngày sinh và năm sinh khỏi `customer_fields`. `applyIndustry` không tạo lại hai trường này.
- **Mọi chỗ đọc ngày sinh chuyển sang cột chung:**
  - Tính mệnh (`roleValues` và customers service).
  - Nhắc sinh nhật (loyalty).
  - Xuất danh sách khách: ngày sinh nằm trong phần thông tin chung, kể cả khi không chọn shop.
  - Gợi ý theo mệnh.
- **UI:**
  - Form tạo và sửa khách, và form thêm nhanh trong `CustomerPicker`, có "Ngày sinh" và một ô phụ "Năm sinh (nếu không rõ ngày)".
  - Hồ sơ khách hiện ngày sinh ở phần thông tin chung, kèm tuổi.
- Danh mục biến công thức (`server/modules/custom/variables.js`), đối tượng khách, thêm:
  - `birth_date` (ngày)
  - `birth_year` (số)
  - `age`: biến dẫn xuất, tuổi tròn theo giờ VN, tính từ `birth_date`; nếu chỉ có năm thì lấy năm hiện tại trừ năm sinh.

## C. Mệnh hiện giá trị đang có hiệu lực

- Trường vai trò `element` là **giá trị ghi đè**. Giá trị hiệu lực = ghi đè nếu có, nếu không thì giá trị tự tính từ ngày sinh hoặc năm sinh chung.
- **Server:** `getValues` (hoặc hàm đọc hồ sơ khách) trả cả `stored` và `effective` cho trường vai trò element, cùng nguồn (`override` | `computed` | `approximate`).
- **Hồ sơ khách:**
  - Hiện giá trị hiệu lực. Khi là tự tính thì kèm chữ nhỏ "(tự tính)" hoặc "(ước tính theo năm)".
  - Form sửa để ô ghi đè trống, placeholder là giá trị tự tính.
  - Đổi nhãn preset thành "Mệnh (ghi đè)" cho shop mới. Shop cũ giữ nhãn đã có.
- Cột ở danh sách khách (`show_in_list`), bộ lọc mệnh và file xuất đều dùng giá trị hiệu lực.
- Biến công thức dẫn xuất `menh` (giá trị hiệu lực) cho shop có tính năng `feng_shui`.
- **Tổng quát hoá nhẹ:** đặt chỗ `derivedValue(role, record, shopId)` để sau này thêm vai trò khác thì dùng chung.

## D. Công thức ngày tháng

Sửa trong `server/lib/formula.js`:
- **Phép tính ngày:**
  - ngày − ngày = số ngày (số nguyên).
  - ngày ± số = ngày (`YYYY-MM-DD`).
  - Nhận chuỗi ngày `YYYY-MM-DD` và ISO. Tính theo giờ `Asia/Ho_Chi_Minh` cho `TODAY()`.
- **Hàm mới** (có trong `FUNCTION_DOCS` để gợi ý ở `FormulaEditor`):
  - `AGE(ngày)`: tuổi tròn.
  - `DAY(ngày)`.
  - `DATE(năm, tháng, ngày)`.
  - `MONTHS_BETWEEN(a, b)`: số tháng tròn.
- **Kiểm kiểu lúc lưu:**
  - Danh mục biến đã có kiểu. Suy kiểu biểu thức để chặn phép không hợp lệ, ví dụ chữ − số hoặc ngày × số.
  - Thông báo gợi ý cách đúng, ví dụ "Muốn tính tuổi, dùng AGE({birth_date})".
- **Lý do khi kết quả rỗng:** `evaluate` trả kèm lý do khi ra null.
  - Thiếu dữ liệu: ví dụ "Khách chưa có Ngày sinh".
  - Chia cho 0.
  - Phép không hợp lệ.

  `POST /custom/formula/preview` và chỗ hiển thị giá trị trường công thức ở hồ sơ hiện lý do ngắn thay vì chỉ "không có dữ liệu". Ví dụ chữ muted "— (chưa có Ngày sinh)".
- **Mẫu công thức** trong `FormulaEditor` cho khách thêm "Tuổi = AGE({birth_date})" và "Số ngày từ đơn gần nhất".
- **Công thức đã lưu dạng `TODAY() - {ngày sinh}`:** sau khi sửa, công thức này ra số ngày, không phải tuổi. Migration 028 liệt kê các công thức trừ một biến ngày khỏi `TODAY()` mà nhãn trường có chữ "tuổi". Với những công thức đó thì viết lại thành `AGE(<biến>)` và ghi audit. Còn lại để nguyên và liệt kê trong báo cáo.

## E. Khởi sinh dữ liệu của trường (bảo đảm và test)

- Trường công thức luôn tính lúc đọc, cho mọi bản ghi, bất kể trường tạo trước hay sau khi có dữ liệu. Phải đúng ở mọi nơi hiển thị: hồ sơ, cột danh sách, xuất file, preview.
- Thêm `default_value` tuỳ chọn cho trường không phải công thức (migration 028 thêm cột):
  - Điền sẵn khi tạo bản ghi mới, hoặc khi mở form của bản ghi chưa có giá trị.
  - Không tự ghi vào bản ghi cũ.
  - UI ở `FieldsManager`.
- Đổi ngành shop (`applyIndustry`) vẫn chỉ thêm trường còn thiếu. Không tạo lại trường đã bị xoá có chủ đích: lưu danh sách khoá preset đã bị xoá theo shop, hoặc kiểm `audit_log`. Chọn cách đơn giản và ghi lại.

## Test

- **Xoá trường:** chưa có dữ liệu thì xoá hẳn; có dữ liệu mà thiếu `confirm` thì 409; có `confirm` thì xoá và có snapshot trong `audit_log`; bị tham chiếu thì 409; xoá xong dùng lại được khoá.
- **Migration 028:**
  - Dựng DB qua 027 với khách có ngày sinh ở hai shop. Có ca trùng giá trị và ca lệch giá trị.
  - Có công thức tham chiếu ngày sinh, và một trường "Số tuổi" dạng `TODAY() - {custom.ngay_sinh}`.
  - Chạy 028 rồi kiểm cột chung, trường cũ đã ẩn, công thức đã viết lại, AGE ra đúng tuổi.
- **Mệnh hiệu lực:** chỉ có ngày sinh thì ra tự tính; có ghi đè thì ra ghi đè; chỉ có năm thì ra ước tính. Hồ sơ, cột danh sách, bộ lọc và file xuất đều ra cùng giá trị.
- **Công thức:** ngày − ngày; ngày + số; AGE; lý do khi null; kiểm kiểu chặn phép sai lúc lưu; tạo trường công thức trước rồi mới nhập ngày sinh thì vẫn ra giá trị.
- **Nhắc sinh nhật và gợi ý theo mệnh** dùng ngày sinh chung. Sửa các test cũ của loyalty, industries và customers cho khớp.
- **Vitest:** `FieldsManager` xoá và xác nhận; hồ sơ khách hiện "(tự tính)"; `FormulaEditor` hiện lý do null.

## Tài liệu

- CLAUDE.md:
  - 5.5: ngày sinh và năm sinh là thông tin chung; mệnh ghi đè theo shop.
  - 5.11: xoá trường, phép tính ngày, `default_value`, lý do null.
  - 5.14: preset ngành bỏ trường ngày sinh.
  - Nhật ký quyết định 2026-11-04: lý do đổi, kèm câu "sửa một phần quyết định trước".
- PROGRESS.md.
