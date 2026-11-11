-- Mẫu import Shopee v2, theo file xuất đơn Shopee thật (xem audit/bao-cao-doi-chieu.md, "Đối chiếu với file Shopee thật").
-- Chỉ UPDATE có điều kiện trên imp_shopee: thêm/sửa đúng các khoá cần thiết, giữ cột người dùng đã thêm.

-- Phí sàn: thêm "Phí xử lý giao dịch" (giữ "Phí thanh toán" là tên cũ, hai tên thay nhau qua options.column_aliases)
UPDATE import_profiles SET column_map = json_set(column_map, '$.platform_fee', json((
  SELECT json_group_array(v) FROM (
    SELECT value AS v FROM json_each(column_map, '$.platform_fee')
    UNION
    SELECT value AS v FROM json_each('["Phí cố định","Phí Dịch Vụ","Phí xử lý giao dịch","Phí thanh toán"]')))))
 WHERE id = 'imp_shopee' AND json_type(column_map, '$.platform_fee') IS NOT NULL;

-- Giảm giá đơn: thêm giảm giá từ Combo của Shop
UPDATE import_profiles SET column_map = json_set(column_map, '$.order_discount', json((
  SELECT json_group_array(v) FROM (
    SELECT value AS v FROM json_each(column_map, '$.order_discount')
    UNION
    SELECT value AS v FROM json_each('["Mã giảm giá của Shop","Giảm giá từ Combo của Shop"]')))))
 WHERE id = 'imp_shopee' AND json_type(column_map, '$.order_discount') IS NOT NULL;

-- Bỏ gán phí vận chuyển người mua trả (tên NFC hoặc NFD, đúng như bản dựng sẵn)
UPDATE import_profiles SET column_map = json_remove(column_map, '$.shipping_fee')
 WHERE id = 'imp_shopee' AND json_extract(column_map, '$.shipping_fee') IN ('Phí vận chuyển mà người mua trả', 'Phí vận chuyển mà người mua trả');

-- Trả hàng
UPDATE import_profiles SET column_map = json_insert(column_map, '$.return_status', 'Trạng thái Trả hàng/Hoàn tiền', '$.returned_qty', 'Số lượng sản phẩm được hoàn trả')
 WHERE id = 'imp_shopee';

-- Trạng thái: chuỗi "Người mua xác nhận đã nhận được hàng, tuy nhiên … tới ngày …" đổi đuôi theo ngày nên khớp theo tiền tố (khoá kết thúc bằng *)
UPDATE import_profiles SET status_map = json_insert(status_map, '$."Người mua xác nhận đã nhận được hàng*"', 'completed', '$."Đã nhận được hàng"', 'completed')
 WHERE id = 'imp_shopee';

-- Tuỳ chọn: ghi chú, nhóm tên cột thay nhau, giá trị trả hàng được coi là đã chấp thuận
UPDATE import_profiles SET options = json_insert(options, '$.column_aliases', json('[["Phí xử lý giao dịch","Phí thanh toán"]]'), '$.return_approved', json('["Đã Chấp Thuận Yêu Cầu"]'))
 WHERE id = 'imp_shopee';
UPDATE import_profiles SET options = json_set(options, '$.note', 'Đã kiểm với file xuất đơn Shopee thật (11/2026). Phí sàn = Phí cố định + Phí Dịch Vụ + Phí xử lý giao dịch (“Phí thanh toán” là tên cũ). Giảm giá đơn = Mã giảm giá của Shop + Giảm giá từ Combo của Shop (không âm). Phí vận chuyển người mua trả KHÔNG được nhập vào đơn: khoản này đi qua Shopee tới hãng vận chuyển, không phải tiền shop nhận, nhập vào sẽ làm tiền Shopee treo sai. Trả hàng: dòng có “Trạng thái Trả hàng/Hoàn tiền” đã chấp thuận và “Số lượng sản phẩm được hoàn trả” sẽ lập phiếu trả chờ hàng về. Tên cột Shopee có thể đổi theo thời gian: kiểm tra lại khi import.')
 WHERE id = 'imp_shopee' AND (json_extract(options, '$.note') IS NULL OR json_extract(options, '$.note') = 'Tên cột Shopee có thể thay đổi theo thời gian — kiểm tra lại khi import lần đầu');
