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
- Kê khai thuế và sổ sách nộp cơ quan thuế theo Thông tư 152/2025 (sổ kế toán nội bộ có từ mục 5.16, nhưng chưa phải sổ theo mẫu của Thông tư). Cần phần mềm kế toán riêng thì đồng bộ qua API/webhook.
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
| Thành phần tương tác | shadcn/ui (Radix + Tailwind v4), chỉ Dialog và Popover | Khoá focus, trả focus, khoá cuộn nền, aria, định vị bám nút: phần khó làm tay mà dễ sai. Cấu hình ở `web/components.json`, `web/src/shadcn.css`; thêm thành phần bằng `npx shadcn add`. Giao diện còn lại vẫn là CSS thuần theo token. |

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
└─ data/                ← master.db, accounts/<id>.db, uploads/<id>/ (ảnh), backups/<id>/ (gitignore)
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
- **Kho** = nơi để hàng thật. Tách khỏi shop. Một shop có **danh sách kho xếp theo ưu tiên** (`shop_warehouses`, API `GET/PUT /shops/:id/warehouses`): đơn lấy hàng từ kho ưu tiên 1, thiếu thì lấy tiếp kho kế tiếp. Kho đầu là **kho chính**; `shops.default_warehouse_id` luôn bằng kho đó (service giữ đồng bộ). Một kho phục vụ được nhiều shop.
- **Kênh** (`channel`): `direct`, `other` (luôn có), kênh của các **nền tảng** (`shopee`, `tiktok`, `facebook`, `zalo`, mục 5.15) và kênh tuỳ chỉnh (`ch_…`, tạo ở Cài đặt → Nền tảng bán hàng). Mỗi đơn thuộc 1 shop và 1 kênh. Kênh bị tắt (`archived_at`) ẩn khỏi bộ chọn tạo đơn và không tạo đơn mới được (`CHANNEL_DISABLED`), nhưng đơn cũ vẫn xem và lọc được. Kênh sàn (`is_marketplace = 1`) quyết định cách tính số tiền cần thu (xem 5.6).

### 5.1A Thiết lập lần đầu của tài khoản mới
Đăng ký xong, tài khoản chưa có shop nên không có gì để làm. Giao diện dẫn qua 3 bước, mỗi bước chỉ hỏi những gì cần:
1. **Tạo shop**: tên, mã (gợi ý từ tên), **ngành bán** (4 thẻ chọn, mục 5.14), điện thoại, địa chỉ.
2. **Tạo kho đầu tiên** (popup hướng dẫn): tên, mã. Kho này thành kho mặc định của shop.
3. **Tạo sản phẩm đầu tiên**: tên, SKU, giá bán, giá vốn (tuỳ chọn). Có thể bỏ qua.
Sau đó vào Tổng quan; nếu còn thiếu kho/sản phẩm ở shop đầu tiên, trang chủ nhắc tiếp (có thể ẩn). Các shop về sau thêm ở Cài đặt → Shop & kho.

### 5.2 Sản phẩm
- **Sản phẩm gốc** (`products`) sống ở cấp toàn hệ thống: tên, mô tả, ảnh, danh mục, thương hiệu, đơn vị, chu kỳ dùng hết (ngày). Ngũ hành hợp **không còn là cột**: là trường sản phẩm riêng của shop thuộc ngành phong thuỷ (mục 5.14); cột `products.elements` cũ giữ lại nhưng không ghi nữa.
- **Biến thể / SKU** (`variants`): mỗi sản phẩm ≥ 1 biến thể (mùi, size, màu…). Tồn kho và giá tính theo biến thể. Sản phẩm đơn giản có 1 biến thể mặc định.
- **Biến thể dạng ma trận**: `products.options` (JSON, tối đa 3 thuộc tính, mỗi thuộc tính nhiều giá trị) và `variants.option_values` (giá trị của biến thể). Form sinh bảng tổ hợp, mỗi dòng có SKU tự sinh (`MAGOC-CAM-10ML`, sửa được), giá bán, giá vốn, tồn đầu kỳ, mã vạch, ảnh, công tắc bán. Tên biến thể tự đặt = các giá trị nối bằng " / ". Server báo SKU trùng kèm số thứ tự dòng (`details.index`). **Tồn đầu kỳ** ghi bằng `applyMovement('opening')` trong cùng transaction với việc tạo sản phẩm (kho chọn trên form, mặc định kho của shop niêm yết đầu tiên; thiếu kho → `WAREHOUSE_REQUIRED`, không tạo gì). Sửa: thêm giá trị sinh dòng mới (tự niêm yết ở các shop của sản phẩm); bỏ giá trị gửi `{id, remove:true}`: biến thể đã có lịch sử kho/đơn/nhập/kiểm kê thì **lưu trữ**, chưa từng dùng thì xoá hẳn (quy ước 6: dữ liệu nháp). **Chuyển đổi sau khi đã tạo**: sản phẩm một biến thể (hoặc cũ nhiều biến thể không thuộc tính) tick "Có biến thể" thì mỗi biến thể đã có chọn một tổ hợp ("Biến thể hiện có là…", mặc định tổ hợp đầu còn trống), giữ nguyên id, SKU, tồn, giá, lịch sử; chỉ thêm `option_values` và tên tự đặt (tên đặt tay giữ nguyên). Sản phẩm đã có thuộc tính được thêm thuộc tính mới (biến thể cũ nhận giá trị đầu, đổi được), đổi tên thuộc tính/giá trị (`option_renames`: server đổi nhãn cho MỌI biến thể kể cả đã lưu trữ, giữ id) và xoá thuộc tính. Server kiểm trong một transaction rằng ánh xạ biến thể → tổ hợp là 1-1: thiếu giá trị → `OPTION_INCOMPLETE` (400), hai biến thể đang bán trùng tổ hợp (vd xoá thuộc tính làm hai biến thể giống nhau) → `OPTIONS_CONFLICT` (409), không đổi gì.
- **Ảnh sản phẩm** (`product_images`, `variants.image_id`): trình duyệt thu nhỏ (WebP, cạnh dài 1200px, q0.82) rồi `POST /uploads/images` (thân thô, ≤ 3 MB, **kiểm magic bytes** webp/jpeg/png, không tin Content-Type), lưu `data/uploads/<accountId>/<img_id>.<ext>`. `GET /files/images/:id` cần đăng nhập và tra trong DB của tài khoản đang đăng nhập nên ảnh của tài khoản khác là 404; `Cache-Control: private, max-age=31536000, immutable`. `PUT /products/:id/images` đặt thứ tự (`[{id, variant_id?}]`); ảnh đầu được chép vào `products.image_url`; ảnh bị gỡ chỉ đánh dấu `archived_at`, file vẫn giữ. Sao lưu hằng ngày chép thêm ảnh mới sang `data/backups/<id>/uploads/` (nút "Tải bản sao lưu" vẫn chỉ là file DB). Ảnh tải lên nhưng chưa gắn sản phẩm nào (`product_id` NULL) chưa có việc dọn.
- **Danh mục** (`categories`, cây): lọc theo danh mục luôn **gồm con cháu** (`server/lib/categories.js`, dùng cho sản phẩm, `/variants`, `/stock`, báo cáo). Đổi cha tạo vòng → `CATEGORY_CYCLE`. Lưu trữ danh mục còn sản phẩm → `CATEGORY_IN_USE` (hoặc kèm `move_products_to` để chuyển sang danh mục khác); còn danh mục con → `CATEGORY_HAS_CHILDREN`. Trang Sản phẩm có tab "Danh mục" (thêm, đổi tên, chọn cha, sắp thứ tự, lưu trữ, số sản phẩm).
- **Combo** có nút "+ Combo" và form riêng (tên, ảnh, SKU, giá, danh mục, shop, thành phần × số lượng, giá vốn ước tính, số bán được); form sản phẩm thường không còn ô "Loại". Danh sách lọc theo loại Sản phẩm/Combo và danh mục.
- **Giá theo kênh** (`channel_prices`, migration 039, `PUT/GET /channel-prices`): giá riêng của biến thể theo shop × kênh; thứ tự giá khi tạo đơn: giá nhập tay → giá kênh → giá niêm yết shop → giá mặc định. `/variants?channel_id=` trả giá theo kênh (`price_source`). Form đơn tự lấy lại giá các dòng khi đổi kênh.
- **Niêm yết theo shop** (`shop_listings`): biến thể được bán ở shop nào, giá bán riêng của shop, trạng thái đang bán/ngừng.
- **Đồng bộ sản phẩm giữa shop** = tạo niêm yết ở shop đích từ niêm yết của shop nguồn (chọn từng sản phẩm hoặc toàn bộ). Thông tin sản phẩm dùng chung (vì là sản phẩm gốc), giá được chép sang rồi chỉnh riêng. Tuỳ chọn: ghi đè giá nếu đã tồn tại.
- **Combo**: biến thể `kind = 'bundle'` gồm các biến thể đơn (không lồng combo) kèm số lượng mỗi combo (`bundle_components`). Combo **không có tồn riêng**: số bán được = min theo thành phần (tồn / SL mỗi combo); nhập hàng, điều chỉnh, chuyển kho, kiểm kê chỉ làm trên thành phần (chặn `BUNDLE_NO_STOCK`). Bán combo trừ kho từng thành phần; giá vốn dòng = Σ SL × giá vốn thành phần lúc bán; ảnh chụp thành phần + giá vốn lưu ở `order_line_components` để huỷ đơn/trả hàng hoàn đúng kể cả khi công thức combo đổi sau. Biến thể đã có lịch sử kho/đơn không đổi loại được (`KIND_LOCKED`).

**Gỡ sản phẩm** (`GET /products/:id/removal-impact`, `POST /products/:id/remove {confirm, write_off}`, `POST /products/:id/restore`; giao diện: form sửa → "Xoá sản phẩm…", tab "Đã ngừng kinh doanh"): tham khảo Odoo và DealPOS (còn bản ghi tham chiếu thì không xoá, chỉ lưu trữ) cộng quy ước 6. Chưa từng có biến động kho/đơn/phiếu nhập/kiểm kê/làm thành phần combo thì **xoá hẳn** (SKU giải phóng, ảnh trả về trạng thái chưa gắn để job dọn); ngược lại **ngừng kinh doanh**: `products.archived_at` + `variants.archived_at` cùng một mốc, tắt niêm yết; khôi phục mở lại đúng các biến thể có cùng mốc và bật lại niêm yết. Chặn (`REMOVE_BLOCKED`): còn là thành phần combo đang bán, vật tư của định mức đóng gói khác, nằm trong đơn nháp/phiếu nhập nháp/kiểm kê nháp, hoặc âm kho. Còn hàng trong kho thì cần `write_off: true` (`PRODUCT_HAS_STOCK`): lập phiếu hàng hỏng (`damage_out`, ghi 811) theo từng kho; không để hàng mồ côi ở sản phẩm đã ẩn. `PATCH /products/:id {archived}` bị từ chối (`USE_REMOVE`/`USE_RESTORE`) để không ai lách các kiểm tra trên. `GET /products?archived=only` chỉ trả sản phẩm đã ngừng.

### 5.3 Tồn kho & giá vốn
- `stock_levels(warehouse, variant)`: `on_hand` (đang có), `reserved` (đã giữ cho đơn chưa giao — giai đoạn sau), `avg_cost` (giá vốn bình quân).
- **Phương pháp giá vốn (cài đặt `costing_method`, migration 034)**: mặc định **bình quân gia quyền di động theo kho**; chọn được **FIFO**. Không có LIFO: kế toán Việt Nam (Thông tư 200) dùng đích danh, bình quân gia quyền, nhập trước xuất trước, không dùng LIFO. Chi tiết FIFO ở cuối mục này.
- **Bình quân gia quyền:** Khi nhập hàng: `avg_mới = (on_hand*avg_cũ + sl_nhập*giá_nhập_đã_phân_bổ) / (on_hand + sl_nhập)`. Khi bán: ghi giá vốn = avg tại thời điểm xuất vào dòng đơn (`unit_cost`) — **chụp lại, không tính lại về sau**.
- **Chi phí nhập phân bổ vào giá vốn**: phí ship nhập, phí khác trên phiếu nhập được chia theo tỷ lệ giá trị dòng.
- **Loại biến động** (`stock_movements.type`): `purchase_in`, `sale_out`, `sale_return_in`, `adjust_in`, `adjust_out`, `transfer_out`, `transfer_in`, `opening` (tồn đầu kỳ), `damage_out`.
- Không cho tồn âm theo mặc định (cấu hình `allow_negative_stock` trong settings, mặc định `false`). Đơn import từ kênh có thể vượt tồn → được phép nhưng gắn cờ cảnh báo.
- **Kiểm kho**: phiếu kiểm kê nhiều bước (`stock_counts`): tạo phiếu (chụp tồn) → nhập số đếm dần, lưu giữa chừng → hoàn tất sinh `adjust_in/out` theo chênh lệch. Chênh lệch tính theo tồn hệ thống **tại lúc nhập số đếm của từng dòng**, nên hàng bán trước hoặc sau lúc đếm không làm sai. Dòng chưa đếm: bỏ qua (mặc định) hoặc coi là 0. Thiếu giá vốn cho hàng nhập lần đầu thì cả phiếu không áp. Phiếu đã chốt không sửa.
- **Lô và hạn dùng** (migration 041, `stock_lots`, sổ phụ của sổ kho): dòng phiếu nhập có `lot_no`, `expiry_date` tạo lô khi nhận hàng. Mọi lần xuất (bán, chuyển, hao hụt, huỷ phiếu nhập) lấy lô hết hạn sớm nhất trước (FEFO), lô không ghi hạn sau cùng; phần hàng không thuộc lô nào (tồn đầu kỳ, nhập không ghi lô) bỏ qua. Chuyển kho mang lô sang kho đến. `GET /stock-lots`, `/stock-lots/summary` (hết hạn, sắp hết hạn trong `expiry_warn_days`, mặc định 30). Hàng trả/huỷ đơn nhập lại không vào lô cũ. `npm run check-stock` kiểm Σ lô ≤ tồn.
- **Chuyển kho**: `transfer_out` + `transfer_in` với cùng giá vốn.
- **Một đơn lấy từ nhiều kho**: khi xác nhận, `planAllocation` (`server/modules/orders/allocation.js`) chia từng biến thể có tồn (combo tách thành thành phần × SL) theo thứ tự kho của shop; tồn được trừ ảo dần qua các dòng. Hết tồn mọi kho thì phần còn lại dồn vào kho ưu tiên 1 và đánh dấu thiếu: bị chặn `STOCK_NOT_ENOUGH` trừ khi cho phép âm kho (đơn import). Mỗi phần ghi một `sale_out` riêng và một dòng `order_line_allocations` (kho, SL, `unit_cost` = giá bình quân của **chính kho đó** lúc xuất, chụp lại, không tính lại). Phân bổ tay (`lines[].allocations`, lưu ở `order_lines.planned_allocations` cho đơn nháp): tổng từng biến thể phải bằng SL cần (`ALLOCATION_MISMATCH`), kho ngoài danh sách của shop chỉ bị cảnh báo. `POST /orders/allocation-preview` xem trước, không ghi.

