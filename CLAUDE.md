# Mở Sổ — Hệ thống quản trị kinh doanh đa shop

> File này là bản thiết kế gốc của dự án. Mọi phiên làm việc (người hay AI) đọc file này trước khi code.
> Tiến độ thực tế ghi ở `PROGRESS.md`. Khi thiết kế thay đổi, sửa file này và ghi lý do vào mục "Nhật ký quyết định".

---

## 1. Tầm nhìn

Một app quản trị kinh doanh **miễn phí, tự host**, cho một chủ kinh doanh nhỏ vận hành **nhiều mảng kinh doanh (shop)** — hiện tại là *nước hoa ô tô* và *vật phẩm phong thuỷ* — bán trên **Shopee, Facebook và bán trực tiếp**.

Mục tiêu cốt lõi: **một nguồn dữ liệu thật duy nhất**. Mọi đơn từ mọi kênh đều nằm trong app, nên muốn biết doanh thu, tồn kho, lợi nhuận thì mở app ra xem, không cần cộng tay từ nhiều nơi.

### Nguyên tắc sản phẩm
1. **Đúng trước, đẹp sau.** Tồn kho, giá vốn, doanh thu phải khớp từng đồng. Giao diện đẹp mà số sai là vô dụng.
2. **Không mất dữ liệu.** Không xoá cứng dữ liệu nghiệp vụ; mọi thay đổi tồn kho đi qua sổ cái (ledger); có sao lưu.
3. **Nhập nhanh trên điện thoại.** Bán trực tiếp phải tạo đơn trong < 30 giây trên iPhone.
4. **API trước.** Mọi thứ giao diện làm được thì API cũng làm được. Có webhook để sau này nối phần mềm kế toán.
5. **Đơn giản trước, mở rộng sau.** Chỉ làm tính năng khi đã có nhu cầu thật.

### Ngoài phạm vi (hiện tại)
- Kế toán, sổ sách theo Thông tư 152/2025, kê khai thuế. Sẽ dùng phần mềm kế toán riêng, đồng bộ qua API/webhook.
- Hoá đơn điện tử (HĐĐT). App chỉ tạo **phiếu bán hàng** (chứng từ nội bộ), không phải hoá đơn hợp lệ với cơ quan thuế.
- Kéo đơn tự động từ Shopee API (để giai đoạn sau, cần Shopee duyệt).
- Nhiều người dùng / phân quyền nhân viên (thiết kế dữ liệu đã chừa chỗ, chưa làm UI).

---

## 2. Bối cảnh vận hành

| Khía cạnh | Thực tế |
|---|---|
| Người dùng | 1 chủ shop (owner). Sau có thể thêm nhân viên. |
| Thiết bị | MacBook (quản trị, báo cáo) + iPhone (bán trực tiếp, tra cứu). |
| Chạy ở đâu | Local trên MacBook. Điện thoại truy cập qua cùng wifi (`http://<ip-mac>:3000`). Sau có thể lên VPS. |
| Kênh bán | Shopee, Facebook, trực tiếp, khác. |
| Shop | Nước hoa ô tô, vật phẩm phong thuỷ. Thêm được shop mới. |
| Kho | Hiện tại 1 chỗ để hàng chung. Thiết kế cho phép nhiều kho. |

---

## 3. Kiến trúc

```
iPhone / MacBook (trình duyệt)
        │  HTTP (JSON)
        ▼
┌──────────────────────────────┐
│ Node.js server (Hono)        │
│  ├─ /api/v1/*   REST API     │◄── Ứng dụng ngoài (API key)
│  ├─ /           Web UI (SPA) │
│  ├─ webhook worker ─────────────► URL đăng ký (kế toán, Zapier…)
│  └─ backup job               │
└──────────────┬───────────────┘
               ▼
        SQLite (file data/moso.db, WAL)
```

### Công nghệ
| Phần | Chọn | Lý do |
|---|---|---|
| Runtime | Node.js ≥ 20 | Phổ biến, chạy được trên Mac lẫn VPS. |
| HTTP | Hono + @hono/node-server | Nhẹ, API giống Express nhưng hiện đại; sau này chuyển sang Cloudflare Workers dễ vì Hono chạy được ở đó. |
| DB | SQLite qua better-sqlite3 | Một file, không cần cài DB server, nhanh, giao dịch đồng bộ an toàn. Sao lưu = copy file. |
| Validate | zod | Kiểm tra dữ liệu vào ở mọi endpoint. |
| UI | React + Vite (JS), react-router | Nhiều màn hình, cần state phức tạp. Build ra file tĩnh, server phục vụ. |
| CSS | CSS thuần với biến (tokens) | Không phụ thuộc framework CSS, nhẹ, mobile-first. |

