# Bản đồ nghiệp vụ chuẩn (dựng TRƯỚC khi đọc code)

Ngày lập: 2026-11-11. Mô hình: nông sản mua đi bán lại + nước hoa ô tô + vật phẩm phong thuỷ; kênh Shopee, Facebook, bán trực tiếp; nhiều shop, chung 1 kho. Kế toán/thuế, kết nối hãng vận chuyển: ngoài phạm vi.

Ký hiệu độ tin cậy:
- **[N]** có nguồn đọc được (link kèm theo)
- **[N~]** chỉ có đoạn trích từ kết quả tìm kiếm, chưa đọc toàn văn (2 bài Shopee Seller Education Hub chỉ tải được khung trang)
- **[SL]** suy luận của tớ từ hiểu biết chung về ngành, chưa có nguồn

Nguồn dùng nhiều:
- KV-NS: https://www.kiotviet.vn/ban-hang-nong-san-thuc-pham/
- KV-NHAP: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-giao-dich/nhap-hang/
- KV-TRANHAP: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-giao-dich/tra-hang-nhap/
- KV-HUY: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-hang-hoa/xuat-huy/
- KV-DVT: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/huong-dan-bar-cafe-nha-hang/danh-muc-hang-hoa-web-fnb/
- SAPO-NS: https://www.sapo.vn/blog/kinh-doanh-nong-san
- SAPO-QD: https://help.sapo.vn/them-san-pham-quy-doi-tren-phan-mem-quan-ly-ban-hang-sapo
- SAPO-DS: https://www.sapo.vn/cap-nhat-tinh-nang/dieu-chinh-nghiep-vu-tinh-nang-phieu-doi-soat , https://www.sapo.vn/cap-nhat-tinh-nang/nhap-file-doi-soat-kenh-san-tmdt
- SAPO-KHO: https://www.sapo.vn/blog/quan-ly-kho-hang-shopee
- MISA-HQ: https://www.misaeshop.vn/44183/phan-mem-quan-ly-ban-hang-hoa-qua/
- ODOO-UOM: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html
- ODOO-FEFO: https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies.html
- SHP-TRA: https://banhang.shopee.vn/edu/article/10626 (FAQ Trả hàng/Hoàn tiền cho Người bán)
- SHP-PHI: https://banhang.shopee.vn/edu/article/2139 (Phí cố định)
- SHP-BC: https://banhang.shopee.vn/edu/article/2072 (Báo cáo doanh thu)
- NHANH-DT: https://nhanh.vn/cach-tinh-doanh-thu-tren-shopee-chuan-2026-cho-nguoi-moi-n156995.html
- GHN-TRA: https://ghn.vn/blogs/tip-ban-hang/tra-hang-shopee-ai-chiu-phi

---

## A. Hàng hoá và đơn vị tính

