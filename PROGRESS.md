# Nhật ký thực hiện

### 2026-11-11 — Bù Cẩm nang và Hướng dẫn cho bốn đợt sửa nghiệp vụ

- Cẩm nang (`web/src/guides/handbook/data.js`) thêm 6 trang, từ 28 lên 34: "Trả hàng cho nhà cung cấp và nhà cung cấp bớt tiền" (chương Bắt đầu), "Khách đặt cọc rồi không lấy: hoàn hay giữ", "Khách nhận hàng bị lỗi, hoàn một phần", "Nhập file Shopee: cảnh báo, trạng thái và trả hàng", "Đơn Shopee bị trả hàng: phí sàn được hoàn" (chương Bán hàng), "Nhập theo kg, bán theo hộp" (chương Kho, kèm mẹo chiết nước hoa ml sang chai 10 ml). Số liệu ví dụ cộng đúng (giá vốn kg 190.000, giá vốn hộp 3.900.000 / 40 = 97.500, phải thu sàn 1.728.000 − 960.000 + 96.000 = 864.000). Sửa tên nút ở các trang cũ cho khớp giao diện (Ghi nhận trả hàng, Xác nhận huỷ, Xem trước (chưa ghi gì), Ghi vào hệ thống). Bìa và Tình huống hay gặp thêm mục.
- Hướng dẫn (`content.js`) sửa: Tạo đơn (huỷ đơn đã thu tiền, đơn sàn không nhập ship khách trả, lô hết hạn, dịch vụ; sửa câu hỏi sai về sửa đơn đã xác nhận), Trả hàng, Nhập đơn từ sàn (định dạng tiền, cột thiếu, phí, trạng thái, trả hàng từ file), Sản phẩm (Dịch vụ, Đóng từ), Nhập hàng (trả hàng NCC, giảm giá, NCC còn nợ shop), Quản lý kho và Lô hàng (xuất huỷ lô, cảnh báo, hàng trả vào lại lô), Đóng gói (ví dụ chiết nước hoa), Đọc báo cáo (Hàng trả, Cọc giữ lại, phí sàn thuần, Hao hụt), Sổ kế toán (nguồn bút toán mới), Hỏi đáp (chiết nước hoa). Thêm `/stock?tab=lots` vào danh sách route hợp lệ của test.
- Test: `handbook.test.jsx` thêm kiểm tiêu đề bắt buộc, số liệu đóng gói, và phát hết kịch bản từng trang mới trong Shadow DOM tới trạng thái cuối. Chưa xem bằng trình duyệt thật (máy không có Playwright), chưa xem trên khổ điện thoại.

### 2026-11-11 — Phiếu đóng gói (kg → hộp), lý do giảm kho có mã + báo cáo hao hụt, dọn việc dở

- Migration 050: `stock_conversions`, `stock_conversion_lines`, `conversion_recipes`, `stock_adjustments.reason_code`.
- Phiếu đóng gói `DG-…` (`server/modules/inventory/conversions.js`): xuất nguồn (kg, bao bì; lô chọn hoặc FEFO) và nhập thành phẩm trong một transaction bằng `transfer_out/in` (`ref_type='conversion'`), không bút toán. Giá vốn thành phẩm = Σ giá trị xuất thật chia theo trọng số bằng `allocate()`; phần lẻ ghi hai mức giá cách nhau 1 đồng (Σ vào = Σ ra đúng từng đồng). Lô/hạn mặc định lấy từ lô nguồn. Huỷ phiếu chỉ khi thành phẩm còn đủ. Công thức "đóng từ" + định mức đóng gói gợi ý nguồn. API `/conversions*`, `/conversion-recipes*`, loại `conversion` ở `/documents`, sự kiện `conversion.created|voided`.
- Giao diện: Kho → Đóng gói (danh sách), trang lập phiếu `/stock/conversions/new`, chi tiết/huỷ `/stock/conversions/:id`, khối "Đóng từ" trong form sản phẩm, sổ kho gọi biến động đóng gói là "Đóng gói". Bài hướng dẫn "Đóng gói: nhập theo kg, bán theo hộp" và mục Hỏi đáp (ba cách).
- Lý do giảm kho có mã (`server/lib/stockReasons.js`), chọn ở Điều chỉnh nhanh; `GET /reports/shrinkage` và tab Báo cáo → Hao hụt (xuất Excel, ⓘ ở `metrics.js`). Không có cột theo nhà cung cấp (không suy được).
- Dọn: (a) nhãn sổ kế toán cho `purchase_return`/`purchase_allowance`; (b) form sửa đơn đã xác nhận hỏi lại `LOT_EXPIRED` rồi gửi `allow_expired`; (c) test import đơn sàn chạm lô hết hạn; (d) test trả hàng nhập hai dòng cùng biến thể; (e) đơn huỷ còn tiền: giữ `payment_status='paid'`, danh sách đơn hiện "Còn phải hoàn khách"/"Giữ cọc"; (f) form dịch vụ ở ma trận ẩn giá vốn, tồn đầu kỳ; (g) CLAUDE.md 5.3B, 5.8, 5.16, mục 6, rủi ro, nhật ký quyết định.
- Test: `tests/conversions.test.js` (10), `tests/shrinkage.test.js` (3), `tests/cleanup_v5.test.js` (5), `web/src/__tests__/conversions.test.jsx` (9).
- Chưa làm: phiếu đóng gói chưa tạo lô cho thành phẩm theo từng lô nguồn riêng (một dòng thành phẩm nhận một lô gộp); chưa thử bằng trình duyệt thật.

### 2026-11-11 — Đơn bán v4: giữ cọc khi huỷ, lô hết hạn, dịch vụ, ship đơn sàn

- Migration 049: `orders.forfeited_amount`, `orders.expired_lot_warning`, `products.is_service`, `daily_stats.forfeit`, tài khoản 5119.
- Huỷ đơn còn tiền đã thu bắt chọn `paid_action` refund/forfeit (409 `CANCEL_PAYMENT_CHOICE_REQUIRED`); cọc giữ lại thành dòng “Cọc giữ lại” ở báo cáo, lãi gộp và sổ kế toán (5119); phần nợ khách hiện ở Công nợ phải trả.
- Lô quá hạn: `LOT_EXPIRED` khi xác nhận (vượt bằng `allow_expired`), cảnh báo ở allocation-preview, nút “Xuất huỷ lô” (`POST /stock-lots/:id/write-off`).
- Dịch vụ không tồn kho (`is_service`), `SERVICE_NO_STOCK` ở `applyMovement`, form sản phẩm/đơn/danh sách/nhập hàng loạt.
- Đơn sàn: `MARKETPLACE_SHIPPING_FEE`; trả toàn bộ đơn sàn cũ tự hoàn ship.
- Test: `tests/orders_v4.test.js` (11), `web/src/__tests__/cancel-form.test.js`. Đổi kỳ vọng test cũ: các test huỷ đơn đã thu thêm `paid_action: 'refund'`; `returns.test.js` (đơn sàn không còn shipping_fee), `returns_docs.test.js` (lô hết hạn cần `allow_expired`), `order-form-lib.test.js` (kênh sàn bỏ ship khách trả).