### Cấu trúc thư mục
```
moso/
├─ CLAUDE.md            ← bản thiết kế (file này)
├─ PROGRESS.md          ← nhật ký thực hiện từng module
├─ package.json
├─ server/
│  ├─ index.js          ← khởi động server
│  ├─ app.js            ← tạo Hono app, gắn route (tách để test)
│  ├─ db/
│  │  ├─ index.js       ← kết nối, transaction helper
│  │  └─ migrations/    ← 001_init.sql, 002_….sql (chỉ thêm, không sửa file cũ)
│  ├─ lib/              ← id, money, time, errors, auth, codes, events
│  ├─ modules/<tên>/    ← mỗi module: routes.js + service.js (+ schema.js)
│  └─ jobs/             ← webhook dispatcher, backup
├─ web/                 ← React SPA (Vite)
│  └─ src/
│     ├─ api.js         ← client gọi API
│     ├─ pages/<tên>/
│     └─ components/
├─ brand/               ← logo (SVG), tokens.css — xem mục 7A
├─ scripts/             ← seed, backup tay, reset mật khẩu
├─ tests/               ← test API bằng node:test
└─ data/                ← moso.db, backups/ (gitignore)
```

---

## 4. Quy ước bắt buộc

1. **Tiền là số nguyên VND** (`INTEGER`, đơn vị đồng). Không bao giờ dùng số thực cho tiền. Tên cột tiền kết thúc bằng `_amount` hoặc là `price`, `cost`.
2. **Số lượng là số nguyên** (đơn vị nhỏ nhất của sản phẩm: chai, cái, hộp).
3. **ID** là chuỗi ULID có tiền tố: `shp_`, `whs_`, `prd_`, `var_`, `cus_`, `ord_`, `pur_`, `exp_`, … Không lộ ID tự tăng.
4. **Mã hiển thị** (người đọc) riêng: đơn `DH-261103-001`, phiếu nhập `PN-…`, khách `KH-00001`.
5. **Thời gian** lưu ISO-8601 UTC (`2026-11-03T03:04:05.000Z`). Báo cáo theo ngày dùng múi giờ `Asia/Ho_Chi_Minh` (cột `business_date` = ngày theo giờ VN, tính khi ghi).
6. **Không xoá cứng** dữ liệu nghiệp vụ. Dùng `archived_at` (ẩn) hoặc trạng thái `cancelled`. Chỉ xoá cứng dữ liệu nháp chưa phát sinh gì.
7. **Tồn kho chỉ thay đổi qua `stock_movements`.** Bảng `stock_levels` là số tổng hợp, luôn cập nhật trong cùng transaction với movement. Có lệnh kiểm tra đối chiếu (`scripts/check-stock.js`).
8. **Mọi thao tác ghi nhiều bảng chạy trong 1 transaction.**
9. **Mỗi thay đổi quan trọng phát 1 sự kiện** (`events` → outbox webhook) và ghi `audit_log`.
10. **Migration chỉ thêm file mới**, không sửa file đã chạy.
11. **API trả lỗi thống nhất**: `{ "error": { "code": "STOCK_NOT_ENOUGH", "message": "…", "details": {...} } }`.
12. Mỗi module xong phải có test API cho luồng chính và cập nhật `PROGRESS.md`.

---

## 5. Mô hình nghiệp vụ

### 5.1 Shop, Kho, Kênh
- **Shop** = một mảng kinh doanh (giống chi nhánh). Vào app chọn shop đang làm việc; mọi màn hình bán hàng, sản phẩm, báo cáo mặc định lọc theo shop đó. Có chế độ **"Tất cả shop"** cho báo cáo.
- **Kho** = nơi để hàng thật. Tách khỏi shop. Một shop có **kho mặc định** để trừ hàng khi bán; một kho phục vụ được nhiều shop.
- **Kênh** (`channel`): `shopee`, `facebook`, `direct`, `other` (+ kênh tuỳ chỉnh sau). Mỗi đơn thuộc 1 shop và 1 kênh.

### 5.2 Sản phẩm
- **Sản phẩm gốc** (`products`) sống ở cấp toàn hệ thống: tên, mô tả, ảnh, danh mục, đơn vị, thuộc tính phong thuỷ (ngũ hành hợp), chu kỳ dùng hết (ngày).
- **Biến thể / SKU** (`variants`): mỗi sản phẩm ≥ 1 biến thể (mùi, size, màu…). Tồn kho và giá tính theo biến thể. Sản phẩm đơn giản có 1 biến thể mặc định.
- **Niêm yết theo shop** (`shop_listings`): biến thể được bán ở shop nào, giá bán riêng của shop, trạng thái đang bán/ngừng.
- **Đồng bộ sản phẩm giữa shop** = tạo niêm yết ở shop đích từ niêm yết của shop nguồn (chọn từng sản phẩm hoặc toàn bộ). Thông tin sản phẩm dùng chung (vì là sản phẩm gốc), giá được chép sang rồi chỉnh riêng. Tuỳ chọn: ghi đè giá nếu đã tồn tại.
- **Combo** (giai đoạn sau): biến thể loại `bundle` gồm nhiều biến thể thành phần; bán combo trừ kho thành phần.

