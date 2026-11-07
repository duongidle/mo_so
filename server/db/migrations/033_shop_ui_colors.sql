-- Màu giao diện riêng của shop (ghi đè màu của chủ đề): JSON {"primary":"#rrggbb","background":"#rrggbb"}, NULL = màu mặc định của chủ đề
ALTER TABLE shops ADD COLUMN ui_colors TEXT;
