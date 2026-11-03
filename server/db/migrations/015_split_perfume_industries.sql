-- Tách ngành "Nước hoa" thành hai: "Nước hoa ô tô" (có dòng xe) và "Nước hoa" thông thường.
-- Mọi shop đang chọn 'nuoc_hoa' được tạo khi ngành đó còn là bộ trường dành cho nước hoa ô tô (dòng xe, mua cho xe…),
-- nên chuyển sang 'nuoc_hoa_o_to'. Trường và dữ liệu khách đã nhập giữ nguyên, không đổi gì.
UPDATE shops SET industry = 'nuoc_hoa_o_to' WHERE industry = 'nuoc_hoa';