### 5.3 Tồn kho & giá vốn
- `stock_levels(warehouse, variant)`: `on_hand` (đang có), `reserved` (đã giữ cho đơn chưa giao — giai đoạn sau), `avg_cost` (giá vốn bình quân).
- **Phương pháp giá vốn: bình quân gia quyền di động theo kho.** Khi nhập hàng: `avg_mới = (on_hand*avg_cũ + sl_nhập*giá_nhập_đã_phân_bổ) / (on_hand + sl_nhập)`. Khi bán: ghi giá vốn = avg tại thời điểm xuất vào dòng đơn (`unit_cost`) — **chụp lại, không tính lại về sau**.
- **Chi phí nhập phân bổ vào giá vốn**: phí ship nhập, phí khác trên phiếu nhập được chia theo tỷ lệ giá trị dòng.
- **Loại biến động** (`stock_movements.type`): `purchase_in`, `sale_out`, `sale_return_in`, `adjust_in`, `adjust_out`, `transfer_out`, `transfer_in`, `opening` (tồn đầu kỳ), `damage_out`.
- Không cho tồn âm theo mặc định (cấu hình `allow_negative_stock` trong settings, mặc định `false`). Đơn import từ kênh có thể vượt tồn → được phép nhưng gắn cờ cảnh báo.
- **Kiểm kho**: phiếu kiểm kê → chênh lệch sinh `adjust_in/out`.
- **Chuyển kho**: `transfer_out` + `transfer_in` với cùng giá vốn.

### 5.4 Nhập hàng (Purchase)
- **Nhà cung cấp** (`suppliers`).
- **Phiếu nhập** (`purchases`): trạng thái `draft → received → (cancelled)`. Chỉ khi `received` mới cộng kho. Huỷ phiếu đã nhận → sinh biến động ngược (nếu tồn đủ).
- Theo dõi công nợ nhà cung cấp: `total_amount`, `paid_amount` (thanh toán ghi ở `payments` với `direction=out`).

### 5.5 Khách hàng (dùng chung toàn hệ thống)
- Khách hàng **không thuộc shop nào**. Hệ thống khách hàng chạy song song hệ thống bán hàng; đơn của mọi shop gắn vào cùng 1 hồ sơ.
- Nhận diện bằng **số điện thoại chuẩn hoá** (`0xxxxxxxxx`). Khách Facebook có thể chỉ có tên + link Facebook.
- **Gộp hồ sơ trùng**: chuyển toàn bộ đơn/ghi chú sang hồ sơ giữ lại, hồ sơ bị gộp đánh dấu `merged_into`.
- Thông tin phong thuỷ: ngày sinh, giới tính → **mệnh (ngũ hành nạp âm)** tính tự động theo năm âm lịch, có thể ghi đè tay (vì năm âm lịch bắt đầu ở Tết, người sinh tháng 1–2 dương có thể bị lệch).
- Chỉ số tự tính: tổng chi tiêu, số đơn, đơn đầu, đơn gần nhất, hạng.

### 5.6 Đơn bán (Order)
- Thuộc 1 shop, 1 kênh, 0–1 khách hàng (khách lẻ được phép), kho xuất = kho mặc định của shop (đổi được).
- **Định danh chống trùng khi import**: `(shop_id, channel, external_id)` duy nhất. Đơn tạo tay sinh mã nội bộ, `external_id` để trống.
- **Trạng thái**:
  ```
  draft ──confirm──► confirmed ──ship──► shipping ──complete──► completed
    │                   │                    │                     │
    └──cancel──► cancelled ◄──cancel─────────┘                     └──return──► returned (toàn phần)
                                                                     (trả một phần: giữ completed + có phiếu trả)
  ```
  - `draft`: chưa ảnh hưởng gì.
  - `confirmed`: **trừ kho** (sale_out), chụp giá vốn.
  - `cancelled` từ confirmed/shipping: **cộng lại kho**.
  - Trả hàng: phiếu trả (`order_returns`) cộng kho với giá vốn đã chụp, ghi giảm doanh thu.
  - Bán trực tiếp: nút "Bán ngay" đi thẳng `draft → completed` + thanh toán đủ trong 1 bước.
- **Tiền trên đơn**:
  - `subtotal` = Σ(đơn giá × SL) dòng
  - `discount_amount` (giảm giá đơn) + giảm giá từng dòng
  - `shipping_fee` (khách trả) 
  - `total_amount` = subtotal − giảm giá + shipping_fee (**khách phải trả**)
  - `platform_fee_amount` (phí sàn: hoa hồng, thanh toán, dịch vụ), `seller_shipping_amount` (phí ship shop chịu)
  - `net_amount` = total − platform_fee − seller_shipping (**shop thực nhận**)
  - `cogs_amount` = Σ giá vốn dòng
  - `gross_profit` = net − cogs (tính khi báo cáo, có cả chi phí trả hàng)
  - `paid_amount`, `payment_status`: `unpaid | partial | paid | refunded`
  - **Số tiền cần thu** khác nhau theo kênh: kênh sàn (`channels.is_marketplace = 1`) → cần thu `net_amount` (sàn trừ phí rồi mới trả shop); kênh khác → cần thu `total_amount` (phí ship shop chịu là khoản chi riêng). Đều trừ phần hàng đã trả.
