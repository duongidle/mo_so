# Báo cáo đối chiếu nghiệp vụ — Mở Sổ

Ngày: 2026-11-11. Bản đồ nghiệp vụ dùng để đối chiếu: `audit/ban-do-nghiep-vu.md` (mã A1, B4… bên dưới trỏ về đó).

## Cách kiểm và giới hạn

- Không sửa code. Mọi tái hiện chạy qua API trên **DB tạm trong bộ nhớ** dựng bằng helper của bộ test (`tests/helpers.js`), không phải bản sao DB thật của cậu, và không đụng `data/`.
- Chỉ thử qua API và đọc code giao diện, **chưa bấm thử trên trình duyệt**.
- Hai bài chính thức của Shopee (FAQ trả hàng, báo cáo doanh thu) chỉ tải được khung trang; quy định Shopee bên dưới lấy từ đoạn trích kết quả tìm kiếm của chính các bài đó. Chưa có file Shopee thật của cậu để đối chiếu.
- "Đã xác nhận" = tớ chạy ra đúng kết quả đó. "Nghi ngờ" = đọc code hoặc suy luận, chưa chạy hoặc phụ thuộc dữ liệu thật.

---

## Nhóm 1 — Sai tiền / sai kho

### 1. Đơn Shopee: phí ship người mua trả bị tính thành tiền shop sẽ nhận
- **Tình huống**: đơn 200.000 hàng, người mua trả 30.000 ship, phí sàn 24.000. Shopee trả shop 176.000 (tiền ship đi qua sàn tới hãng vận chuyển).
- **App** (đã xác nhận hành vi): `net_amount` = 206.000, "tiền sàn đang treo" = 206.000. Mẫu `imp_shopee` gán cột "Phí vận chuyển mà người mua trả" vào `shipping_fee` và không gán gì vào ship shop chịu. Hệ quả: tiền treo dư 30.000 mỗi đơn, doanh thu ship (5113) ảo; khi đối soát có tick "lệch" thì 30.000 đó bị dồn thành phí sàn ảo.
- **Nghi ngờ còn lại**: tớ chưa thấy file thật của cậu; PROGRESS cũng ghi mục này "cần file Shopee thật để chốt".
- **Chuẩn**: báo cáo doanh thu Shopee tách phí ship người mua trả, Shopee trợ giá, phí thực tế; thu nhập = doanh thu hàng − chi phí ([Shopee](https://banhang.shopee.vn/edu/article/2072), [Nhanh.vn](https://nhanh.vn/cach-tinh-doanh-thu-tren-shopee-chuan-2026-cho-nguoi-moi-n156995.html)). Sapo đối soát bằng file doanh thu của sàn ([Sapo](https://www.sapo.vn/cap-nhat-tinh-nang/nhap-file-doi-soat-kenh-san-tmdt)).
- **Đề xuất**: với kênh sàn, ship người mua trả không cộng vào số shop nhận (bỏ gán cột trong mẫu, hoặc tự cấn bằng ship shop chịu). Đối soát bằng file Doanh thu theo mã đơn thay vì file đơn hàng.

### 2. Đơn Shopee trả hàng: app luôn giữ phí sàn, Shopee thì không thu
- **Tình huống**: đơn ở mục 1 bị trả hàng & hoàn tiền toàn bộ. Thực tế shop nhận 0 và không mất phí.
- **App** (đã xác nhận): sau phiếu trả, phí sàn 24.000 vẫn là chi phí, đơn còn "cần thu" 6.000 nhưng không hiện ở tiền treo (chỉ lấy đơn `completed`). Mỗi đơn trả lỗ ảo đúng bằng phí sàn. Thiết kế ghi rõ "giả định sàn không hoàn phí".
- **Chuẩn**: Shopee không tính phí cố định, phí dịch vụ, phí xử lý giao dịch cho sản phẩm Trả hàng & Hoàn tiền; vẫn tính với "Hoàn tiền ngay" trừ lý do chưa nhận hàng ([FAQ Shopee](https://banhang.shopee.vn/edu/article/10626), [Phí cố định](https://banhang.shopee.vn/edu/article/2139)) — chỉ đọc được đoạn trích.
- **Đề xuất**: phiếu trả kênh sàn có ô "phí sàn được hoàn", mặc định theo tỷ lệ hàng trả, sửa được.

### 3. Bán theo cân: tiền thành số lẻ, và giao diện chưa bán được số lẻ
- **Tình huống**: cam 45.500 đ/kg, bán 0,125 kg.
- **App** (đã xác nhận): API nhận số lượng 3 số lẻ cho mọi hàng. Kết quả: `total_amount` 5.687,5; `cogs_amount` 3.791,625; thu 5.688 thì "còn nợ khách 0,5"; phiếu nhập 10,5 kg × 30.333 có tổng 318.496,5. Cột tiền trong DB thành kiểu REAL, trái quy ước 4.1 "tiền là số nguyên". Ngược lại form tạo đơn chỉ có nút +/− (số nguyên), form nhập hàng `min=1`, thành phần combo chỉ nhận số nguyên; import đọc "0.5" thành 5 (`toInt` bỏ dấu chấm).
- **Chuẩn**: Sapo cho 3 số lẻ với kg/mét; MISA bán 100 g trừ 0,1 kg ([Sapo](https://help.sapo.vn/tao-don-dat-hang-nhap-tren-sapo-omniai), [MISA eShop](https://www.misaeshop.vn/44183/phan-mem-quan-ly-ban-hang-hoa-qua/)).
- **Đề xuất**: làm tròn về đồng tại đúng một chỗ (thành tiền dòng, giá vốn dòng, dòng phiếu nhập), rồi mới mở ô nhập số lẻ ở giao diện cho sản phẩm có đơn vị kg. Trước đó nên chặn số lẻ ở đơn bán để không sinh tiền lẻ.

### 4. Import đơn "Trả hàng/Hoàn tiền": cộng tồn ngay khi hàng chưa về
- **App** (đã xác nhận): import chuyển đơn sang trả hàng bằng phiếu trả `restock: true`, không dùng "chờ hàng về". Tồn tăng ngay.
- **Thực tế**: hàng hoàn Shopee về sau nhiều ngày, có thể hỏng hoặc mất. Sapo có luồng riêng cho hàng hoàn ([Sapo](https://www.sapo.vn/cap-nhat-tinh-nang/quan-ly-dong-goi-va-hang-hoan)).
- **Đề xuất**: import tạo phiếu trả ở trạng thái chờ hàng về (app đã có sẵn cơ chế này).

### 5. Ánh xạ trạng thái khi import đoán theo "chứa chuỗi"
- **App** (đã xác nhận): "Người mua xác nhận đã nhận được hàng" → `confirmed` (vì chứa "xác nhận"), đáng ra là hoàn thành. "Yêu cầu Trả hàng/Hoàn tiền" → `returned`, tức yêu cầu chưa duyệt đã ghi trả và nhập kho. "Đã nhận được hàng", "Giao không thành công" báo lỗi (cách xử lý này thì đúng).
- **Nghi ngờ**: tớ chưa biết file Shopee của cậu dùng đúng những chuỗi nào.
- **Đề xuất**: chỉ nhận khớp nguyên văn; chuỗi lạ thì báo lỗi dòng như hiện nay.

### 6. Import lại đơn đã có: đổi số lượng, giá, giảm giá bị bỏ qua im lặng
- **App** (đã xác nhận): đơn SP3 import lần hai với SL 3→1, giá 200k→180k, giảm 10k: kết quả chỉ ghi đổi trạng thái, đơn vẫn 600.000. Chỉ so `shipping_fee`, phí sàn, ship shop chịu, mã vận đơn, ghi chú, địa chỉ. Thiết kế 5.7 nói "so sánh và cập nhật tiền".
- **Đề xuất**: ít nhất báo cảnh báo "dòng hàng/giảm giá khác với đơn đã có" trong bảng xem trước.

### 7. Lô đã hết hạn vẫn bán, không cảnh báo
- **App** (đã xác nhận): lô hạn 2026-01-01, bán ngày 2026-11-11 qua bình thường, `stock_warning = 0`. FEFO còn lấy lô hết hạn trước tiên.
- **Chuẩn**: MISA cảnh báo cận hạn để đẩy bán; Odoo FEFO đi cùng ngày loại bỏ ([MISA](https://www.misaeshop.vn/44183/phan-mem-quan-ly-ban-hang-hoa-qua/), [Odoo](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies.html)).
- **Đề xuất**: cảnh báo khi xác nhận đơn chạm lô hết hạn; nút xuất huỷ cả lô.

### 8. Khách cọc rồi huỷ đơn nháp: tiền cọc không còn dấu vết công nợ
- **App** (đã xác nhận): thu cọc 100.000 trên đơn nháp, huỷ đơn → đơn ghi "đã thu đủ", `refund_owed_amount` = 0, và `payables.js` loại đơn đã huỷ nên không có trong Công nợ phải trả. Hoàn cọc làm được bằng tay, nhưng nếu quên thì không nơi nào nhắc; nếu shop giữ cọc thì tiền nằm trong quỹ mà không thành thu nhập ở báo cáo.
- **Chuẩn**: KiotViet có luồng Đặt hàng kèm cọc (chỉ có đoạn trích). Phần xử lý khi huỷ là suy luận của tớ.
- **Đề xuất**: khi huỷ đơn còn tiền đã thu, bắt chọn "hoàn cọc" hoặc "giữ cọc (ghi thu nhập khác)".

---

## Nhóm 2 — Thiếu luồng hay gặp

### 9. Trả hàng cho nhà cung cấp (B4) — chưa có
- **App** (đã xác nhận): chỉ huỷ được cả phiếu; đã bán bớt thì bị chặn `STOCK_NOT_ENOUGH` và được khuyên "tạo phiếu điều chỉnh", tức ghi lỗ và nợ NCC không giảm.
- **Chuẩn**: KiotViet có phiếu Trả hàng nhập (theo phiếu hoặc trả nhanh), trừ kho, giảm nợ hoặc NCC hoàn tiền ([KiotViet](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-giao-dich/tra-hang-nhap/)).
- **Đề xuất**: phiếu trả hàng nhập theo dòng, xuất kho ở giá nhập, giảm `total_amount` còn nợ.

### 10. NCC bớt tiền sau khi đã nhận, cân thiếu (A4, B5) — chưa có
- **App** (đã xác nhận): phiếu đã nhận không sửa được (`NOT_DRAFT`), không có điều chỉnh nợ NCC.
- **Chuẩn**: KiotViet có điều chỉnh nợ NCC (đoạn trích). Nông sản gặp việc này thường xuyên là suy luận của tớ.
- **Đề xuất**: "giảm giá sau nhận" trên phiếu: giảm nợ NCC và giảm giá vốn phần hàng còn tồn.

### 11. Đơn vị quy đổi (A2, A3) — chưa có
- **App**: mỗi sản phẩm một đơn vị, không có hệ số. Lách được bằng combo cho quy cách là bội số nguyên (thùng 5 kg = combo 5 × kg), nhưng túi 500 g thì không vì thành phần combo chỉ nhận số nguyên.
- **Chuẩn**: KiotViet đơn vị cơ bản + quy đổi có giá riêng, tồn và giá vốn chỉ ở đơn vị cơ bản; Sapo 1 bao = 50 kg; Odoo đơn vị mua khác đơn vị tồn ([KiotViet](https://www.kiotviet.vn/ban-hang-nong-san-thuc-pham/), [Sapo](https://help.sapo.vn/them-san-pham-quy-doi-tren-phan-mem-quan-ly-ban-hang-sapo), [Odoo](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html)).
- **Đề xuất**: phụ thuộc câu hỏi 1 và 2 bên dưới. Cách rẻ nhất: cho thành phần combo nhận số lẻ sau khi sửa mục 3.

### 12. Bồi thường một phần, khách giữ hàng (D7, E7) — chưa có
- **App** (đã xác nhận): hoàn 20.000 trên đơn đã thu đủ bị `OVER_REFUND`. Lách bằng phiếu trả 0,44 kg không nhập kho thì ra 20.020 và làm sai số lượng đã bán. Kênh sàn: chỉ ghi được qua đối soát lệch, tức thành phí sàn.
- **Chuẩn**: Shopee có hoàn tiền một phần (đoạn trích). Kênh thường là suy luận.
- **Đề xuất**: phiếu "giảm giá sau bán" không có dòng hàng, giảm doanh thu và tạo khoản nợ khách.

### 13. Tỷ lệ hao hụt (C2, C3) — có ghi, chưa có báo cáo
- **App** (đã xác nhận): xuất huỷ và điều chỉnh giảm chạy đúng với số lẻ (1,5 kg; 0,4 kg), lý do là chữ tự do. Không có báo cáo hao hụt theo sản phẩm, NCC hay lô; hao hụt không vào giá vốn mà vào 811.
- **Chuẩn**: Sapo khuyên theo dõi tỷ lệ hao hụt thực tế cùng số ngày tồn và tốc độ bán, và tính hao hụt vào giá vốn thực ([Sapo](https://www.sapo.vn/blog/kinh-doanh-nong-san)).
- **Đề xuất**: lý do có mã (hỏng, hết hạn, hao hụt cân, mất) + báo cáo % hao hụt trên lượng nhập theo sản phẩm và NCC.

### 14. Xuất hàng bán làm mẫu thử, biếu, tự dùng (C10, I5) — chưa có
- **App** (đã xác nhận): phiếu xuất vật tư từ chối hàng bán (`NOT_MATERIAL`). Còn hai cách đều lệch nghĩa: điều chỉnh giảm (ghi 811 như mất hàng) hoặc đơn 0 đồng (đã thử, chạy được, giá vốn vào đơn và kéo biên lãi).
- **Đề xuất**: cho phiếu xuất nội bộ nhận hàng bán, ghi vào chi phí bán hàng.

### 15. Phân loại, sang chiết (A5, A6) — chưa có
- **App**: không có chuyển số lượng và giá vốn từ mã này sang mã khác. Lách bằng điều chỉnh giảm + tăng sẽ ghi 811/711 và giá vốn mã mới phải gõ tay.
- **Đề xuất**: chờ câu hỏi 2.

---

## Nhóm 3 — Thiếu luồng hiếm hoặc tác động nhỏ

16. **Thuế sàn khấu trừ thay** (E4): không có trường riêng; khi đối soát lệch nó thành phí sàn. Số tiền về vẫn đúng, chỉ sai tên khoản. ([GHN](https://ghn.vn/blogs/tip-ban-hang/thue-shopee), đoạn trích Shopee.)
17. **Khoản ví Shopee không gắn đơn** (E12: quảng cáo, phạt, bồi thường hàng mất): tớ chưa thử; nghi ngờ phải ghi bằng chi phí hoặc phiếu thu tay.
18. **Hàng trả về không vào lại lô** (đã ghi trong PROGRESS là còn thiếu): hàng nông sản trả về mất hạn dùng.
19. **Đơn 0 đồng** hiện "chưa thanh toán" (đã xác nhận, chỉ là nhãn).
20. **Danh sách tồn cần sửa trên Shopee sau khi bán kênh khác** (C8): không có; Sapo cảnh báo đúng rủi ro bán vượt này ([Sapo](https://www.sapo.vn/blog/quan-ly-kho-hang-shopee)). Đồng bộ tự động thì ngoài phạm vi.

---

## App cố ý làm khác, hợp lý cho shop nhỏ

- Tiền sàn về ghi thẳng vào quỹ ngân hàng, không có "ví Shopee" trung gian (E13).
- Đối soát sàn và COD bằng file, không qua API.
- Combo không có tồn riêng; không làm LIFO; chưa tích điểm; không bảng giá sỉ.
- Hàng trả về hỏng nằm lại trong giá vốn đơn thay vì khoản lỗ riêng.
- Đơn sàn import được phép làm âm kho, có cờ cảnh báo.
- Vỏ sọt, ký gửi, PO nhận nhiều đợt: chưa có và tớ không tính là thiếu khi chưa biết cậu có dùng.

## Có và đúng (đã chạy hoặc có test sẵn của dự án)

Phiếu nhập nháp → nhận, chiết khấu và phí nhập chia vào giá vốn, ship trả hãng riêng, công nợ NCC trả nhiều đợt, lô + FEFO, xuất huỷ, kiểm kê nhiều bước, chuyển kho, cọc + giữ hàng trên đơn nháp, thu nhiều lần, trả hàng kênh thường (hoàn ship, phí trả hàng, ship chiều về), giao không thành chờ hàng về, đổi hàng một bước, COD đối soát theo phiếu, giá theo kênh, khuyến mãi và quà tặng, nhắc nợ, chi phí chung chia về shop.

---

## 5 việc nên làm trước

1. Lấy một file Đơn hàng và một file Doanh thu thật của Shopee, chốt mục 1, 2, 5 cùng lúc (ship người mua trả, phí khi trả hàng, chuỗi trạng thái).
2. Chặn tiền lẻ: làm tròn thành tiền và giá vốn dòng về đồng (mục 3). Đây là điều kiện để bán nông sản theo cân.
3. Import trả hàng sàn dùng "chờ hàng về" và bỏ đoán trạng thái theo chứa chuỗi (mục 4, 5).
4. Phiếu trả hàng nhập + giảm giá sau nhận cho NCC (mục 9, 10).
5. Cảnh báo lô hết hạn khi bán và báo cáo hao hụt có mã lý do (mục 7, 13).

## Câu hỏi cho cậu

1. Nông sản cậu bán theo cân lẻ (0,35 kg) hay luôn theo túi/hộp đóng sẵn?
2. Cậu nhập theo đơn vị nào và bán theo đơn vị nào? Có phân loại hoặc chia nhỏ sau khi nhập không?
3. Nông sản là hàng tươi (hỏng trong vài ngày) hay hàng khô? Cậu có đang ghi hạn dùng không?
4. Nông sản bán ở shop riêng trong app chưa? Thiết kế hiện chỉ nhắc hai shop nước hoa ô tô và phong thuỷ.
5. Cậu có bán sỉ nông sản cho mối quen, cho nợ gối đầu không?
6. Có hay trả hàng cho NCC, hoặc được NCC bớt tiền vì hàng xấu, cân thiếu không? Có ứng tiền trước cho NCC không?
7. File Shopee cậu tải là "Đơn hàng" hay "Doanh thu"? Cột trạng thái trong file ghi những chuỗi nào?
8. Khi khách Facebook nhận hàng dập, cậu thường hoàn bớt tiền, gửi bù, hay nhận trả hàng?
9. Khách cọc rồi bỏ: cậu trả lại cọc hay giữ?
10. Vật phẩm phong thuỷ có món độc bản (mỗi món một giá) hoặc dịch vụ kèm không tồn kho không?
11. Cậu có dùng mẫu thử, tester, hàng biếu thường xuyên không?

---

## Cập nhật sau khi chủ shop trả lời (2026-11-11)

Trả lời: bán theo hộp đóng sẵn 500 g; nhập theo kg rồi chia hộp; hàng khô có hạn dùng; nông sản chưa có shop trong app; chỉ bán lẻ, có cọc và trả nhiều lần; có trả hàng/bớt tiền với NCC; file Shopee là file Đơn hàng; khách trả nông sản thì kiểm hàng rồi hoàn nửa hoặc toàn bộ; cọc bỏ thì giữ, tính doanh thu; phong thuỷ có món độc bản và dịch vụ kèm; không dùng tester/hàng biếu.

Thay đổi mức ưu tiên:
- **Mục 15 (sang chiết kg → hộp) lên đầu.** Đây là việc hằng ngày của mảng nông sản và app chưa có. Mục 11 (đơn vị quy đổi) gộp vào đây.
- **Mục 3**: không cần ô bán số lẻ nữa. Vẫn phải làm tròn tiền vì phiếu nhập theo kg lẻ đã ra tiền lẻ (đã xác nhận).
- **Mục 12** được xác nhận là cần: hoàn nửa tiền mà khách giữ hàng. Hoàn nửa tiền khi hàng có về thì app làm được (phí trả hàng = phần shop giữ).
- **Mục 8** được xác nhận là sai so với cách làm của shop: cọc giữ lại phải thành doanh thu, hiện không.
- **Mục 9, 10** được xác nhận là cần.
- **Mục 13** hạ xuống (hàng khô, hao hụt ít). **Mục 14** bỏ.
- **Mới**: dịch vụ kèm không tồn kho. `products.item_type` chỉ có hàng bán / đóng gói / vật tư, không có loại dịch vụ (đọc schema, chưa chạy thử).

5 việc nên làm trước, bản mới:
1. Phiếu đóng gói: xuất N kg + bao bì, nhập M hộp, giá vốn hộp = tổng giá vốn xuất / M, giữ lô và hạn dùng.
2. Chốt đơn Shopee bằng file thật (mục 1, 2, 5).
3. Trả hàng nhập và bớt tiền sau nhận cho NCC (mục 9, 10).
4. Hoàn một phần không trả hàng, và "giữ cọc" thành thu nhập khi huỷ đơn (mục 12, 8).
5. Làm tròn tiền về đồng, cảnh báo lô hết hạn khi bán (mục 3, 7).

---

## Đối chiếu với file Shopee thật (2026-11-11)

File: `example/Order.all.order_creation_date.20261110_20261110.xlsx` (1.693 dòng, 1.285 đơn, 72 cột). Đọc bằng đúng thư viện và tuỳ chọn mà `Import.jsx` dùng, chạy lại đúng hàm `toInt` và `normalizeStatus` của app. Chưa import thật vào app vì SKU trong file không phải sản phẩm của shop.

Đã xác nhận:

| # | Phát hiện | Bằng chứng |
|---|---|---|
| S1 | **Mọi số tiền bị nhân 100.** File ghi `"18000.00"`, `toInt` bỏ dấu chấm thành 1.800.000 | Giá, voucher shop, 3 loại phí đều dạng `x.00` |
| S2 | **Hai cột không được nhận ra** vì Shopee viết tên cột bằng Unicode tách dấu (NFD), app so khớp nguyên văn: "Giá ưu đãi", "Phí vận chuyển mà người mua trả". Giao diện có cảnh báo thiếu cột nhưng vẫn cho import; đơn giá lấy theo giá niêm yết trong app | `cols.includes()` = false, sau khi chuẩn hoá NFC thì khớp |
| S3 | **"Phí thanh toán" đã đổi tên thành "Phí xử lý giao dịch"**: mẫu bỏ sót 6,1 triệu trên 33,6 triệu phí của file (18%) | Tổng 3 cột phí theo đơn không huỷ |
| S4 | **44 đơn đã nhận hàng bị hiểu là "đã xác nhận"**. Chuỗi thật: "Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày …" (có ngày thay đổi nên không khớp nguyên văn được) | `normalizeStatus` trả `confirmed` |
| S5 | **Trả hàng không nằm ở cột trạng thái đơn.** Nó ở cột riêng "Trạng thái Trả hàng/Hoàn tiền" ("Đã Chấp Thuận Yêu Cầu") và "Số lượng sản phẩm được hoàn trả"; trạng thái đơn vẫn là "Đã giao". App không đọc hai cột này nên không bao giờ thấy đơn trả | 2 dòng trong file |
| S6 | **Ship người mua trả**: 252 đơn, 2,24 triệu. Khi S2 được sửa, số này sẽ cộng vào tiền shop chờ nhận (mục 1 của báo cáo) | Cột 48 |
| S7 | "Giảm giá từ Combo của Shop" không có trong mẫu (93 nghìn trong file, có cả giá trị âm) | Cột 41 |
| S8 | Cột cấp đơn (phí, voucher, ship) lặp lại y hệt ở mọi dòng của đơn nhiều sản phẩm; app lấy dòng đầu nên không cộng trùng | 240/240 đơn nhiều dòng |

Chưa kết luận được từ file này:
- Shop thực nhận bao nhiêu mỗi đơn: file Đơn hàng không có cột đó. "Tổng giá trị đơn hàng" là số người mua trả cho hàng (đã trừ cả voucher Shopee), không phải tiền về shop. Cần file Doanh thu.
- Phí có được hoàn khi trả hàng: 2 dòng trả hàng, một dòng phí bằng 0, một dòng còn phí. Quá ít để chốt.
- Phí trong file là dự kiến hay thực tế: đơn "Đang giao" đã có phí.