- **FIFO** (`server/modules/inventory/costing.js`, `PUT /costing-method {method}`, giao diện Cài đặt → Ngưỡng & kho): mỗi lần nhập tạo một lớp giá `stock_layers` (kho × biến thể, SL còn lại, đơn giá nguyên, thời điểm nhập). Xuất lấy lớp cũ nhất trước; xuất qua nhiều lớp thì `applyMovement` ghi **một biến động kho và một phân bổ đơn cho mỗi lớp** (đơn giá nguyên từng phần, nên `cogs_amount = Σ SL × đơn giá` vẫn đúng từng đồng, giá trị chốt kho vẫn là Σ SL × `unit_cost` của biến động). Kết quả trả về thêm `slices`. Nhập lại kho (huỷ đơn, trả hàng) tạo lớp mới ở đúng giá đã chụp. Huỷ phiếu nhập rút lớp của chính phiếu đó trước. Chuyển kho chuyển từng phần kèm tuổi lớp (`layerAt`). Hàng vào lúc đang âm kho: phần bù chỗ âm không tạo lớp. Xuất vượt các lớp (âm kho) tạm tính theo `avg_cost` gần nhất. `stock_levels.avg_cost` vẫn được giữ = bình quân các lớp còn lại để các báo cáo cũ dùng chung. Đổi phương pháp chỉ qua `PUT /costing-method` (PATCH /settings bị chặn), có nhật ký: bình quân → FIFO biến mỗi dòng tồn thành một lớp ở giá bình quân; FIFO → bình quân bỏ lớp. Giá trị tồn không đổi, giá vốn đã chụp trên đơn cũ không đổi. `npm run check-stock` thêm kiểm Σ lớp = max(tồn, 0). Lưu ý: tài khoản 156 và "giá trị tồn" ở báo cáo dùng tồn × `avg_cost` đã làm tròn nên có thể lệch vài đồng so với tổng lớp giá thật.

### 5.3A Chốt kỳ kho và đóng kho (migration 032)
- **Chốt kho** = chọn ngày D (≤ hôm qua): `POST /stock-close {date, note}` đặt `settings.stock_lock_date`, chụp tồn từng kho × biến thể vào `stock_closes` / `stock_close_lines` (số lượng, giá trị = Σ SL × `unit_cost` các biến động có `business_date` ≤ D, kèm băm). `GET /stock-close/preview?date=` trả việc chặn (phiếu kiểm kê `draft`, ngày không hợp lệ) và cảnh báo (phiếu nhập nháp, đơn nháp, âm kho tại D, hàng trả sàn chờ về). Không chốt lùi: muốn lùi thì `POST /stock-close/reopen {date|null, reason}` (bắt buộc lý do, ghi `audit_log`, đánh dấu các lần chốt sau mốc mới là đã mở lại). `GET /stock-close` so sổ kho hiện tại với ảnh chụp để báo thay đổi trái phép sau chốt. `stock_lock_date` không đặt được qua `PATCH /settings`.
- **Chặn ghi lùi ngày**: `applyMovement` từ chối biến động có ngày ≤ ngày chốt (`STOCK_PERIOD_CLOSED`). Ngoại lệ: đơn bán (trừ kho, nhập lại khi huỷ/trả) truyền `clampIfClosed`: biến động được ghi vào ngày đầu của kỳ mở và ghi chú ngày gốc, vì đơn sàn import muộn là chuyện thật (cùng tinh thần khoá sổ kế toán). Nhập hàng, điều chỉnh, kiểm kê, chuyển kho, vật tư luôn ghi vào "bây giờ" nên không chạm kỳ đã chốt.
- **Đóng kho** (lưu trữ kho, `PATCH /warehouses/:id {archived}`): chỉ khi kho hết hàng (`WAREHOUSE_HAS_STOCK`), không còn phiếu kiểm kê nháp (`WAREHOUSE_HAS_OPEN_COUNT`) hay phiếu nhập nháp trỏ vào kho (`WAREHOUSE_HAS_DRAFT_PURCHASE`), ngoài các kiểm tra kho-shop có sẵn. `force` chỉ gỡ kho khỏi shop, không bỏ qua kiểm tra hàng.
- Chốt kho và khoá sổ kế toán là hai khoá độc lập (kho / tiền). Giao diện: Kho → tab "Chốt kho".
- **Gỡ kho** (`GET /warehouses/:id/impact`, `POST /warehouses/:id/remove {transfer_to?, confirm}`; giao diện Cài đặt → Shop & kho → bấm kho → "Gỡ kho…", bắt gõ tên kho): chặn khi còn kiểm kê nháp, phiếu nhập nháp, kho duy nhất của một shop, hoặc có dòng âm kho (`REMOVE_BLOCKED`). Còn hàng thì bắt buộc `transfer_to` (một phiếu chuyển kho giữ nguyên giá vốn, không bỏ hàng lại). Xoá kế hoạch chia kho (`planned_allocations`) của đơn nháp trỏ vào kho, gỡ kho khỏi mọi shop (kho chính cập nhật theo). Kho chưa từng có biến động/phiếu nhập/đơn/kiểm kê/điều chỉnh thì xoá hẳn (`mode: deleted`); kho đã có lịch sử chỉ đóng (`archived_at`, `mode: closed`) vì quy ước 6 cấm xoá cứng dữ liệu nghiệp vụ. Lưu trữ kho trực tiếp bằng PATCH vẫn có các kiểm tra cũ.

### 5.4 Nhập hàng (Purchase)
- **Nhà cung cấp** (`suppliers`).
- **Phiếu nhập** (`purchases`): trạng thái `draft → received → (cancelled)`. Chỉ khi `received` mới cộng kho. Huỷ phiếu đã nhận → sinh biến động ngược (nếu tồn đủ).
- Theo dõi công nợ nhà cung cấp: `total_amount`, `paid_amount` (thanh toán ghi ở `payments` với `direction=out`).
- **Ship nhập trả bên vận chuyển** (migration 031, `shipping_payee: 'carrier'`): phí ship vẫn chia vào giá vốn, nhưng `total_amount` (số nợ NCC) không gồm nó. Số ship nằm ở `carrier_amount`, phần đã trả ở `carrier_paid_amount`, trả bằng `POST /purchases/:id/carrier-payments` (payment `ref_type='purchase_carrier'`). Bút toán nhận hàng: Nợ 156 (hàng + ship) / Có 331 (hàng) / Có 3388 (ship); trả ship: Nợ 3388 / Có quỹ. Huỷ phiếu đã trả ship cần phương thức hoàn (`CARRIER_PAID`). Ship trả NCC (mặc định) giữ nguyên.

### 5.5 Khách hàng (hồ sơ dùng chung, danh sách theo từng shop)
- **Hồ sơ** khách (tên, SĐT, Facebook, địa chỉ) là **một cho một người** trong cả tài khoản; đơn của mọi shop gắn vào cùng hồ sơ đó. Nhưng **danh sách khách của mỗi shop là riêng**: khách là *thành viên* của shop nào thì mới hiện ở shop đó (`customer_shops`).
- **Thành viên shop** tự có khi: khách mua ở shop (tạo/sửa đơn), được tạo từ trang Khách hàng khi đang chọn shop, nhập thông tin riêng ở shop, hoặc bấm "Thêm vào shop". Xem tất cả shop thì thấy mọi hồ sơ.
- **Xoá khách = xoá khỏi một shop** (`DELETE /customers/:id?shop_id=`, bắt buộc có `shop_id`). Chỉ mất phần của shop đó: thông tin riêng, nhãn, ghi chú của shop. **Không đụng** hồ sơ chung, khách ở shop khác, lịch sử đơn. Khách mua lại ở shop đó thì tự quay về danh sách. Khách không còn ở shop nào *và* chưa có đơn nào thì hồ sơ được lưu trữ (ẩn, `archived_at`); tạo lại cùng SĐT thì dùng lại hồ sơ cũ thay vì báo trùng. Dữ liệu bị xoá ghi vào `audit_log` để khôi phục tay.
- **Nhãn khách** (`customer_tags`) là **của từng shop**: cùng một khách, shop A gắn "VIP" không làm shop B thấy. Chuẩn hoá khi lưu (bỏ khoảng trắng thừa, trùng không phân biệt hoa thường), tối đa 20 nhãn mỗi khách mỗi shop. Lọc theo nhãn cần `shop_id`. Cột `customers.tags` cũ không còn dùng.
- Nhận diện bằng **số điện thoại chuẩn hoá** (`0xxxxxxxxx`). Khách Facebook có thể chỉ có tên + link Facebook.
- **Gộp hồ sơ trùng**: chuyển toàn bộ đơn/ghi chú sang hồ sơ giữ lại, hồ sơ bị gộp đánh dấu `merged_into`. Thành viên shop và nhãn của hai hồ sơ được hợp lại.
- **Ngày sinh và năm sinh là thông tin chung** (cập nhật 2026-11-04): cột `customers.birth_date` (YYYY-MM-DD, không ở tương lai) và `customers.birth_year` (khi chưa biết ngày; có ngày thì năm suy ra từ ngày) nằm trên hồ sơ như tên, SĐT, địa chỉ. Nhập ở form khách (kể cả form thêm nhanh ở `CustomerPicker`), mọi shop đều thấy, gộp khách thì hồ sơ giữ lại thắng và thiếu thì lấy từ hồ sơ bị gộp. Tuổi (`age`) tính theo giờ VN từ ngày sinh, hoặc năm hiện tại trừ năm sinh. Nhắc sinh nhật đọc từ cột này (có `shop_id` thì chỉ khách còn là thành viên của shop đó). File xuất khách có Ngày sinh, Năm sinh, Tuổi ở cả hai kiểu (có hay không chọn shop). Migration 028 gom giá trị từ các trường ngày/năm sinh cũ của mọi shop (ưu tiên shop phong thuỷ rồi shop lập trước vì `custom_values` không có thời gian; ca lệch ghi `audit_log`, xem bằng `npm run check-birthdates`), ẩn các trường cũ (không xoá giá trị) và viết lại công thức tham chiếu chúng.
- **Thông tin riêng theo shop**: mọi thông tin khác (giới tính, mệnh ghi đè, mùi yêu thích, dòng xe…) là **trường tuỳ chỉnh của từng shop** (mục 5.11): trường của shop này không xuất hiện ở shop kia, kể cả cùng một khách. **Mệnh** (ngũ hành nạp âm theo năm âm lịch) chỉ có ở shop ngành phong thuỷ. Trường vai trò `element` là **giá trị ghi đè**; giá trị hiệu lực = ghi đè nếu có, nếu không thì tự tính từ ngày sinh (chính xác theo âm lịch) hoặc năm sinh (ước tính). Hồ sơ, cột ở danh sách, bộ lọc mệnh, file xuất và biến công thức `{menh}` đều dùng giá trị hiệu lực; giao diện ghi rõ “(tự tính)” hoặc “(ước tính theo năm)”. Chỗ tính nằm ở `derivedValue(role, record)` để thêm vai trò khác sau này. Cột `element_override`, `gender` cũ trên bảng `customers` không còn dùng; khi một shop bật ngành phong thuỷ, giá trị cũ được chép sang trường của shop cho những khách đã mua ở shop đó.
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
  - `cancelled` từ confirmed: **cộng lại kho**. Đơn `shipping` **không huỷ được qua API** (`CANCEL_SHIPPING`): hàng đang ở đơn vị vận chuyển nên cộng tồn ngay là sai. Giao không thành xử lý bằng phiếu trả hàng chờ hàng về (nút “Giao không thành”). Import từ sàn vẫn đổi được trạng thái vì đi thẳng `transitionOrder`. Đơn đã trả ship cho hãng vận chuyển không huỷ được (`SELLER_SHIPPING_PAID`).
  - Trả hàng: phiếu trả (`order_returns`) cộng kho với giá vốn đã chụp, ghi giảm doanh thu. **Phiếu trả kiểu KiotViet** (migration 027), kênh thường:
    - `goods_amount`: giá trị hàng trả = phần tiền thực của dòng (đã trừ giảm giá dòng và giảm giá đơn chia) theo SL, **làm tròn luỹ kế** (giá trị luỹ kế sau lần này − tổng đã trả trước đó; trả hết dòng thì tổng đúng bằng tiền thực của dòng, `returnLineValue`).
    - `shipping_refund_amount`: hoàn phí ship cho khách (tối đa phí ship còn lại của đơn). `return_fee_amount`: phí trả hàng shop giữ lại (tối đa hàng + ship hoàn; shop giữ toàn bộ tiền thì đặt phí = giá trị trả). `return_shipping_cost`: ship chiều về shop chịu.
    - **Cần trả khách** = hàng + ship hoàn − phí trả hàng. `refund_amount` = tiền trả ngay (kèm phương thức), không vượt cần trả khách và số khách đã trả.
    - Trên đơn: `returned_goods_amount`, `returned_shipping_amount`, `return_fee_amount`, `return_shipping_cost` (tổng các phiếu); `returned_amount` = hàng + ship hoàn − phí trả hàng = **mức giảm số phải thu** (mọi công thức công nợ `total − returned_amount − paid` giữ nguyên); `refund_owed_amount` = max(0, đã thu − phải thu) = **shop còn nợ khách**, hoàn sau bằng thanh toán chiều chi (tối đa số còn nợ). Đơn COD khách không nhận: trả hết + hoàn hết ship, tiền trả 0 → không còn phải thu, không còn doanh thu ship.
    - **Kênh sàn**: sàn tự hoàn tiền cho người mua → không có ship hoàn, phí trả hàng, tiền trả khách (chặn `MARKETPLACE_RETURN`); hàng trả giảm phải thu sàn (1388); ship chiều về vẫn nhập được. Phí sàn vẫn giả định không được hoàn.
    - **Lý do trả hàng có mã** (`order_returns.reason_code`, migration 035; danh sách ở `server/lib/returnReasons.js`, `GET /orders/return-reasons`): khách không nhận, đổi ý, giao sai, hàng lỗi, hỏng khi vận chuyển, không đúng mô tả, khác; ô ghi chú tự do `reason` vẫn giữ. `GET /reports/return-reasons` thống kê theo lý do.
    - **Hàng chờ về** (`awaiting_goods: true`, mọi kênh, không chỉ sàn): phiếu trả ghi ngay nhưng chưa nhập kho và chưa hoàn giá vốn cho tới `POST /orders/:id/returns/:rid/receive`. Dùng cho giao không thành và hàng trả đang gửi về.
    - **Phiếu hàng huỷ** (`return_write_offs`, mã `HH-…`, mục 5.6): dòng trả có `restock: false` (hoặc nhận hàng với `damaged_line_ids`) tự lập một phiếu, ghi số lượng và giá vốn đã chụp. Không có biến động kho (hàng chưa từng vào kho) và không có bút toán riêng: giá vốn của hàng đó không được hoàn nên vẫn nằm trong `cogs_amount`/632 của đơn, tức là một khoản lỗ trong lãi gộp. Phiếu chỉ để tra cứu và thống kê.
    - Lãi gộp đơn = `net_amount` − ship hoàn − hàng trả + phí trả hàng − giá vốn − ship chiều về (`orderGrossProfit`).
  - Bán trực tiếp: nút "Bán ngay" đi thẳng `draft → completed` + thanh toán đủ trong 1 bước.
  - Giao diện luôn gửi `customer_id` (khách mới được tạo qua `POST /customers` trước rồi mới chọn) nên đơn từ giao diện không tự sinh hồ sơ trùng. Đơn nháp sửa được qua `PATCH /orders/:id` (chỉ nháp).