- **Phiếu bán hàng**: trang in khổ A5/80mm từ đơn, có logo/tên shop, không gọi là "hoá đơn".

### 5.7 Import đơn
- Nguồn: file CSV/XLSX xuất từ Shopee, hoặc file theo **mẫu chuẩn của app** (dùng cho Facebook/AI tạo hàng loạt).
- File được **đọc trên trình duyệt** (không gửi file thô lên server), map cột → JSON, gửi theo lô ≤ 200 đơn.
- Mỗi đơn: nếu `(shop, channel, external_id)` **chưa có → tạo**; **đã có → so sánh và cập nhật** (trạng thái, tiền, phí sàn). Đổi trạng thái đi qua đúng luồng nghiệp vụ (vd. completed → cancelled sẽ hoàn kho).
- Ghép sản phẩm theo `SKU`; dòng không ghép được → báo lỗi dòng đó, không bỏ qua im lặng.
- Ghép khách theo SĐT; chưa có thì tạo.
- Chạy **thử (dry-run)** trước: trả về bảng "sẽ tạo / sẽ cập nhật / lỗi", người dùng xác nhận mới ghi.
- Mỗi lần import lưu `import_batches` + `import_rows` để tra lại.
- Cấu hình map cột lưu thành **mẫu import** (`import_profiles`) tái sử dụng.

### 5.8 Thu chi & Chi phí
- **Chi phí** (`expenses`): danh mục (quảng cáo FB, phí sàn ngoài đơn, ship, bao bì, mặt bằng, khác), số tiền, ngày, gắn với shop (hoặc chung), kênh (tuỳ chọn).
- Chi phí chung được **phân bổ** vào shop khi báo cáo theo quy tắc: theo doanh thu thuần (mặc định) / chia đều / tỷ lệ cố định.
- **Thanh toán** (`payments`): thu từ đơn, trả nhà cung cấp, hoàn tiền khách. Phương thức: tiền mặt, chuyển khoản, Shopee payout, COD.
- **Đối soát Shopee**: tiền đơn Shopee hoàn thành nhưng chưa ghi nhận payout = "tiền đang treo".

### 5.9 Báo cáo & Sức khoẻ kinh doanh
Lọc: khoảng thời gian, shop (1 / nhiều / tất cả), kênh, danh mục. So sánh với kỳ trước.

Chỉ số:
| Nhóm | Chỉ số |
|---|---|
| Doanh thu | Doanh thu gộp, giảm giá, hoàn/huỷ, **doanh thu thuần**, phí sàn |
| Lợi nhuận | Giá vốn, **lợi nhuận gộp**, biên LN gộp, chi phí, **lợi nhuận ròng ước tính** (theo shop, kênh) |
| Đơn | Số đơn, giá trị đơn TB (AOV), tỷ lệ huỷ, tỷ lệ hoàn |
| Khách | Khách mới, khách quay lại, tỷ lệ mua lại, top khách |
| Kho | Giá trị tồn kho, **số ngày tồn** (days of inventory), hàng bán chậm (không bán N ngày), hàng sắp hết (dưới mức tối thiểu hoặc < X ngày bán) |
| Dòng tiền | Tiền đã thu, công nợ khách, tiền Shopee đang treo, công nợ NCC |

**Sức khoẻ**: mỗi chỉ số có ngưỡng do người dùng đặt (xanh/vàng/đỏ). Trang tổng quan hiện các chỉ số đang đỏ lên đầu.

Hiệu năng: bảng tổng hợp `daily_stats(business_date, shop_id, channel)` cập nhật khi đơn thay đổi; báo cáo đọc bảng này, chi tiết mới query bảng gốc.

### 5.10 Loyalty & Chăm sóc khách
- **Hạng khách** theo tổng chi tiêu toàn hệ thống trong 12 tháng (cấu hình ngưỡng: Thành viên / Bạc / Vàng / Kim cương). Hạng → % giảm giá gợi ý khi bán.
- **Nhắc mua lại**: từ `products.consumption_days` và ngày mua → ngày dự kiến hết. Trang "Hôm nay nên liên hệ" + tin nhắn mẫu (template có biến `{ten}`, `{san_pham}`, `{shop}`).
- **Gợi ý theo mệnh**: khách có mệnh → gợi ý vật phẩm phong thuỷ có ngũ hành tương sinh/tương hợp (bán chéo giữa 2 shop).
- **Ngày đặc biệt**: sinh nhật khách.
- Tích điểm: *không làm ở giai đoạn đầu* (điểm là khoản nợ với khách, phức tạp khi chia giữa shop).