### 2026-11-11 — Trả hàng nhập và NCC giảm giá sau nhận

- Migration 048: `purchases.returned_amount/allowance_amount`, bảng `purchase_returns(+_lines)`, `purchase_allowances(+_lines)`, trigger đánh dấu sổ kế toán.
- `server/modules/purchases/returns.js`, `state.js`: trả hàng nhập (TN-), huỷ phiếu trả, giảm giá sau nhận (GG-), huỷ, NCC hoàn tiền sau. Nợ NCC = total − returned − allowance − paid ở danh sách NCC, Công nợ phải trả (thêm loại `supplier_refund`, phải thu), báo cáo tuổi nợ và dòng tiền.
- `applyMovement` nhận `preferRef`; sổ kế toán thêm `purchase_return` và `purchase_allowance`; `GET /documents` thêm hai loại.
- Giao diện: chi tiết phiếu nhập có “Trả hàng NCC”, “NCC giảm giá”, lịch sử, ghi NCC hoàn tiền; Chứng từ, Công nợ phải trả.
- Test: `tests/purchase_returns.test.js` (14), `web/src/__tests__/purchase-returns.test.jsx` (3). Tài liệu: CLAUDE.md 5.4, mục 6, nhật ký quyết định; Hướng dẫn nhập hàng + Hỏi đáp; catalog API; metrics.

### 2026-11-11 — Phí sàn được hoàn, giảm giá sau bán, hàng trả về đúng lô

- Migration 047: `order_returns.platform_fee_refund_amount`, `order_returns.kind` (`return`|`allowance`), `orders.platform_fee_refunded_amount`, bảng `order_line_lots`; đánh dấu dựng lại `daily_stats`.
- A. Đơn sàn trả hàng: phiếu có `platform_fee_refund_amount` (mặc định tỷ lệ luỹ kế, sửa được, tối đa phí còn lại). `returned_amount` đơn sàn trừ cả phần hoàn nên phải thu/tiền treo/tuổi nợ/1388 tự đúng; lãi gộp cộng phần hoàn; báo cáo dùng phí sàn thuần; sổ cái Có 6411. `POST /orders/:id/returns/preview`. Form trả hàng đơn sàn có ô “Phí sàn được hoàn”.
- B. `POST /orders/:id/allowances` (phiếu `GG-…`, kind `allowance`, không có hàng): giảm doanh thu và phải thu, không đụng kho/giá vốn/trạng thái; trả tiền ngay hoặc thành khoản còn nợ khách; đơn sàn chỉ giảm phải thu sàn. Hộp thoại ở chi tiết đơn → Khác.
- C. Bán ghi lô đã lấy; huỷ đơn, trả hàng, nhận hàng chờ về, sửa đơn cộng lại đúng lô (lô lấy sau cùng trả trước).
- Test: `tests/returns_v3.test.js` (12), `web/src/__tests__/returns-v3.test.jsx` (9); sửa kỳ vọng 3 test cũ (đơn sàn không còn lỗ phí khi trả hết) và thêm assert vào `import_shopee.test.js`.
- Tài liệu: CLAUDE.md 5.3, 5.6, 5.9, 5.16 + nhật ký quyết định; `metrics.js`; Hỏi đáp và bài Trả hàng ở `guides/content.js`; catalog API.

### 2026-11-11 — Số lượng lẻ không còn tạo tiền lẻ

- `server/lib/money.js`: `lineAmount(qty, giá)` (làm tròn một lần, tính qua số nguyên nghìn), `shareOf(tổng, phần, cả)` (luỹ kế), `qty3()` (chuẩn hoá tồn 3 chữ số). `web/src/lib/money.js` có bản tương đương cho xem trước.
- Dùng ở: thành tiền dòng đơn và phiếu nhập; giá vốn từng phần xuất kho (bình quân, FIFO nhiều lớp, nhiều kho); hoàn giá vốn khi huỷ/trả một phần (luỹ kế theo từng phân bổ); giá trị hàng trả luỹ kế; tách đơn; khuyến mãi; giá trị tồn, lô, chốt kho, bút toán kho, báo cáo ngày tồn. `verify.js` đối chiếu giá vốn dòng theo cùng công thức và so tồn sau khi làm tròn 3 chữ số.
- Tồn cộng trừ số lẻ chuẩn hoá về 3 chữ số (hết 10.042000000001); phân bổ kho tay nhận số lẻ.
- Đơn tổng 0 đồng đã xác nhận trở đi có `payment_status = 'paid'`.
- Form phiếu nhập nhập được số lượng lẻ; xem trước tiền ở form đơn, phiếu nhập, đổi hàng, trả hàng làm tròn giống máy chủ.
- Test: `tests/money_rounding.test.js` (9) quét mọi cột tiền của 12 bảng, `verifyStock` và `verifyJournal` sạch.

### 2026-11-11 — Nhập đơn Shopee đúng với file thật

- Migration 046: cập nhật mẫu `imp_shopee` (có điều kiện, giữ cột người dùng thêm): thêm Phí xử lý giao dịch, Giảm giá từ Combo của Shop, cột trả hàng, trạng thái theo tiền tố; bỏ gán phí ship người mua trả.
- Hàm thuần mới `web/src/lib/importRows.js`: `toMoney`/`toQty` (hết lỗi "18000.00" thành 1.800.000), chuẩn hoá NFC tên cột, `missingColumns` có nhóm tên thay nhau, giảm giá đơn không âm. `Import.jsx` dùng lại và hiện cảnh báo từng đơn.
- Server: `normalizeStatus` bỏ đoán chuỗi con, thêm tiền tố `*`; trả hàng từ file thành phiếu chờ hàng về (không trùng khi import lại); import lại đơn đã có so cả dòng hàng và giảm giá, sửa được thì sửa, không thì `warning`.
- Test: `tests/import_shopee.test.js` (6), `tests/import_shopee_real.test.js` (chạy trên file thật, tự bỏ qua nếu thiếu), `web/src/__tests__/import-rows.test.js` mở rộng.
- Chưa làm: chưa import thật vào app (SKU trong file không phải sản phẩm của shop này); chưa thử bằng trình duyệt.

### 2026-11-08 — Cẩm nang từng bước trong trang Hướng dẫn

- Đưa cẩm nang (trước đó là trang web riêng) vào Hướng dẫn, đứng đầu danh sách (`/guide/cam-nang`): 28 trang, màn hình mô phỏng chạy trong Shadow DOM, phát lại liên tục, có Tạm dừng. Thêm hai tình huống: nhập hàng trả nhà cung cấp nhiều đợt, khách trả tiền nhiều lần. Chỉnh văn phong theo quy tắc chung ("hệ thống", "nhấn", "Vui lòng", xưng "bạn").
- Sửa lỗi khi dựng: nội dung bìa còn sót dưới các trang khác vì React dùng lại cùng một thẻ; đã đặt khoá theo trang và có test.
- Kiểm chứng: `handbook.test.jsx` (6 test, gồm chạy kịch bản tới trạng thái cuối trong Shadow DOM), toàn bộ 255 test giao diện, 226 test API, build. Đã mở thử trong trình duyệt thật: bìa, chuyển trang, vòng phát lại sau khoảng 22 giây. Chưa xem trên khổ điện thoại.

