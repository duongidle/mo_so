# Plan: làm lại bố cục giao diện cho gọn, rõ, dễ nhìn

## Bối cảnh

Chủ shop dùng thử bản sau đợt nâng cấp, nhận xét ngày 2026-11-04: giao diện "nhức đầu, thiếu trực quan, thiếu tách bạch". Cụ thể:
- Danh sách sản phẩm và đơn hàng khó quan sát.
- Popup tạo sản phẩm và phiếu nhập quá dài, khó điền, màu sắc rối.
- Trang có quá nhiều section chồng lên nhau.
- Màn kế toán lỗi căn lề.
- Menu "Bán nhanh" thừa.

Ảnh chụp cho thấy:

**Trang Nhập hàng:** năm dải ngang trước khi tới nội dung.
- Tiêu đề.
- Đường lôi văn chạy hết chiều ngang.
- Khoảng trống lớn.
- Hàng tab có gạch chân.
- Hàng chip lọc.

Nền giấy có vân sóng làm nhiễu.

**Kết quả kinh doanh (kế toán):**
- Các dòng in đậm dính mép trái thẻ, không có đệm, trong khi dòng 5111/5113 thụt vào.
- Dòng đầu bị góc bo cắt.
- Số 0 hiện "-0 đ".
- Dải phạm vi ghi "một shop" thay vì tên shop (`web/src/pages/Accounting.jsx` ~212).
- Hai khung ghi chú xếp chồng.
- Bộ chọn nhóm dạng nút to, rồi tab, rồi câu mô tả, rồi chọn ngày, rồi dải phạm vi, rồi ghi chú: sáu lớp trước khi tới số liệu.

**Ô nhập:** nền xám đặc (`--paper-sunk`) trên thẻ giấy, cộng viền champagne, cộng hàng màu be. Nhiều màu nền cạnh tranh nhau.

## Nguyên tắc mới (ghi vào CLAUDE.md mục 7 và 7A, có dòng nhật ký quyết định)

1. **Một trang tối đa ba lớp trước nội dung:**
   - Lớp 1: header gồm tiêu đề, mô tả ngắn (tuỳ chọn) và nút hành động bên phải.
   - Lớp 2: thanh công cụ một hàng gồm tab hoặc segmented, ô tìm và bộ lọc.
   - Lớp 3: nội dung.
   - Bỏ khoảng trống lớn giữa các lớp.
2. **Họa tiết tiết chế hơn nữa.**
   - Đường lôi văn hay đường kẻ đôi dưới tiêu đề chỉ giữ ở Tổng quan. Các trang khác dùng một đường kẻ mảnh bình thường, hoặc không có.
   - Vân giấy dó trên nền: giảm độ đậm rõ rệt, hoặc chỉ giữ ở trang đăng nhập và Tổng quan.
   - Áp dụng cho mọi theme (general, phongthuy, nuochoa, oto).
   - Phần 7A về họa tiết sửa theo, ghi lý do: chủ shop thấy rối.
3. **Màu nền ít lớp.**
   - Ô nhập dùng nền thẻ (`--paper`) và viền 1px trung tính đủ thấy, độ tương phản viền với nền ≥ 3:1. Focus thì viền màu nhấn.
   - Không dùng nền xám đặc cho ô nhập.
   - Hàng nhấn (như "Áp dụng cho tất cả") dùng nền rất nhạt hoặc chỉ một đường kẻ, không dùng màu be đậm.
   - Một trang chỉ có một màu nhấn đặc: nút chính.
4. **Một ghi chú mỗi vùng.** Gộp các khung giải thích thành một dòng chữ nhỏ màu muted dưới thanh công cụ. Phần dài đưa vào nút ⓘ (MetricInfo).
5. **Căn lề nhất quán.** Mọi dòng trong thẻ có cùng đệm trái và phải, kể cả dòng tổng in đậm. Thẻ có `overflow: hidden` hoặc đệm trên đủ để góc bo không cắt chữ.
6. **Số 0 hiện "0 ₫"**, không bao giờ "-0 ₫". Sửa tận gốc trong hàm định dạng tiền (`web/src/lib.js` hoặc nơi đang định dạng).