### 5.11 Trường tuỳ chỉnh & Công thức
- Định nghĩa trường tuỳ chỉnh cho đối tượng: `product`, `customer`, `order`, `purchase`. Kiểu: text, number, money, date, select, multi-select, boolean, **formula**.
- **Phạm vi trường**: toàn hệ thống (mặc định, để cộng gộp được giữa shop) hoặc riêng 1 shop.
- **Trường công thức**: biểu thức an toàn (không `eval`) trên các trường của chính bản ghi, vd `{total_amount} - {cogs_amount} - {custom.phi_dong_goi}`. Hàm: `IF, ROUND, MIN, MAX, ABS, DAYS_BETWEEN, TODAY`.
- **Chỉ số tuỳ chỉnh cho báo cáo**: công thức trên các chỉ số tổng hợp, vd `{net_revenue} / {order_count}`, áp dụng được cho 1 shop / nhiều shop.
- Lưu giá trị: bảng EAV `custom_values(entity_type, entity_id, field_id, value_text, value_num)`.

### 5.12 API & Webhook
- REST tại `/api/v1`. Xác thực bằng **session cookie** (web) hoặc **API key** (`Authorization: Bearer tk_live_…`, lưu dạng hash, có quyền `read`/`write`).
- Phân trang con trỏ: `?limit=50&cursor=…`. Lọc chung: `shop_id`, `updated_since`.
- **Idempotency**: header `Idempotency-Key` cho POST tạo đơn/phiếu nhập.
- **Webhook**: đăng ký URL + danh sách sự kiện + secret. Gửi `POST` JSON, chữ ký `X-Moso-Signature: sha256=HMAC(secret, body)`, `X-Moso-Event`, `X-Moso-Delivery`. Retry lũy thừa (1m, 5m, 30m, 2h, 12h), tối đa 6 lần, xem log từng lần gửi.
- Sự kiện: `order.created|updated|status_changed|cancelled`, `order.payment_recorded`, `purchase.received`, `stock.changed`, `customer.created|updated|merged`, `product.created|updated`, `expense.created`.
- Tài liệu API: `/api/v1/docs` (OpenAPI JSON + trang đọc).

### 5.13 Sao lưu & An toàn
- SQLite chế độ WAL. Sao lưu tự động hằng ngày bằng SQLite online backup → `data/backups/moso-YYYYMMDD-HHmm.db`, giữ 14 bản ngày + 8 bản tuần. Nút "Tải bản sao lưu" và "Xuất CSV toàn bộ".
- Đăng nhập: 1 tài khoản owner, mật khẩu băm scrypt, cookie `HttpOnly; SameSite=Lax`, phiên 30 ngày. Giới hạn sai mật khẩu.
- Vì chạy trong mạng LAN, vẫn bắt buộc đăng nhập (người khác cùng wifi có thể mở được).
- Lên VPS: đặt sau reverse proxy có HTTPS (Caddy), bật cookie `Secure`.

---

## 6. Lược đồ dữ liệu (SQLite)

Chi tiết cột nằm trong `server/db/migrations/*.sql` (nguồn sự thật). Tóm tắt:

| Bảng | Vai trò |
|---|---|
| `settings` | key/value cấu hình hệ thống |
| `users`, `sessions`, `api_keys` | xác thực |
| `shops` | mảng kinh doanh; `default_warehouse_id`, `code_prefix` |
| `warehouses` | kho |
| `channels` | kênh bán (seed sẵn 4 kênh) |
| `categories` | danh mục sản phẩm (cây) |
| `products`, `variants` | sản phẩm gốc & SKU |
| `shop_listings` | biến thể bán ở shop nào, giá bao nhiêu |
| `stock_levels`, `stock_movements` | tồn kho & sổ cái kho |
| `stock_counts`, `stock_count_lines` | kiểm kê |
| `suppliers`, `purchases`, `purchase_lines` | nhập hàng |
| `customers`, `customer_notes` | khách hàng chung |
| `orders`, `order_lines`, `order_status_history`, `order_returns`, `order_return_lines` | bán hàng |
| `payments` | thu/chi gắn đơn, phiếu nhập |
| `expenses`, `expense_categories` | chi phí |
| `import_profiles`, `import_batches`, `import_rows` | import |
| `custom_fields`, `custom_values`, `report_metrics` | tuỳ chỉnh |
| `loyalty_tiers`, `reminders`, `message_templates` | loyalty |
| `daily_stats` | tổng hợp báo cáo |
| `events`, `webhooks`, `webhook_deliveries` | sự kiện & webhook |
| `audit_log` | ai sửa gì, khi nào, trước/sau |
| `sequences` | bộ đếm sinh mã hiển thị |
| `idempotency_keys` | chống tạo trùng qua API |

---

## 7. Giao diện