| # | Luồng | Phần mềm chuyên dụng làm gì | Tin cậy |
|---|---|---|---|
| A1 | **Bán theo cân, số lượng lẻ** (0,35 kg; 1,2 kg) | Sapo cho nhập tối đa 3 số lẻ với đơn vị kg/mét; MISA: bán 100 g trừ kho 0,1 kg | [N] SAPO-QD (kết quả tìm kiếm help.sapo.vn), MISA-HQ |
| A2 | **Đơn vị nhập khác đơn vị bán** (nhập thùng/bao/sọt, bán kg/túi) | KiotViet: đơn vị cơ bản + đơn vị quy đổi kèm hệ số và giá riêng; tồn và giá vốn chỉ giữ ở đơn vị cơ bản. Sapo: 1 bao = 50 kg, hệ số không đổi được sau khi tạo. Odoo: UoM mua ≠ UoM tồn, tự quy đổi | [N] KV-NS, KV-DVT, SAPO-QD, ODOO-UOM |
| A3 | **Một lô nhập, bán ra nhiều quy cách** (túi 500 g, 1 kg, thùng 5 kg cùng trừ một tồn kg) | Chính là A2: mỗi quy cách là đơn vị quy đổi của cùng hàng | [N] như A2 |
| A4 | **Trọng lượng thực nhận ≠ trọng lượng trên phiếu NCC** (nhập 100 kg, cân lại 97 kg) | Không thấy nguồn mô tả tính năng riêng; thực tế ghi theo số cân thực, phần thiếu thành hao hụt hoặc trừ nợ NCC | [SL] |
| A5 | **Phân loại sau nhập** (hàng xô → loại 1, loại 2, dạt): chuyển SL từ mã này sang mã khác, giá vốn chia lại | Sapo chỉ khuyên "phân loại theo đặc tính". ERP làm bằng lệnh sản xuất/tách hàng | [SL], SAPO-NS chỉ nói chung |
| A6 | **Sang chiết/đóng gói lại** (bao 50 kg → túi 1 kg, có bao bì) | KiotViet có "hàng sản xuất" (thành phần → thành phẩm); Odoo có BoM | [N~] KV-DVT; [SL] cho áp dụng nông sản |
| A7 | Biến thể (mùi, size), combo/giỏ quà, quà tặng kèm | Chuẩn ở mọi phần mềm | [N] MISA-HQ nhắc giỏ quà như mô hình |
| A8 | Mã vạch/SKU, in tem | Chuẩn | [SL] |
| A9 | **Giá bán đổi theo ngày/mùa** (nông sản) và giá theo kênh | MISA khuyên cập nhật giá nhập theo mùa vụ; bảng giá theo kênh là chuẩn của KiotViet/Sapo | [N] MISA-HQ; [SL] bảng giá |
| A10 | Chứng nhận/nguồn gốc (VietGAP…) ghi trên sản phẩm | Sapo: chỉ ghi khi có hồ sơ | [N] SAPO-NS |

## B. Nhập hàng và nhà cung cấp

| # | Luồng | Chuẩn | Tin cậy |
|---|---|---|---|
| B1 | Phiếu nhập: nháp → nhận; trả một phần; công nợ NCC; lịch sử thanh toán | KiotViet | [N] KV-NHAP |
| B2 | **Giảm giá trên phiếu nhập** (tổng phiếu và từng dòng) | KiotViet có cả hai | [N] KV-NHAP |
| B3 | **Chi phí nhập hàng** hai loại: trả NCC và trả bên thứ ba; phân bổ vào giá vốn | KiotViet; Odoo landed cost chia theo SL / khối lượng / thể tích / giá trị | [N] KV-NHAP; Odoo [N~] |
| B4 | **Trả hàng nhập cho NCC** (hàng lỗi, dập, sai): trừ kho, giảm nợ NCC hoặc NCC hoàn tiền; trả theo phiếu nhập hoặc trả nhanh; huỷ phiếu trả | KiotViet | [N] KV-TRANHAP |
| B5 | **NCC bớt tiền mà không lấy lại hàng** (hàng xấu, thiếu cân → giảm giá sau khi đã nhận) | KiotViet có "điều chỉnh nợ" NCC | [N~] kết quả tìm kiếm KiotViet nhà cung cấp |
| B6 | **Ứng trước/đặt cọc cho NCC** trước khi có hàng (thương lái, nhà vườn) | Không thấy nguồn; phổ biến ở nông sản | [SL] |
| B7 | Đặt hàng nhập (PO) rồi nhận nhiều đợt | KiotViet "Đặt hàng nhập", Sapo OmniAI | [N~] |
| B8 | Mua không hoá đơn từ nông dân, trả tiền mặt ngay | — | [SL] |
| B9 | Lịch sử giá nhập, so sánh giá giữa NCC | MISA | [N] MISA-HQ |
| B10 | Nhập theo lô + hạn dùng | MISA; Odoo | [N] MISA-HQ, ODOO-FEFO |

## C. Kho

