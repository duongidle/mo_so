# Plan: làm lại phần tiền của phiếu trả hàng

## Bối cảnh

Rà soát ngày 2026-11-04 tìm thấy bốn vấn đề ở `createReturn` (`server/modules/orders/service.js`):

1. **Giá trị trả bị làm tròn riêng từng lần.** Mỗi lần trả, giá trị được làm tròn độc lập, nên trả nhiều lần lệch dòng đơn. Ví dụ dòng 100đ có 3 cái, trả 3 lần mỗi lần 1 cái, tổng ra 99đ. Lỗi này phạm quy ước 14 của CLAUDE.md.
2. **Trả hàng không hoàn tiền thì sổ và báo cáo nói khác nhau.**
   - Doanh thu bị trừ đủ giá trị hàng trả.
   - Sổ kế toán: 131 còn số dư Có, tức là shop nợ khách.
   - Báo cáo: chặn công nợ ở 0, đơn vẫn báo "Đã thu đủ". Khoản shop nợ khách không hiện ở đâu.
   - Hệ thống không có cách ghi "shop giữ lại tiền", trong khi chủ shop coi khoản giữ lại là doanh thu.
3. **Hoàn phí ship không trừ vào doanh thu phí ship (5113).** Hậu quả là 131 lệch. Riêng đơn COD bị khách từ chối nhận: phí ship vẫn nằm trong doanh thu, và hệ thống báo khách còn nợ phí ship.
4. **Tiền hoàn chỉ bị chặn theo số đã thu,** không theo giá trị của phiếu trả.

## Cách làm của phần mềm bán hàng phổ biến

KiotViet, Sổ Bán Hàng: phiếu trả gồm tổng tiền hàng trả, **phí trả hàng**, giảm giá hoặc thu khác, **cần trả khách**, và **tiền trả khách** (số thực trả, kèm phương thức). Báo cáo doanh thu, lãi lỗ, kho và sổ thu chi tự cập nhật.

Theo kế toán (TT200 và MISA): Nợ 5212 giảm trừ doanh thu / Có 111, 112 hoặc 131; Nợ 156 / Có 632 theo giá vốn.

Mình làm theo mô hình này.

## Thiết kế

### Các khoản trên phiếu trả

Kênh thường, không phải sàn:

| Khoản | Ý nghĩa | Ghi nhận |
|---|---|---|
| `goods_amount` (đã có) | Giá trị hàng trả. Mặc định theo tỷ lệ SL trên tiền thực của dòng (đã trừ giảm giá dòng và phần giảm giá đơn được chia). | Giảm doanh thu hàng: Nợ 5212 |
| `shipping_refund_amount` (mới) | Hoàn phí ship cho khách. Tuỳ chọn. Tối đa bằng `shipping_fee` trừ phần ship đã hoàn ở các phiếu trước. | Giảm doanh thu phí ship: Nợ 5113 |
| `return_fee_amount` (mới) | Phí trả hàng shop giữ lại. Tuỳ chọn. Tối đa bằng goods + ship hoàn. Shop giữ toàn bộ tiền thì đặt phí = giá trị trả. | Doanh thu khác: Có 5118 (tài khoản mới, con của 511). Không dùng 711, để báo cáo và sổ khớp nhau. |
| `return_shipping_cost` (mới) | Phí ship chiều về do shop chịu. Tuỳ chọn. | Chi phí bán hàng: Nợ 6412 / Có 3388 (giống `seller_shipping`) |
| **Cần trả khách** (tính ra) | goods + ship hoàn − phí trả hàng | |
| `refund_amount` (đã có) | Tiền trả khách ngay lúc lập phiếu, kèm phương thức. Không vượt "cần trả khách" và không vượt số tiền khách đã trả còn lại. | Thanh toán chiều chi |
| **Còn nợ khách** (tính ra) | max(0, đã thu − phải thu sau trả) trên cả đơn | Hiện ở đơn, hồ sơ khách và Báo cáo → Tiền & công nợ. Hoàn sau bằng thanh toán chiều chi trên đơn (đã hỗ trợ). |

Ba khoản ship hoàn, phí trả hàng và ship chiều về lưu trên `order_returns`. Migration 027 chỉ thêm cột. Phiếu cũ có các cột mới bằng 0.

**Kênh sàn** (`is_marketplace`): sàn tự hoàn tiền cho người mua rồi trừ vào tiền trả shop.
- Ẩn phần "trả khách". Cần trả khách = 0.
- Hàng trả giảm phải thu sàn (1388) như hiện nay.
- Ship hoàn và phí trả hàng không áp dụng. Giữ giả định phí sàn không được hoàn.
- Ship chiều về vẫn nhập được, vì sàn có thể tính phí này cho shop.

### Công thức đơn

- `returned_amount` của đơn = Σ goods − Σ phí trả hàng + Σ ship hoàn.
  - Phí trả hàng bù lại doanh thu. Ship hoàn làm giảm tiền phải thu.
  - Tách rõ khi hiển thị: `returned_goods_amount`, `returned_shipping_amount`, `return_fee_amount`, `return_shipping_cost`. Đặt tên cột cho dễ đọc, có thể giữ tên cũ cho phần hàng.