- **Tiền trên đơn**:
  - `subtotal` = Σ(đơn giá × SL) dòng
  - `discount_amount` (giảm giá đơn) + giảm giá từng dòng
  - `shipping_fee` (khách trả) 
  - `total_amount` = subtotal − giảm giá + shipping_fee (**khách phải trả**)
  - `platform_fee_amount` (phí sàn: hoa hồng, thanh toán, dịch vụ), `seller_shipping_amount` (phí ship shop chịu, **mọi kênh**: kênh sàn thì sàn trừ vào tiền trả shop; kênh khác thì shop trả hãng vận chuyển, ghi việc đã trả bằng `POST /orders/:id/seller-shipping-payments`, payment `ref_type='order_seller_shipping'`, bút toán Nợ 3388 / Có quỹ, không tính vào tiền khách trả; `seller_shipping_due` = còn phải trả)
  - `net_amount` = total − platform_fee − seller_shipping (**shop thực nhận**)
  - `cogs_amount` = Σ giá vốn dòng
  - `gross_profit` = net − cogs (tính khi báo cáo, có cả chi phí trả hàng)
  - **Giá vốn lưu thành tổng tiền**: `order_lines.cogs_amount` = Σ (SL − đã nhập lại) × `unit_cost` của các phân bổ còn hiệu lực (0 khi nháp/huỷ); `orders.cogs_amount` = Σ các dòng. `order_lines.unit_cost` chỉ để hiển thị (`round(cogs/SL)`) vì chia nhiều kho thì đơn giá không còn nguyên. Mọi báo cáo dùng `SUM(cogs_amount)`; báo cáo theo kho cộng từ phân bổ của kho đó. `orders.warehouse_id` = kho chính.
  - **Huỷ / trả hàng**: nhập lại đúng kho đã xuất, đúng giá vốn đã chụp. Trả một phần lấy từ phân bổ tạo sau cùng trước (LIFO); phiếu trả có thể chọn kho nhận khác (giá vốn hoàn vẫn là giá đã chụp). Trả không nhập lại (hàng hỏng) không đổi giá vốn. `cogs_amount` giảm đúng bằng giá vốn đã hoàn. `npm run check-stock` đối chiếu tồn với sổ kho và `cogs_amount` với phân bổ.
  - `paid_amount`, `payment_status`: `unpaid | partial | paid | refunded`
  - **Số tiền cần thu** khác nhau theo kênh: kênh sàn (`channels.is_marketplace = 1`) → cần thu `net_amount` (sàn trừ phí rồi mới trả shop); kênh khác → cần thu `total_amount` (phí ship shop chịu là khoản chi riêng). Đều trừ phần hàng đã trả.
- **Phiếu bán hàng**: trang in khổ A5/80mm từ đơn, có logo/tên shop, không gọi là "hoá đơn".
- **Xuất đơn**: `GET /orders/export` dùng đúng bộ lọc của danh sách đơn (`orderFilter`), hai kiểu file (mỗi đơn một dòng / mỗi sản phẩm một dòng), CSV (có BOM, chống công thức độc) hoặc JSON (giao diện dựng Excel), `format=count` để báo trước số dòng. Tiền là số nguyên đồng, ngày giờ theo giờ VN, tối đa 50.000 dòng. Khác với `/system/export/orders.csv` (bản sao thô của bảng, dùng để lưu trữ).

- **Hạn nợ và nhắc nợ** (migration 042): `orders.due_date` (hạn khách thanh toán, đặt ở form đơn hoặc ở chi tiết đơn; không đặt thì lấy ngày đơn + cài đặt `payment_terms_days`, 0 = không đặt), `purchases.due_date` (hạn trả nhà cung cấp). `GET /loyalty/debts` trả khách nợ (đơn ngoài sàn đã hoàn thành còn nợ; nhóm quá hạn / sắp đến hạn trong N ngày / chưa đặt hạn từ 3 ngày) và phiếu nhập đã nhận sắp hoặc quá hạn trả; `POST /loyalty/debts/action` ghi "đã nhắc" và hẹn nhắc lại (`orders.debt_remind_after`). Loyalty → Hôm nay có thẻ Nhắc nợ; mẫu tin loại `debt` có biến `{ma_don} {con_no} {han_tra}`.
- **Sửa đơn đã xác nhận** (hàng còn ở shop): `PATCH /orders/:id` được đổi dòng hàng, giảm giá, kho. Máy chủ cộng hàng về kho (đúng giá vốn đã chụp), thay dòng, rồi trừ kho lại trong một giao dịch; thiếu hàng thì lỗi và không đổi gì. Các khoản đã thu giữ nguyên. Đơn đã có phiếu trả (`HAS_RETURNS`) hoặc đã giao đi thì không sửa dòng (dùng Trả hàng / Đổi hàng).
- **Tách đơn / giao từng phần** (`POST /orders/:id/split`): chuyển một phần số lượng của đơn nháp hoặc đã xác nhận sang đơn nháp mới (`orders.parent_order_id`, cùng khách, kênh, kho). Giảm giá dòng và giảm giá đơn chia theo tỷ lệ bằng `allocate`; phí ship và tiền đã thu ở lại đơn gốc.
- **Giữ hàng** (`POST /orders/:id/reserve {reserve, until}`, `orders.reserve_stock/reserved_until`): đơn nháp giữ hàng thì đơn khác không xác nhận được phần đó (`STOCK_RESERVED`, tính theo tổng tồn các kho của shop trừ phần giữ), trừ khi cho phép âm kho. Hết hạn tự nhả vì chỉ tính các đơn chưa quá hạn lúc xét. `/stock` có `reserved_qty`.
- **Thời hạn trả hàng và bảo hành**: cài đặt `return_window_days` (0 = không giới hạn); đơn hoàn thành quá hạn trả hàng bị `RETURN_WINDOW_EXPIRED` trừ khi gửi `allow_late: true` (giao diện hỏi lại). `products.warranty_days` (ngày kể từ lúc hoàn thành đơn); `GET /orders/warranty?q=` tra theo SĐT, tên, mã đơn, SKU; giao diện Chứng từ → Tra cứu bảo hành.
- **Nhập sản phẩm hàng loạt** (`POST /products/import/preview` rồi `POST /products/import`, giao diện Sản phẩm → Nhập từ Excel, tối đa 2000 dòng): mỗi dòng một SKU; các dòng cùng tên sản phẩm gộp thành biến thể của một sản phẩm; danh mục chưa có được tạo; tồn đầu kỳ cần giá vốn và kho (cột Kho, hoặc kho chọn chung); loại Hàng bán / Đóng gói / Vận hành; hàng bán được niêm yết ở shop đang chọn. SKU trùng (trong file hoặc đã có) và dòng lỗi bị bỏ qua kèm lý do, mỗi sản phẩm một điểm lưu riêng nên lỗi ở một sản phẩm không làm hỏng sản phẩm khác. Cột file tự đoán theo từ khoá, chỉnh được.
- **Nhãn giao hàng** (`GET /orders/:id/label`, `GET /orders/labels?ids=`): trang in 100×150 mm, mã vạch Code 128 của mã vận đơn (chưa có thì mã đơn), người nhận, người gửi (thông tin shop), tiền thu hộ hoặc "đã thanh toán", hàng trong đơn, ghi chú. In từ chi tiết đơn hoặc chọn nhiều vận đơn ở tab Vận chuyển.
- **Danh sách chứng từ gộp** (`GET /documents`, trang `/documents` “Chứng từ”): đơn bán, phiếu nhập, phiếu trả hàng, phiếu hàng huỷ, chuyển kho, điều chỉnh, kiểm kê; lọc theo loại, mã, ngày, shop (phiếu kho theo các kho của shop). Thanh toán và chi phí có danh sách riêng.

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
- **Đối soát sàn lệch** (migration 038): khi sàn trả khác số còn treo, `POST /reconciliation/payouts {items:[{amount}], settle_difference:true}` cộng phần lệch vào phí sàn của chính đơn đó (đơn hết treo, lãi từng đơn đúng) và ghi `payout_adjustments` (`GET /reconciliation/adjustments`). Không tick thì chỉ ghi số đã nhận, phần thiếu còn treo. Đơn giao xong quá `payout_overdue_days` (mặc định 10) mà sàn chưa trả được đánh dấu để khiếu nại.
- **Đối soát sàn**: tiền đơn của một kênh sàn (Shopee, TikTok Shop, kênh sàn tuỳ chỉnh) đã hoàn thành nhưng chưa ghi nhận tiền về = "tiền đang treo". Mỗi sàn đối soát riêng (`/reconciliation/pending?channel_id=`); ghi nhận tiền về dùng phương thức payout của sàn đó (`shopee_payout`, `tiktok_payout`; kênh sàn tuỳ chỉnh dùng `bank`) và từ chối đơn thuộc kênh khác. Báo cáo dòng tiền tách tiền treo theo sàn (`marketplace_by_channel`).

### 5.8A Vận chuyển và đối soát COD (migration 037)
Tham khảo cách Sapo/GHN mô tả đối soát: tiền đối soát = COD thu hộ + tiền shop trả trước/phí trả hàng − phí giao, bảo hiểm, chuyển hoàn, lưu kho…; hãng có lịch riêng và gửi file Excel. App chưa nối API của hãng (cần khoá của từng hãng), nên đối soát bằng file.
- `carriers` (tên, link tra cứu `{code}`), `shipments` (đơn, hãng, mã vận đơn duy nhất theo hãng, `cod_amount`, trạng thái đang giao / đã giao / hoàn / mất, `statement_id`). `POST /orders/:id/ship` tạo vận đơn và đưa đơn sang đang giao (COD mặc định = số khách còn nợ, không vượt). Đơn sàn không tạo vận đơn (sàn lo vận chuyển).
- **Phiếu đối soát** (`carrier_statements`, `POST /carrier-statements/preview` rồi `POST /carrier-statements`): mỗi dòng ghép theo mã vận đơn. Giao thành công: đơn hoàn thành nếu đang giao; ghi thu COD bằng phương thức `carrier_payout` (thuộc quỹ ngân hàng) tối đa số khách còn nợ; phí giao được trừ vào khoản "ship shop chịu" của đơn (bù 3388) trước, phần còn lại cùng phí COD, phí hoàn, phí khác thành MỘT khoản chi phí "Vận chuyển" cho mỗi shop (phương thức `carrier_payout`). Tiền hãng chuyển về = COD − phí. Hãng báo hoàn: lập phiếu trả toàn bộ, hoàn ship khách trả, hàng chờ về. Mã không có, đã đối soát, đơn ở trạng thái không hợp lệ: ghi vào phiếu với lý do, không ghi tiền.
- Chưa làm: tạo vận đơn qua API hãng, tự kéo trạng thái giao hàng, phí hoàn khi COD lệch đã tự cấn sang kỳ sau.

### 5.9A Nhật ký thay đổi và thông báo
- **Nhật ký** (`GET /system/audit`, giao diện Cài đặt → Nhật ký, chỉ chủ shop đăng nhập): đọc từ `audit_log`; mỗi dòng có tên hành động tiếng Việt, nhãn đối tượng (mã đơn, tên sản phẩm…), người làm (chủ shop / API key / hệ thống) và các trường đơn giản đã đổi từ gì sang gì. Lọc theo đối tượng, hành động, ngày, từ khoá. Hành động mới thêm tên ở `ACTION_LABELS` (`server/modules/system/auditlog.js`).
- **Thông báo** (migration 043, `server/modules/notifications`, job `server/jobs/notify.js` chạy mỗi 30 phút từng tài khoản): hộp thông báo ở biểu tượng chuông; loại: hàng sắp hết, hàng sắp/đã hết hạn, đơn xác nhận quá N ngày chưa giao, khách nợ đến hạn, sắp đến hạn trả nhà cung cấp, đơn sàn quá hạn chưa nhận tiền, tóm tắt ngày hôm qua (gửi sau giờ đặt). Mỗi loại tối đa một lần mỗi ngày (`dedupe_key = loại:ngày`). Kênh: trong app, Telegram (bot token + chat id; gọi `sendMessage`, lỗi mạng ghi vào `deliveries` chứ không làm hỏng), webhook (phát sự kiện `notification.created` cho webhook đã đăng ký để nối Zalo/email qua Zapier, Make, n8n). Cấu hình ở `notification_config` (một dòng), KHÔNG nằm trong `settings` nên token không lộ qua `GET /settings` hay nhật ký; `GET /notifications/config` chỉ trả `has_token` và 4 ký tự cuối. Chưa có email trực tiếp và Zalo OA.

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
- **Từ điển chỉ số và phạm vi hiển thị** (`web/src/metrics.js`, một nguồn): mỗi chỉ số có nghĩa, cách tính, nguồn (đơn trạng thái nào, theo ngày nào, hàng trả tính vào ngày đơn gốc), phạm vi (`filter`: theo shop & kênh đang lọc; `shop_plus_shared`: shop + chi phí chung được chia; `account`: toàn tài khoản như công nợ NCC, số dư quỹ, thuế; `warehouse`: tồn kho theo shop, tính đến hôm nay) và link tới dữ liệu gốc. Nút ⓘ ở mọi KPI, dòng và cột của Báo cáo và Tổng quan. Đầu trang Báo cáo luôn có dải "Đang xem: shop · khoảng ngày · kênh · so với kỳ trước". Server trả `meta.scope` (chỉ thêm) cho overview, cashflow, aging, health, inventory. Khi sửa công thức ở `server/modules/reports` phải sửa định nghĩa ở `metrics.js`; test quét mọi `metric=` để không có khoá thiếu. Excel xuất kèm sheet "Giải thích".
- **Cẩm nang từng bước** (`/guide/cam-nang`, đứng đầu trang Hướng dẫn; `web/src/guides/handbook/data.js` + `web/src/pages/guide/Handbook.jsx`): bộ trang có lời hướng dẫn bên trái và màn hình mô phỏng tự thao tác bên phải (con trỏ di chuyển, gõ chữ, bấm nút), phát lại liên tục có nút Tạm dừng và Xem lại, tôn trọng "giảm chuyển động". Màn hình mô phỏng dựng bằng HTML trong Shadow DOM (CSS ở `mockCss.js`) nên không lẫn giao diện chính. Có tình huống nhập hàng trả nhà cung cấp nhiều đợt và khách trả tiền nhiều lần. Test kiểm kịch bản chỉ trỏ tới phần tử có thật và bước nào cũng được nhắc. Khi thêm tính năng người dùng thấy được, thêm hoặc sửa trang tương ứng ở `data.js`.
- **Hướng dẫn** (`/guide`, `/guide/:id`, trong menu; nội dung ở `web/src/guides/content.js`, test kiểm liên kết trỏ đúng trang): mục lục theo nhóm, mỗi bài một trang (bắt đầu, bán hàng, kho, chốt kho, kế toán, khách, báo cáo, trường tuỳ chỉnh, cài đặt). Khi thêm tính năng người dùng thấy được thì thêm hoặc sửa bài tương ứng. Bài **Cách đọc sức khoẻ kinh doanh** (`/guide/suc-khoe-kinh-doanh`) là một bài trong đó: thay vì nhìn hàng chục chỉ số, trả lời 5 câu hỏi (Tiền có đủ không? Bán có lời không? Hàng có kẹt/sắp hết không? Khách có quay lại không? Chi phí có phình ra không?), mỗi câu có màu xanh/vàng/đỏ, số chính và việc nên làm; kèm từ điển từng con số. Chỉ dùng ngưỡng người dùng đã đặt và quy tắc tự nhiên (quỹ âm, đang lỗ); không bịa ngưỡng mới.