### Bố cục
- **Điện thoại**: thanh tab dưới cùng (Tổng quan · Bán hàng · Đơn · Kho · Thêm). Nút nổi "+ Đơn" ở mọi màn hình.
- **Máy tính**: thanh bên trái, nội dung rộng, bảng dữ liệu đầy đủ cột.
- **Bộ chọn shop** luôn ở đầu trang. Chế độ "Tất cả shop" chỉ có ở Báo cáo, Khách hàng, Kho.

### Màn hình
| Màn | Nội dung chính |
|---|---|
| Đăng nhập / Thiết lập lần đầu | tạo mật khẩu, tạo shop & kho đầu tiên |
| Tổng quan | doanh thu hôm nay/tháng, LN gộp, đơn chờ xử lý, cảnh báo sức khoẻ, hàng sắp hết, khách cần nhắc |
| Bán nhanh (POS) | tìm SKU, giỏ hàng, chọn khách (gõ SĐT), giảm giá, thu tiền, "Bán ngay" |
| Đơn hàng | danh sách lọc theo trạng thái/kênh/ngày; chi tiết đơn; đổi trạng thái; thanh toán; trả hàng; in phiếu |
| Import đơn | chọn file → chọn mẫu map cột → xem thử → xác nhận → kết quả |
| Sản phẩm | danh sách theo shop, chi tiết sản phẩm + biến thể, niêm yết theo shop, đồng bộ sang shop khác |
| Kho | tồn theo kho, lịch sử biến động, kiểm kê, chuyển kho |
| Nhập hàng | phiếu nhập, nhà cung cấp, công nợ NCC |
| Khách hàng | danh sách, hồ sơ (đơn ở mọi shop, mệnh, hạng, ghi chú), gộp trùng |
| Chăm sóc | hôm nay nên liên hệ, mẫu tin nhắn, sinh nhật |
| Chi phí | danh sách, thêm nhanh |
| Báo cáo | các tab: Doanh thu, Lợi nhuận, Kênh, Sản phẩm, Khách, Kho, Dòng tiền, Chỉ số tuỳ chỉnh |
| Cài đặt | shop, kho, kênh, ngưỡng sức khoẻ, hạng khách, trường tuỳ chỉnh, API key, webhook, sao lưu, mật khẩu |

### Phong cách
- Nhận diện, bảng màu và quy tắc dùng màu: xem mục 7A. Token màu nằm ở `brand/tokens.css`.
- Số tiền căn phải, định dạng `1.250.000 ₫`.
- Màu trạng thái đơn là ngoại lệ chức năng (nháp xám, xác nhận xanh dương, đang giao tím, hoàn thành xanh lá, huỷ đỏ, trả hàng cam), đã giảm bão hoà trong `tokens.css` để hợp tông.
- Nút bấm cao ≥ 44px trên điện thoại.

---

## 7A. Thương hiệu & nhận diện

Tên: **Mở Sổ**. Nghĩa đen là mở cuốn sổ ra để ghi và xem. Hợp với bản chất app: một cuốn sổ cái duy nhất cho mọi shop, mọi kênh.

### Concept: Đương đại Á Đông · Dấu vết thời gian (The Traces of Time)
Kết hợp sự tiết chế của thiết kế đương đại với cảm giác vật liệu, thủ công và không gian Á Đông. Không mô phỏng cổ phong máy móc. Không dùng biểu tượng phong thuỷ quen thuộc (rồng, tiền xu, hoa văn mây, chữ Hán…) làm lối tắt cho bản sắc.

Dấu vết thời gian: mỗi đơn, mỗi lần nhập kho là một nét ghi lại. Giao diện nên gợi giấy, gỗ, gốm, dấu niêm: ấm, chậm, đáng tin. Không dùng hiệu ứng bóng loáng kiểu dashboard công nghệ.

### Bảng màu chính thức
| Màu | HEX | Tỷ lệ | Vai trò |
|---|---|---|---|
| Linen | `#EDE3D2` | 45% | Nền chính, giấy, không gian sáng |
| Walnut (nâu óc chó) | `#301F12` | 30% | Chữ, nội dung, màu tối chủ đạo, nhãn |
| Terracotta | `#865C49` | 15% | Điểm nhấn ấm, chi tiết hình ảnh |
| Oxblood | `#633D37` | 10% | Dấu niêm, điểm nhấn cao cấp, nút chính |
| Muted Champagne | `#CDB58D` | nhấn | Nét logo, viền mảnh, ép kim. **Màu nhấn đề xuất, không thay thế bảng nền tảng.** |

Tỷ lệ là định hướng tổng thể, không áp dụng cứng cho từng màn hình.

### Quy tắc dùng màu
1. Linen và Walnut là cặp nền tảng. Mặc định mọi màn hình là chữ Walnut trên nền Linen.
2. Terracotta tạo độ ấm, không phủ kín cả màn hình.
3. Oxblood dùng có chủ đích: nút hành động chính, dấu "đã xong/đã chốt", chi tiết cần nhấn.
4. Champagne chỉ cho nét mảnh, viền, đường kẻ. Không dùng vàng kim làm màu chủ đạo.
5. Không phủ bộ lọc màu lên ảnh sản phẩm. Ảnh giữ màu thật.
6. Giá, kích thước, chất liệu, cảnh báo phải dễ đọc, tương phản đủ.