| # | Luồng | Chuẩn | Tin cậy |
|---|---|---|---|
| C1 | **Xuất huỷ** (hỏng, dập, thối, hết hạn): phiếu riêng, trừ kho theo giá vốn, huỷ phiếu thì cộng lại | KiotViet | [N] KV-HUY |
| C2 | **Hao hụt tự nhiên** (mất nước, sụt cân): ghi để có *tỷ lệ hao hụt* theo mặt hàng; giá vốn thực = giá nhập + vận chuyển + đóng gói + bảo quản + hao hụt phân bổ | Sapo | [N] SAPO-NS |
| C3 | **Báo cáo hao hụt**: tỷ lệ theo sản phẩm/NCC/lô; 3 chỉ số số ngày tồn, tốc độ bán, tỷ lệ hao hụt | Sapo | [N] SAPO-NS |
| C4 | Kiểm kê định kỳ, phiếu chênh lệch; nên ≥ 2 lần/tháng với hàng đa kênh | MISA, Sapo | [N] MISA-HQ, SAPO-KHO |
| C5 | FEFO và cảnh báo cận hạn → đẩy bán (giảm giá, combo) | MISA, Odoo | [N] MISA-HQ, ODOO-FEFO |
| C6 | **Hạ giá hàng xuống cấp** (bán loại 2, xả hàng cận hạn) vẫn truy được về lô | Sapo: ghi nhận "hỏng, huỷ, giảm giá" để tính hao hụt | [N] SAPO-NS (mức khái niệm) |
| C7 | Chuyển kho | Chuẩn | [N~] KiotViet chuyển hàng |
| C8 | **Một kho, nhiều kênh: chống bán vượt**: tồn trên Shopee không tự giảm khi bán Facebook/trực tiếp → phải sửa tồn trên sàn tay hoặc đồng bộ | Sapo cảnh báo đúng điều này | [N] SAPO-KHO |
| C9 | Vật tư đóng gói (hộp, túi, băng keo) tiêu hao theo đơn | — | [SL] |
| C10 | Hàng mẫu, hàng dùng thử, hàng biếu, tự dùng: xuất kho không doanh thu | — | [SL] |
| C11 | Vỏ sọt/thùng luân chuyển mượn của NCC | Không tìm thấy phần mềm nào nêu | [SL] |
| C12 | Hàng ký gửi | — | [SL] |

## D. Bán hàng chung

| # | Luồng | Chuẩn | Tin cậy |
|---|---|---|---|
| D1 | Đơn: nháp → xác nhận → giao → hoàn thành; huỷ | Chuẩn | [SL] |
| D2 | Thanh toán nhiều hình thức trong một đơn; thu nhiều lần | KiotViet | [N] KV-NS |
| D3 | **Khách đặt cọc** rồi lấy hàng sau | KiotViet "Đặt hàng" | [N~] |
| D4 | Bán chịu, công nợ khách, hạn trả, nhắc nợ | Chuẩn | [SL] |
| D5 | **Đổi hàng** (trả món A lấy món B, bù chênh lệch) | Sapo mô tả: tính chênh lệch, cập nhật kho | [N~] sapo.vn/blog/don-hang-hoan-sau-khi-xuat-hoa-don-xu-ly-nhu-the-nao |
| D6 | Trả hàng một phần/toàn phần, hoàn tiền, phí trả hàng | KiotViet | [N~] |
| D7 | **Bồi thường không trả hàng** (nông sản dập vài quả: hoàn bớt tiền, khách giữ hàng) | Tương tự "hoàn tiền một phần" của Shopee | [SL] cho kênh thường |
| D8 | Giảm giá dòng/đơn, khuyến mãi, voucher, quà tặng | Chuẩn | [SL] |
| D9 | In phiếu bán, nhãn giao | Chuẩn | [SL] |
| D10 | **Làm tròn tiền** khi bán theo cân (0,35 kg × 47.000 = 16.450) | — | [SL] |