- Doanh thu thuần hàng = `goods_revenue` − Σ goods + Σ phí trả hàng. Phí trả hàng hiện thành dòng riêng "Phí trả hàng thu được" trong báo cáo, cộng vào doanh thu thuần.
- Doanh thu phí ship = `shipping_fee` − Σ ship hoàn.
- Phải thu, kênh thường = max(0, total − Σ goods − Σ ship hoàn + Σ phí trả hàng).
- Lãi gộp đơn = (net_amount − Σ ship hoàn) − Σ goods + Σ phí trả hàng − cogs − Σ ship chiều về.
- `refund_owed_amount` = max(0, đã thu − phải thu), lưu trên đơn. Có giá trị thì đơn hiện "Còn phải trả khách X đ" và nút "Hoàn tiền".
- Báo cáo → Tiền & công nợ có thêm chỉ số "Nợ phải trả khách (trả hàng)".

### Sửa lỗi làm tròn

Giá trị hàng trả của một lần = giá trị luỹ kế sau lần này − giá trị luỹ kế trước lần này, với:

> luỹ kế(n) = round((line_total − allocated_order_discount) × n / qty)

Như vậy trả hết dòng thì tổng các lần bằng đúng tiền thực của dòng. Áp dụng tương tự cho ship hoàn nếu có chia theo tỷ lệ.

Thêm script hoặc migration kiểm các phiếu trả cũ:
- Không sửa số đã chụp.
- Chỉ báo những dòng đã trả hết mà tổng lệch, để biết.

### Bút toán (`server/modules/accounting/posting.js`, `returnEntry`)

Theo ngày đơn gốc, như hiện nay:
- Nợ 5212 goods / Có 131 (hoặc 1388).
- Nợ 5113 ship hoàn / Có 131.
- Nợ 131 phí trả hàng / Có 5118.
- Nợ 6412 ship chiều về / Có 3388.
- Nợ 156 / Có 632 theo giá vốn đã nhập lại (giữ nguyên).

Seed tài khoản 5118 "Doanh thu khác (phí trả hàng)" trong migration 027. Thêm 5118 vào KQKD như một dòng doanh thu.

### Giao diện (form trả hàng trong `web/src/pages/Orders.jsx`)

Tách ra component riêng nếu dài. Thứ tự:
1. Các dòng: SL trả, ô tick "Nhập lại kho (bỏ chọn nếu hàng hỏng)" (đã có, mặc định tick), giá trị trả từng dòng (chỉ đọc).
2. Khối tiền: tổng tiền hàng trả; "Hoàn cả phí ship" (tick, rồi nhập số, mặc định toàn bộ phí ship còn lại); phí trả hàng; phí ship chiều về shop chịu.
3. **Cần trả khách**, in đậm.
4. Tiền trả khách ngay + phương thức. Mặc định = cần trả khách nếu đơn đã thu tiền, = 0 nếu đơn chưa thu (COD).
5. Một dòng giải thích kết quả, ví dụ "Shop còn nợ khách 135.000 ₫, hoàn sau ở mục Thanh toán", hoặc "Doanh thu giảm X, giá vốn giảm Y".

Thêm nút nhanh "Khách không nhận hàng (COD)": tick trả toàn bộ, nhập lại kho, hoàn toàn bộ ship, tiền trả khách 0.

Dùng `MoneyInput` cho mọi ô tiền. Kênh sàn ẩn các khối không áp dụng và có dòng chú thích.

### Từ điển chỉ số và hướng dẫn

- `web/src/metrics.js`: thêm "Phí trả hàng thu được", "Hoàn phí ship", "Phí ship chiều về", "Nợ phải trả khách (trả hàng)". Sửa nghĩa của doanh thu thuần, lãi gộp và hàng trả cho khớp công thức mới.
- Trang Cách đọc số liệu (`/guide`) cập nhật theo.

## Test

Thêm `tests/returns.test.js`. Mỗi kịch bản kiểm số trên đơn, `reports/overview`, `reports/cashflow` và sổ kế toán (131, 5111/5212/5113/5118, 632/156, quỹ):
1. Hoàn đủ tiền, nhập lại kho. Đơn không giảm giá và đơn có giảm giá (2 dòng, giảm giá đơn chia theo dòng).
2. Không hoàn tiền, đơn đã thu:
   - Phí trả hàng = 0: hiện "còn nợ khách", 131 âm bằng đúng số đó, báo cáo hiện cùng số.
   - Phí trả hàng = toàn bộ giá trị: doanh thu thuần và lãi không đổi so với trước khi trả (chỉ khác ở phần giá vốn được nhập lại).
3. Hoàn một phần, phần còn lại hoàn sau bằng thanh toán chiều chi: còn nợ khách về 0.
4. Đơn COD chưa thu, khách không nhận: không còn phải thu, không còn doanh thu phí ship. Ship chiều về là chi phí.
5. Hàng hỏng, không nhập lại kho: giá vốn giữ nguyên.
6. Trả 3 lần mỗi lần 1 cái trên dòng 100đ có 3 cái: tổng = 100đ.
7. Chặn: tiền trả khách > cần trả khách; ship hoàn > ship còn lại; phí trả hàng > goods + ship hoàn.
8. Kênh sàn: hàng trả giảm 1388, không có phần trả khách.

Các test hiện có phải vẫn xanh: `finance_integrity`, `accounting_integrity`, `multi_warehouse`, `daily_stats`. Riêng `daily_stats` kiểm nếu trigger hoặc ô thống kê dựa vào `returned_amount`. Cập nhật có chủ đích nếu công thức đổi.

## Ngoài phạm vi lần này (ghi vào PROGRESS.md mục "Việc chờ làm")

- Dùng tiền khách gửi (store credit) để trừ vào đơn sau.
- Đổi hàng trong một bước.
- Trạng thái "chờ hàng về" cho phiếu trả của sàn.