### Độ tương phản đã kiểm (WCAG)
| Cặp | Tỷ lệ | Dùng cho chữ? |
|---|---|---|
| Walnut / Linen | 12.4 | Có, mọi cỡ |
| Oxblood / Linen | 7.3 | Có, mọi cỡ |
| Terracotta / Linen | 4.5 | Có, vừa đủ AA. Tránh cỡ nhỏ hơn 14px |
| Champagne / Walnut | 8.0 | Có, trên nền tối |
| Champagne / Linen | 1.6 | **Không.** Chỉ trang trí |
| Oxblood / Walnut | 1.7 | **Không** đặt chữ hoặc biểu tượng cần đọc lên nhau |
| Terracotta / Walnut | 2.7 | **Không** dùng cho chữ |

### Logo
Thư mục `brand/`:
- `logo-mark.svg`: biểu tượng vuông bo góc nền Walnut. Hai tờ sổ phẳng lệch nhau (tờ trái Terracotta ở phía bóng, tờ phải Linen đang được mở lên), dòng kẻ sổ là "dấu vết", gáy Champagne, một dấu niêm Oxblood đóng hơi lệch như đóng tay. Viền Champagne mảnh gợi ép kim trên hộp quà.
- `logo-lockup.svg`: biểu tượng + chữ "Mở Sổ" (serif, Walnut) + dòng "DẤU VẾT CỦA THỜI GIAN" (Terracotta). Chữ đã chuyển thành đường nét (font Noto Serif SemiBold, giấy phép SIL OFL) nên hiển thị giống nhau trên mọi máy, không phụ thuộc font cài sẵn. Muốn đổi chữ thì phải tạo lại outline, không sửa trực tiếp.
- `favicon.svg`: bản rút gọn cho thanh tab và icon nhỏ (bỏ dòng kẻ và viền).
- `tokens.css`: biến CSS màu và font cho giao diện.

Quy tắc dùng logo: để khoảng trống quanh logo ít nhất bằng 1/4 chiều rộng biểu tượng. Không đổi màu các thành phần, không xoay, không thêm bóng. Trên nền Walnut dùng biểu tượng như cũ (nền tile đã là Walnut).

---

## 8. Lộ trình module

Mỗi module = DB migration + service + routes + UI + test + cập nhật PROGRESS.md.

| # | Module | Phụ thuộc | Ưu tiên |
|---|---|---|---|
| M0 | Nền: khung dự án, DB, migration runner, lỗi, ID, tiền, giờ, auth, audit, events | — | Bắt buộc |
| M1 | Shop, kho, kênh, cài đặt | M0 | Bắt buộc |
| M2 | Sản phẩm, biến thể, danh mục, niêm yết shop, đồng bộ sản phẩm | M1 | Bắt buộc |
| M3 | Tồn kho, sổ cái kho, nhập hàng, NCC, kiểm kê, chuyển kho | M2 | Bắt buộc |
| M4 | Khách hàng chung, mệnh, gộp trùng | M0 | Bắt buộc |
| M5 | Đơn bán, trạng thái, thanh toán, trả hàng, phiếu bán hàng, POS | M3, M4 | Bắt buộc |
| M6 | Import đơn (dry-run, upsert, mẫu map cột) | M5 | Bắt buộc |
| M7 | Chi phí & thanh toán, đối soát Shopee | M5 | Cao |
| M8 | Báo cáo, daily_stats, sức khoẻ kinh doanh | M5, M7 | Cao |
| M9 | Loyalty: hạng, nhắc mua lại, gợi ý theo mệnh, mẫu tin nhắn | M4, M5 | Trung bình |
| M10 | Trường tuỳ chỉnh, công thức, chỉ số báo cáo tuỳ chỉnh | M8 | Trung bình |
| M11 | API key, webhook, tài liệu API | M0 | Trung bình |
| M12 | Sao lưu tự động, xuất CSV, khôi phục | M0 | Cao |
| M13 | Giao diện web đầy đủ (làm song song từng module) | — | Bắt buộc |

---

## 9. Cách chạy

```bash
npm install
npm run build        # build giao diện web
npm start            # chạy server tại http://localhost:3000
# Điện thoại: http://<IP-của-Mac>:3000 (cùng wifi)

npm run dev          # chế độ phát triển (server + Vite hot reload)
npm test             # chạy test API
node scripts/seed.js # tạo dữ liệu mẫu (2 shop, 1 kho, vài sản phẩm)
```

Biến môi trường (`.env`, không bắt buộc): `PORT=3000`, `HOST=0.0.0.0`, `DATA_DIR=./data`, `TZ_BUSINESS=Asia/Ho_Chi_Minh`.

---

