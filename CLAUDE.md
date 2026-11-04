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
- Nhiều người dùng trong **cùng một tài khoản** (nhân viên, phân quyền). Hiện mỗi tài khoản là một chủ kinh doanh với dữ liệu riêng (mục 3A); thêm nhân viên vào một tài khoản chưa làm.

---

## 2. Bối cảnh vận hành

| Khía cạnh | Thực tế |
|---|---|
| Người dùng | Nhiều tài khoản chủ shop, mỗi tài khoản có dữ liệu riêng hoàn toàn (mục 3A). Sau có thể thêm nhân viên vào một tài khoản. |
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
        SQLite, mỗi tài khoản một file (data/accounts/<id>.db, WAL)
        + sổ tài khoản chung data/master.db
```

### 3A. Nhiều tài khoản (cập nhật 2026-11-03)
- **Mỗi tài khoản một file SQLite riêng** (`data/accounts/<account_id>.db`) với đủ bảng nghiệp vụ như mục 6. Danh sách shop, kho, sản phẩm, khách, đơn của tài khoản này không bao giờ lẫn với tài khoản khác: cách ly bằng file, không bằng cột `account_id` (quên một mệnh đề `WHERE` cũng không thể lộ dữ liệu).
- **`data/master.db`** chỉ giữ: `accounts` (tên đăng nhập, mật khẩu băm, tên hiển thị), `sessions` (phiên đăng nhập), `api_key_index` (băm key → tài khoản, để biết key của ai mà mở đúng DB). Key thật vẫn nằm trong DB của tài khoản.
- Mỗi request: `requireAuth()` xác thực (cookie → `sessions`, Bearer → `api_key_index`) rồi chạy phần còn lại **trong ngữ cảnh DB của tài khoản đó** (`AsyncLocalStorage`). `getDb()` ngoài ngữ cảnh thì **báo lỗi**, không có DB mặc định để vô tình dùng nhầm.
- Đăng ký tự do (`POST /auth/register`); đặt `REGISTRATION=closed` để đóng đăng ký (tài khoản đầu tiên luôn tạo được). Giới hạn số lần đăng ký theo IP mỗi giờ (`REGISTER_LIMIT`, mặc định 20). Tên đăng nhập: chữ không dấu, số, `. _ @ -`, 3–50 ký tự, không phân biệt hoa thường.
- Tài khoản mới **chưa có shop**: giao diện chạy luồng thiết lập (mục 5.1A) rồi mới vào app.
- Bản cài cũ có một file `moso.db`: lần khởi động đầu tự chuyển thành tài khoản đầu tiên (không mất dữ liệu).
- Sao lưu, webhook worker, script `seed`/`backup`/`restore`/`reset-password` đều chạy theo từng tài khoản.

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
│  │  ├─ index.js       ← kết nối, transaction helper, ngữ cảnh DB theo tài khoản
│  │  ├─ tenancy.js     ← sổ tài khoản (master.db), mở/tạo DB từng tài khoản
│  │  ├─ master/        ← migration của master.db (tài khoản, phiên, chỉ mục API key)
│  │  └─ migrations/    ← 001_init.sql, 002_….sql của DB từng tài khoản (chỉ thêm, không sửa file cũ)
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
└─ data/                ← master.db, accounts/<id>.db, backups/<id>/ (gitignore)
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
13. **Route PATCH dùng `patchOf(schema)`** (`server/lib/http.js`), không dùng `.partial()` trực tiếp: trong zod 4 `.partial()` vẫn áp giá trị `.default()` cho trường vắng, nên sửa một ô sẽ âm thầm đặt phí ship, phí sàn, đơn vị… về mặc định. Ràng buộc `.refine()` phải đặt *trước* `.default()` để `patchOf` giữ được.
14. **Chia tiền dùng `allocate()`** (`server/lib/money.js`), không `Math.round(x * tỷ lệ)` từng phần: tổng các phần phải bằng đúng số gốc.

---

## 5. Mô hình nghiệp vụ

### 5.1 Shop, Kho, Kênh
- **Shop** = một mảng kinh doanh (giống chi nhánh). Vào app chọn shop đang làm việc; mọi màn hình bán hàng, sản phẩm, báo cáo mặc định lọc theo shop đó. Có chế độ **"Tất cả shop"** cho báo cáo.
- **Kho** = nơi để hàng thật. Tách khỏi shop. Một shop có **kho mặc định** để trừ hàng khi bán; một kho phục vụ được nhiều shop.
- **Kênh** (`channel`): `shopee`, `facebook`, `direct`, `other` (+ kênh tuỳ chỉnh sau). Mỗi đơn thuộc 1 shop và 1 kênh.

### 5.1A Thiết lập lần đầu của tài khoản mới
Đăng ký xong, tài khoản chưa có shop nên không có gì để làm. Giao diện dẫn qua 3 bước, mỗi bước chỉ hỏi những gì cần:
1. **Tạo shop**: tên, mã (gợi ý từ tên), **ngành bán** (4 thẻ chọn, mục 5.14), điện thoại, địa chỉ.
2. **Tạo kho đầu tiên** (popup hướng dẫn): tên, mã. Kho này thành kho mặc định của shop.
3. **Tạo sản phẩm đầu tiên**: tên, SKU, giá bán, giá vốn (tuỳ chọn). Có thể bỏ qua.
Sau đó vào Tổng quan; nếu còn thiếu kho/sản phẩm ở shop đầu tiên, trang chủ nhắc tiếp (có thể ẩn). Các shop về sau thêm ở Cài đặt → Shop & kho.

### 5.2 Sản phẩm
- **Sản phẩm gốc** (`products`) sống ở cấp toàn hệ thống: tên, mô tả, ảnh, danh mục, đơn vị, thuộc tính phong thuỷ (ngũ hành hợp), chu kỳ dùng hết (ngày).
- **Biến thể / SKU** (`variants`): mỗi sản phẩm ≥ 1 biến thể (mùi, size, màu…). Tồn kho và giá tính theo biến thể. Sản phẩm đơn giản có 1 biến thể mặc định.
- **Niêm yết theo shop** (`shop_listings`): biến thể được bán ở shop nào, giá bán riêng của shop, trạng thái đang bán/ngừng.
- **Đồng bộ sản phẩm giữa shop** = tạo niêm yết ở shop đích từ niêm yết của shop nguồn (chọn từng sản phẩm hoặc toàn bộ). Thông tin sản phẩm dùng chung (vì là sản phẩm gốc), giá được chép sang rồi chỉnh riêng. Tuỳ chọn: ghi đè giá nếu đã tồn tại.
- **Combo**: biến thể `kind = 'bundle'` gồm các biến thể đơn (không lồng combo) kèm số lượng mỗi combo (`bundle_components`). Combo **không có tồn riêng**: số bán được = min theo thành phần (tồn / SL mỗi combo); nhập hàng, điều chỉnh, chuyển kho, kiểm kê chỉ làm trên thành phần (chặn `BUNDLE_NO_STOCK`). Bán combo trừ kho từng thành phần; giá vốn dòng = Σ SL × giá vốn thành phần lúc bán; ảnh chụp thành phần + giá vốn lưu ở `order_line_components` để huỷ đơn/trả hàng hoàn đúng kể cả khi công thức combo đổi sau. Biến thể đã có lịch sử kho/đơn không đổi loại được (`KIND_LOCKED`).

### 5.3 Tồn kho & giá vốn
- `stock_levels(warehouse, variant)`: `on_hand` (đang có), `reserved` (đã giữ cho đơn chưa giao — giai đoạn sau), `avg_cost` (giá vốn bình quân).
- **Phương pháp giá vốn: bình quân gia quyền di động theo kho.** Khi nhập hàng: `avg_mới = (on_hand*avg_cũ + sl_nhập*giá_nhập_đã_phân_bổ) / (on_hand + sl_nhập)`. Khi bán: ghi giá vốn = avg tại thời điểm xuất vào dòng đơn (`unit_cost`) — **chụp lại, không tính lại về sau**.
- **Chi phí nhập phân bổ vào giá vốn**: phí ship nhập, phí khác trên phiếu nhập được chia theo tỷ lệ giá trị dòng.
- **Loại biến động** (`stock_movements.type`): `purchase_in`, `sale_out`, `sale_return_in`, `adjust_in`, `adjust_out`, `transfer_out`, `transfer_in`, `opening` (tồn đầu kỳ), `damage_out`.
- Không cho tồn âm theo mặc định (cấu hình `allow_negative_stock` trong settings, mặc định `false`). Đơn import từ kênh có thể vượt tồn → được phép nhưng gắn cờ cảnh báo.
- **Kiểm kho**: phiếu kiểm kê nhiều bước (`stock_counts`): tạo phiếu (chụp tồn) → nhập số đếm dần, lưu giữa chừng → hoàn tất sinh `adjust_in/out` theo chênh lệch. Chênh lệch tính theo tồn hệ thống **tại lúc nhập số đếm của từng dòng**, nên hàng bán trước hoặc sau lúc đếm không làm sai. Dòng chưa đếm: bỏ qua (mặc định) hoặc coi là 0. Thiếu giá vốn cho hàng nhập lần đầu thì cả phiếu không áp. Phiếu đã chốt không sửa.
- **Chuyển kho**: `transfer_out` + `transfer_in` với cùng giá vốn.

### 5.4 Nhập hàng (Purchase)
- **Nhà cung cấp** (`suppliers`).
- **Phiếu nhập** (`purchases`): trạng thái `draft → received → (cancelled)`. Chỉ khi `received` mới cộng kho. Huỷ phiếu đã nhận → sinh biến động ngược (nếu tồn đủ).
- Theo dõi công nợ nhà cung cấp: `total_amount`, `paid_amount` (thanh toán ghi ở `payments` với `direction=out`).

### 5.5 Khách hàng (hồ sơ dùng chung, danh sách theo từng shop)
- **Hồ sơ** khách (tên, SĐT, Facebook, địa chỉ) là **một cho một người** trong cả tài khoản; đơn của mọi shop gắn vào cùng hồ sơ đó. Nhưng **danh sách khách của mỗi shop là riêng**: khách là *thành viên* của shop nào thì mới hiện ở shop đó (`customer_shops`).
- **Thành viên shop** tự có khi: khách mua ở shop (tạo/sửa đơn), được tạo từ trang Khách hàng khi đang chọn shop, nhập thông tin riêng ở shop, hoặc bấm "Thêm vào shop". Xem tất cả shop thì thấy mọi hồ sơ.
- **Xoá khách = xoá khỏi một shop** (`DELETE /customers/:id?shop_id=`, bắt buộc có `shop_id`). Chỉ mất phần của shop đó: thông tin riêng, nhãn, ghi chú của shop. **Không đụng** hồ sơ chung, khách ở shop khác, lịch sử đơn. Khách mua lại ở shop đó thì tự quay về danh sách. Khách không còn ở shop nào *và* chưa có đơn nào thì hồ sơ được lưu trữ (ẩn, `archived_at`); tạo lại cùng SĐT thì dùng lại hồ sơ cũ thay vì báo trùng. Dữ liệu bị xoá ghi vào `audit_log` để khôi phục tay.
- **Nhãn khách** (`customer_tags`) là **của từng shop**: cùng một khách, shop A gắn "VIP" không làm shop B thấy. Chuẩn hoá khi lưu (bỏ khoảng trắng thừa, trùng không phân biệt hoa thường), tối đa 20 nhãn mỗi khách mỗi shop. Lọc theo nhãn cần `shop_id`. Cột `customers.tags` cũ không còn dùng.
- Nhận diện bằng **số điện thoại chuẩn hoá** (`0xxxxxxxxx`). Khách Facebook có thể chỉ có tên + link Facebook.
- **Gộp hồ sơ trùng**: chuyển toàn bộ đơn/ghi chú sang hồ sơ giữ lại, hồ sơ bị gộp đánh dấu `merged_into`. Thành viên shop và nhãn của hai hồ sơ được hợp lại.
- **Thông tin riêng theo shop**: hồ sơ khách chỉ giữ thông tin chung (tên, SĐT, Facebook, địa chỉ, ghi chú). Mọi thông tin khác (ngày sinh, mệnh, mùi yêu thích, dòng xe…) là **trường tuỳ chỉnh của từng shop** (mục 5.11): trường của shop này không xuất hiện ở shop kia, kể cả cùng một khách. Mệnh (ngũ hành nạp âm theo năm âm lịch) chỉ có ở shop thuộc ngành phong thuỷ, tính từ trường ngày/năm sinh của shop đó, ghi đè tay được. Cột `birth_date`, `birth_year`, `element_override`, `gender` cũ trên bảng `customers` không còn dùng; khi một shop bật ngành phong thuỷ, giá trị cũ được chép sang trường của shop cho những khách đã mua ở shop đó.
- Chỉ số tự tính: tổng chi tiêu, số đơn, đơn đầu, đơn gần nhất, hạng.
- **Cột ở danh sách khách**: mỗi trường khách của shop có thể bật `show_in_list` để hiện thành cột ở danh sách khách (tối đa 4 cột mỗi shop). Chỉ hiện khi xem theo một shop.
- **Xuất danh sách khách**: `GET /customers/export` dùng đúng bộ lọc của danh sách (`q`, `shop_id`, `tag`, `element`, `sort`) nên không thể lệch; `format=csv|json`. **Có `shop_id`**: file của shop đó, gồm thông tin chung, nhãn, mệnh (shop phong thuỷ), *mọi* trường riêng của shop, số đơn/chi tiêu/đơn đầu/đơn gần nhất **tại shop đó**, hạng, ngày vào shop, ghi chú. **Không có `shop_id`**: chỉ thông tin chung + các shop khách thuộc về + số liệu tổng, không có dữ liệu riêng của shop nào. CSV có BOM và chống công thức độc như xuất đơn; Excel dựng ở trình duyệt; tối đa 50.000 dòng.

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
- **Xuất đơn**: `GET /orders/export` dùng đúng bộ lọc của danh sách đơn (`orderFilter`), hai kiểu file (mỗi đơn một dòng / mỗi sản phẩm một dòng), CSV (có BOM, chống công thức độc) hoặc JSON (giao diện dựng Excel), `format=count` để báo trước số dòng. Tiền là số nguyên đồng, ngày giờ theo giờ VN, tối đa 50.000 dòng. Khác với `/system/export/orders.csv` (bản sao thô của bảng, dùng để lưu trữ).

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
- Chi phí chung được phân bổ về shop theo quy tắc **doanh thu thuần** (mặc định), **chia đều** hoặc **tỷ lệ cố định** (`expense_allocation_fixed`: % mỗi shop, không cần cộng đủ 100). Chia bằng `allocate()` nên tổng các shop luôn bằng đúng số chi phí. Chi phí của shop đã lưu trữ vẫn tính vào tổng.
- Chi phí có **phương thức trả** (`method`): quyết định tiền chi ra khỏi quỹ nào, và được tính là tiền ra trong dòng tiền.
- **Thanh toán** (`payments`): thu từ đơn, trả nhà cung cấp, hoàn tiền khách, NCC hoàn tiền. Phương thức: tiền mặt, chuyển khoản, Shopee payout, COD, thẻ, ví, khác. Huỷ phiếu nhập đã trả tiền NCC bắt buộc ghi nhận NCC hoàn tiền (`PURCHASE_PAID`).
- **Quỹ tiền** (`cash_accounts`, `cash_entries`): két tiền mặt, tài khoản ngân hàng, ví. Mỗi phương thức thanh toán thuộc đúng một quỹ (mặc định: Tiền mặt = cash, cod; Ngân hàng = các phương thức còn lại). **Số dư không lưu, luôn tính từ sổ**: số dư đầu (tại `opening_date`) + thu − chi − chi phí theo phương thức ± chuyển quỹ ± điều chỉnh. Chuyển quỹ = hai dòng đối ứng (tổng không đổi, huỷ cả hai phía). **Kiểm đếm** ghi phần chênh thành một dòng điều chỉnh, không sửa thu chi cũ. Phương thức chưa gán quỹ được báo riêng (`unassigned`).
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

Hiệu năng: bảng đệm `daily_stats(business_date, shop_id, channel_id)` (migration 017). **Chống lệch bằng trigger SQLite**: mọi INSERT/UPDATE/DELETE trên `orders`, từ bất kỳ đường nào, đánh dấu ô tương ứng (cả ô cũ lẫn ô mới nếu đơn đổi ngày) là "bẩn" trong `daily_stats_dirty`; báo cáo tính lại các ô bẩn từ bảng `orders` trước khi đọc. Không phụ thuộc việc code nghiệp vụ có nhớ cập nhật. `npm run check-stats [-- --fix]` kiểm tra và dựng lại. Báo cáo theo sản phẩm, khách, kho vẫn query bảng gốc.

**Quy tắc số liệu** (có test đối chiếu `tests/finance_integrity.test.js`): tổng theo shop, theo kênh, theo ngày, theo sản phẩm, theo ngũ hành, cộng các đơn lẻ, đều phải khớp tổng quan. Doanh thu theo sản phẩm/ngũ hành đã trừ hàng trả (từng dòng, theo giá trị ghi trên phiếu trả). Phí sàn khi trả hàng được **giả định sàn không hoàn**. Lọc kênh: chi phí gắn kênh khác bị bỏ, chi phí không gắn kênh chia cho các kênh theo doanh thu kênh của shop (cộng các kênh lại = tổng). Số ngày tồn dùng giá vốn bán 30 ngày của **đúng shop/kho đang xem**.

**Bổ sung**:
- **Báo cáo chi phí** (`/reports/expenses`): theo danh mục (tách phần của shop và phần chung đã chia), so kỳ trước, tỷ lệ trên doanh thu thuần, khoản chi lớn nhất.
- **Tuổi nợ** (`/reports/aging`): khách nợ và tiền sàn chưa về (tính từ ngày đặt đơn), nợ NCC (từ ngày nhận hàng), chia 0–7, 8–30, 31–60, 61–90, trên 90 ngày.
- **Lọc danh mục sản phẩm** (kể cả danh mục con) áp dụng cho báo cáo *sản phẩm* và *ngũ hành*. Chỉ số cấp đơn (doanh thu, phí ship, phí sàn, chi phí) không chia theo danh mục vì thuộc cả đơn.
- **Dòng tiền** tính cả chi phí là tiền ra. Lọc theo shop: chi phí chung không thuộc shop nào nên báo riêng (`shared_expenses_not_included`).
- **Ước tính thuế** (`tax_enabled`, `tax_rules`): **mặc định tắt và app không tự đặt mức thuế nào** vì mức thuế/ngưỡng của hộ kinh doanh thay đổi theo thời kỳ (các nguồn tra cứu còn mâu thuẫn nhau). Người dùng tự nhập các khoản (tỷ lệ %, cơ sở tính: doanh thu thuần / + phí ship / lợi nhuận ròng, ngưỡng miễn thuế cả năm). Ngưỡng tính cộng dồn từ đầu năm dương lịch, thuế một kỳ = thuế cộng dồn cuối kỳ − trước kỳ nên cộng các kỳ liền nhau ra đúng cả năm. Là thuế của cả hộ nên không tính khi lọc shop/kênh. Chỉ là ước tính để thấy lợi nhuận sau thuế, không phải tờ khai.
- **Xuất Excel** từ mọi tab báo cáo (đúng cái đang xem, mỗi bảng một sheet, tiền và tỷ lệ là số).
- **Cách đọc số liệu** (`/guide`, trong menu): thay vì nhìn hàng chục chỉ số, trả lời 5 câu hỏi (Tiền có đủ không? Bán có lời không? Hàng có kẹt/sắp hết không? Khách có quay lại không? Chi phí có phình ra không?), mỗi câu có màu xanh/vàng/đỏ, số chính và việc nên làm; kèm từ điển từng con số. Chỉ dùng ngưỡng người dùng đã đặt và quy tắc tự nhiên (quỹ âm, đang lỗ); không bịa ngưỡng mới.

### 5.10 Loyalty & Campaign
Một module gộp mọi việc chăm sóc khách (trước đây là trang Chăm sóc, Gợi ý theo mệnh và cài đặt Hạng khách), trang `/loyalty`, các tab: **Hôm nay · Gợi ý theo mệnh · Hạng khách · Mẫu tin nhắn · Tự động hoá**. `/care` chuyển hướng về đây. Chỗ để sau này thêm các việc tự động (mục dưới).

- **Hạng khách** theo tổng chi tiêu toàn hệ thống trong 12 tháng (cấu hình ngưỡng: Thành viên / Bạc / Vàng / Kim cương). Hạng → % giảm giá gợi ý khi bán.
- **Nhắc mua lại** (tab Hôm nay): từ `products.consumption_days` và ngày mua → ngày dự kiến hết. Chỉ nhắc khách còn là thành viên của shop có đơn đó (khách đã xoá khỏi shop thì shop đó thôi nhắc). Soạn tin từ mẫu, sửa, sao chép.
- **Gợi ý theo mệnh** (tab riêng, **chỉ shop ngành phong thuỷ**): mỗi khách của shop biết mệnh và còn vật phẩm đang bán hợp mệnh mà chưa mua → một dòng kèm tối đa 3 gợi ý, xếp theo chi tiêu; soạn tin ngay. Mệnh là thông tin riêng của shop nên không bán chéo từ shop khác. Gợi ý cho từng khách vẫn hiện ở hồ sơ khách.
- **Hạng khách** và **Mẫu tin nhắn** (thêm/sửa/xoá) quản lý ngay trong module, không còn ở Cài đặt.
- **Tự động hoá** (chưa làm, tab chỉ nói rõ điều đó): tự động nhắn tin nhắc mua lại/chúc sinh nhật, tự động nâng hạng. Gửi tin cần chọn kênh gửi (Zalo OA, SMS…) và tuân quy định tin nhắn quảng cáo nên làm sau khi chốt kênh.
- **Ngày đặc biệt**: sinh nhật khách.
- Tích điểm: *không làm ở giai đoạn đầu* (điểm là khoản nợ với khách, phức tạp khi chia giữa shop).

### 5.11 Trường tuỳ chỉnh & Công thức
- Định nghĩa trường tuỳ chỉnh cho đối tượng: `product`, `customer`, `order`, `purchase`. Kiểu: text, number, money, date, select, multi-select, boolean, **formula**.
- **Phạm vi trường**: sản phẩm/đơn/phiếu nhập: toàn hệ thống (mặc định, để cộng gộp được giữa shop) hoặc riêng 1 shop. **Khách hàng: luôn riêng 1 shop** (bắt buộc `shop_id`); khoá chỉ cần duy nhất trong shop; đọc/ghi giá trị luôn kèm `shop_id`. Trường có thể mang `role` (`birth_date`, `birth_year`, `element`) để app biết dùng vào việc gì (tính mệnh, nhắc sinh nhật). Gộp khách: giá trị của hồ sơ giữ lại thắng, trường còn thiếu lấy từ hồ sơ bị gộp.
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
- SQLite chế độ WAL. Sao lưu tự động hằng ngày, **riêng từng tài khoản** (và sổ tài khoản `_master`), bằng SQLite online backup → `data/backups/<account_id>/moso-YYYYMMDD-HHmm.db`, giữ 14 bản ngày + 8 bản tuần. Nút "Tải bản sao lưu" và "Xuất CSV toàn bộ".
- Đăng ký/đăng nhập: nhiều tài khoản, mỗi tài khoản dữ liệu riêng (mục 3A). Mật khẩu băm scrypt, cookie `HttpOnly; SameSite=Lax`, phiên 30 ngày. Giới hạn sai mật khẩu và giới hạn đăng ký theo IP.
- Vì chạy trong mạng LAN, vẫn bắt buộc đăng nhập (người khác cùng wifi có thể mở được).
- Lên VPS: đặt sau reverse proxy có HTTPS (Caddy), bật cookie `Secure`.

### 5.14 Ngành bán
- Mỗi shop chọn một **ngành bán** (`shops.industry`, đổi trong Cài đặt → Shop & kho). Danh mục ngành nằm ở `server/lib/industries.js`: `general` (Bán lẻ chung), `phong_thuy`, `nuoc_hoa_o_to` (nước hoa/tinh dầu/phụ kiện thơm cho xe: nhóm hương, dòng xe, mua cho xe nào), `nuoc_hoa` (nước hoa mặc cho người: nhóm hương, nồng độ, thương hiệu yêu thích, phong cách, dịp dùng, ngân sách, sinh nhật). Hai ngành nước hoa **tách biệt**: khách và cách bán khác nhau nên trường khách và giao diện khác nhau. Thêm ngành = thêm một mục ở đó (và một theme CSS nếu muốn giao diện riêng).
- Ngành quyết định: (1) **theme giao diện** (mục 7A), (2) **tính năng** bật theo ngành (`feng_shui`: mệnh, ngũ hành, âm lịch, doanh thu theo ngũ hành, gợi ý theo mệnh), (3) **trường thông tin khách tạo sẵn** cho shop.
- Chọn/đổi ngành chỉ **thêm** trường còn thiếu (theo khoá hoặc vai trò), không xoá hay ẩn gì: trường và dữ liệu của ngành cũ vẫn giữ.
- Chủ shop tự thêm/sửa/ẩn trường khách của shop trong trang Khách hàng → "Thông tin khách của shop".
- Chuyển shop ở bộ chọn shop thì giao diện, tính năng và trường khách đổi theo. "Tất cả shop" dùng giao diện chung, không có thông tin riêng của shop nào.

---

## 6. Lược đồ dữ liệu (SQLite)

Chi tiết cột nằm trong `server/db/migrations/*.sql` (nguồn sự thật). Tóm tắt:

| Bảng | Vai trò |
|---|---|
| `settings` | key/value cấu hình hệ thống |
| `users`, `sessions`, `api_keys` | xác thực trong DB của tài khoản |
| (master.db) `accounts`, `sessions`, `api_key_index` | sổ tài khoản: đăng nhập, phiên, tra key → tài khoản (mục 3A) |
| `shops` | mảng kinh doanh; `default_warehouse_id`, `code_prefix` |
| `warehouses` | kho |
| `channels` | kênh bán (seed sẵn 4 kênh) |
| `categories` | danh mục sản phẩm (cây) |
| `products`, `variants` | sản phẩm gốc & SKU |
| `shop_listings` | biến thể bán ở shop nào, giá bao nhiêu |
| `stock_levels`, `stock_movements` | tồn kho & sổ cái kho |
| `stock_counts`, `stock_count_lines` | kiểm kê |
| `suppliers`, `purchases`, `purchase_lines` | nhập hàng |
| `customers`, `customer_notes` | hồ sơ khách chung |
| `customer_shops`, `customer_tags` | khách thuộc shop nào (kèm `removed_at`), nhãn khách theo shop |
| `orders`, `order_lines`, `order_status_history`, `order_returns`, `order_return_lines` | bán hàng |
| `payments` | thu/chi gắn đơn, phiếu nhập |
| `expenses`, `expense_categories` | chi phí |
| `import_profiles`, `import_batches`, `import_rows` | import |
| `custom_fields`, `custom_values`, `report_metrics` | tuỳ chỉnh |
| `loyalty_tiers`, `reminders`, `message_templates` | loyalty |
| `daily_stats`, `daily_stats_dirty` | bảng đệm tổng hợp báo cáo + ô cần tính lại (trigger trên `orders`) |
| `cash_accounts`, `cash_entries` | quỹ tiền; chuyển quỹ và điều chỉnh kiểm đếm |
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
| Đăng nhập / Đăng ký / Thiết lập lần đầu | đăng ký tài khoản; tạo shop (chọn ngành) → popup tạo kho → tạo sản phẩm đầu tiên |
| Tổng quan | doanh thu hôm nay/tháng, LN gộp, đơn chờ xử lý, cảnh báo sức khoẻ, hàng sắp hết, khách cần nhắc |
| Bán nhanh (POS) | tìm SKU, giỏ hàng, chọn khách (gõ SĐT), giảm giá, thu tiền, "Bán ngay" |
| Đơn hàng | danh sách lọc theo trạng thái/kênh/ngày; chi tiết đơn; đổi trạng thái; thanh toán; trả hàng; in phiếu; nhập từ file; xuất file (CSV/Excel) |
| Import đơn | chọn file → chọn mẫu map cột → xem thử → xác nhận → kết quả |
| Sản phẩm | danh sách theo shop, chi tiết sản phẩm + biến thể, niêm yết theo shop, đồng bộ sang shop khác |
| Kho | tồn theo kho, lịch sử biến động, kiểm kê, chuyển kho |
| Nhập hàng | phiếu nhập, nhà cung cấp, công nợ NCC |
| Khách hàng | danh sách theo shop (lọc nhãn, mệnh, cột riêng), thêm khách vào shop, hồ sơ (đơn, mệnh, hạng, nhãn, thông tin riêng, ghi chú), xoá khỏi shop, gộp trùng, xuất file |
| Loyalty & Campaign | hôm nay nên liên hệ (nhắc mua lại, sinh nhật), gợi ý theo mệnh, hạng khách, mẫu tin nhắn, tự động hoá (chưa có) |
| Chi phí & đối soát | tab Chi phí (danh sách, thêm nhanh, chọn phương thức trả), Quỹ tiền (số dư, chuyển quỹ, kiểm đếm, sổ quỹ), Đối soát Shopee |
| Báo cáo | các tab: Doanh thu, Lợi nhuận (kèm ước tính thuế), Chi phí, Kênh, Sản phẩm (lọc danh mục), Khách, Kho, Tiền & công nợ (số dư quỹ, dòng tiền, tuổi nợ), Chỉ số tuỳ chỉnh, Sức khoẻ; xuất Excel từng tab |
| Cách đọc số liệu | 5 câu hỏi sức khoẻ kinh doanh có màu và việc nên làm, màu nghĩa là gì, từ điển các con số |
| Cài đặt | shop, kho, kênh, ngưỡng sức khoẻ và cách chia chi phí chung, trường tuỳ chỉnh, thuế ước tính, API key, webhook, sao lưu, mật khẩu |

### Phong cách
- Nhận diện, bảng màu và quy tắc dùng màu: xem mục 7A. Token màu nằm ở `brand/tokens.css`.
- Số tiền căn phải, định dạng `1.250.000 ₫`.
- Trang giao diện không dùng ngôi "cậu/tớ" (app nhiều tài khoản): dùng câu mệnh lệnh trung tính hoặc "bạn".
- Màu trạng thái đơn là ngoại lệ chức năng (nháp xám, xác nhận xanh dương, đang giao tím, hoàn thành xanh lá, huỷ đỏ, trả hàng cam), đã giảm bão hoà trong `tokens.css` để hợp tông.
- Nút bấm cao ≥ 44px trên điện thoại.

---

## 7A. Thương hiệu & nhận diện

Tên: **Mở Sổ**. Nghĩa đen là mở cuốn sổ ra để ghi và xem. Hợp với bản chất app: một cuốn sổ cái duy nhất cho mọi shop, mọi kênh.

### Concept: Đương đại Á Đông · Dấu vết thời gian (The Traces of Time)
Kết hợp sự tiết chế của thiết kế đương đại với cảm giác vật liệu, thủ công và không gian Á Đông. Phẳng, tĩnh, chắc: không đổ bóng, không kính mờ, không hiệu ứng nổi.

Dấu vết thời gian: mỗi đơn, mỗi lần nhập kho là một nét ghi lại. Giao diện gợi giấy dó, gỗ, gốm, dấu triện.

**Phong thuỷ là dữ liệu và bố cục, không phải đồ trang trí** (cập nhật 2026-11-03, xem nhật ký quyết định). Các yếu tố được dùng:
1. **Ngũ hành** là hệ ký hiệu có nghĩa: mệnh khách, hành của sản phẩm, doanh thu theo hành. Ký hiệu = chữ Hán (金 木 水 火 土) trong khung tròn + tên Việt. Màu ngũ hành là ngoại lệ chức năng như màu trạng thái đơn (đã giảm bão hoà, ≥ 4.5:1 trên nền giấy). Chữ Hán chỉ dùng cho 5 ký tự này (font con nhúng sẵn `web/src/fonts/han-*.woff2`, Noto Serif SC, OFL).
2. **Âm lịch + can chi** hiển thị ở thanh trên (tính bằng cùng thuật toán với server).
3. **Họa tiết nét mảnh** (chỉ nét, màu Champagne/Terracotta, không tô đặc, tối đa vài điểm nhấn mỗi màn hình): la bàn bát quái (thẻ hero, trang đăng nhập), trống đồng Đông Sơn (dành cho trạng thái trống/trang trí khác), lôi văn (đường diềm dưới tiêu đề trang và đáy thẻ hero).
4. **Chất liệu dạng hoạ tiết phẳng**: vân giấy dó mờ trên nền trang, vân gỗ trên các mảng Walnut. Không dùng ảnh/texture thật, không đổ khối.
5. **Dấu triện** vuông (logo trên trang đăng nhập) và dấu "ĐÃ CHỐT" trên đơn đã thu đủ.
6. **Bố cục**: ưu tiên lệch (7:5) và khoảng trống hơn lưới đều; nhãn chữ dọc ở thẻ hero.

Vẫn **không dùng**: rồng, tiền xu, hoa văn mây/sóng, bát quái hay la bàn làm hình nền phủ kín, màu đỏ/vàng kim rực. Muốn dùng thì ghi lý do vào nhật ký quyết định trước. Quán trà hay tiệm vàng mã là điều cần tránh.

### Giao diện theo ngành bán (cập nhật 2026-11-03)
Phần phong thuỷ ở trên **chỉ áp dụng cho shop ngành phong thuỷ** (`html[data-theme=phongthuy]`). Mỗi ngành có theme riêng, đặt theo shop đang làm việc:

| Theme | Dùng cho | Bảng màu | Họa tiết |
|---|---|---|---|
| `general` | Bán lẻ chung, "Tất cả shop", màn đăng nhập | Bảng màu thương hiệu bên dưới | Kẻ dòng sổ cái, đường kẻ đôi dưới tiêu đề. Không họa tiết khác |
| `phongthuy` | Ngành phong thuỷ | Bảng màu thương hiệu | La bàn bát quái, lôi văn, vân giấy dó/gỗ, ngũ hành, âm lịch |
| `nuochoa` | Ngành nước hoa | Biến thể: mận `#2B2029`, nền hồng phấn `#F8F2F0`, đỏ tía `#7A2E4A`, hồng đồng `#C08A76` (chữ/nền 14.1:1, đỏ tía/nền 8.2:1) | Vòng lan toả (hương toả ra), ba hình thoi "tầng hương" dưới tiêu đề. Không họa tiết phong thuỷ |
| `oto` | Ngành nước hoa ô tô | Biến thể: xám than `#1B2226`, nền `#F0F2F1`, cam cháy `#9C3D1A`, hổ phách `#D49A3A` (như đèn đồng hồ taplô; chữ/nền 14.3:1, cam cháy/nền 6.0:1, terracotta `#946020`/nền 4.7:1) | Mặt đồng hồ tốc độ, vạch kẻ đường đứt nét dưới tiêu đề. Không họa tiết phong thuỷ |

Bảng màu thương hiệu bên dưới là gốc: logo, `general`, `phongthuy`. Theme ngành khác (`nuochoa`, `oto`) đổi các biến màu trong `web/src/styles.css` theo `[data-theme]`; mọi thành phần chỉ dùng biến, không viết cứng màu. Giữ nguyên quy tắc phẳng và tiết chế cho mọi theme.

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
- `logo-lockup.svg`: biểu tượng + chữ "Mở Sổ" (serif, Walnut) + dòng "HÀNH TRÌNH PHƯƠNG ĐÔNG" (Terracotta). Chữ đã chuyển thành đường nét (font Noto Serif SemiBold, giấy phép SIL OFL) nên hiển thị giống nhau trên mọi máy, không phụ thuộc font cài sẵn. Muốn đổi chữ thì phải tạo lại outline, không sửa trực tiếp.
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
npm test             # test API (node:test)
npm run test:web     # test giao diện (vitest + Testing Library)
npm run test:e2e     # smoke test trình duyệt thật (cần npm run build và Playwright)
npm run test:all     # cả ba
node scripts/seed.js # tạo dữ liệu mẫu (2 shop, 1 kho, vài sản phẩm)
```

Biến môi trường (`.env`, không bắt buộc): `PORT=3000`, `HOST=0.0.0.0`, `DATA_DIR=./data`, `TZ_BUSINESS=Asia/Ho_Chi_Minh`, `REGISTRATION=open|closed`, `REGISTER_LIMIT=20`.

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
| 2026-11-03 | Báo cáo query thẳng bảng `orders`, chưa làm `daily_stats` | Quy mô 1 chủ shop, có index `(shop_id, business_date)`. Giữ một bảng tổng hợp đồng bộ qua mọi điểm sửa đơn (tạo, sửa, trạng thái, trả hàng, import) dễ lệch số, mà nguyên tắc 1 là số phải đúng. Làm khi đo thấy chậm. |
| 2026-11-03 | Hoàn trả tính vào ngày của đơn gốc | Doanh thu thuần của một ngày không đổi ngược khi có hoàn sau đó; nhất quán với `net_revenue` trên đơn. Cần báo cáo theo ngày trả hàng thì thêm sau. |
| 2026-11-03 | Quản lý API key, webhook, sao lưu chỉ cho người đăng nhập, không cho API key | Một key chỉ đọc không được tự tạo key có quyền ghi hay tải cả DB (có mật khẩu băm). |
| 2026-11-03 | Công thức: tự viết bộ phân tích, không `eval`; giá trị thiếu → null, chia 0 → null | Mục 5.11 yêu cầu biểu thức an toàn. Thiếu dữ liệu mà coi là 0 sẽ ra con số trông hợp lý nhưng sai. |
| 2026-11-03 | Nhắc mua lại: ngày hết = ngày mua gần nhất + chu kỳ × số lượng lần mua đó | Mua 3 chai nước hoa thì không hết sau 1 chu kỳ. Trạng thái xử lý gắn với ngày mua nên khách mua lại thì nhắc cũ tự hết. |
| 2026-11-03 | Nền trang web sáng hơn Linen gốc nửa tông (`#F2EADC`), thẻ giấy `#FAF6EC`; Linen `#EDE3D2` vẫn là màu thương hiệu | Nền Linen nguyên bản thấy chói mắt khi nhìn lâu trên màn hình. Chỉ đổi lớp nền của giao diện web (`web/src/styles.css`), không đổi `brand/tokens.css`, logo hay chữ trên nền tối. Walnut/nền vẫn ≥ 12:1. |
| 2026-11-04 | Theme `phongthuy` đặt nền sáng hơn một tông nữa: `--bg` `#F6F0E4`, `--paper` `#FCF9F3` (chỉ trong `[data-theme=phongthuy]`); thanh bên chỉ mở rộng khi `:has(:focus-visible)` thay vì `:focus-within` | Nền phong thuỷ vẫn thấy tối so với các ngành khác. Tương phản trên `--bg`: Walnut 13.9:1, Terracotta 5.1:1, Oxblood 8.2:1 (trên `--paper`: 15.0, 5.5, 8.9). Click chuột làm thanh bên kẹt mở vì `:focus-within`; focus-visible chỉ bật khi dùng bàn phím. Hover tách luật riêng để trình duyệt thiếu `:has` không mất hiệu ứng. |
| 2026-11-03 | Giao diện phẳng: không đổ bóng, không làm mờ kính, không hạt giấy, không dịch chuyển nổi; thanh bên và thanh tab dính sát mép | Concept phong thuỷ cần tĩnh và chắc, không "3D bay bổng". Phân tầng bằng viền champagne mảnh và nền giấy sáng/tối thay cho bóng. Biểu đồ dùng màu đặc có độ trong, không dải màu chuyển. |
| 2026-11-03 | Cho phép phong thuỷ rõ hơn trong giao diện: ngũ hành (chữ Hán + màu), âm lịch, la bàn bát quái, trống đồng, lôi văn, vân giấy dó/gỗ dạng phẳng, dấu triện. Sửa mục 7A | Chủ shop thấy bản đầu "chưa phong thuỷ". Ngũ hành/âm lịch là dữ liệu thật của app (mệnh khách, hành sản phẩm) nên đưa lên thành ngôn ngữ thiết kế thay vì trang trí. Họa tiết giữ nét mảnh và tiết chế để không ra kiểu quán trà. Rồng, tiền xu, mây/sóng vẫn không dùng. |
| 2026-11-03 | Doanh thu theo ngũ hành chia đều cho các hành của sản phẩm hợp nhiều hành | Tránh đếm trùng: tổng 5 hành + "chưa gán" luôn bằng doanh thu hàng. Có test. |
| 2026-11-03 | Thêm **ngành bán** cho shop; mỗi ngành có theme giao diện, tính năng và trường khách riêng. Mệnh/ngày sinh chuyển từ cột chung của khách sang **trường tuỳ chỉnh của từng shop** | Mệnh chỉ hợp với shop phong thuỷ; shop nước hoa không cần và giao diện phong thuỷ cũng không hợp. Chủ shop muốn trường khách tồn tại riêng theo shop, kể cả cùng một khách. Giá trị gắn vào trường (mà trường thuộc shop) nên tách theo shop tự nhiên, không cần cột shop trên giá trị. Cột cũ trên `customers` giữ lại (không xoá dữ liệu), chỉ dùng để chép sang khi bật ngành phong thuỷ. |
| 2026-11-03 | Gợi ý theo mệnh chỉ trong phạm vi một shop phong thuỷ (sản phẩm niêm yết ở shop đó); không còn bán chéo từ shop khác | Mệnh là thông tin riêng của shop nên shop khác không biết mệnh để gợi ý. Cần bán chéo thì chủ shop nhập mệnh ở shop phong thuỷ. |
| 2026-11-03 | Theme `nuochoa` dùng bảng màu biến thể ngoài bảng thương hiệu | Chủ shop muốn mỗi ngành một giao diện khác hẳn. Biến thể vẫn qua kiểm tra tương phản; logo và theme gốc không đổi. |
| 2026-11-03 | Combo không có tồn riêng, tồn khả dụng tính từ thành phần; chụp thành phần + giá vốn lúc bán | Tồn riêng của combo sẽ lệch khi bán lẻ thành phần. Ảnh chụp giúp huỷ/trả hàng hoàn đúng cả khi công thức combo đổi hay giá vốn thành phần đổi. |
| 2026-11-03 | Kiểm kê: chênh lệch tính theo tồn hệ thống tại lúc nhập số đếm từng dòng, không phải lúc tạo phiếu | Đếm cả kho mất nhiều giờ, trong lúc đó vẫn bán hàng. Tính theo tồn lúc tạo phiếu sẽ ghi đè mất các đơn bán sau đó. Giả định: người đếm nhập số ngay sau khi đếm. |
| 2026-11-03 | Giao diện có 3 lớp test: vitest (hàm thuần, component), test API, smoke e2e bằng trình duyệt thật (tự bỏ qua nếu thiếu Playwright/dist) | Lớp e2e bắt được lỗi mà hai lớp kia không thấy (trang sập khi chuyển sang "Tất cả shop" vì dữ liệu cũ + shop rỗng). |
| 2026-11-03 | Tối đa 4 cột trường khách ở danh sách khách mỗi shop | Nhiều hơn thì bảng vỡ trên máy tính và vô dụng trên điện thoại (cột ẩn ở màn nhỏ). |
| 2026-11-03 | Biến động kho của đơn import ghi theo ngày đặt trên sàn, và "lần xuất/nhập gần nhất" chỉ tiến, không lùi | Sổ cái kho theo ngày và tốc độ bán 30 ngày phải phản ánh lúc hàng thực sự đi, không phải lúc bấm import. Sổ cái vẫn sắp theo thứ tự ghi nên số dư từng dòng luôn đúng. |
| 2026-11-03 | Xuất đơn là endpoint riêng có bộ lọc chung với danh sách, không dùng bản sao thô của bảng | Bản sao thô có cột kỹ thuật (id, JSON) và không lọc được. File cho người dùng cần tiêu đề tiếng Việt, ngày giờ VN, lợi nhuận tính sẵn, và phải khớp đúng những gì đang thấy trên danh sách. Dùng chung `orderFilter` nên hai nơi không thể lệch nhau (có test đối chiếu). |
| 2026-11-03 | Mỗi tài khoản một file SQLite riêng + `master.db` chỉ giữ tài khoản/phiên/chỉ mục API key; `getDb()` ngoài ngữ cảnh tài khoản báo lỗi | Cách ly bằng file an toàn hơn thêm `account_id` vào mọi bảng (quên một `WHERE` là lộ dữ liệu người khác) và gần như không phải sửa code nghiệp vụ: toàn bộ test cũ chạy nguyên trên helper mới. Đổi lại: thống kê chéo tài khoản khó hơn (không cần). |
| 2026-11-03 | Tách hai ngành `nuoc_hoa_o_to` và `nuoc_hoa` | Bản đầu của "nước hoa" thực chất làm cho xe (dòng xe, mua cho xe nào). Nước hoa mặc cho người có nhu cầu khách khác hẳn (nồng độ, phong cách, dịp dùng, ngân sách). Shop cũ ngành `nuoc_hoa` được chuyển sang `nuoc_hoa_o_to` bằng migration 015 để giữ nguyên hành vi. |
| 2026-11-03 | Khách là thành viên của từng shop (`customer_shops`); xoá khách = xoá khỏi một shop | Chủ shop muốn dọn khách tạo nhầm mà không ảnh hưởng shop kia dù cùng một người. Hồ sơ vẫn chung (để đơn, SĐT, gộp trùng đúng), phần riêng của shop mới là thứ bị xoá. Xoá cứng hồ sơ bị loại: đơn cũ vẫn trỏ về khách. |
| 2026-11-03 | Nhãn khách là của từng shop (`customer_tags`), bỏ cột `customers.tags` chung | Cùng nguyên tắc với thông tin riêng theo shop: nhãn "VIP" ở shop này không có nghĩa ở shop kia. |
| 2026-11-03 | Gộp Chăm sóc + Gợi ý theo mệnh + Hạng khách + Mẫu tin nhắn thành module "Loyalty & Campaign" | Các việc này cùng một mục đích (giữ chân khách, bán thêm) và sắp có thêm tự động hoá (nhắn tin, nâng hạng). Một chỗ thì dễ thêm hơn rải rác ở Cài đặt/hồ sơ khách. Tab "Tự động hoá" nói thẳng là chưa có gì chạy để không ai tưởng đã bật. |
| 2026-11-03 | Terracotta của theme `oto` đậm hơn (`#946020`) | Bản đầu `#A2692C` chỉ 4.1:1 trên nền, dưới AA cho chữ nhỏ. |
| 2026-11-03 | Làm `daily_stats` bằng trigger + đánh dấu ô bẩn + tính lại khi đọc (thay quyết định "chưa làm" trước đó) | Lý do cũ: đồng bộ qua mọi điểm sửa đơn dễ lệch. Trigger trên `orders` bắt mọi đường thay đổi (kể cả SQL trực tiếp) nên không thể quên; ô được tính lại bằng chính câu SQL tổng hợp từ bảng gốc nên không có hai bản logic. Có `verifyStats`, script `check-stats` và test chạy qua mọi loại thao tác. |
| 2026-11-03 | Ước tính thuế do người dùng tự nhập, mặc định tắt, app không đặt sẵn mức nào | Tra cứu thấy nguồn mâu thuẫn (ngưỡng không chịu thuế 500 triệu hay 1 tỷ, tỷ lệ TNCN theo ngành không rõ). Số thuế sai trông vẫn hợp lý nên tệ hơn không có. Cơ chế đủ linh hoạt (tỷ lệ, cơ sở, ngưỡng năm) để nhập đúng quy định hiện hành. |
| 2026-11-03 | Số dư quỹ luôn tính từ sổ, không lưu; kiểm đếm ghi dòng điều chỉnh | Số lưu sẽ lệch với thu chi. Dòng điều chỉnh làm chênh lệch nhìn thấy được thay vì sửa lặng lẽ thu chi cũ. |
| 2026-11-03 | Chi phí là tiền ra theo phương thức trả; mỗi phương thức thuộc đúng một quỹ | Dòng tiền thiếu chi phí khiến tiền ròng cao hơn thực tế. Một phương thức một quỹ để mỗi đồng chỉ nằm ở một nơi. |
| 2026-11-03 | Lọc danh mục chỉ áp dụng cho báo cáo sản phẩm và ngũ hành | Doanh thu, phí ship, phí sàn, chi phí thuộc cả đơn chứ không thuộc từng dòng; chia theo danh mục phải bịa tỷ lệ. |
| 2026-11-03 | Route PATCH dùng `patchOf`; huỷ phiếu nhập đã trả tiền phải kèm NCC hoàn tiền | `.partial()` của zod 4 áp `.default()` làm sửa đơn nháp xoá phí ship/phí sàn/giảm giá và sửa đơn đã chốt luôn bị 409. Huỷ phiếu nhập đã trả để tiền đã chi nằm đó không hàng, không công nợ. |
| 2026-11-03 | Trang "Cách đọc số liệu" chỉ dùng ngưỡng người dùng đã đặt và quy tắc tự nhiên | Chủ shop nhìn nhiều chỉ số không biết xem gì. Ngưỡng bịa thêm sẽ gây báo động giả; quỹ âm hoặc đang lỗ thì đúng với mọi shop. |
| 2026-11-04 | Đổi slogan "Dấu vết của thời gian" → **"Hành Trình Phương Đông"** (thanh bên, trang đăng nhập, `logo-lockup.svg`) | Slogan mới nói hành trình làm ăn trên mảnh đất phương đông. Tên concept thiết kế "Dấu vết thời gian" (mục 7A) giữ nguyên vì là ngôn ngữ thiết kế, không phải slogan. Chữ trong lockup tạo lại outline bằng Noto Serif SemiBold. |