### 5.10 Loyalty & Campaign
Một module gộp mọi việc chăm sóc khách (trước đây là trang Chăm sóc, Gợi ý theo mệnh và cài đặt Hạng khách), trang `/loyalty`, các tab: **Hôm nay · Gợi ý theo mệnh · Hạng khách · Mẫu tin nhắn · Tự động hoá**. `/care` chuyển hướng về đây. Chỗ để sau này thêm các việc tự động (mục dưới).

- **Hạng khách** theo tổng chi tiêu toàn hệ thống trong 12 tháng (cấu hình ngưỡng: Thành viên / Bạc / Vàng / Kim cương). Hạng → % giảm giá gợi ý khi bán.
- **Nhắc mua lại** (tab Hôm nay): từ `products.consumption_days` và ngày mua → ngày dự kiến hết. Chỉ nhắc khách còn là thành viên của shop có đơn đó (khách đã xoá khỏi shop thì shop đó thôi nhắc). Soạn tin từ mẫu, sửa, sao chép.
- **Gợi ý theo mệnh** (tab riêng, **chỉ shop ngành phong thuỷ**): mỗi khách của shop biết mệnh và còn vật phẩm đang bán hợp mệnh mà chưa mua → một dòng kèm tối đa 3 gợi ý, xếp theo chi tiêu; soạn tin ngay. Mệnh là thông tin riêng của shop nên không bán chéo từ shop khác. Gợi ý cho từng khách vẫn hiện ở hồ sơ khách.
- **Khuyến mãi** (tab riêng, migration 040, `server/modules/loyalty/promotions.js`): loại giảm % đơn, giảm tiền đơn, giảm % theo sản phẩm/danh mục, mua X tặng Y (cùng sản phẩm), ưu đãi theo hạng khách (dùng `discount_pct` của hạng); điều kiện: đơn tối thiểu, trần giảm, ngày hiệu lực, shop, kênh, tổng lượt và lượt mỗi khách, mã voucher (không mã = tự áp). Khuyến mãi không cộng dồn: chọn cái giảm nhiều nhất; cộng dồn được thì áp thêm lần lượt. `POST /loyalty/promotions/evaluate` xem trước; `POST /orders` với `auto_promotions` / `promotion_code` thì máy chủ tính lại (không tin số từ giao diện), cộng vào giảm giá dòng/đơn và ghi `promotion_uses`; mã sai/hết lượt báo `PROMOTION_INVALID`. Thống kê lượt dùng, tiền đã giảm, doanh thu theo khuyến mãi ở danh sách. Sửa đơn nháp không tính lại khuyến mãi.
- **Quà tặng kèm** (khuyến mãi loại `gift`, migration 044): đủ điều kiện (đơn tối thiểu và/hoặc mua tối thiểu trong phạm vi sản phẩm/danh mục) thì thêm dòng quà giá 0 (`order_lines.is_gift`) vào đơn mới; quà vẫn trừ kho, giá vốn vào giá vốn đơn; hết quà (không đủ tồn các kho của shop) thì không tặng và báo lý do. Quà luôn cộng thêm, không loại trừ nhau. Thống kê "đã giảm" của khuyến mãi quà tính theo giá trị bán của quà.
- **Hạng khách** và **Mẫu tin nhắn** (thêm/sửa/xoá) quản lý ngay trong module, không còn ở Cài đặt.
- **Tự động hoá** (chưa làm, tab chỉ nói rõ điều đó): tự động nhắn tin nhắc mua lại/chúc sinh nhật, tự động nâng hạng. Gửi tin cần chọn kênh gửi (Zalo OA, SMS…) và tuân quy định tin nhắn quảng cáo nên làm sau khi chốt kênh.
- **Ngày đặc biệt**: sinh nhật khách, đọc từ ngày sinh chung trên hồ sơ (mục 5.5). 29/2 mừng vào 28/2 ở năm không nhuận.
- Tích điểm: *không làm ở giai đoạn đầu* (điểm là khoản nợ với khách, phức tạp khi chia giữa shop).

### 5.11 Trường tuỳ chỉnh & Công thức
- Định nghĩa trường tuỳ chỉnh cho đối tượng: `product`, `customer`, `order`, `purchase`. Kiểu: text, number, money, date, select, multi-select, boolean, **formula**.
- **Phạm vi trường**: sản phẩm/đơn/phiếu nhập: toàn hệ thống (mặc định, để cộng gộp được giữa shop) hoặc riêng 1 shop. **Khách hàng: luôn riêng 1 shop** (bắt buộc `shop_id`); khoá chỉ cần duy nhất trong shop; đọc/ghi giá trị luôn kèm `shop_id`. Trường bắt buộc (`required`) chỉ chặn khi yêu cầu xoá/để trống chính nó: bản ghi cũ thiếu giá trị vẫn sửa được các ô khác (giao diện vẫn hiện `*`). Hiện lại trường đã ẩn thì kiểm lại vai trò và khoá trùng (`DUPLICATE_ROLE`, `DUPLICATE_KEY`). Trường có thể mang `role` để app biết dùng vào việc gì; hiện chỉ còn `element` (mệnh ghi đè của khách, ngũ hành của sản phẩm). Hai vai trò `birth_date`, `birth_year` đã bỏ (ngày sinh là thông tin chung, mục 5.5): tạo mới báo `ROLE_RETIRED`, chỉ còn trên các trường cũ đã ẩn. Gộp khách: giá trị của hồ sơ giữ lại thắng, trường còn thiếu lấy từ hồ sơ bị gộp.
- **Trường công thức**: biểu thức an toàn (không `eval`) trên các trường của chính bản ghi, vd `{total_amount} - {cogs_amount} - {custom.phi_dong_goi}`. Hàm: `IF, ROUND, MIN, MAX, ABS, DAYS_BETWEEN, TODAY, CONCAT, YEAR, MONTH, DAY, DATE, AGE, MONTHS_BETWEEN, COALESCE`.
  - **Phép tính ngày** (`server/lib/formula.js`): ngày − ngày = số ngày (số nguyên); ngày ± số = ngày (`YYYY-MM-DD`). Nhận chuỗi `YYYY-MM-DD` và ISO (đổi sang giờ `Asia/Ho_Chi_Minh`); `TODAY()` theo giờ VN. `AGE(ngày)` là tuổi tròn, `MONTHS_BETWEEN(a, b)` số tháng tròn từ a đến b, `DATE(năm, tháng, ngày)` dựng ngày (không có thật thì trống). Biến khách: `birth_date`, `birth_year`, `age`, và `menh` (hiệu lực, chỉ shop có `feng_shui`). Trước đây `TODAY() - {ngày}` ra trống mà không báo gì; nay ra số ngày. Muốn tuổi thì dùng `AGE({birth_date})`.
  - **Kiểm kiểu lúc lưu** (`inferType`): chặn phép sai như chữ − số, ngày × số, ngày + ngày, số − ngày, kèm vị trí và gợi ý cách đúng (“Muốn tính tuổi, dùng AGE({ngày sinh})”). Công thức đã lưu từ trước không bị kiểm lại, đọc vẫn không văng lỗi.
  - **Lý do khi trống**: `evaluateExplain` trả kèm lý do (“Khách chưa có Ngày sinh”, “Chia cho 0”, “Ngày chỉ trừ với ngày…”). `POST /custom/formula/preview` trả `reason`; `GET /custom/values/:entity/:id?meta=1` trả `{ values, reasons, element }`; hồ sơ khách và `FormulaEditor` hiện lý do thay vì chỉ “—”. Trường công thức luôn tính lại lúc đọc, nên tạo trường trước hay sau khi có dữ liệu đều ra giá trị.
- **Xoá trường**: `DELETE /custom/fields/:id` (khác “Ẩn”: ẩn giữ dữ liệu, hiện lại được). Trường đang bị công thức chưa ẩn khác tham chiếu: 409 `FIELD_REFERENCED` kèm danh sách. Chưa có giá trị nào: xoá hẳn (dữ liệu nháp, quy ước 6). Đã có giá trị: cần `confirm: true`, không thì 409 `CONFIRM_REQUIRED` kèm `values_count`; khi xoá, định nghĩa + toàn bộ giá trị được chép vào `audit_log` (`custom_field.deleted`, như tiền lệ “xoá khách khỏi shop” ở 5.5) để khôi phục tay, rồi phát sự kiện `custom_field.deleted`. `GET /custom/fields/:id/usage` cho giao diện biết số bản ghi và công thức đang dùng. Khoá được giải phóng.
- **Giá trị mặc định** (`custom_fields.default_value`, JSON, kiểm theo kiểu và lựa chọn; trường công thức không có): điền sẵn khi tạo khách mới ở một shop và trên form của bản ghi chưa có giá trị ở trường đó. Không bao giờ tự ghi vào bản ghi cũ: form chỉ điền sẵn trên màn hình, bấm Lưu mới ghi.
- **Chỉ số tuỳ chỉnh cho báo cáo**: công thức trên các chỉ số tổng hợp, vd `{net_revenue} / {order_count}`, áp dụng được cho 1 shop / nhiều shop.
- Lưu giá trị: bảng EAV `custom_values(entity_type, entity_id, field_id, value_text, value_num)`.
- **Danh mục biến** (`server/modules/custom/variables.js`, một nguồn cho cả kiểm tra lẫn gợi ý): chỉ cột có nhãn tiếng Việt, không có id, thời điểm nội bộ, JSON, cột khách cũ. Khách có thêm biến theo shop `shop_order_count`, `shop_total_spent`, `shop_last_order_at`. Công thức trường chỉ nhận biến trong danh mục + `{custom.khoá}` (lỗi nêu tên biến và vị trí); công thức đã lưu từ trước vẫn đọc được vì chỉ kiểm khi tạo/sửa. Chỉ số báo cáo chỉ nhận biến trong `REPORT_VARIABLES` (`reports/service.js`).
- Hàm: `IF ROUND MIN MAX ABS DAYS_BETWEEN TODAY CONCAT YEAR MONTH COALESCE` (`FUNCTION_DOCS` trong `formula.js`). CONCAT coi giá trị thiếu là chuỗi rỗng, COALESCE lấy giá trị đầu tiên có dữ liệu, còn lại giá trị thiếu lan truyền.
- **Xem trước**: `POST /custom/formula/preview` tính trên bản ghi mẫu (gần nhất trong shop, hoặc `entity_id`); chỉ số báo cáo tính trên tháng này. Lỗi trả kèm `position`.
- **Vai trò** (`role`): chỉ đúng đối tượng (khách: ngày sinh, năm sinh, mệnh; sản phẩm: mệnh/ngũ hành), mỗi shop một trường mỗi vai trò. **Bắt buộc** (`required`): kiểm khi lưu giá trị qua `PUT /custom/values`, không áp cho trường công thức.
- Giao diện quản lý trường là một component dùng chung (`FieldsManager`) cho Cài đặt và trang Khách hàng; ô soạn công thức là `FormulaEditor`.

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

### 5.15 Nền tảng bán hàng (plugin)
- Danh mục nền tảng ở `server/lib/platforms.js` (như `industries.js`): `shopee`, `tiktok` (TikTok Shop), `facebook`, `zalo`. Mỗi nền tảng gồm kênh, `is_marketplace`, phương thức payout (chỉ sàn), mẫu import dựng sẵn, chức năng (`import`, `reconciliation`). Thêm nền tảng = thêm một mục ở đó + migration seed kênh (lưu trữ sẵn) và mẫu import.
- Cài đặt `enabled_platforms` (mặc định `["shopee","facebook"]`, tài khoản cũ giữ hành vi cũ) chỉ đổi qua `POST /platforms/:id/enable|disable`, không qua `PATCH /settings`. **Bật**: bỏ lưu trữ kênh, bảo đảm mẫu import tồn tại, bảo đảm phương thức payout thuộc một quỹ (mặc định quỹ ngân hàng). **Tắt**: chỉ lưu trữ kênh; đơn, tiền treo, mẫu import, phương thức payout giữ nguyên. Đều ghi `audit_log`.
- Phương thức thanh toán hợp lệ = phương thức gốc + payout của mọi nền tảng (`paymentMethods()`), nên đơn cũ trả bằng payout của nền tảng đã tắt vẫn hợp lệ; giao diện chỉ ẩn payout của nền tảng đang tắt khỏi bộ chọn.
- Kênh tuỳ chỉnh: `POST/PATCH /channels` (id `ch_…`, tên không trùng, `is_marketplace`, lưu trữ). Kênh dựng sẵn không sửa qua đây. Đã có đơn thì không đổi loại kênh (sàn/thường) vì đổi cách tính số tiền cần thu. `GET /channels` chỉ trả kênh đang bật; `?include_archived=1` trả cả kênh đã tắt (để đọc tên kênh của đơn cũ).
- Mẫu import TikTok (`imp_tiktok`) là **mẫu khởi đầu** theo tên cột file xuất đơn của TikTok Seller Center, chưa kiểm với file thật, sửa được ở trình sửa mẫu; file xuất đơn không có phí sàn.
- Giao diện: Cài đặt → "Nền tảng bán hàng" (thẻ nền tảng + công tắc Kết nối + kênh tuỳ chỉnh); tab "Đối soát sàn" ở Chi phí & đối soát (chọn sàn trong các sàn đang bật, ẩn nếu không có sàn nào); Tổng quan tách "Tiền sàn đang treo" theo sàn. `session` có `platforms`, `platformEnabled(id)`, `marketplaces`, `channels` (đang bật) và `allChannels` (gồm đã tắt).

### 5.14 Ngành bán
- Mỗi shop chọn một **ngành bán** (`shops.industry`, đổi trong Cài đặt → Shop & kho). Danh mục ngành nằm ở `server/lib/industries.js`: `general` (Bán lẻ chung), `phong_thuy`, `nuoc_hoa_o_to` (nước hoa/tinh dầu/phụ kiện thơm cho xe: nhóm hương, dòng xe, mua cho xe nào), `nuoc_hoa` (nước hoa mặc cho người: nhóm hương, nồng độ, thương hiệu yêu thích, phong cách, dịp dùng, ngân sách, sinh nhật). Hai ngành nước hoa **tách biệt**: khách và cách bán khác nhau nên trường khách và giao diện khác nhau. Thêm ngành = thêm một mục ở đó (và một theme CSS nếu muốn giao diện riêng).
- Ngành quyết định: (1) **theme giao diện** (mục 7A), (2) **tính năng** bật theo ngành (`feng_shui`: mệnh, ngũ hành, âm lịch, doanh thu theo ngũ hành, gợi ý theo mệnh), (3) **trường thông tin khách tạo sẵn** cho shop, (4) **trường thông tin sản phẩm tạo sẵn** (`product_fields`, riêng shop đó). Ngành phong thuỷ có `ngu_hanh` ("Ngũ hành hợp", nhiều lựa chọn, vai trò `element`): `applyIndustry` tạo cho shop, báo cáo theo ngũ hành đọc theo shop của đơn (shop không có trường, ví dụ ngành khác, hoặc sản phẩm chưa gán → "chưa gán"), gợi ý theo mệnh đọc theo shop đang xem. Khoá trường sản phẩm duy nhất trong phạm vi shop nên hai shop phong thuỷ đều có `ngu_hanh` riêng.
- Chọn/đổi ngành chỉ **thêm** trường còn thiếu (theo khoá hoặc vai trò), không xoá hay ẩn gì: trường và dữ liệu của ngành cũ vẫn giữ. Trường mẫu mà chủ shop đã **xoá có chủ đích** (có bản ghi `custom_field.deleted` trong `audit_log` cho đúng shop + khoá) thì không tạo lại; muốn có lại thì tự thêm trường cùng khoá.
- Preset khách của các ngành **không còn trường ngày sinh / năm sinh / sinh nhật** (đã là thông tin chung, mục 5.5). Nhãn trường mệnh của ngành phong thuỷ là “Mệnh (ghi đè)” cho shop mới; shop cũ giữ nhãn đã có.
- Chủ shop tự thêm/sửa/ẩn trường khách của shop trong trang Khách hàng → "Thông tin khách của shop".
- Chuyển shop ở bộ chọn shop thì giao diện, tính năng và trường khách đổi theo. "Tất cả shop" dùng giao diện chung, không có thông tin riêng của shop nào.