### 2026-11-08 — Nhập hàng loạt, nhắc nợ, nhật ký, thông báo, nhãn giao hàng, quà tặng kèm, chỉnh văn phong

- Văn phong: "app" → "hệ thống", "bấm" → "nhấn", "Xem thử" → "Xem trước", "Hãy" → "Vui lòng", bỏ xưng hô thân mật, "Ví dụ:" thống nhất; viết lại các thông báo lỗi nói thẳng đường dẫn API.
- Migrations 042 (hạn nợ, mẫu tin `debt`), 043 (thông báo), 044 (khuyến mãi `gift`, `order_lines.is_gift`; dựng lại bảng khuyến mãi và lượt dùng).
- Server: nhập sản phẩm hàng loạt, `/loyalty/debts`, `/system/audit`, `/notifications/*` + job 30 phút, `/orders/:id/label` và `/orders/labels` (Code 128 tự dựng), quà tặng trong khuyến mãi và đơn.
- Giao diện: Nhập từ Excel (Sản phẩm), thẻ Nhắc nợ (Loyalty → Hôm nay), hạn thanh toán ở form đơn/chi tiết đơn/phiếu nhập, Cài đặt → Nhật ký và → Thông báo, chuông thông báo ở thanh trên, nút In nhãn giao hàng, loại khuyến mãi "Tặng quà kèm".
- Kiểm chứng: `tests/returns_docs.test.js` (nay 24 test), 249 test giao diện, build qua. CHƯA thử Telegram thật (chỉ thử bằng hàm gửi giả), CHƯA thử bằng trình duyệt thật các màn mới của đợt này, CHƯA in nhãn thật ra giấy 100×150 để kiểm cỡ và độ quét mã vạch.
- Chưa làm: email và Zalo OA trực tiếp, bảng giá sỉ (chủ shop không cần).

### 2026-11-08 — Chín việc về sự cố bán hàng (COD, giá kênh, khuyến mãi, sửa đơn, giao từng phần, lô, đối soát sàn, đổi trả, vận đơn)

- Migrations 036–041: `orders.parent_order_id/reserve_stock/reserved_until`, `products.warranty_days`; `carriers`, `shipments`, `carrier_statements(+lines)`; `payout_adjustments`; `channel_prices`; `promotions`, `promotion_uses`; `stock_lots`, `purchase_lines.lot_no/expiry_date`.
- Server: sửa đơn đã xác nhận (hoàn kho rồi trừ lại), tách đơn, giữ hàng, thời hạn trả hàng, tra cứu bảo hành, vận chuyển + phiếu đối soát COD, đối soát sàn lệch, giá theo kênh, khuyến mãi (module Loyalty), lô FEFO.
- Giao diện: sửa đơn đã xác nhận, giao cho hãng, tách đơn, giữ hàng, tab Chi phí & đối soát → Vận chuyển (nhập file đối soát đoán cột), Đối soát sàn có số thực trả và cảnh báo quá hạn, Loyalty → Khuyến mãi, mã giảm giá và giá kênh ở form đơn, giá theo kênh và bảo hành ở form sản phẩm, lô/hạn ở phiếu nhập, Kho → Lô & hạn dùng, Chứng từ → Tra cứu bảo hành, cài đặt thời hạn trả/quá hạn sàn/cảnh báo hết hạn.
- Kiểm chứng: `tests/returns_docs.test.js` (nay 17 test, mỗi tính năng có test API), 243 test giao diện, build qua. CHƯA thử bằng trình duyệt thật và CHƯA thử với file đối soát thật của GHN/GHTK (cột đoán theo từ khoá, có bảng chọn cột để chỉnh).
- Còn thiếu: nối API hãng vận chuyển, phí hoàn tự cấn, lô cho hàng trả về, khuyến mãi khi sửa đơn nháp.

### 2026-11-08 — Trả hàng, ship shop trả, chứng từ

- Migration 035: `order_returns.reason_code`, bảng `return_write_offs`. Đơn đang giao không huỷ được (`CANCEL_SHIPPING`); nút “Giao không thành” = phiếu trả toàn bộ, hàng chờ về (mở `awaiting_goods` cho mọi kênh), nhận hàng nhập kho hoặc báo hỏng. Lý do trả hàng chọn từ danh sách, thống kê ở Báo cáo → Doanh thu. Hàng không nhập lại tự lập phiếu hàng huỷ HH-… (chỉ chứng từ, giá vốn vẫn ở giá vốn đơn).
- Ô “Ship shop tự trả” ở form đơn mọi kênh; `POST /orders/:id/seller-shipping-payments` ghi việc trả hãng vận chuyển (Nợ 3388 / Có quỹ), chặn trả quá và chặn huỷ đơn đã trả ship.
- `GET /documents` và trang Chứng từ gộp 7 loại phiếu.
- Kiểm chứng: `tests/returns_docs.test.js` (8 test), toàn bộ test API và 236 test giao diện qua, build qua. Chưa thử bằng trình duyệt thật; nút “Hàng về bị hỏng” nhận mọi dòng của phiếu cùng lúc (API cho chọn từng dòng).

### 2026-11-08 — Phương pháp tính giá vốn (bình quân / FIFO)

- Thêm cài đặt `costing_method` (migration 034, bảng `stock_layers`), `GET/PUT /costing-method`, thẻ "Phương pháp tính giá vốn" ở Cài đặt → Ngưỡng & kho, bài hướng dẫn "Chọn cách tính giá vốn". Mặc định vẫn bình quân gia quyền di động theo kho. Không làm LIFO.
- `applyMovement` ghi một biến động cho mỗi lớp giá khi xuất FIFO; đơn hàng ghi một phân bổ cho mỗi phần; chuyển kho giữ giá và tuổi lớp; huỷ phiếu nhập rút lớp của phiếu đó; hàng vào bù âm kho không tạo lớp. `check-stock` thêm kiểm Σ lớp = max(tồn, 0).
- Kiểm chứng: `tests/costing.test.js` (7 test) và toàn bộ test API qua (trừ lỗi cũ "Tuổi nợ" ở finance.test.js), 232 test giao diện và build qua. Chưa thử trên trình duyệt thật, chưa chạy với dữ liệu mẫu nhiều đơn; tài khoản 156 và giá trị tồn ở báo cáo dùng tồn × giá bình quân làm tròn nên có thể lệch vài đồng khi dùng FIFO.

### 2026-11-08 — Thang khoảng cách, thang chữ, phân cấp sắc độ

- Viết lại token: khoảng cách bội 4 (`--sp-*`), chữ 6 bậc (12/13/14/16/20/24), độ đậm 400/500/600, chiều cao điều khiển bội 4. Quy đổi hàng loạt giá trị lệch trong `styles.css` và style inline của JSX (22 tệp).
- Bề mặt: viền thẻ `--rule` 75%→38%, kẻ dòng `--hair` 12%→7%, tiêu đề bảng nền `--thead` thay cho kẻ đậm; nút chọn shop theo token ô nhập. Sticky header bảng bám đúng chiều cao thanh trên (61px).
- Đo lại bằng script trên 10 trang desktop: khoảng cách bội 4px 40%→95%, cỡ chữ 13→8 giá trị, chữ đậm 600 299→128 đoạn.