## Việc cần làm

### A. Bỏ menu Bán nhanh, một giao diện tạo đơn
- `web/src/App.jsx`:
  - Bỏ `/pos` khỏi `NAV`. Thanh tab điện thoại (`PRIMARY`, `tab('/pos'…)`) đổi thành `/orders/new`, nhãn "Tạo đơn".
  - Nút "Bán nhanh" trên thanh trên cùng giữ nguyên, trỏ `/orders/new`, ẩn khi đang ở `/orders/new`.
  - Nút nổi "+ Đơn" trỏ `/orders/new`.
  - Route `/pos` chuyển hướng sang `/orders/new`.
- `OrderForm` phải nhanh như POS cũ trên điện thoại (tạo đơn < 30 giây):
  - Mặc định kênh "Bán trực tiếp".
  - Focus sẵn ô tìm sản phẩm.
  - Nút "Bán xong" luôn ở thanh dưới.
  - Phần nâng cao (mã đơn kênh, phí sàn, chia kho, ghi chú) gọn trong một khối "Thêm tuỳ chọn" thu gọn.
- Xoá `Pos.jsx` nếu không còn dùng. Tests và e2e tham chiếu `/pos` thì sửa theo.

### B. Bộ khung trang dùng chung
Trong `web/src/components/` tạo:
- `PageHeader`: tiêu đề, mô tả, actions.
- `Toolbar`: một hàng, xuống dòng gọn trên điện thoại. Nhận tab hoặc segmented, ô tìm, bộ lọc, nút phụ.
- `Section`: thẻ có tiêu đề nhỏ và nội dung, đệm thống nhất.

Áp dụng cho mọi trang: Tổng quan, Đơn hàng, Sản phẩm, Kho, Nhập hàng, Khách hàng, Loyalty, Chi phí & quỹ, Sổ kế toán, Báo cáo, Cài đặt, Cách đọc số liệu. Tab hiện tại có gạch chân dày thì chuyển sang segmented control gọn, hoặc tab mảnh nằm cùng hàng với bộ lọc.

### C. Danh sách dễ quan sát (Đơn hàng, Sản phẩm, rồi áp dụng cho Kho, Nhập hàng, Khách hàng)
- **Bảng gọn:**
  - Header dính khi cuộn.
  - Hàng cao vừa phải, hover rõ.
  - Cột tiền căn phải, số dạng tabular.
  - Chữ phụ (mã, SKU, ngày) màu muted cỡ nhỏ ở dòng thứ hai của ô thay vì cột riêng.
- **Đơn hàng:**
  - Cột: mã + ngày giờ; khách (tên + SĐT); kênh (badge nhỏ); số SP; khách phải trả; thanh toán (badge); trạng thái (badge).
  - Tab trạng thái kèm số đếm, ví dụ "Chờ xác nhận 3". Server có thể cần một endpoint đếm theo trạng thái dùng chung `orderFilter`; nếu thêm thì có test.
  - Đơn có cảnh báo (âm kho, còn nợ khách) có chấm nhỏ.
- **Sản phẩm:**
  - Ảnh thu nhỏ 40px, tên, danh mục (muted).
  - Số biến thể, khoảng giá, tồn tổng (đỏ nếu dưới tối thiểu), trạng thái bán.
  - Bấm hàng mở form sửa.
- **Điện thoại:** mỗi hàng thành thẻ hai dòng, không cuộn ngang.

### D. Form tạo/sửa (Sản phẩm, Combo, Phiếu nhập) thành trang đầy đủ hoặc ngăn kéo bên phải
Chọn **trang đầy đủ** (`/products/new`, `/products/:id`, `/products/combo/new`, `/purchases/new`, `/purchases/:id`), kiểu trang sản phẩm của Shopify:
- **Máy tính hai cột 8:4.**
  - Cột chính: Thông tin cơ bản (tên, mô tả); Giá & kho (khi không có biến thể) hoặc Biến thể (ma trận).
  - Cột phụ: Ảnh, Phân loại (danh mục, thương hiệu, đơn vị), Bán ở shop, Trường riêng của shop, Trạng thái.
  - Mỗi khối là một `Section` có tiêu đề rõ.