### 5.16 Kế toán (sổ cái kép, Phase 8a + 8b)
- **Sổ cái là dữ liệu dẫn xuất**, cùng mẫu với `daily_stats` (5.9): trigger SQLite trên `orders`, `order_lines`, `order_line_allocations`, `order_returns`, `purchases`, `payments`, `expenses`, `cash_entries`, `cash_accounts`, `stock_movements` (chỉ `adjust_in/out`, `damage_out`, `opening`) ghi `(source_type, source_id)` vào `journal_dirty`. `flushJournal()` chạy trước mọi lần đọc sổ kế toán: xoá bút toán tự động cũ của chứng từ bẩn rồi sinh lại từ trạng thái hiện tại bằng hàm thuần `postingsFor()` (`server/modules/accounting/posting.js`). Mã bút toán (`BT-…`) giữ nguyên khi sinh lại. Bút toán tay (`is_auto = 0`, `source_type = 'manual'`, làm ở 8b) không bao giờ bị sinh lại.
- Mỗi bút toán phải cân (Σ Nợ = Σ Có): chặn khi sinh, kiểm lại ở `verifyJournal()`; `npm run check-journal [-- --fix]` (như `check-stats`) so sổ lưu với sổ dựng lại trong bộ nhớ, phát hiện thiếu/thừa/sai/không cân/mồ côi.
- **Hệ thống tài khoản** (`accounts`): 111/112 (tiền mặt, ngân hàng/ví; mỗi quỹ một tài khoản con 111x/112x tạo tự động bằng trigger), 1131 tiền đang chuyển, 131, 1388, 156, 211, 214, 242, 331, 3388, 411, 421, 5111, 5113, 5118 (doanh thu khác: phí trả hàng, dòng doanh thu riêng trong KQKD), 5212, 632, 6411–6418, 6422, 6428, 711, 811. Tài khoản hệ thống không đổi/xoá; thêm được tài khoản con. Danh mục chi phí gán tài khoản chi phí (`expense_categories.account_code`, mặc định theo bảng seed; danh mục mới chưa gán → 6428).
- **Quy tắc hạch toán** khớp ĐÚNG cách báo cáo đếm (cùng trạng thái, cùng ngày):
  | Chứng từ | Bút toán | Ngày |
  |---|---|---|
  | Đơn đã xác nhận trở đi, kênh thường | Nợ 131 total · Có 5111 hàng (sau giảm giá) · Có 5113 phí ship · Nợ 6411 phí sàn / Nợ 6412 ship shop chịu, Có 3388 · Nợ 632 / Có 156 giá vốn | ngày đơn |
  | Đơn kênh sàn | Nợ 1388 net · Nợ 6411 · Nợ 6412 · Có 5111 · Có 5113 · giá vốn như trên | ngày đơn |
  | Phiếu trả hàng | Nợ 5212 hàng trả · Nợ 5113 ship hoàn · Có 131 (hoặc 1388) phần còn lại sau phí trả hàng · Có 5118 phí trả hàng (cấn vào công nợ khách) · Nợ 6412 / Có 3388 ship chiều về · nhập lại kho: Nợ 156 / Có 632 theo giá vốn đã chụp. Phí sàn không hoàn | ngày của ĐƠN GỐC (như báo cáo) |
  | Thanh toán | Thu: Nợ quỹ / Có 131 (hoặc 1388, 331 khi NCC hoàn); chi/hoàn: ngược lại. Quỹ = tài khoản con của quỹ chứa phương thức; chưa gán quỹ → 1131 (cảnh báo ở Tổng quan) | ngày thanh toán |
  | Phiếu nhập đã nhận | Nợ 156 / Có 331 tổng phiếu. Huỷ/nháp: không có bút toán | ngày nhận |
  | Chi phí | Nợ tài khoản danh mục (kèm shop) / Có quỹ theo phương thức, trống thì 3388. Chi phí chung giữ shop NULL | ngày chi phí |
  | Kho | adjust_in: Nợ 156 / Có 711 · adjust_out, hỏng: Nợ 811 / Có 156 · tồn đầu: Nợ 156 / Có 411 · chuyển kho: không có | ngày biến động |
  | Quỹ | Số dư đầu: Nợ quỹ / Có 411 · chuyển quỹ: Nợ đích / Có nguồn · kiểm đếm thừa: Nợ quỹ / Có 711, thiếu: Nợ 811 / Có quỹ | ngày dòng |
  - Thu chi **trước ngày mở sổ** của một quỹ đã nằm trong số dư đầu (khớp `cash/balanceOf`), nên phía tiền được ghi vào 411 thay vì tài khoản quỹ.
- **Báo cáo** (`/accounting`, giao diện "Kế toán → Sổ kế toán"): tổng quan, sổ nhật ký, sổ cái (bấm mở chứng từ gốc), cân đối phát sinh, KQKD (lọc kỳ và shop), cân đối kế toán (luôn toàn tài khoản; lợi nhuận lũy kế chưa kết chuyển hiện thành "421 – lợi nhuận kỳ này"), lưu chuyển tiền trực tiếp, hệ thống tài khoản; xuất Excel từng tab; ⓘ giải thích ở `metrics.js`.
- **KQKD theo shop** dùng đúng hàm phân bổ chi phí chung của báo cáo (`expenseItems`), nên lợi nhuận từng shop = báo cáo. Điều chỉnh kho/kiểm đếm quỹ (711/811) không thuộc shop nào nên chỉ có khi xem tất cả shop; báo cáo không đếm chúng, nên KQKD tất cả shop = lợi nhuận báo cáo + các khoản đó.
- **Chênh lệch có chủ đích với báo cáo**: (1) tài khoản 156 lệch vài đồng so với Σ tồn × giá vốn bình quân do làm tròn giá bình quân và giá nhập phân bổ về đồng nguyên (cận trên nêu trong test); (2) báo cáo cắt công nợ mỗi đơn ở 0, sổ cái giữ số dư có (đơn sàn trả toàn phần: sàn không hoàn phí nên shop nợ sàn phần phí); (3) phí sàn/ship shop chịu trên đơn kênh thường ghi phải trả khác (3388) vì chưa có dòng tiền.
- **8b. Nghiệp vụ bổ sung** (migrations 025, 026):
  - **Chứng từ tay** (`vouchers` + bút toán `source_type='manual'`, `is_auto=0`, không bao giờ sinh lại; `verifyJournal` chỉ kiểm chúng có cân). Ba loại: Phiếu thu khác `PT-` (Nợ quỹ / Có tài khoản đối ứng: 411 góp vốn, 711 thu khác), Phiếu chi khác `PC-` (Nợ đối ứng: 811 tiền phạt, 411 rút vốn / Có quỹ), Bút toán tổng hợp `BT-` (nhiều dòng, phải cân). Có ngày, mô tả, shop và đối tác tuỳ chọn. Sửa = thay các dòng trong cùng transaction; huỷ = `voided_at`, không xoá; phát sự kiện `voucher.*` và ghi `audit_log`. Không hạch toán vào tài khoản tổng 111/112/1131; phiếu thu/chi không đối ứng với quỹ khác (dùng chuyển quỹ); dòng tiền không được lập trước ngày mở sổ của quỹ (`CASH_BEFORE_OPENING`).
  - **Dòng tiền của chứng từ tay và tài sản vào số dư quỹ**: `cash/balanceOf` cộng thêm (a) Nợ − Có của các bút toán tay trên tài khoản 111x/112x của quỹ (mọi ngày đến ngày xem; vì cấm lập trước ngày mở sổ nên không cần cận dưới), (b) nguyên giá tài sản mua bằng phương thức thuộc quỹ (như chi phí). Sổ quỹ (`cash/ledger`) có thêm các dòng đó. Nhờ vậy số dư tài khoản 111x/112x luôn bằng `balanceOf` (test mở rộng).
  - **Chi phí định kỳ** (`recurring_expenses`; `expenses.recurring_id`, `period_key`, unique `(recurring_id, period_key)` nên không bao giờ trùng, kể cả chi phí đã huỷ vẫn giữ khoá kỳ). Chu kỳ tháng (ngày 1–31, tháng ngắn lấy ngày cuối), tuần (1 = thứ Hai … 7), năm. Job `server/jobs/recurring.js` chạy khi khởi động rồi mỗi giờ, từng tài khoản, tạo mọi kỳ đến hạn còn thiếu (tạo bù khi máy tắt). Tiếp tục sau tạm dừng không tạo bù thời gian tạm dừng (`skip_before`). Kỳ rơi vào kỳ đã khoá sổ bị bỏ qua và báo lại. "Tạo ngay kỳ này", xem trước các kỳ sắp tới, lưu trữ thay vì xoá. Chi phí định kỳ là dòng `expenses` thật nên vào Báo cáo như mọi chi phí. Hàm lịch thuần ở `server/lib/schedule.js`.
  - **Tài sản & chi phí trả trước** (`assets`): `fixed_asset` (211, hao mòn 214) hoặc `prepaid` (242). Mua: Nợ 211/242 / Có quỹ theo phương thức hoặc 331 nếu chưa trả (phiếu chi tay để trả sau). Mỗi tháng đã trọn một bút toán Nợ 641x/642x / Có 214 hoặc 242, ghi vào ngày CUỐI THÁNG, kỳ đầu là tháng của ngày mua; chia bằng `allocate()` nên Σ các kỳ = nguyên giá. Thanh lý: dừng khấu hao từ ngày thanh lý (tháng chưa trọn không tính), giá trị còn lại vào 811 (đơn giản hoá: tiền bán tài sản ghi bằng phiếu thu tay). Huỷ bản ghi nhập nhầm = `voided_at`.
  - **Khấu hao luôn mới**: bút toán tài sản phụ thuộc "hôm nay" (`server/lib/clock.js`, test đặt được ngày giả). `flushJournal` đọc mốc `journal_meta.asset_day`; khi ngày đổi (kể cả đồng hồ giả lùi/tiến) nó đánh dấu bẩn mọi tài sản chưa huỷ một lần rồi sinh lại, cùng ngày thì không làm gì. `verifyJournal` dựng sổ kỳ vọng bằng cùng "hôm nay" nên luôn khớp.
  - **Khoá sổ** (`accounting_lock_date`, đặt qua `POST /accounting/lock`, có kiểm tra ở `PATCH /settings`): chứng từ tay, chi phí, thanh toán (cả huỷ), chuyển quỹ/kiểm đếm quỹ, tài sản có ngày ≤ ngày khoá (cả ngày cũ lẫn ngày mới khi sửa) bị chặn `409 PERIOD_LOCKED`. Đơn và phiếu nhập KHÔNG bị chặn (đơn sàn import muộn là bình thường); lúc khoá app chụp số dư mọi tài khoản đến ngày khoá (`period_lock_snapshots`, kèm băm), trang Tổng quan so lại và báo "kỳ đã khoá có thay đổi sau khoá" với danh sách tài khoản đổi; "Chấp nhận và chụp lại" bằng cách khoá lại cùng ngày.
  - **KQKD và báo cáo**: khấu hao/phân bổ là dòng riêng (`depreciation`), không nằm trong 641x/642x; có `operating_profit_before_depreciation`. Khấu hao KHÔNG có trong "Lợi nhuận ròng ước tính" của Báo cáo (nó không phải dòng chi phí), chi phí định kỳ thì có ở cả hai. Quyết định giữ nguyên số của Báo cáo ở giai đoạn này; chênh lệch giữa lợi nhuận kế toán và Báo cáo = khấu hao + thu/chi khác (711/811, gồm chứng từ tay, thanh lý) + chênh lệch kho/quỹ, đã ghi ở giao diện và `metrics.js` (`acc_depreciation`, `acc_other`, `acc_lock`). Khấu hao của tài sản "Chung" (không shop) không chia về shop khi lọc shop, như điều chỉnh kho.
  - Giao diện thêm các tab Chứng từ, Chi phí định kỳ, Tài sản & phân bổ, Khoá sổ (xuất Excel cho ba danh sách đầu), ánh xạ danh mục chi phí → tài khoản và tạo danh mục ở tab Hệ thống tài khoản.

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
| `channels` | kênh bán (seed sẵn direct/facebook/shopee/other; tiktok, zalo seed ở trạng thái tắt; kênh tuỳ chỉnh `ch_…`) |
| `categories` | danh mục sản phẩm (cây) |
| `products`, `variants` | sản phẩm gốc & SKU (`options`, `option_values`, `image_id`) |
| `product_images` | chỉ mục ảnh sản phẩm (file ở `data/uploads/<account>/`), nơi kiểm quyền đọc ảnh |
| `shop_listings` | biến thể bán ở shop nào, giá bao nhiêu |
| `stock_levels`, `stock_movements` | tồn kho & sổ cái kho |
| `shop_warehouses` | danh sách kho của shop theo ưu tiên (1 = lấy trước) |
| `order_line_allocations` | từng phần xuất kho của dòng đơn: kho, SL, giá vốn chụp, SL đã nhập lại |
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
| `cash_accounts`, `cash_entries` | quỹ tiền; chuyển quỹ và điều chỉnh kiểm đếm. `cash_accounts.account_code` = tài khoản con 111x/112x |
| `accounts` | hệ thống tài khoản kế toán (mục 5.16) |
| `journal_entries`, `journal_lines` | sổ nhật ký/sổ cái kép, dẫn xuất từ chứng từ (migration 024) |
| `journal_dirty` | chứng từ cần sinh lại bút toán (trigger trên chứng từ) |
| `vouchers` | chứng từ tay: phiếu thu/chi khác, bút toán tổng hợp; bút toán `manual` đi kèm (migration 025) |
| `recurring_expenses` | chi phí định kỳ; `expenses.recurring_id/period_key` chống tạo trùng kỳ (migration 025) |
| `assets` | tài sản cố định, chi phí trả trước; bút toán mua/khấu hao/thanh lý dẫn xuất (migration 026) |
| `journal_meta`, `period_lock_snapshots` | mốc làm mới khấu hao theo ngày; ảnh chụp số liệu kỳ khoá sổ (migration 026) |
| `events`, `webhooks`, `webhook_deliveries` | sự kiện & webhook |
| `audit_log` | ai sửa gì, khi nào, trước/sau |
| `sequences` | bộ đếm sinh mã hiển thị |
| `idempotency_keys` | chống tạo trùng qua API |

---

## 7. Giao diện