### 2026-11-07 — Rà soát giao diện, tương phản, shadcn/ui

- Rà soát giao diện thật ở 1440, 1280, 768 và 390px (mô phỏng bằng iframe vì cửa sổ trình duyệt không nhỏ hơn 570px), bấm qua từng tab con. Sửa các lỗi trang cuộn ngang trên điện thoại (bảng có header dính, đầu thẻ nhiều nút, thanh so sánh, thẻ chỉ số số lớn), vùng chạm tab/chip/nút nhỏ, bộ lọc Sản phẩm gộp một nhóm "Loại", thẻ chỉ số Sổ kế toán gọn nhãn phạm vi, dải tab Cài đặt không còn rớt chữ, chuỗi dài tự ngắt dòng, phản hồi nhấn nút, hiệu ứng vào trang 0,2s.
- Đo tương phản WCAG bằng script (màu chữ và nền hiệu lực qua canvas) trên 12 trang × 4 theme ngành, 3.332 mẫu chữ: 3 nhóm lỗi (ⓘ trên thẻ nền tối, số đếm trên tab, chữ cái trên ô ảnh nhỏ) đã sửa; chạy lại 1.192 mẫu ở các trang liên quan: 0 lỗi. Chưa đo: placeholder, trạng thái hover/disabled, vùng có ảnh nền hoạ tiết (tính theo màu nền gần nhất).
- shadcn/ui (Radix + Tailwind v4) cho `Modal` và `MetricInfo`, cách ly khỏi CSS thuần (xem nhật ký quyết định 2026-11-07 ở CLAUDE.md). Hộp thoại nay giữ focus, trả focus về nút mở, khoá cuộn nền; ⓘ bám nút và tự lật khi sát mép. Xoá CSS `.modal*` và `.metric-pop` cũ. Test `metrics.test.jsx` đổi sang sự kiện pointer của Radix.
- Kiểm chứng: 221 test giao diện và production build qua. Chưa chạy lại `test:e2e` (cần Playwright). Cảnh báo `npm audit` về `xlsx` có từ trước, không liên quan.

### 2026-11-06 — Mở rộng kho hàng và vật tư

- Thêm loại mặt hàng `product` / `packaging` / `supply`, nhà cung cấp mặc định và ngăn vật tư được niêm yết hoặc thêm vào đơn bán.
- Mở rộng số lượng kho tối đa 3 chữ số thập phân theo đơn vị cơ sở để ghi nhận mét, kg, tờ lẻ; chưa tự quy đổi thùng/cuộn nếu chưa khai báo hệ số.
- Thêm định mức đóng gói theo sản phẩm và API xem lượng dự kiến. Chỉ trừ vật liệu sau khi xác nhận; mỗi đơn chỉ ghi nhận một lần và dùng số thực tế.
- Thêm phiếu xuất vật tư vận hành. Tiêu hao đóng gói ghi Nợ 6414 / Có 156; xuất nội bộ ghi vào tài khoản chi phí chọn trước / Có 156. Dùng chung sổ biến động kho và journal hiện hữu.
- Thêm báo cáo tồn, nhập/xuất theo kỳ, giá trị tồn, tiêu hao và đối chiếu TK 156 trong trang Kho.
- Báo cáo tồn lâu chưa bật do chưa có tracking theo lô; không suy đoán ngày nhập. Hiện mỗi mặt hàng quản lý theo một đơn vị cơ sở.
- Giao diện thêm danh mục vật tư, định mức đóng gói trong hồ sơ sản phẩm, nút xác nhận đóng gói trong đơn, xuất vật tư nội bộ, báo cáo tồn/tiêu hao và tải CSV.
- Kiểm chứng: 173 test server, 221 test giao diện và production build đều qua; `git diff --check` sạch. Build còn cảnh báo chunk frontend lớn.

### 2026-11-06 — Phạm vi shop trong Sổ kế toán

- Cân đối phát sinh nhận bộ lọc shop và chỉ cộng các bút toán thuộc shop được chọn; Excel cũng ghi rõ shop.
- Tổng quan kế toán lọc doanh thu, lợi nhuận, phải thu khách/sàn theo shop; tiền/quỹ, hàng tồn và phải trả NCC vẫn hiển thị toàn tài khoản. Chi phí chung tiếp tục phân bổ vào lợi nhuận shop theo quy tắc hiện có.
- Cân đối kế toán vẫn toàn tài khoản. Giao diện nêu phạm vi để người dùng phân biệt số theo shop với số dư toàn sổ.
- Có test API kiểm tra doanh thu theo shop, tổng Nợ/Có của Cân đối phát sinh và các số dư chung không đổi theo shop.

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
| M14 | Kế toán kép (8a + 8b) | ✅ | ✅ | ✅ | Sổ cái dẫn xuất bằng trigger; chứng từ tay, chi phí định kỳ (job), tài sản/khấu hao, khoá sổ |
| M13 | Giao diện web | | ✅ | ✅ | Đủ màn hình, điện thoại + máy tính. Test: API 76, vitest 91, smoke e2e 10 |

✅ xong · 🟡 một phần · ⬜ chưa làm

---

## Nhật ký

### 2026-11-06 — Đối chiếu việc còn mở và hoàn thiện form dài

- Đối chiếu các mục “chưa làm” lịch sử với mã hiện tại: các mục gộp khách, chuyển kho, chỉnh mẫu import, combo, kiểm kê nhiều bước và test `rowsToOrders` đã được triển khai ở các đợt sau; không làm lại.
- Form tạo/sửa chi phí định kỳ (8 trường) và form tài sản/chi phí trả trước (7 trường) chuyển từ popup sang trang nhập liệu đầy đủ dùng `FormPage`, có nút quay lại và thanh lưu dính đáy. Thêm test giao diện cho cả hai luồng.
- SĐT chính đã được chuẩn hoá và duy nhất toàn tài khoản từ trước; `/customers/lookup` cũng tìm cả SĐT phụ. Bộ chọn khách trong đơn nay tải cả khách ở shop khác ngay khi mở (không phải gõ trước), chọn khách sẽ tự thêm membership khi lưu đơn. Tạo khách khi đang xem “Tất cả shop” nay phải thuộc một shop (shop duy nhất được chọn sẵn), không tạo khách mới vô chủ.
- Thanh thao tác đơn gọn thành một hàng tổng tiền + ba nút, nhãn xác nhận rút ngắn; các cặp trường Thuế tự xếp một cột trên màn hình nhỏ để tránh nhãn dài làm lệch ô.
- Kiểm tra: API 168/168; giao diện 221/221; build thành công. E2E chưa chạy thật vì môi trường chưa cài Playwright (12 ca bị skip). Build có cảnh báo chunk JS lớn; npm báo 1 lỗ hổng mức high trong dependency tree.
- Còn cần làm/kiểm chứng: chụp và xem giao diện ở 390px cùng bốn theme; chạy E2E khi có Playwright/Chromium; thử trên iPhone thật. Loyalty tiếp tục hoãn. Các nghiệp vụ trả hàng còn lại được mở lại để triển khai theo yêu cầu 2026-11-06; hạch toán phí ship sàn vẫn cần file Shopee thật để chốt.