## 10. Rủi ro & điểm cần nhớ

- **Nhập tay là điểm yếu lớn nhất** của "một nguồn sự thật": quên 1 đơn là lệch kho. Giảm thiểu bằng: POS thật nhanh, import Shopee định kỳ, báo cáo đối chiếu tồn kho với kiểm kê.
- **Giá vốn sai thì lợi nhuận sai mà trông vẫn hợp lý.** Luôn phân bổ phí nhập; không sửa giá vốn đã chụp trên đơn.
- **SQLite một file**: mất máy là mất dữ liệu nếu không sao lưu ra ngoài máy. Nên copy thư mục `data/backups` lên Google Drive/iCloud.
- **Năm âm lịch** cho mệnh: người sinh trước Tết thuộc năm âm trước. Có ngày sinh → app đổi sang âm lịch chính xác (`server/lib/lunar.js`). Chỉ có năm sinh → giả định sinh sau Tết, đánh dấu `approximate`. Luôn cho ghi đè tay.
- **Phiếu bán hàng không phải hoá đơn thuế.**
- **Định dạng file xuất của Shopee có thể đổi** → map cột cấu hình được, không code cứng.

---

## 11. Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-11-03 | Tự build thay vì dùng KiotViet/Sapo | Không muốn trả phí; cần 1 nguồn dữ liệu cho nhiều kênh và tính năng riêng (mệnh, nhắc mua lại). |
| 2026-11-03 | Node + SQLite chạy local, sau lên VPS | Đơn giản, miễn phí, không cần quan tâm server lúc đầu. |
| 2026-11-03 | Tách kho khỏi shop | Hàng hiện để chung một chỗ; tồn theo shop sẽ không khớp thực tế. |
| 2026-11-03 | Khách hàng dùng chung mọi shop | Phục vụ loyalty và bán chéo. |
| 2026-11-03 | Sản phẩm gốc + niêm yết theo shop (liên kết, không sao chép) | Tránh 2 bản lệch nhau sau nhiều lần sửa. |
| 2026-11-03 | Import upsert theo (shop, kênh, mã đơn kênh) | Đơn đã import có thể đổi trạng thái (huỷ/hoàn) sau đó. |
| 2026-11-03 | Giá vốn bình quân gia quyền di động theo kho | Phổ biến, dễ hiểu, phù hợp quy mô nhỏ. |
| 2026-11-03 | Kế toán/thuế để sau, mở API + webhook | Sẽ mua phần mềm kế toán riêng và đồng bộ. |
| 2026-11-03 | Hạng theo chi tiêu, chưa làm tích điểm | Tích điểm là khoản nợ, phức tạp khi chia giữa shop. |
| 2026-11-03 | Đơn sàn: cần thu = tiền sau phí sàn | Chạy thử thấy đơn Shopee nhận payout đủ vẫn bị báo "thanh toán một phần". |
| 2026-11-03 | Đơn import từ sàn được phép làm âm kho, gắn cờ `stock_warning` | Đơn đã xảy ra thật trên sàn; chặn lại sẽ làm mất dữ liệu. Cờ giúp phát hiện kho trong app lệch thực tế. |
| 2026-11-03 | Dùng thư viện lịch âm (thuật toán Hồ Ngọc Đức) thay vì bảng tra Tết | Tính đúng mọi năm, không phải duy trì bảng; đã kiểm tra khớp Tết 1984–2026. |
| 2026-11-03 | Đổi tên dự án Tiệm → **Mở Sổ**; chốt concept "Đương đại Á Đông · Dấu vết thời gian" | Tên cũ chung chung. "Mở Sổ" nói đúng việc app làm: một cuốn sổ cái cho mọi shop. Chi tiết ở mục 7A. |
| 2026-11-03 | Thêm Muted Champagne làm màu nhấn, chỉ cho nét mảnh/viền, cấm làm chữ trên Linen | Gợi ép kim cho logo và hộp quà. Tương phản với Linen chỉ 1.6:1. Quy tắc gốc cũng cấm vàng kim làm màu chủ đạo. |
| 2026-11-03 | Màu trạng thái đơn giảm bão hoà, thành ngoại lệ chức năng ngoài bảng màu | Xanh/đỏ/cam rực làm vỡ tông giấy-gỗ, nhưng người bán cần phân biệt trạng thái trong 1 giây. Mọi giá trị ≥ 4.5:1 trên Linen. |
| 2026-11-03 | Chữ trong logo chuyển thành outline từ Noto Serif | Bản đầu dùng thẻ text với font hệ thống, máy khác thay font làm vỡ dấu tiếng Việt (ở, ổ) và tagline tràn khung. |
| 2026-11-03 | Migration 007 cập nhật tên mẫu import thay vì sửa 006 | Quy ước 10: không sửa migration đã có. Đổi tên file DB `tiem.db` → `moso.db`, cookie `moso_session`, header webhook `X-Moso-*` (chưa có dữ liệu thật nên không cần chuyển). |
