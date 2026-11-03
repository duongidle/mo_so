# Mở Sổ

<img src="brand/logo-lockup.svg" alt="Mở Sổ" width="320">

Quản trị kinh doanh đa shop, tự host. Thiết kế đầy đủ ở `CLAUDE.md`, tiến độ ở `PROGRESS.md`.

## Chạy trên máy

Cần Node.js 20 trở lên (`node -v`).

```bash
npm install
npm run seed      # (tuỳ chọn) dữ liệu mẫu, đăng nhập admin / matkhau123
npm start         # http://localhost:3000
npm test
```

Hiện có API đầy đủ cho shop, kho, sản phẩm, nhập hàng, tồn kho, khách hàng, đơn bán, import đơn. Giao diện web là bước tiếp theo.

Sao lưu tay: `npm run backup` → `data/backups/`. Quên mật khẩu: `npm run reset-password -- admin matkhaumoi`.