## E. Shopee

| # | Luồng | Thực tế trên sàn | Tin cậy |
|---|---|---|---|
| E1 | Nhập đơn từ file xuất, cập nhật trạng thái về sau | Sapo đồng bộ API; file là phương án thay | [N] SAPO-DS |
| E2 | **Cấu trúc tiền một đơn**: giá gốc − trợ giá người bán − mã giảm giá người bán − xu người bán tài trợ; voucher/trợ giá của Shopee KHÔNG làm giảm tiền người bán; phí vận chuyển gồm người mua trả, Shopee trợ giá, phí thực tế (chỉ biết sau khi hoàn thành) | Báo cáo doanh thu Shopee | [N~] SHP-BC |
| E3 | **Các loại phí**: phí cố định (theo ngành hàng), phí dịch vụ (Freeship Xtra, Voucher Xtra…), phí xử lý giao dịch (tính trên giá + ship người mua trả − khuyến mãi người bán), phí tiếp thị liên kết | Shopee | [N~] SHP-PHI, NHANH-DT |
| E4 | **Thuế sàn khấu trừ thay** từ 01/07/2025 (GTGT + TNCN theo đơn, Nghị định 117/2025) hiện thành dòng riêng trong báo cáo | Shopee | [N~] SHP-BC, https://ghn.vn/blogs/tip-ban-hang/thue-shopee |
| E5 | **Trả hàng & hoàn tiền (hàng về)**: người bán KHÔNG bị tính phí cố định, phí dịch vụ, phí xử lý giao dịch cho sản phẩm bị trả | Shopee FAQ | [N~] SHP-TRA |
| E6 | **Hoàn tiền ngay / không trả hàng**: phí cố định và phí thanh toán VẪN tính (trừ lý do chưa nhận được hàng) | Shopee | [N~] SHP-PHI, SHP-TRA |
| E7 | **Hoàn tiền một phần**, người mua giữ hàng | Shopee | [N~] SHP-TRA (chi tiết chưa đọc được) |
| E8 | **Phí vận chuyển chiều hoàn** người bán chịu (có ngưỡng được Shopee bù) | GHN blog | [N~] GHN-TRA |
| E9 | **Giao không thành, hàng hoàn về**: không có doanh thu, hàng về kho sau nhiều ngày, có thể mất/hỏng | Sapo "Quản lý đóng gói và hàng hoàn" | [N~] https://www.sapo.vn/cap-nhat-tinh-nang/quan-ly-dong-goi-va-hang-hoan |
| E10 | **Hàng hoàn bị mất/hỏng, sàn bồi thường** (khoản điều chỉnh cộng vào số dư) | — | [SL] |
| E11 | **Đối soát theo file doanh thu**: so tiền thực nhận từng đơn với dự kiến; Sapo không tự tạo phiếu thu, người dùng ghi sau khi đối soát | Sapo | [N] SAPO-DS |
| E12 | **Khoản không gắn đơn** trong số dư: phí quảng cáo, phạt, điều chỉnh, bồi thường | — | [SL] |
| E13 | **Rút tiền từ số dư TK Shopee về ngân hàng** (tiền nằm ở ví sàn trước khi về ngân hàng) | misaeshop "Shopee trả tiền cho người bán như thế nào" | [N~] https://www.misaeshop.vn/40941/shopee-tra-tien-cho-nguoi-ban-nhu-the-nao/ |
| E14 | Trả hàng phát sinh SAU khi sàn đã trả tiền → sàn trừ lại vào số dư | — | [SL] |
| E15 | Hàng nông sản/thực phẩm trên sàn: yêu cầu hạn dùng, giấy tờ | SAPO-NS (pháp lý nói chung) | [N] mức chung |

## F. Facebook / Zalo (bán qua tin nhắn)