- **Thanh lưu dính đáy** (Huỷ / Lưu). Cảnh báo khi rời trang mà chưa lưu.
- **Trường tuỳ chọn ít dùng** (mã vạch, tồn tối thiểu, chu kỳ dùng hết, thương hiệu) nằm trong khối "Thêm thông tin" thu gọn, hoặc gom vào cột phụ.
- **Ma trận biến thể** giữ chức năng hiện có (thêm/đổi tên/xoá thuộc tính, chuyển từ sản phẩm đơn, xác nhận bỏ biến thể, ảnh biến thể, "Áp dụng cho tất cả"), làm gọn lại:
  - Hàng "Áp dụng cho tất cả" là một thanh nhỏ phía trên bảng: ô giá, giá vốn, tồn + nút Áp dụng.
  - Bảng trong `Section` riêng.
- **Phiếu nhập** cùng khung:
  - Cột chính: các dòng hàng (tìm SKU, SL, giá nhập, thành tiền).
  - Cột phụ: nhà cung cấp, kho nhận, ngày, phí ship và phí khác, tổng, thanh toán.
  - Thanh dưới: Lưu nháp / Nhận hàng.
- **Popup nhỏ** (thêm danh mục, thêm khách nhanh, xác nhận) giữ dạng modal nhưng gọn: tối đa khoảng 5 ô, nút ở footer.
- Mọi form cũ đang mở bằng modal và dài hơn khoảng 6 ô thì chuyển theo cách này: chi phí, chứng từ tay, tài sản, chi phí định kỳ có thể giữ modal nếu ngắn. Liệt kê những form đã chuyển trong báo cáo.

### E. Sổ kế toán
- Bộ chọn nhóm (Nghiệp vụ, Sổ, Báo cáo) và tab gộp thành một hàng: segmented nhóm bên trái, tab của nhóm ngay cạnh hoặc ngay dưới. Không dùng nút to.
- Câu mô tả, dải phạm vi và ghi chú gộp thành một dòng muted. Phần giải thích dài đưa vào ⓘ.
- Dải phạm vi hiện **tên shop** thật.
- KQKD và các bảng báo cáo:
  - Đệm thống nhất, dòng nhóm thụt vào, dòng tổng in đậm có kẻ trên, cùng mép trái và phải.
  - Không cắt góc.
  - Số 0 = "0 ₫". Số âm dùng dấu trừ chuẩn, căn phải.
- Rà các tab còn lại (Cân đối phát sinh, Cân đối kế toán, Lưu chuyển tiền, Sổ cái, Nhật ký, Chứng từ…) cho cùng chuẩn.

### F. Rà toàn bộ
- Thanh bên: bỏ mục thừa, nhóm hợp lý.
- Trang Báo cáo: dải "Đang xem" và câu mở đầu gộp thành một dòng.
- Kiểm cả bốn theme và hai cỡ (≥ 1280px và 390px). Không cuộn ngang trang trên điện thoại.

## Kiểm tra

- `npm test`, `npm run test:web`, `npm run build` xanh. Sửa test có chủ đích khi đổi route hoặc markup, không xoá test để cho qua.
- Thêm vitest:
  - Định dạng tiền (0 và số âm).
  - `/pos` chuyển hướng.
  - Form sản phẩm dạng trang lưu đúng payload như trước, có test cũ làm chuẩn.
- Nếu có công cụ trình duyệt: chạy server với DB seed trong thư mục tạm, chụp và tự xem các trang chính ở hai cỡ. Nếu không có thì ghi rõ là chưa xem.
- Cập nhật `CLAUDE.md` (mục 7 bố cục, bảng màn hình, 7A họa tiết, nhật ký quyết định 2026-11-04) và `PROGRESS.md`.