### 2026-11-06 — Quyết định khách hàng và xử lý mục lợi nhuận

- Quyết định chính thức: giữ hồ sơ khách dùng chung toàn tài khoản; không tách hồ sơ theo shop. Membership, nhãn và thông tin riêng theo shop tiếp tục như hiện tại. Không làm nút sao chép hồ sơ giữa shop. Loyalty tiếp tục hoãn.
- Báo cáo lợi nhuận tổng nay cộng điều chỉnh kho và thừa/thiếu kiểm đếm quỹ từ sổ cái; không cộng trùng tiền phạt đã nằm trong chi phí. Theo shop/kênh không cộng khoản không gắn phạm vi. Cơ sở thuế ròng dùng cùng số lợi nhuận này. Cập nhật giải thích chỉ số, trang lợi nhuận và file xuất.
- Form chi phí (6 trường) chuyển từ popup sang trang nhập liệu; popup giữ cho nghiệp vụ ngắn.
- Đối chiếu hoàn tất: Báo cáo = KQKD kế toán cho toàn bộ và từng shop; tổng theo shop lệch đúng phần điều chỉnh không gán shop. API 168/168, giao diện 221/221, build thành công.

### 2026-11-06 — Hoàn tất các luồng trả hàng còn mở

- Tiền khách gửi dùng chung hồ sơ khách nhưng số dư theo shop phát sinh; hoàn trả hàng có thể ghi thành tiền gửi, đơn sau tại shop đó dùng làm phương thức thanh toán. Sổ cái hạch toán qua công nợ 3388, không đi qua quỹ tiền.
- Thêm đổi hàng một bước cho đơn bán trực tiếp: ghi phiếu trả, nhập lại kho theo lựa chọn, cấn tiền khách gửi vào đơn mới và thu phần chênh trong cùng giao dịch. Đơn mới mở ngay sau khi hoàn tất.
- Đơn sàn có thể ghi nhận trả hàng trước, giữ hàng ở trạng thái “Chờ hàng về”; chỉ khi xác nhận nhận hàng mới cộng tồn và hoàn giá vốn. Phiếu cũ được xem là đã nhận để tránh nhập kho lần hai.
- Còn để lại: xác nhận cách hạch toán phí ship chiều về của sàn bằng file đối soát Shopee thật; đây là mục cần dữ liệu thực tế.
- Kiểm tra: API 171/171, giao diện 221/221, build thành công. E2E/iPhone và đối chiếu file sàn để lại theo yêu cầu; môi trường hiện chưa có Playwright.

### 2026-11-04 — Đợt nâng cấp, đợt rà soát cuối (polish)
- **Dòng đơn** (OrderForm): mỗi dòng là thẻ gọn (hàng 1: ảnh, tên đầy đủ, SKU · tồn, nút bỏ; hàng 2: số lượng, đơn giá, giảm, thành tiền); thứ tự Tab theo số lượng, giá, giảm, bỏ. POS vốn đã dạng thẻ nên giữ.
- **Ô nhập tiền**: `components/MoneyInput.jsx` + `lib/money.js` (dấu chấm ngăn nghìn, số nguyên, căn phải, `inputMode=numeric`); thay vào đơn, POS, sản phẩm/combo, chứng từ, chi phí định kỳ, tài sản, nhập hàng, chi phí, quỹ tiền… Có vitest.
- **Bỏ biến thể** phải xác nhận: `POST /products/:id/removal-preview` cho biết cái nào xoá hẳn, cái nào lưu trữ; hộp xác nhận trước khi PATCH.
- **Trường bắt buộc** chỉ chặn khi xoá/để trống chính nó; hiện lại trường ẩn kiểm lại vai trò và khoá trùng. Cập nhật test.
- **Lưu trữ kho**: 409 `WAREHOUSE_IN_USE` (kèm danh sách shop), `force` gỡ khỏi shop và ghi audit; kho duy nhất của shop: `WAREHOUSE_LAST`.
- **Sổ kế toán**: 3 nhóm tab, `?tab=` vẫn dùng được; quỹ âm đỏ kèm gợi ý và liên kết Quỹ tiền.
- **Ảnh mồ côi**: `server/jobs/uploads.js` chạy trong job sao lưu hằng ngày, dọn ảnh chưa gắn quá 7 ngày.
- **Ma trận biến thể**: cột Biến thể cố định khi cuộn ngang, dưới 720px mỗi tổ hợp là một thẻ, ô ảnh là nút ảnh thu nhỏ mở danh sách chọn; bảng thành phần combo tự xuống dòng.
- **Mật độ giao diện**: token trên `:root`, gọn từ 900px; điện thoại giữ ô ≥44px, chữ ô nhập 16px.
- Không đổi số liệu báo cáo.

**Đã xử lý 2026-11-06:** Báo cáo tổng cộng điều chỉnh kho và kiểm đếm quỹ, còn lọc shop/kênh thì loại các khoản không gán phạm vi. Thuế dùng cùng cơ sở lợi nhuận. Khấu hao và chứng từ thu/chi khác lập tay vẫn chỉ có ở KQKD kế toán, đã giải thích trong từ điển.

### 2026-11-04 — Làm lại phần tiền của phiếu trả hàng

- Migration 027: cột mới trên `order_returns` (hoàn ship, phí trả hàng, ship chiều về) và `orders` (`returned_goods_amount`, `returned_shipping_amount`, `return_fee_amount`, `return_shipping_cost`, `refund_owed_amount`); `daily_stats` thêm `return_fee`, `return_shipping_cost`; tài khoản 5118. Dữ liệu cũ: phần hàng chép từ `returned_amount`, `refund_owed_amount` tính lại.
- `createReturn`: làm tròn luỹ kế, các khoản mới, chặn tiền trả khách > cần trả khách, ship hoàn > ship còn lại, phí trả hàng > hàng + ship hoàn, kênh sàn. Hoàn tiền sau (thanh toán chiều chi) bị chặn ở số còn nợ khách.
- Sổ cái: `returnEntry` ghi 5212/5113/131/5118/6412/3388; KQKD có dòng 5118. Báo cáo: lãi gộp có phí trả hàng và ship chiều về; ship = sau hoàn; `cashflow` có `customer_refund_owed`.
- Giao diện: `ReturnModal` (khối tiền, cần trả khách, tiền trả ngay, giải thích kết quả, nút "Khách không nhận hàng (COD)"), nút "Hoàn tiền" ở đơn, hồ sơ khách và Tiền & công nợ hiện số còn nợ; từ điển chỉ số và trang Cách đọc số liệu cập nhật.
- Test: `tests/returns.test.js` (10 kịch bản), `web/src/__tests__/return-form.test.js`. Các test cũ không phải sửa. Thêm `npm run check-returns`.