| # | Luồng | Tin cậy |
|---|---|---|
| F1 | Chốt đơn qua inbox/livestream → tạo đơn nhanh; khách chỉ có tên + link Facebook | [N] MISA-HQ (AI tạo đơn từ livestream); [SL] |
| F2 | Chuyển khoản trước / cọc một phần + COD phần còn lại | [SL] |
| F3 | **COD: hãng thu hộ, đối soát theo kỳ**, trừ phí ship, phí COD, phí hoàn | [N] Sapo/GHN (đã dẫn trong thiết kế app); |
| F4 | **Bom hàng**: khách không nhận, hàng hoàn về, shop chịu ship hai chiều; nông sản tươi hoàn về thường hỏng → huỷ luôn | [SL] |
| F5 | Chi phí quảng cáo Facebook theo ngày, gắn shop → tính lãi theo kênh | [SL] |
| F6 | Khách quen đặt lặp lại, nhắc mua lại | [SL] |

## G. Bán trực tiếp

| # | Luồng | Tin cậy |
|---|---|---|
| G1 | Bán nhanh tại chỗ, thu tiền mặt/QR, khách lẻ | [N] KV-NS |
| G2 | Cân hàng tại quầy (cân điện tử; không có thì gõ số cân) | [N] MISA-HQ |
| G3 | Chốt két cuối ngày: đếm tiền mặt so với sổ | [SL] |
| G4 | Bán sỉ cho mối quen, công nợ gối đầu (nông sản) | [SL] — CẦN HỎI: có bán sỉ nông sản không |

## H. Định kỳ (tuần/tháng)

| # | Luồng | Tin cậy |
|---|---|---|
| H1 | Lãi gộp theo shop, kênh, sản phẩm; chi phí chung chia về shop | [SL] |
| H2 | Tồn kho: giá trị, hàng chậm, sắp hết, số ngày tồn | [N] SAPO-NS |
| H3 | Tỷ lệ hao hụt theo mặt hàng/NCC | [N] SAPO-NS |
| H4 | Công nợ phải thu/phải trả, tuổi nợ | [SL] |
| H5 | Đối soát sàn, đối soát COD, số dư quỹ | [N] SAPO-DS |
| H6 | Chốt kỳ kho, kiểm kê | [N] (đã dẫn Katana/MISA trong thiết kế) |

## I. Đặc thù phong thuỷ và nước hoa ô tô

| # | Luồng | Tin cậy |
|---|---|---|
| I1 | Vật phẩm phong thuỷ **độc bản** (mỗi viên đá/vòng một giá, một trọng lượng): tồn = 1, cần ảnh và thông số riêng | [SL] — CẦN HỎI |
| I2 | Vòng theo size cổ tay, chỉnh size/gia công sau bán, dịch vụ kèm (khai quang…) = dòng dịch vụ không có tồn | [SL] — CẦN HỎI |
| I3 | Nước hoa ô tô: lọ + lõi/tinh dầu thay thế, bảo hành rò rỉ/vỡ khi vận chuyển, đổi mùi | [SL] |
| I4 | Hàng dễ vỡ khi ship → bồi thường/gửi bù không thu tiền (đơn 0 đồng trừ kho) | [SL] |
| I5 | Tester/mẫu thử mùi: xuất dùng nội bộ | [SL] |

---

## Những chỗ nguồn yếu, cần cậu xác nhận

1. Mọi dòng [N~] về Shopee: tớ không mở được toàn văn bài chính thức (trang chỉ trả khung). Nội dung E5/E6 (phí khi trả hàng) lấy từ đoạn trích kết quả tìm kiếm của chính bài Shopee, khả năng đúng cao nhưng chưa đọc tận nơi.
2. Mức phí cụ thể (4%, 5%, 6%…) các nguồn mâu thuẫn nhau; bản đồ không dùng con số nào.
3. Phần nông sản đầu mối (thương lái, vỏ sọt, ứng trước) không có phần mềm Việt nào tớ tìm được mô tả; toàn bộ là suy luận.