### Bố cục
- **Điện thoại**: thanh tab dưới cùng (Tổng quan · Tạo đơn · Đơn · Kho · Thêm). Nút nổi "+ Đơn" trỏ `/orders/new`, ẩn ở trang tạo đơn và các form dạng trang.
- **Một cách tạo đơn**: không có màn "Bán nhanh" riêng. Nút "Bán nhanh" trên thanh trên cùng, tab "Tạo đơn" và nút nổi đều mở `/orders/new`; `/pos` chuyển hướng về đó. Form mặc định kênh Bán trực tiếp, tìm sản phẩm có sẵn focus, "Bán xong" luôn ở thanh dưới, phần ít dùng (mã đơn kênh, địa chỉ, ghi chú) gọn trong "Thêm tuỳ chọn".
- **Một trang tối đa ba lớp trước nội dung**: (1) `PageHeader`: tiêu đề, mô tả ngắn tuỳ chọn, nút hành động bên phải; (2) `Toolbar`: một hàng gồm tab/segmented, ô tìm, bộ lọc, tự xuống dòng gọn trên điện thoại; (3) nội dung. Mỗi vùng chỉ một dòng ghi chú muted (`Note`); phần giải thích dài đưa vào ⓘ (`MetricInfo`) hoặc khối thu gọn (`Fold`). Các khối nội dung dùng `Section` (đệm thống nhất). Các thành phần này ở `web/src/components/ui.jsx`.
- **Tab** là segmented control gọn (`Tabs`, `Chips`), có thể kèm số đếm (ví dụ "Nháp 3"). Không dùng tab gạch chân dày hay nút to làm tab.
- **Form dài là trang đầy đủ**, không phải popup: `/products/new`, `/products/:id`, `/products/combo/new`, `/purchases/new` (chi tiết phiếu ở `/purchases/:id`). Máy tính hai cột 8:4 (cột chính: thông tin cơ bản, giá & kho hoặc biến thể, dòng hàng; cột phụ: ảnh, phân loại, bán ở shop, trường riêng của shop, nhà cung cấp, phí), thanh lưu dính đáy (Huỷ / Lưu), cảnh báo khi rời trang chưa lưu (`useLeaveGuard`, cần data router nên `main.jsx` dùng `createBrowserRouter`). Tuỳ chọn ít dùng nằm trong `Fold`. Popup (`Modal`) chỉ còn cho việc ngắn (tối đa khoảng 5 ô: thêm nhà cung cấp, đồng bộ sản phẩm, xác nhận bỏ biến thể, chi phí, tài sản…).
- **Danh sách dễ quan sát** (`Card flat.list-card`): header dính khi cuộn, hàng vừa phải, hover rõ, cột tiền căn phải số tabular, chữ phụ (mã, SKU, ngày, SĐT) màu muted ở dòng thứ hai của ô thay vì cột riêng, trạng thái dạng badge, chấm nhỏ (`dotflag`) cho cảnh báo; điện thoại thành thẻ hai dòng không cuộn ngang.
- **Máy tính**: thanh bên trái, nội dung rộng, bảng dữ liệu đầy đủ cột.
- **Màu giao diện riêng của shop** (migration 033, `shops.ui_colors` = `{primary, background}`, Cài đặt → Shop & kho → bấm shop; `PATCH /shops/:id {ui_colors}`, `null` = về màu chủ đề): ghi đè `--oxblood`/`--seal` (nút chính, liên kết) và `--bg`/`--paper` trên `<html>` khi đang làm việc ở shop đó. Máy chủ và giao diện cùng chặn màu chủ đạo có tương phản < 4,5:1 với chữ trên nút (`#ede3d2`) hoặc với nền, và nền có độ sáng < 0,75. Các màu chọn sẵn đều đã đo ≥ 4,5:1 (test).
- **Bộ chọn shop** luôn ở đầu trang. Chế độ "Tất cả shop" chỉ có ở Báo cáo, Khách hàng, Kho (danh sách trang ở `web/src/lib/routes.js`). Ở trang khác mà lựa chọn đã lưu là "Tất cả shop" thì `session.shopId` tự đổi sang shop đầu tiên (đúng như nút chọn shop hiển thị), lựa chọn đã lưu vẫn giữ để quay lại trang cho phép.

### Màn hình
| Màn | Nội dung chính |
|---|---|
| Đăng nhập / Đăng ký / Thiết lập lần đầu | đăng ký tài khoản; tạo shop (chọn ngành) → popup tạo kho → tạo sản phẩm đầu tiên |
| Tổng quan | doanh thu hôm nay/tháng, LN gộp, đơn chờ xử lý, cảnh báo sức khoẻ, hàng sắp hết, khách cần nhắc |
| Đơn hàng | danh sách lọc theo trạng thái (tab kèm số đếm, `GET /orders/status-counts` dùng chung `orderFilter`)/kênh/ngày, cột: mã + ngày giờ, khách (tên + SĐT), kênh, số SP, khách phải trả, thanh toán, trạng thái; **form tạo/sửa đơn** `/orders/new`, `/orders/:id/edit` (bố cục 7:5, một cột trên điện thoại, thanh hành động dính đáy: sản phẩm có ảnh/tồn theo kho, chọn khách có sẵn hoặc tạo nhanh, kênh, phí sàn chỉ với kênh sàn, tổng + lãi gộp ước tính, chia kho tay từ `allocation-preview`, "Lưu nháp / Xác nhận đơn / Bán xong"); chi tiết đơn (nút Sửa cho đơn nháp); đổi trạng thái; thanh toán; trả hàng; in phiếu; nhập từ file; xuất file (CSV/Excel) |
| Import đơn | chọn file → chọn mẫu map cột → xem thử → xác nhận → kết quả |
| Sản phẩm | danh sách theo shop (ảnh nhỏ, danh mục + SKU ở dòng phụ, số biến thể, khoảng giá, tồn tổng đỏ khi dưới tối thiểu, trạng thái bán); **trang** thêm/sửa sản phẩm, combo (hai cột 8:4, ma trận biến thể trong `Section` riêng với thanh "Áp dụng cho tất cả" phía trên bảng); niêm yết theo shop, đồng bộ sang shop khác |
| Kho | tồn theo kho, lịch sử biến động, kiểm kê, chuyển kho |
| Nhập hàng | danh sách phiếu (trạng thái badge), **trang** phiếu nhập mới (dòng hàng ở cột chính; nhà cung cấp, kho, phí, thanh toán, tổng ở cột phụ; "Lưu nháp / Nhận hàng & lưu"), trang chi tiết phiếu, nhà cung cấp, công nợ NCC |
| Khách hàng | danh sách theo shop (lọc nhãn, mệnh, cột riêng), thêm khách vào shop, hồ sơ (đơn, mệnh, hạng, nhãn, thông tin riêng, ghi chú), xoá khỏi shop, gộp trùng, xuất file |
| Loyalty & Campaign | hôm nay nên liên hệ (nhắc mua lại, sinh nhật), gợi ý theo mệnh, hạng khách, mẫu tin nhắn, tự động hoá (chưa có) |
| Chi phí & đối soát | tab Chi phí (danh sách, thêm nhanh, chọn phương thức trả), Quỹ tiền (số dư, chuyển quỹ, kiểm đếm, sổ quỹ), Đối soát sàn (chọn sàn) |
| Báo cáo | các tab: Doanh thu, Lợi nhuận (kèm ước tính thuế), Chi phí, Kênh, Sản phẩm (lọc danh mục), Khách, Kho, Tiền & công nợ (số dư quỹ, dòng tiền, tuổi nợ), Chỉ số tuỳ chỉnh, Sức khoẻ; xuất Excel từng tab |
| Cách đọc số liệu | 5 câu hỏi sức khoẻ kinh doanh có màu và việc nên làm, màu nghĩa là gì, từ điển các con số |
| Cài đặt | shop, kho, nền tảng bán hàng và kênh, ngưỡng sức khoẻ và cách chia chi phí chung, trường tuỳ chỉnh, thuế ước tính, API key, webhook, sao lưu, mật khẩu |

### Phong cách
- Nhận diện, bảng màu và quy tắc dùng màu: xem mục 7A. Token màu nằm ở `brand/tokens.css`.
- Số tiền căn phải, định dạng `1.250.000 ₫`. Số 0 luôn là `0 ₫`, không bao giờ `-0 ₫` (sửa trong `vnd()` ở `web/src/lib.js`).
- **Màu nền ít lớp**: ô nhập dùng nền thẻ (`--paper`) và viền 1px trung tính `--field-border` (≥ 3:1), focus đổi viền sang màu nhấn; không dùng nền xám đặc cho ô nhập. Hàng nhấn ("Áp dụng cho tất cả", dòng tổng) dùng nền rất nhạt `--tint` hoặc một đường kẻ, không dùng màu be đậm. Mỗi trang chỉ một màu nhấn đặc: nút chính.
- **Căn lề nhất quán**: mọi dòng trong một thẻ có cùng đệm trái/phải, kể cả dòng tổng in đậm (báo cáo tài chính dùng `.fin-row`); dòng nhóm thụt vào, dòng tổng có kẻ trên.
- Trang giao diện không dùng ngôi "cậu/tớ" (app nhiều tài khoản): dùng câu mệnh lệnh trung tính hoặc "bạn".
- Màu trạng thái đơn là ngoại lệ chức năng (nháp xám, xác nhận xanh dương, đang giao tím, hoàn thành xanh lá, huỷ đỏ, trả hàng cam), đã giảm bão hoà trong `tokens.css` để hợp tông.
- Nút bấm cao ≥ 44px trên điện thoại.
- **Mật độ giao diện**: máy tính gọn kiểu CRM, điện thoại giữ ≥44px và chữ ô nhập 16px. Cỡ chữ, chiều cao ô, padding bảng/thẻ/modal là token trên `:root` (`--fs-base`, `--control-h`, `--cell-py`, `--h1`, `--kpi`…) trong `web/src/styles.css`; từ 900px trở lên đổi sang giá trị gọn (chữ 14px, ô 36px, bảng 9px 12px). Không viết cứng cỡ chữ/chiều cao ô, dùng token.
- **Thang thiết kế (cập nhật 2026-11-08)**, token ở `web/src/styles.css`, không viết số lẻ ngoài thang:
  - **Khoảng cách**: chỉ bội số của 4 (`--sp-1…--sp-10` = 4, 8, 12, 16, 20, 24, 32, 40). Riêng 2px chỉ cho chỉnh quang học rất nhỏ. Chiều cao ô nhập, nút, tab đều là bội số của 4 (máy tính 36/32, điện thoại 44/40); tab nằm trong khung đệm 4px nên tổng bằng chiều cao ô nhập.
  - **Chữ**: 6 bậc 12 · 13 · 14 · 16 · 20 · 24 (số hero lớn riêng). Dòng chữ thường cao 20px. Ô nhập 16px trên điện thoại (iOS không tự phóng to).
  - **Độ đậm**: 400 chữ thường; 500 nhãn, tiêu đề cột, nút phụ, tab; 600 chữ cần đọc trước (tiêu đề, số chính, tab đang chọn, nút chính). Không dùng 700.
  - **Bề mặt và viền**: phân tầng bằng sắc độ trước, viền sau: nền trang `--bg` → thẻ `--paper` → vùng lõm `--thead`/`--tint`. Viền thẻ `--rule` rất mảnh và mờ (champagne 38%), kẻ dòng `--hair` (walnut 7%). Viền đậm `--field-border` chỉ cho ô nhập và nút (cần ≥ 3:1). Thẻ không lồng thẻ.
- **Ô nhập tiền** dùng `components/MoneyInput.jsx` (hiện `1.250.000`, giữ số nguyên, căn phải), không dùng `<input type=number>`.

---

## 7A. Thương hiệu & nhận diện

Tên: **Mở Sổ**. Nghĩa đen là mở cuốn sổ ra để ghi và xem. Hợp với bản chất app: một cuốn sổ cái duy nhất cho mọi shop, mọi kênh.

### Concept: Đương đại Á Đông · Dấu vết thời gian (The Traces of Time)
Kết hợp sự tiết chế của thiết kế đương đại với cảm giác vật liệu, thủ công và không gian Á Đông. Phẳng, tĩnh, chắc: không đổ bóng, không kính mờ, không hiệu ứng nổi.

Dấu vết thời gian: mỗi đơn, mỗi lần nhập kho là một nét ghi lại. Giao diện gợi giấy dó, gỗ, gốm, dấu triện.

**Phong thuỷ là dữ liệu và bố cục, không phải đồ trang trí** (cập nhật 2026-11-03, xem nhật ký quyết định). Các yếu tố được dùng:
1. **Ngũ hành** là hệ ký hiệu có nghĩa: mệnh khách, hành của sản phẩm, doanh thu theo hành. Ký hiệu = chữ Hán (金 木 水 火 土) trong khung tròn + tên Việt. Màu ngũ hành là ngoại lệ chức năng như màu trạng thái đơn (đã giảm bão hoà, ≥ 4.5:1 trên nền giấy). Chữ Hán chỉ dùng cho 5 ký tự này (font con nhúng sẵn `web/src/fonts/han-*.woff2`, Noto Serif SC, OFL).
2. **Âm lịch + can chi** hiển thị ở thanh trên (tính bằng cùng thuật toán với server).
3. **Họa tiết nét mảnh** (chỉ nét, màu Champagne/Terracotta, không tô đặc, tối đa vài điểm nhấn mỗi màn hình): la bàn bát quái (thẻ hero, trang đăng nhập), trống đồng Đông Sơn (trạng thái trống), lôi văn (chỉ ở đường diềm dưới tiêu đề **Tổng quan** và đáy thẻ hero; các trang khác dùng tiêu đề trơn, không đường diềm).
4. **Chất liệu dạng hoạ tiết phẳng**: vân giấy dó mờ **chỉ ở trang đăng nhập và Tổng quan** (các trang khác nền phẳng), vân gỗ trên các mảng Walnut. Không dùng ảnh/texture thật, không đổ khối.
5. **Dấu triện** vuông (logo trên trang đăng nhập) và dấu "ĐÃ CHỐT" trên đơn đã thu đủ.
6. **Bố cục**: ưu tiên lệch (7:5) và khoảng trống hơn lưới đều; nhãn chữ dọc ở thẻ hero.

Vẫn **không dùng**: rồng, tiền xu, hoa văn mây/sóng, bát quái hay la bàn làm hình nền phủ kín, màu đỏ/vàng kim rực. Muốn dùng thì ghi lý do vào nhật ký quyết định trước. Quán trà hay tiệm vàng mã là điều cần tránh.

### Giao diện theo ngành bán (cập nhật 2026-11-03)
Phần phong thuỷ ở trên **chỉ áp dụng cho shop ngành phong thuỷ** (`html[data-theme=phongthuy]`). Mỗi ngành có theme riêng, đặt theo shop đang làm việc:

