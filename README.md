# Mở Sổ

<img src="brand/logo-lockup.svg" alt="Mở Sổ" width="320">

Mở Sổ là app quản trị kinh doanh đa shop, miễn phí và tự host. Mọi đơn từ Shopee, Facebook và bán trực tiếp nằm chung một cuốn sổ, nên muốn biết doanh thu, tồn kho, lợi nhuận thì mở app ra xem.

Thiết kế đầy đủ ở [`CLAUDE.md`](CLAUDE.md), tiến độ ở [`PROGRESS.md`](PROGRESS.md).

## Trạng thái

Đã có backend và giao diện web cho: shop, kho, sản phẩm, nhập hàng, tồn kho, khách hàng, đơn bán (POS), import đơn, chi phí và đối soát Shopee, báo cáo và sức khoẻ kinh doanh, chăm sóc khách, trường tuỳ chỉnh, API key, webhook, sao lưu. Các điểm còn thiếu ghi ở `PROGRESS.md`.

## Chạy trên máy

Cần Node.js 20 trở lên (`node -v`).

```bash
npm install
npm run build     # build giao diện web (lần đầu)
npm run seed      # (tuỳ chọn) dữ liệu mẫu, đăng nhập admin / matkhau123
npm start         # http://localhost:3000
npm test
```

Sao lưu tự động mỗi ngày vào `data/backups/` (giữ 14 bản ngày + 8 bản tuần). Sao lưu tay: `npm run backup`. Khôi phục (tắt server trước): `npm run restore -- <file>`. Phát triển giao diện: chạy `npm run dev` và `npm run dev:web` song song. Quên mật khẩu: `npm run reset-password -- admin matkhaumoi`.

## Nhận diện

**Đương đại Á Đông · Dấu vết thời gian.** Tiết chế như thiết kế đương đại, ấm như giấy, gỗ, gốm và dấu niêm. Không dùng biểu tượng phong thuỷ quen thuộc làm lối tắt.

<img src="brand/palette.svg" alt="Tỷ lệ màu thương hiệu" width="600">

| Màu | HEX | Tỷ lệ | Vai trò |
|---|---|---|---|
| Linen | `#EDE3D2` | 45% | Nền chính, giấy |
| Walnut | `#301F12` | 30% | Chữ, màu tối chủ đạo |
| Terracotta | `#865C49` | 15% | Điểm nhấn ấm |
| Oxblood | `#633D37` | 10% | Dấu niêm, điểm nhấn cao cấp |
| Muted Champagne | `#CDB58D` | nhấn | Nét mảnh, viền. Không dùng làm chữ trên Linen |

Logo, token CSS và quy tắc dùng màu: thư mục [`brand/`](brand/) và mục 7A trong `CLAUDE.md`.