### 2026-11-04 — Đợt nâng cấp, Phase 8b: nghiệp vụ kế toán bổ sung (M14 xong)
- Migration 025 (`vouchers`, `recurring_expenses`, cột `expenses.recurring_id/period_key`), 026 (`assets`, `journal_meta`, `period_lock_snapshots`, trigger tài sản).
- Server: `accounting/{vouchers,assets,lock}.js`, `expenses/recurring.js`, `jobs/recurring.js`, `lib/{schedule,clock,period}.js`; `cash/balanceOf` cộng chứng từ tay và tài sản; KQKD tách khấu hao; khoá sổ `PERIOD_LOCKED` ở chi phí, thanh toán, quỹ, chứng từ, tài sản.
- Giao diện: tab Chứng từ, Chi phí định kỳ, Tài sản & phân bổ, Khoá sổ; ánh xạ danh mục chi phí → tài khoản; từ điển chỉ số mới (`acc_depreciation`, `acc_other`, `acc_lock`).
- Test: API 145 (thêm 4 kịch bản 8b trong `accounting_integrity` + `schedule.test.js`), giao diện 176 (thêm `voucher-lib`). `check-journal`, `check-stock`, `check-stats` sạch trên DB seed.
- Hạn chế: thanh lý tài sản ghi giá trị còn lại vào 811 (tiền bán ghi bằng phiếu thu tay); tài sản mua chưa trả ghi 331 không gắn nhà cung cấp; chi phí định kỳ rơi vào kỳ khoá bị bỏ qua.

### 2026-11-04 — Đợt nâng cấp, Phase 8a: lõi sổ cái kế toán

- Migration 024: `accounts` (seed 26 tài khoản), `journal_entries`, `journal_lines`, `journal_dirty`, `expense_categories.account_code`, `cash_accounts.account_code` (tài khoản con 111x/112x tự tạo bằng trigger), danh mục "Tiền phạt" (811) và "Vận hành" (6428). Trigger đánh dấu chứng từ bẩn; chứng từ đã có được đánh dấu để lần đọc đầu dựng toàn sổ.
- `server/modules/accounting/`: `posting.js` (hàm thuần), `journal.js` (`flushJournal`, `verifyJournal`, `rebuildJournal`), `reports.js` (tài khoản, nhật ký, sổ cái, cân đối phát sinh, KQKD, cân đối kế toán, lưu chuyển tiền, tổng quan), `routes.js` (`/accounting`). `npm run check-journal [-- --fix]`.
- Giao diện: nhóm menu "Kế toán" (Chi phí & quỹ, Sổ kế toán), `Accounting.jsx` 8 tab, xuất Excel, ⓘ (`metrics.js`, `reportTables.js`).
- Test: `accounting_posting.test.js` (hàm thuần), `accounting_integrity.test.js` (kịch bản đủ loại thao tác: mọi bút toán cân, cân đối phát sinh, tài sản = nợ + vốn + lợi nhuận, KQKD = báo cáo cho tất cả shop và từng shop, 111x/112x = số dư quỹ, 156 ≈ tồn × giá vốn trong cận làm tròn, 131 + 1388 và 331 khớp báo cáo công nợ, sửa/huỷ cập nhật sổ, verify bắt được sổ bị sửa lén).
- Chênh lệch có chủ đích với báo cáo: xem `CLAUDE.md` mục 5.16.

### 2026-11-04 — Đợt nâng cấp, Phase 7: báo cáo dễ hiểu

- `web/src/metrics.js`: từ điển 62 chỉ số (nghĩa, cách tính, lấy từ đâu, phạm vi, nên làm gì, link dữ liệu gốc). `GLOSSARY` của trang Cách đọc số liệu dựng từ đây; `guide.js` chỉ re-export.
- `MetricInfo` (nút ⓘ, khung giải thích đóng bằng Esc/bấm ngoài, điện thoại là bảng trượt từ đáy) và nhãn phạm vi. `Kpi` nhận `metric`. Áp dụng cho mọi KPI, dòng, tiêu đề cột ở Báo cáo và Tổng quan.
- Báo cáo: dải "Đang xem: shop · khoảng ngày · kênh · so với kỳ trước" luôn hiện, mỗi tab có một câu nói tab trả lời câu hỏi gì, tab Tiền & công nợ có ghi chú nợ NCC/quỹ là toàn tài khoản khi lọc shop.
- Server: `meta.scope` ở overview, cashflow, aging, health, inventory (chỉ thêm, số không đổi).
- Trang Đơn hàng đọc `from`, `to`, `channel` trên URL để link "Xem dữ liệu gốc" mở đúng khoảng ngày.
- Excel: thêm sheet "Giải thích" cho tab đang xuất.
- Test: API 119, vitest 171.

### 2026-11-04 — Đợt nâng cấp, Phase 6: hoàn thiện trường tuỳ chỉnh

- Server: `custom/variables.js` là danh mục biến duy nhất (nhãn tiếng Việt, kiểu, nhóm; không có id, thời điểm nội bộ, JSON, cột khách cũ). `GET /custom/variables`, `GET /custom/metric-variables`, `GET /custom/functions`, `POST /custom/formula/preview` (bản ghi mẫu gần nhất hoặc `entity_id`; `metric` tính trên tháng này). `parseFormula` và `createMetric` chỉ nhận biến trong danh mục, lỗi kèm `details.position`. Công thức đã lưu từ trước dùng cột ngoài danh mục vẫn đọc được (chỉ kiểm khi tạo/sửa).
- Biến dẫn xuất của khách theo shop: `shop_order_count`, `shop_total_spent`, `shop_last_order_at` (tính trong `getValues`, cùng cách tính với `by_shop` của hồ sơ khách). `REPORT_VARIABLES` ở `reports/service.js`.
- `formula.js`: thêm CONCAT, YEAR, MONTH, COALESCE; `FormulaError.position`; `FUNCTION_DOCS` cho giao diện.
- Trường: `role` nhận khi tạo (kiểm đối tượng, kiểu, mỗi shop một trường mỗi vai trò), PATCH sửa được `options`, `required`, `role`; `required` (migration 023) có hiệu lực khi `PUT /custom/values` (chỉ khi lưu qua API này, đơn nhập từ file không đi qua). `GET /custom/fields?archived=1` liệt kê trường đã ẩn.
- Giao diện: `FormulaEditor` (gợi ý biến khi gõ `{`, gợi ý hàm, bảng Biến/Hàm, mẫu, xem trước 400ms, tô vị trí lỗi), `FieldsManager` dùng chung cho Cài đặt → Trường tuỳ chỉnh (gồm Khách hàng) và Khách hàng → "Thông tin khách của shop" (sửa, thứ tự, ẩn/hiện lại, lựa chọn dạng thẻ). Chỉ số báo cáo dùng FormulaEditor.
- Test: API 118, web 163. Không có e2e mới.
- Chưa làm: thử trên iPhone thật; trường bắt buộc chưa chặn lúc tạo khách/đơn bằng API (chỉ khi lưu giá trị trường).

### 2026-11-04 — Đợt nâng cấp, Phase 5: form tạo đơn mới + chọn khách có sẵn