| Theme | Dùng cho | Bảng màu | Họa tiết |
|---|---|---|---|
| `general` | Bán lẻ chung, "Tất cả shop", màn đăng nhập | Bảng màu thương hiệu bên dưới | Kẻ dòng sổ cái ở thẻ hero. Không họa tiết khác |
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
| M14 | Kế toán kép: sổ cái dẫn xuất, báo cáo kế toán (8a); chứng từ tay, chi phí định kỳ, tài sản, khoá sổ (8b) | M5, M7, M8 | Cao |

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
| 2026-11-06 | Vật tư dùng chung `products` / `variants` và `stock_movements`; tiêu hao hạch toán từ journal kho, không tạo module chi phí thứ hai | Giữ một sổ tồn và một nguồn tài chính. Vật tư có loại riêng, không niêm yết bán; quy cách chỉ gợi ý, xác nhận thực tế mới trừ kho. |
| 2026-11-06 | Số lượng vật tư hỗ trợ tối đa 3 số lẻ theo đơn vị cơ sở; chưa tự quy đổi đơn vị mua | Quy đổi cuộn/thùng cần hệ số do người dùng khai báo. Không tự đoán quy cách và làm sai tồn. |
| 2026-11-06 | Chưa hiển thị báo cáo tồn lâu cho đến khi có tracking lô | Không được gán ngày nhập cũ cho tồn còn lại khi chưa biết chính xác lô nào còn. |
| 2026-11-06 | Cân đối phát sinh có góc nhìn theo shop; Cân đối kế toán luôn toàn tài khoản; Tổng quan lọc kết quả và phải thu nhưng giữ tiền, tồn kho, phải trả NCC toàn tài khoản | Bút toán chung và số dư tài khoản không được chia theo shop một cách giả tạo; góc nhìn theo shop phải nói rõ phạm vi. |
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
| 2026-11-06 | Giữ hồ sơ khách hàng chung toàn tài khoản; không tách hồ sơ theo shop | Quyết định chính thức của chủ shop: một hồ sơ và SĐT chuẩn hoá dùng xuyên các shop để nhận diện đúng cùng một người. Membership, nhãn và thông tin riêng theo shop vẫn giữ nguyên; nút sao chép hồ sơ giữa shop không cần thiết. Loyalty tiếp tục hoãn. |
| 2026-11-06 | Tiền khách gửi được theo dõi theo shop tạo khoản; không ghi như tiền mặt | Số dư là khoản shop còn nợ khách (3388), có thể dùng lại hoặc đổi hàng trong cùng shop. Hạch toán riêng khỏi quỹ để số tiền mặt/ngân hàng không tăng giả. Trả hàng sàn có trạng thái chờ nhận; tồn kho chỉ tăng khi xác nhận hàng đã về. |
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
| 2026-11-04 | Shop có danh sách kho xếp ưu tiên (`shop_warehouses`) thay cho một kho mặc định; đơn tự lấy từ kho đầu rồi tới kho sau | Hàng thật nằm ở nhiều chỗ; một đơn thiếu ở kho này vẫn bán được nếu kho kia còn. `default_warehouse_id` giữ nguyên và đồng bộ với kho đầu để code cũ không vỡ. |
| 2026-11-04 | Giá vốn lưu thành tổng tiền `order_lines.cogs_amount`, phân bổ lưu ở `order_line_allocations` với giá vốn chụp từng kho | Hai kho có giá bình quân khác nhau thì đơn giá trung bình của dòng không nguyên; nhân ngược `unit_cost × SL` sẽ lệch vài đồng. Cộng số nguyên theo phần thì đúng từng đồng (nguyên tắc 1). Hoàn kho/trả hàng đi đúng phần đã chụp nên không phải tính lại giá vốn. |
| 2026-11-04 | Trả một phần hoàn theo LIFO phân bổ; cho chọn kho nhận khác | Phiếu trả không ghi hàng đến từ kho nào. LIFO xác định được, dễ giải thích; kho nhận khác vì hàng trả có thể nhập về chỗ khác, giá vốn hoàn vẫn là giá đã chụp. |
| 2026-11-04 | `/variants` không truyền `warehouse_id` thì tính tổng các kho của shop cho cả biến thể đơn và combo | Trước đây biến thể đơn ra 0 còn combo cộng mọi kho, không nhất quán. Tổng theo kho của shop đúng với những gì đơn thật sự lấy được. |
| 2026-11-04 | Trường tuỳ chỉnh bắt buộc chỉ chặn khi yêu cầu xoá/để trống nó | Bắt mọi lần lưu phải đủ trường bắt buộc khiến bản ghi cũ (tạo trước khi trường được đặt bắt buộc) không sửa được ô nào. Giao diện vẫn hiện dấu * và nhắc nhẹ. |
| 2026-11-04 | Lưu trữ kho còn trong danh sách kho của shop trả 409 `WAREHOUSE_IN_USE`; `force` gỡ kho khỏi các shop (có audit); kho duy nhất của shop không bao giờ lưu trữ được (`WAREHOUSE_LAST`) | Lưu trữ lặng lẽ khiến shop trỏ vào kho đã ẩn, đơn không biết lấy hàng ở đâu. |
| 2026-11-04 | Bỏ biến thể phải qua bước xác nhận liệt kê cái xoá hẳn / cái lưu trữ (`POST /products/:id/removal-preview`) | Bỏ giá trị thuộc tính từng âm thầm ngừng bán hoặc xoá biến thể. |
| 2026-11-04 | Job hằng ngày dọn ảnh tải lên chưa gắn sản phẩm quá 7 ngày: đánh dấu `archived_at`, chỉ xoá file đó | Ảnh tải lên rồi bỏ dở tích tụ mãi trong data/uploads. Ảnh đang gắn sản phẩm/biến thể không bao giờ bị đụng. |
| 2026-11-04 | Sổ kế toán chia tab thành 3 nhóm (Nghiệp vụ / Sổ / Báo cáo); số dư quỹ âm hiện màu đỏ kèm gợi ý | 12 tab tràn ngang bị cắt. Quỹ âm thường là thu chi chưa ghi hoặc thiếu số dư đầu kỳ. |
| 2026-11-04 | Mật độ giao diện theo token: gọn trên máy tính (≥900px), thoáng trên điện thoại (ô ≥44px, chữ ô nhập 16px) | Cỡ chữ và ô nhập cho điện thoại làm giao diện máy tính to và loãng như app di động; chữ ô nhập <16px làm iOS tự phóng to. |
| 2026-11-04 | Ngày sinh và năm sinh thành thông tin chung của khách (cột trên `customers`), không còn là trường riêng của từng shop. **Sửa một phần** quyết định 2026-11-03 “Mệnh/ngày sinh chuyển sang trường tuỳ chỉnh của từng shop” (mệnh ghi đè và các thông tin khác vẫn theo shop) | Ngày sinh là thông tin cá nhân, giống nhau ở mọi shop; bắt nhập lại ở từng shop thì lệch (đã gặp ca hai shop ghi hai ngày khác nhau) và nhắc sinh nhật, tính tuổi, tính mệnh phải đọc nhiều nơi. Migration 028 gom giá trị, ẩn trường cũ (không xoá), viết lại công thức, ghi ca lệch vào `audit_log`. |
| 2026-11-04 | Mệnh hiển thị giá trị hiệu lực (ghi đè hoặc tự tính, có nhãn nguồn); trường vai trò `element` chỉ là ô ghi đè | Ô mệnh hiện “—” dù thẻ Mệnh bên trên đã ra “Mộc” làm chủ shop tưởng mất dữ liệu. |
| 2026-11-04 | Công thức: phép tính ngày, `AGE`/`DAY`/`DATE`/`MONTHS_BETWEEN`, kiểm kiểu lúc lưu, lý do khi trống | `TODAY() - {ngày sinh}` ra trống mà không báo, chủ shop nghi do thứ tự tạo trường (thực ra trường công thức luôn tính lúc đọc). Trống thì phải nói vì sao; phép sai phải bị chặn lúc lưu chứ không lặng lẽ ra trống. Công thức “Số tuổi” kiểu `TODAY() - {ngày}` được migration viết lại thành `AGE`, vì nay phép trừ ra số ngày. |
| 2026-11-04 | Cho xoá hẳn trường tuỳ chỉnh (có snapshot vào `audit_log`, chặn khi còn công thức dùng); thêm `default_value`; `applyIndustry` không tạo lại trường mẫu đã xoá | Chỉ có “Ẩn” thì danh sách trường cứ dài ra. Quy ước 6 cấm xoá cứng dữ liệu nghiệp vụ, nên trường có dữ liệu phải xác nhận và lưu bản sao như “xoá khách khỏi shop”. Nhớ trường đã xoá bằng chính `audit_log` để không thêm bảng. |
| 2026-11-04 | Cảnh báo “chưa lưu” của form dạng trang chốt mốc ở lần chạm đầu của người dùng, không dùng đồng hồ 150ms | Đồng hồ chạy đua với nạp dữ liệu chậm và các bước tự điền; mốc theo sự kiện người dùng thì tất định. |
| 2026-11-04 | Đổi slogan "Dấu vết của thời gian" → **"Hành Trình Phương Đông"** (thanh bên, trang đăng nhập, `logo-lockup.svg`) | Slogan mới nói hành trình làm ăn trên mảnh đất phương đông. Tên concept thiết kế "Dấu vết thời gian" (mục 7A) giữ nguyên vì là ngôn ngữ thiết kế, không phải slogan. Chữ trong lockup tạo lại outline bằng Noto Serif SemiBold. |
| 2026-11-04 | Nền tảng bán hàng dạng plugin (`platforms.js`), bật/tắt từng nền tảng; thêm TikTok Shop và Zalo; bỏ code cứng Shopee ở phương thức thanh toán, đối soát, import; đối soát theo từng sàn | Chủ shop bán thêm TikTok Shop và chưa muốn thấy nền tảng mình không dùng. Mặc định giữ Shopee + Facebook để tài khoản cũ không đổi hành vi. Tắt chỉ lưu trữ kênh (không xoá dữ liệu) và chặn tạo đơn mới ở kênh tắt; phương thức payout luôn hợp lệ kể cả khi nền tảng tắt để thanh toán cũ không thành rác. Mẫu import TikTok dựng theo tên cột công khai, chưa kiểm với file thật nên ghi rõ trong mẫu. |
| 2026-11-04 | Ngũ hành chuyển từ cột `products.elements` sang trường sản phẩm riêng của từng shop phong thuỷ (`product_fields` của ngành, vai trò `element`); migration 021 tạo trường cho shop phong thuỷ đang có và chép giá trị cho sản phẩm niêm yết ở shop đó, giữ cột cũ | Ngũ hành chỉ có nghĩa ở shop phong thuỷ, cùng nguyên tắc với mệnh của khách (thông tin riêng theo shop). Cột chung buộc mọi shop thấy ô ngũ hành. Báo cáo đọc theo shop của đơn nên tổng 5 hành + "chưa gán" vẫn bằng doanh thu hàng. Phải đổi chỉ mục khoá trường: trước đây khoá trường sản phẩm duy nhất toàn hệ thống nên hai shop không cùng có `ngu_hanh` được. |
| 2026-11-04 | Ảnh sản phẩm lưu file trên đĩa (`data/uploads/<tài khoản>/`) có bảng chỉ mục `product_images`, phục vụ qua route cần đăng nhập; ảnh riêng của biến thể ở `variants.image_id` (không phải `product_images.variant_id`) | Nhúng ảnh vào SQLite làm file DB và bản sao lưu phình nhanh. Phục vụ file tĩnh công khai sẽ lộ ảnh giữa các tài khoản, nên tra id trong DB của tài khoản đang đăng nhập. Một ảnh dùng chung được cho nhiều biến thể (cùng màu khác size) nên con trỏ nằm ở biến thể. Ảnh gỡ chỉ lưu trữ để không mất dữ liệu. |
| 2026-11-04 | Bỏ biến thể khỏi ma trận: xoá hẳn nếu chưa từng dùng, lưu trữ nếu đã có lịch sử kho/đơn/nhập/kiểm kê | Đúng quy ước 6 (chỉ xoá cứng dữ liệu nháp chưa phát sinh gì); biến thể có tồn đầu kỳ đã có biến động nên chỉ lưu trữ. |
| 2026-11-04 | Cho chuyển sản phẩm đã tạo sang ma trận, thêm/đổi tên/xoá thuộc tính; đổi nhãn là thao tác riêng (`option_renames`) áp lên mọi biến thể giữ id; ánh xạ biến thể → tổ hợp phải 1-1 (`OPTION_INCOMPLETE`, `OPTIONS_CONFLICT`) | Phiên bản đầu khoá cấu trúc thuộc tính khiến shop "tạo sản phẩm không biến thể rồi sau bán thêm mùi/size" phải tạo sản phẩm trùng, tách lịch sử kho và đơn. Đổi tên không còn nguy hiểm vì là đổi nhãn có kiểm soát chứ không phải xoá rồi sinh lại; kiểm 1-1 trong một transaction chặn việc hai biến thể rơi vào cùng tổ hợp. |
| 2026-11-04 | Lưu trữ danh mục còn sản phẩm bị chặn, kèm tuỳ chọn chuyển sản phẩm sang danh mục khác trong cùng giao dịch | Lưu trữ lặng lẽ sẽ để sản phẩm trỏ vào danh mục ẩn; chọn danh mục đã lưu trữ làm cha/nhãn cũng bị chặn. |
| 2026-11-04 | Trường tuỳ chỉnh: danh mục biến có nhãn thay cho cột thô, xem trước công thức, một trình quản lý trường dùng chung | Chủ shop không biết gõ biến nào. Cột thô từ `PRAGMA` lộ id, JSON và cột khách cũ; nay chỉ biến có nhãn, kiểm lúc tạo/sửa (công thức cũ vẫn đọc được). Xem trước báo lỗi đúng vị trí thay vì chỉ báo lỗi lúc lưu. Hai bản quản lý trường (Cài đặt, Khách hàng) hợp thành một để khỏi lệch nhau. |
| 2026-11-04 | Từ điển chỉ số một nguồn `metrics.js` + ⓘ tại chỗ + dải phạm vi, thay vì chỉ trang hướng dẫn riêng | Chủ shop không biết số lấy ở đâu, tính cho shop nào hay cả hệ thống. Giải thích phải nằm ngay cạnh con số, và phạm vi phải nói rõ vì có số không theo bộ lọc (nợ NCC, số dư quỹ, thuế, tồn kho tính đến hôm nay). |
| 2026-11-04 | Kế toán kép **dẫn xuất từ chứng từ bằng trigger + sinh lại**, không ghi bút toán trong code nghiệp vụ | Cùng mẫu với `daily_stats` đã chứng minh trong dự án: trigger bắt mọi đường thay đổi (kể cả SQL trực tiếp, import) nên không thể quên; sinh lại từ trạng thái hiện tại nên sửa/huỷ đơn không cần bút toán đảo; một bộ quy tắc duy nhất (`posting.js`) khớp cách báo cáo đếm, có `verifyJournal` và test đối chiếu KQKD, quỹ, tồn kho, công nợ với báo cáo. Đổi lại: bút toán không bất biến (phải khoá sổ ở 8b), sổ chỉ cập nhật khi đọc. |
| 2026-11-04 | Chứng từ tay = bút toán `manual` + bảng `vouchers` (tiêu đề), không nhét vào `cash_entries`; `cash/balanceOf` cộng thêm dòng tiền của chúng và nguyên giá tài sản | `cash_entries.kind` có CHECK, đổi phải dựng lại bảng cùng trigger; bút toán tay đã là nguồn sự thật của sổ cái nên số dư quỹ đọc thẳng từ chúng thì không thể lệch. Đổi lại: chứng từ tay không được lập trước ngày mở sổ của quỹ. |
| 2026-11-04 | Khấu hao dẫn xuất theo "hôm nay" và làm mới một lần mỗi ngày bằng mốc `journal_meta` | Khấu hao thay đổi theo thời gian mà không có sự kiện nào kích hoạt trigger. Mốc ngày giữ chi phí gần 0 khi cùng ngày, và đồng hồ giả (`clock.js`) cho test kiểm qua nhiều tháng không cần chờ. |
| 2026-11-04 | Khấu hao không đưa vào "Lợi nhuận ròng ước tính" của Báo cáo; chỉ có ở KQKD kế toán, kèm dòng "lãi thuần trước khấu hao" | Giai đoạn này không đổi số của Báo cáo; khấu hao không phải một dòng chi phí. Chi phí định kỳ là chi phí thật nên có ở cả hai. Ghi rõ ở giao diện và `metrics.js` để hai con số lệch không gây hiểu nhầm. |
| 2026-11-04 | Khoá sổ chặn chứng từ tay/chi phí/thanh toán/quỹ/tài sản, chỉ cảnh báo với đơn và phiếu nhập (so ảnh chụp số dư lúc khoá) | Đơn sàn import muộn là bình thường nên chặn sẽ mất dữ liệu; nhưng số kỳ đã chốt đổi thì phải thấy ngay. Chi phí định kỳ rơi vào kỳ khoá bị bỏ qua thay vì lặng lẽ sửa kỳ đã chốt. |
| 2026-11-04 | Phiếu trả hàng theo mô hình KiotViet/MISA: hàng trả, hoàn ship, phí trả hàng, ship chiều về, cần trả khách, tiền trả khách; thêm `refund_owed_amount` (còn nợ khách) | Rà soát thấy trả hàng không hoàn tiền làm sổ (131 dư Có) và báo cáo (chặn công nợ ở 0, đơn vẫn "đã thu đủ") nói khác nhau, và không có cách ghi "shop giữ lại tiền" dù chủ shop coi đó là doanh thu. KiotViet/Sổ Bán Hàng có sẵn các khoản này; kế toán TT200 giảm trừ doanh thu bằng 5212. |
| 2026-11-04 | Giá trị hàng trả làm tròn luỹ kế (luỹ kế sau lần này − tổng đã trả) thay vì làm tròn riêng từng lần | Dòng 100đ có 3 cái trả 3 lần ra 99đ, phạm quy ước 14. Trừ theo tổng đã ghi (kể cả phiếu cũ) nên phiếu cũ không làm lệch; `npm run check-returns` chỉ báo, không sửa số đã chụp. |
| 2026-11-04 | Phí trả hàng ghi vào tài khoản mới 5118 (không dùng 711); `returned_amount` của đơn đổi nghĩa thành "giảm số phải thu", phần hàng thuần tách ra `returned_goods_amount` | 711 chỉ có điều chỉnh kho/quỹ không thuộc shop và không có trong báo cáo, nên dùng sẽ làm sổ lệch báo cáo. Giữ `returned_amount` làm số giảm phải thu để mọi công thức công nợ (báo cáo, tuổi nợ, đối soát sàn) không phải sửa. |
| 2026-11-04 | Doanh thu thuần báo cáo chỉ gồm hàng; phí trả hàng là dòng riêng cộng vào lãi gộp (kế hoạch ban đầu muốn cộng thẳng vào doanh thu thuần) | Báo cáo theo sản phẩm/ngũ hành chia doanh thu theo dòng hàng và phải cộng ra đúng doanh thu thuần; phí trả hàng không thuộc dòng nào. Lãi và (doanh thu thuần + phí trả hàng) vẫn không đổi khi shop giữ trọn tiền. |
| 2026-11-04 | Kênh sàn: không có hoàn ship, phí trả hàng, tiền trả khách | Sàn tự hoàn tiền cho người mua rồi trừ vào tiền trả shop; shop không giữ tiền của người mua. |
| 2026-11-04 | Giảm họa tiết và lớp nền: đường lôi văn/kẻ đôi dưới tiêu đề và vân giấy dó chỉ còn ở Tổng quan và đăng nhập (mọi theme); ô nhập đổi từ nền xám đặc sang nền thẻ + viền trung tính; mỗi trang tối đa ba lớp trước nội dung (header, thanh công cụ, nội dung), tab thành segmented | Chủ shop nhận xét bản trước "nhức đầu, thiếu trực quan, thiếu tách bạch": năm dải ngang trước nội dung trang Nhập hàng, vân sóng làm nhiễu nền, nhiều màu nền cạnh tranh nhau trong ô nhập. Phong thuỷ vẫn là dữ liệu (ngũ hành, âm lịch) và bố cục; chỉ bớt phần trang trí lặp ở mọi trang. |
| 2026-11-04 | Form tạo/sửa sản phẩm, combo, phiếu nhập thành trang đầy đủ (hai cột 8:4, thanh lưu dính đáy, cảnh báo chưa lưu), không còn popup; popup giữ cho việc ngắn | Popup dài hơn 6 ô khó điền trên điện thoại và không thấy tổng thể; ma trận biến thể cần chỗ rộng. Trang có URL riêng nên mở lại/chia sẻ được. Payload API không đổi (các component form giữ nguyên props `init/onClose/onSaved`, test cũ làm chuẩn). |
| 2026-11-04 | Bỏ màn Bán nhanh (POS), chỉ còn `/orders/new` | Hai giao diện tạo đơn làm chủ shop rối. Form đơn đã có đủ thứ POS có (tìm SKU, khách, thu tiền, "Bán xong") nên chỉnh cho nhanh (kênh mặc định trực tiếp, focus ô tìm, phần ít dùng gập lại) thay vì giữ hai nơi. |
| 2026-11-07 | Dùng shadcn/ui cho **hộp thoại (`Modal`) và khung giải thích ⓘ (`MetricInfo`)**; giao diện còn lại giữ CSS thuần theo token. Tailwind v4 cách ly: không nhập preflight, chỉ quét `web/src/components/ui` (`source(none)`), mọi thứ nằm trong `@layer`, màu ánh xạ thẳng vào token Mở Sổ (không tạo biến `:root` mới vì `--accent` của thương hiệu trùng tên với shadcn). Hộp thoại vẫn phẳng (viền mảnh, không đổ bóng), điện thoại là tấm trượt từ đáy | Chủ shop muốn dùng shadcn. Chuyển cả app sang shadcn nghĩa là viết lại gần như toàn bộ CSS (bảng, thẻ, tab, ô nhập đều gắn với token và quy tắc mật độ) và Tailwind preflight sẽ reset đè lên giao diện hiện có, mà không thêm được gì cho người dùng. Chỗ shadcn/Radix làm tốt hơn hẳn là hành vi: `Modal` cũ chỉ có phím Esc, không giữ focus trong hộp thoại, không trả focus, không khoá cuộn nền; ⓘ cũ cố định giữa đáy màn hình, không bám nút. Quy ước khi thêm thành phần shadcn: đặt trong `web/src/components/ui`, bỏ bóng đổ và class lạ, dùng token thay vì mã màu; muốn dùng thêm Select/Tabs thì cân nhắc riêng (Select của Radix kém trên điện thoại so với `<select>` gốc; Tabs của Radix kích hoạt khi nhấn chuột xuống nên các test dùng `fireEvent.click` phải sửa). |
| 2026-11-08 | Chuẩn hoá thang khoảng cách (bội 4), thang chữ 6 bậc, độ đậm 400/500/600, viền thẻ và kẻ dòng mờ hơn, tiêu đề bảng lõm nhẹ thay cho kẻ | Đo trên 10 trang: chỉ 40% khoảng cách nằm trên lưới 4px (nhiều 9, 6, 14, 10px), 13 cỡ chữ khác nhau (6 cỡ nằm trong khoảng 2,5px), 58% chữ ở độ đậm 600 nên chữ quan trọng không nổi. Sau chỉnh: 95% khoảng cách bội 4, 8 cỡ chữ, 600 còn 25% số đoạn chữ. Viền champagne 75% làm thẻ trông "đóng khung"; hạ về 38% và để sắc độ nền gánh phân tầng. Không đổi bảng màu thương hiệu, không đổi giá trị tương phản (đo lại 3.864 mẫu, 0 lỗi). |
| 2026-11-08 | Tab có nền trượt, bộ lọc đổi ngả màu nhấn khi đang lọc, mũi tên select tự vẽ, popup công thức tách khối | Tab/chip tĩnh khó thấy đang ở đâu; mũi tên select gốc dính viền; popup công thức có chip xếp rải rác. Tab và chip dùng `useSlider` (nền giấy chạy tới nút được chọn, tắt khi giảm chuyển động); select có ô trống đầu mà đang chọn giá trị khác thì viền/nền ngả `--seal` (CSS `:has`); popup: ô gõ → kết quả thử → mẫu → bảng chèn Biến/Hàm có ô tìm, dạng hàng thay cho chip. Vẫn phẳng, không đổ bóng. |
| 2026-11-08 | Phiếu nhập có lựa chọn ship trả cho bên vận chuyển: vào giá vốn, không vào nợ NCC, ghi 3388 | Trước đó ship chỉ có thể nằm trong số nợ NCC (nợ NCC hiện dư, không có chỗ ghi khoản trả hãng vận chuyển) hoặc ghi thành chi phí riêng (giá vốn thấp hơn thực tế, chi phí kỳ nhập bị đội). Dùng cột riêng `carrier_amount` thay vì sửa `total_amount` để mọi chỗ tính nợ NCC (`total − paid`) giữ nguyên. |
| 2026-11-08 | Chốt kỳ kho theo ngày + chụp tồn, chặn ghi lùi, đơn import vào kỳ chốt thì kẹp sang ngày đầu kỳ mở; đóng kho chỉ khi hết hàng | Tham khảo cách Katana (ngày chốt khoá mọi chứng từ ảnh hưởng tồn, lùi được) và MISA (khoá sổ kho tách khỏi sổ tiền, danh sách chứng từ chưa xử lý hiện trước khi khoá). Chặn cứng đơn import muộn sẽ làm mất đơn thật nên kẹp ngày, như khoá sổ kế toán không chặn đơn. Giá trị tồn tính từ sổ kho (không phụ thuộc thứ tự ghi) để chụp lại được kể cả khi chốt về sau. Kho đã đóng mà còn hàng thì hàng "mồ côi" trong kho ẩn. |
| 2026-11-08 | Trang "Cách đọc số liệu" thành trang Hướng dẫn hệ thống; tài liệu API viết lại có mô tả tiếng Việt cho từng route và test bắt buộc đủ mô tả | Người dùng cần một chỗ học cả hệ thống, sức khoẻ kinh doanh chỉ là một bài. Tài liệu API trước chỉ là bảng route tự sinh, không nói route làm gì; danh sách route vẫn lấy từ app đang chạy, mô tả nằm ở `server/modules/system/apidocs/catalog.js`, thiếu mô tả là test đỏ. |
| 2026-11-08 | Nền theme chung và phong thuỷ nhạt hơn: chung `#f6f3ee`/thẻ `#fdfcf9`, phong thuỷ `#f7f4ee`/`#fefdfa` | Hai theme này còn ngả vàng đậm so với nước hoa và ô tô, chủ shop thấy nhức mắt. Chữ/nền tăng lên 14.3–14.4:1, terracotta/nền 5.2–5.3:1 (trước 13.9 và 5.1). |
| 2026-11-08 | Cho chỉnh màu giao diện từng shop (chủ đạo + nền), có "về màu mặc định" của chủ đề; gỡ kho là một quy trình có cảnh báo, chuyển hàng, xác nhận bằng tên kho, xoá hẳn chỉ khi kho chưa từng dùng | Chủ shop muốn mỗi shop một sắc thái nhưng bảng màu thương hiệu phải giữ đọc được: chỉ cho đổi hai màu, chặn tương phản thấp ở cả máy chủ lẫn giao diện. Gỡ kho đụng tới tồn, shop, đơn nháp và lịch sử; nghiên cứu cách KiotViet/Odoo xử lý (kho phải về 0, kho có lịch sử chỉ lưu trữ) và áp quy ước "không xoá cứng dữ liệu nghiệp vụ" của dự án. |
| 2026-11-08 | Thêm thiết lập phương pháp giá vốn: bình quân (mặc định) hoặc FIFO; không làm LIFO | Hỏi chủ shop: giá nhập lên xuống nhiều thì bình quân che mất chênh lệch từng đợt. FIFO cần lớp giá, nên xuất qua nhiều lớp được tách thành nhiều biến động/phân bổ để mọi đơn giá vẫn là số nguyên và các công thức cộng đúng từng đồng. LIFO bị loại vì Thông tư 200 không có (các nguồn tra cứu mâu thuẫn, chưa đối chiếu nguyên văn) và không được IFRS chấp nhận. Đổi phương pháp giữ nguyên giá trị tồn và giá vốn đã chụp. |
| 2026-11-08 | Không huỷ đơn đang giao; giao không thành là phiếu trả chờ hàng về; lý do trả hàng có mã; hàng hỏng tự lập phiếu hàng huỷ; ship shop tự trả có ô nhập và phiếu trả cho mọi kênh; thêm trang Chứng từ | Chủ shop chỉ ra huỷ đơn đang giao cộng tồn ngay dù hàng còn ở hãng vận chuyển. Chờ hàng về đã có cho đơn sàn nên mở cho mọi kênh thay vì làm trạng thái mới. Phiếu hàng huỷ để lại dấu vết nhưng không đổi cách tính (giá vốn vẫn ở 632) vì báo cáo không đếm 811: chuyển sang 811 sẽ làm sổ kế toán lệch báo cáo lãi gộp. Ship shop tự trả trước đây chỉ API nhận và nợ 3388 treo mãi; nay có phiếu trả để cân. |
| 2026-11-08 | Sửa đơn đã xác nhận, tách đơn, giữ hàng, thời hạn trả hàng/bảo hành, vận chuyển + đối soát COD bằng file, đối soát sàn lệch, giá theo kênh, khuyến mãi trong Loyalty, lô/hạn dùng (FEFO) | Chủ shop hỏi các sự cố hay gặp chưa xử lý. Tham khảo: Sapo/GHN (công thức đối soát COD, lịch đối soát riêng từng hãng, file Excel), Shopee Seller Center (báo cáo thu nhập theo mã đơn, khiếu nại đơn chưa trả sau 7 ngày). Chọn đối soát bằng file thay vì API hãng vì API cần khoá từng hãng và chưa thử được. Phần lệch đối soát sàn cộng vào phí sàn của đơn để lãi từng đơn đúng. Khuyến mãi tính ở máy chủ vì số giảm ảnh hưởng doanh thu. Lô là sổ phụ để không đổi cách tính tồn và giá vốn. |
| 2026-11-08 | Nhập sản phẩm hàng loạt, hạn nợ + nhắc nợ, xem nhật ký thay đổi, thông báo cho chủ shop (trong app, Telegram, webhook), nhãn giao hàng, quà tặng kèm khác sản phẩm; không làm bảng giá sỉ | Chủ shop không bán sỉ nên bỏ bảng giá sỉ. Thông báo: không có hạ tầng gửi tin riêng nên chọn Telegram (HTTP đơn giản, không cần thư viện) và sự kiện webhook để nối Zalo/email; email SMTP và Zalo OA cần khoá và thử thật nên để sau. Token bot tách khỏi bảng settings vì settings đi vào nhật ký và trả qua API. Quà tặng đặt ở khuyến mãi (cùng module) chứ không thêm cơ chế riêng; quà tính vào giá vốn đơn để lãi thật. |
| 2026-11-08 | Gỡ sản phẩm: xoá hẳn chỉ khi chưa từng dùng, còn lại ngừng kinh doanh (khôi phục được); còn hàng phải xác nhận xuất huỷ; chặn khi còn trong combo/đơn nháp | Các hệ thống tra được (Odoo, DealPOS) đều không cho xoá khi còn tham chiếu và dẫn sang lưu trữ. Dự án cấm xoá cứng dữ liệu nghiệp vụ nên cùng hướng. Xuất huỷ bắt buộc vì tồn của sản phẩm ẩn sẽ làm giá trị kho và sổ kế toán lệch khỏi hàng thật. Tắt `PATCH archived` để mọi đường gỡ đều qua kiểm tra. |