- `web/src/components/CustomerPicker.jsx` (dùng chung, có chế độ `compact` cho POS): tìm theo tên/SĐT/mã (khách của shop trước, "khách ở shop khác" sau), mỗi dòng có hạng, số đơn, đơn gần nhất; phím mũi tên/Enter/Esc; thẻ khách đã chọn (Đổi), hạng + % giảm gợi ý có nút áp dụng; "+ Khách mới" tạo qua `POST /customers` rồi chọn, SĐT trùng khách có sẵn thì chặn tạo và gợi ý chọn khách đó. Luôn trả khách có id.
- `web/src/pages/OrderForm.jsx` ở `/orders/new` và `/orders/:id/edit` (đơn nháp; đơn khác chuyển về chi tiết): bố cục 7:5, một cột trên điện thoại, thanh Lưu nháp / Xác nhận đơn / Bán xong dính đáy (trên thanh tab). Chia kho tay theo từng dòng từ `allocation-preview`, chặn lưu khi tổng chia lệch số lượng. Phí sàn và ship shop chịu chỉ hiện với kênh sàn.
- `web/src/lib/orderForm.js`: hàm thuần (tính tiền theo công thức server, kiểm phân bổ, payload, tiền thu theo hành động).
- `Orders.jsx`: "Đơn mới" trỏ `/orders/new`; chi tiết đơn nháp có nút Sửa. `Pos.jsx`: bộ chọn khách gọn, ảnh sản phẩm trong giỏ, gửi `customer_id`.
- Sửa lỗi: khoá `Idempotency-Key` bị lưu cả với phản hồi lỗi 4xx nên bấm lại sau khi sửa dữ liệu vẫn nhận lỗi cũ. POS và form mới đổi khoá sau mỗi lần thất bại.
- Test: web 149 (thêm customer-picker, order-form, order-form-lib), API 111, e2e thêm 1 ca (tự bỏ qua khi thiếu Playwright). Không đổi server, không migration.
- Chưa làm: kiểm tay trên iPhone thật, kiểm bằng mắt 4 theme (chỉ dùng biến CSS nên theo theme tự động).

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

**Kế hoạch ban đầu:** các module M13, M7, M8, M12, M9, M11 và M10 bên dưới đã được triển khai ở các phiên tiếp theo; không còn là danh sách việc mở.

**Còn chờ dữ liệu/thiết bị bên ngoài**
- Tên cột trong file xuất đơn của Shopee hiện tại (mẫu `imp_shopee` đang dựa trên tên cột phổ biến, có thể đã đổi).
- Phí ship shop chịu trên Shopee có bị sàn trừ vào payout không, hay trả riêng.
- Chu kỳ dùng hết thực tế của từng loại nước hoa.

**Nợ kỹ thuật đã biết, mức ưu tiên thấp**
- `listStock` tính tốc độ bán 30 ngày bằng query trực tiếp; khi dữ liệu lớn nên đọc từ `daily_stats`.
- Báo cáo query thẳng bảng `orders` (có index theo shop/ngày), chưa dùng `daily_stats`. Khi dữ liệu lớn mới cần.
- Hoàn trả tính vào ngày của đơn gốc, không phải ngày trả hàng.
- Lọc khách theo mệnh lấy hết khách khớp điều kiện rồi mới phân trang (đúng nhưng không tối ưu). Với hàng chục nghìn khách thì cần chuyển mệnh thành cột tính sẵn.
- Ngày biến động kho của đơn import là ngày đặt; huỷ/trả hàng của đơn import vẫn ghi theo lúc thao tác (không biết ngày huỷ thật trên sàn).

**Còn chờ người thật hoặc thông tin nghiệp vụ**
- Thử trên iPhone thật qua wifi (cần thiết bị).
- Kiểm tra với file xuất Shopee thật: tên cột, phí ship shop chịu có bị trừ vào payout không (cần file thật).
- Điền "chu kỳ dùng hết" cho từng sản phẩm thì mới có nhắc mua lại.
- Chưa có ngành thứ năm: cần tên ngành và các trường khách muốn hỏi (thêm ở `server/lib/industries.js`).
- `daily_stats` và tính hoàn trả theo ngày trả hàng: đã quyết định chưa làm (xem nhật ký quyết định trong `CLAUDE.md`).

**Đợt làm gọn giao diện (2026-11-04, nhánh `feat/giao-dien-gon`, kế hoạch `docs/plans/2026-11-giao-dien-gon.md`)**
- Khung chung: `PageHeader`, `Toolbar`, `Note`, `Section`, `Fold`, `SaveBar`, tab segmented có số đếm; ô nhập một nền + viền trung tính; bỏ họa tiết lặp (lôi văn, vân giấy dó) khỏi các trang ngoài Tổng quan/đăng nhập; `vnd(0)` luôn là `0 ₫`.
- Bỏ menu/route Bán nhanh (`/pos` chuyển hướng `/orders/new`), form đơn chỉnh cho nhanh.
- Sản phẩm, combo, phiếu nhập là trang đầy đủ (cảnh báo rời trang chưa lưu); chi tiết phiếu nhập là trang `/purchases/:id`.
- Danh sách Đơn (tab có số đếm, `GET /orders/status-counts`, có test) và Sản phẩm (`stock_total`, `low_stock_count` thêm vào `GET /products`) dễ quan sát; Kho, Khách dùng bảng dính header.
- Sổ kế toán một hàng công cụ, KQKD/Cân đối thẳng lề; Báo cáo, Kho, Khách, Loyalty, Chi phí, Cài đặt, Guide dùng khung chung.
- Test: server 161 (thêm 2), web 207 (thêm: định dạng tiền, form dạng trang, phiếu nhập, điều hướng `/pos`).
- Chưa làm / còn thô: phiếu thu/chi tay ngắn vẫn là popup; bút toán tổng hợp vẫn là popup có bảng dòng động. Form Chi phí, Tài sản và Chi phí định kỳ đã chuyển thành trang. Chưa chụp thử cỡ 390px; chưa chạy e2e thật vì thiếu Playwright; chưa kiểm kỹ cả bốn theme bằng mắt (trước đó mới xem theme ô tô).

**Đợt trường tuỳ chỉnh v2 (2026-11-04, cùng nhánh, kế hoạch `docs/plans/2026-11-truong-tuy-chinh-v2.md`)**
- A. Xoá trường: `DELETE /custom/fields/:id` (409 `FIELD_REFERENCED` / `CONFIRM_REQUIRED`, snapshot `audit_log`, sự kiện `custom_field.deleted`), `GET /custom/fields/:id/usage`; `FieldsManager` có nút Xoá + hộp xác nhận nói số bản ghi, nút tắt khi còn công thức dùng.
- B. Ngày/năm sinh là cột chung của khách: form khách, form thêm nhanh, hồ sơ (kèm tuổi), nhắc sinh nhật, xuất file, gộp khách. Migration 028 gom giá trị các shop (ưu tiên phong thuỷ, rồi shop lập trước), ẩn trường cũ, viết lại công thức, ghi ca lệch vào `audit_log`; script `npm run check-birthdates`. Preset ngành bỏ trường ngày sinh.
- C. Mệnh hiệu lực (`derivedValue`): hồ sơ, cột danh sách (`shop_derived`), bộ lọc, xuất file, biến `{menh}`; ô ghi đè có gợi ý tự tính.
- D. Công thức: ngày − ngày, ngày ± số, `AGE/DAY/DATE/MONTHS_BETWEEN`, kiểm kiểu lúc lưu, lý do khi trống (preview, hồ sơ khách, panel trường), mẫu “Tuổi”.
- E. `default_value` (cột mới ở 028) cho trường không phải công thức; `applyIndustry` không tạo lại trường mẫu đã xoá.
- Hồ sơ khách và chi tiết đơn chuyển sang `PageHeader`/`Section` (thông tin chung → thẻ Mệnh/Hạng/Tổng → nhãn + thông tin riêng). Cảnh báo chưa lưu (`useDirty`) chốt mốc ở lần chạm đầu của người dùng, bỏ đồng hồ 150ms.
- Test: server 168 (thêm `migration_028`, `custom_v2`, sửa test cũ), web 217 (thêm `use-dirty`, `customer-profile`, xoá trường, lý do công thức, mặc định).
- Còn thô: form thêm nhanh dạng gọn (`compact`) của `CustomerPicker` không có ô ngày sinh (để POS nhanh); trường công thức lồng nhau chỉ báo lý do ở mức “chưa có <tên trường>”; migration chỉ viết lại công thức “tuổi” có dạng đúng `TODAY() - {biến}` (khoảng trắng tuỳ ý), dạng khác để nguyên và `check-birthdates` liệt kê công thức còn dùng trường cũ.

**Việc chờ làm (từ kế hoạch trả hàng 2026-11-04, ngoài phạm vi lần này)**
**Đã hoàn tất các nghiệp vụ trả hàng còn mở ngày 2026-11-06:** tiền khách gửi, đổi hàng một bước, và trạng thái chờ nhận hàng sàn. Phí ship chiều về đơn sàn vẫn ghi Có 3388 cho tới khi đối chiếu được file thanh toán thật; phí trả hàng trong tổng chi tiêu/hạng khách giữ nguyên vì Loyalty đang hoãn.

**Việc chờ làm: làm lại module Loyalty cho hoàn chỉnh** (chủ shop dặn ngày 2026-11-04)
- Chủ shop sẽ tự lên yêu cầu sau vì module có nhiều cài đặt. Khi bắt đầu, **làm trọn một lần**: hạng, chi tiêu, cài đặt, tự động hoá, báo cáo. Không vá từng mảnh nhỏ, để sau không phải quay lại sửa lắt nhắt.
- Hiện đã có bản cơ bản (M9, mục 5.10 `CLAUDE.md`): hạng theo tổng chi tiêu 12 tháng, ngưỡng Thành viên/Bạc/Vàng/Kim cương, % giảm gợi ý; tab Tự động hoá chưa chạy gì. Bản làm lại thay thế hoặc mở rộng bản này, không chạy song song hai cách tính.
- Câu hỏi phải chốt khi làm:
  - "Chi tiêu" của khách tính bằng gì: hàng thuần (hiện tại), có cộng phí trả hàng không, có cộng phí ship không.
  - Đơn trả hàng có làm giảm chi tiêu và hạ hạng khách không; hạ ngay hay chỉ xét lại theo kỳ.
  - Hạng tính theo toàn tài khoản (hiện tại) hay theo từng shop.
  - Cửa sổ thời gian (12 tháng lăn, năm dương lịch, hay giữ hạng đến hết kỳ).
  - Tích điểm (CLAUDE.md đang ghi không làm vì là khoản nợ với khách) và tiền khách gửi (mục trả hàng ở trên) có gộp vào module này không.

## 2026-11-08 · Ship nhập trả bên vận chuyển
- Migration 031, `shipping_payee` trên phiếu nhập, `POST /purchases/:id/carrier-payments`, bút toán Có 3388, giao diện chọn người nhận ship và ghi trả ship ở chi tiết phiếu.
- `tests/purchase_carrier.test.js` (4 test). Lưu ý: `tests/finance.test.js` 'Tuổi nợ' đang fail từ trước (lệch ngày UTC/giờ VN), không do thay đổi này.

## 2026-11-08 · Chốt kho, tài liệu API, trang Hướng dẫn, nền dịu
- Chốt kỳ kho + đóng kho (CLAUDE.md 5.3A): migration 032, `server/modules/inventory/close.js`, tab Kho → Chốt kho, `tests/stock_close.test.js`. Đóng kho chặn khi còn hàng/kiểm kê/phiếu nhập nháp.
- Tài liệu API viết lại (`server/modules/system/apidocs/`): 222 route đều có mô tả, ví dụ, mã lỗi, hướng dẫn webhook và kiểm chữ ký; `tests/apidocs.test.js`.
- `/guide` thành trang Hướng dẫn với 14 bài (`web/src/guides/content.js`), "Cách đọc sức khoẻ kinh doanh" là một bài; menu đổi tên "Hướng dẫn"; e2e và test cập nhật.
- Nền theme chung và phong thuỷ nhạt hơn.
- Sửa gạch chân và nút Trước/Tiếp ở Hướng dẫn; màu giao diện riêng của shop (migration 033); gỡ kho có cảnh báo/chuyển hàng (`tests/warehouse_remove.test.js`).
- Gỡ sản phẩm (xoá hẳn / ngừng kinh doanh / khôi phục, xuất huỷ tồn): `server/modules/catalog/removal.js`, `tests/product_remove.test.js`, giao diện `RemoveProduct`, tab "Đã ngừng kinh doanh".


## Đợt chỉnh: công nợ phải trả, lịch sao lưu, cẩm nang gọn, Hỏi đáp
- Chi phí định kỳ chuyển từ Sổ kế toán sang Chi phí & quỹ. Loyalty chỉ còn nhắc nợ khách; thêm tab Công nợ phải trả (`GET /payables`).
- Cài đặt → Sao lưu: lịch (giờ, ngày/tuần, số bản giữ, ảnh sản phẩm), trạng thái lần tới/gần nhất; bộ lập lịch kiểm mỗi 5 phút.
- Bỏ các ghi chú về chạy trên máy cá nhân khỏi Hướng dẫn và cẩm nang.
- Cẩm nang đổi tên "Cẩm nang từng bước", bỏ phần lặp (tiêu đề, điều hướng kép, chú thích), mở toàn khổ.
- Trang Hỏi đáp tình huống (40 câu). Đơn huỷ đã nhận cọc có nút Hoàn tiền.
- Chưa có: nút huỷ/xoá một khoản thanh toán đã ghi nhầm (API chưa mở `voidPayment`); sửa phiếu nhập nháp trên giao diện (chỉ nhận hàng hoặc huỷ).
- Huỷ khoản thanh toán ghi nhầm (`POST /payments/:id/void`, đơn và phiếu nhập, có nút trên giao diện), sửa phiếu nhập nháp ở `/purchases/:id/edit`. Hỏi đáp thêm 2 câu, sửa câu nhập sai số lượng. Test API 5 mới, test giao diện 3 mới.
- Huỷ cả phiếu đối soát hãng vận chuyển (migration 045: bản ghi tác động `carrier_statement_effects`, cột `voided_*`, `effects_tracked`). `previewVoidStatement` / `voidStatement` ở `shipping/service.js`; `removeAwaitingReturn`, `revertOrderCompletion` ở `orders/service.js`. Giao diện: nút "Huỷ phiếu" + hộp thoại xem trước ở tab Vận chuyển. Hỏi đáp thêm 1 câu, nhật ký thêm 3 hành động. Test: 3 test API (huỷ sạch + đối soát lại + sổ cân, bị chặn khi đơn có phiếu trả, kỳ khoá + phiếu cũ), 2 test giao diện.
