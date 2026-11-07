import { GROUPS, EXAMPLES, ERROR_CODES, parseRoutes } from './catalog.js';
import { EVENT_TYPES } from '../events.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const oaPath = (p) => p.replace(/:([A-Za-z_]+)/g, '{$1}');
const pathParams = (p) => [...p.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]);

/** Các route thật đang chạy ('METHOD /path', bỏ tiền tố /api/v1) */
export function liveRoutes(app) {
  const seen = new Set();
  for (const rt of app.routes) {
    if (!rt.path.startsWith('/api/v1') || rt.method === 'ALL') continue;
    const p = rt.path.replace('/api/v1', '').replace(/\/$/, '') || '/';
    seen.add(`${rt.method} ${p}`);
  }
  return [...seen];
}

/** Gộp mô tả tay với route thật: route nào chưa có mô tả rơi vào nhóm "Chưa mô tả" (test sẽ báo) */
export function buildCatalog(app) {
  const described = parseRoutes();
  const key = (r) => `${r.method} ${r.path}`;
  const live = new Set(liveRoutes(app));
  const items = described.filter((r) => live.has(key(r)));
  const known = new Set(described.map(key));
  const missing = [...live].filter((k) => !known.has(k)).map((k) => { const [method, path] = k.split(' '); return { group: 'other', method, path, summary: 'Chưa có mô tả', params: [] }; });
  const stale = described.filter((r) => !live.has(key(r))).map(key);
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((r) => r.group === g.id) }));
  if (missing.length) groups.push({ id: 'other', title: 'Chưa mô tả', intro: 'Các route chưa có trong catalog.', items: missing });
  return { groups, missing: missing.map(key), stale };
}

export function openapi(app, origin = '') {
  const { groups } = buildCatalog(app);
  const paths = {};
  for (const g of groups) {
    for (const r of g.items) {
      const p = `/api/v1${oaPath(r.path)}`;
      const ex = EXAMPLES[`${r.method} ${r.path}`];
      const op = {
        tags: [g.title],
        summary: r.summary,
        ...(g.session ? { description: 'Chỉ dùng được khi đăng nhập bằng cookie phiên, không dùng API key.', 'x-session-only': true } : {}),
        parameters: [
          ...pathParams(r.path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
          ...r.params.map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
        ],
        ...(ex ? { requestBody: { required: true, content: { 'application/json': { example: ex.body, ...(ex.note ? { schema: { description: ex.note } } : {}) } } } } : {}),
        responses: {
          200: { description: 'Thành công. Thân: { "data": … }' },
          400: { description: 'VALIDATION_ERROR hoặc lỗi nghiệp vụ 400' },
          401: { description: 'UNAUTHORIZED' },
          409: { description: 'Xung đột nghiệp vụ (xem bảng mã lỗi)' },
        },
      };
      (paths[p] ||= {})[r.method.toLowerCase()] = op;
    }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Mở Sổ API',
      version: '1.0.0',
      description: 'Xác thực bằng `Authorization: Bearer tk_live_…` (tạo ở Cài đặt → API & webhook) hoặc cookie phiên. Tiền là số nguyên VND. Lỗi: `{"error":{"code","message","details"}}`. POST tạo đơn/phiếu nhập hỗ trợ header `Idempotency-Key`. Phân trang con trỏ: `limit`, `cursor`.',
    },
    servers: [{ url: origin || '/' }],
    tags: groups.map((g) => ({ name: g.title, description: g.intro })),
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API key dạng tk_live_…' } } },
    security: [{ bearer: [] }],
    paths,
  };
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function curlFor(r, origin) {
  const ex = EXAMPLES[`${r.method} ${r.path}`];
  const url = `${origin}/api/v1${r.path.replace(/:([A-Za-z_]+)/g, '<$1>')}`;
  const lines = [`curl ${r.method === 'GET' ? '' : `-X ${r.method} `}'${url}${r.method === 'GET' && r.params.length ? `?${r.params.slice(0, 2).map((p) => `${p}=…`).join('&')}` : ''}'`, `  -H 'Authorization: Bearer $MOSO_KEY'`];
  if (ex) { lines.push(`  -H 'Content-Type: application/json'`); if (/^(POST \/orders|POST \/purchases)$/.test(`${r.method} ${r.path}`)) lines.push(`  -H 'Idempotency-Key: $(uuidgen)'`); lines.push(`  -d '${JSON.stringify(ex.body)}'`); }
  return lines.join(' \\\n');
}

const CSS = `
:root{--bg:#f6f3ee;--paper:#fdfcf9;--ink:#301f12;--soft:#5c4a3b;--rule:#e6dccb;--seal:#633d37;--terra:#865c49;--code:#f1ece2;--get:#33566f;--post:#42633f;--put:#8a4e14;--patch:#6a4a70;--del:#a23a30}
@media (prefers-color-scheme:dark){:root{--bg:#1d1611;--paper:#271e17;--ink:#efe6d6;--soft:#bfae98;--rule:#3b2e24;--seal:#d9a99f;--terra:#c9a58f;--code:#1a130e;--get:#8fb4d0;--post:#9dc39a;--put:#e0a867;--patch:#c7a3cc;--del:#e5948b}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
a{color:var(--terra)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);max-width:1280px;margin:0 auto}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;padding:24px 16px;border-right:1px solid var(--rule)}
nav h2{font-family:inherit;font-weight:600;font-size:12px;line-height:1;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);margin:24px 8px 8px}
nav a{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:8px;color:var(--ink);text-decoration:none;font-size:14px}
nav a:hover{background:var(--code)}nav a small{color:var(--soft)}
.brand{font:600 20px/1.2 Georgia,"Times New Roman",serif;padding:0 8px}.brand small{display:block;font:400 13px/1.4 inherit;color:var(--soft);margin-top:4px}
main{padding:32px 32px 96px;min-width:0}
h1{font:600 32px/1.2 Georgia,"Times New Roman",serif;margin:0 0 8px}
h2.sec{font:600 22px/1.3 Georgia,"Times New Roman",serif;margin:48px 0 8px}h3{font-size:16px;margin:24px 0 8px}
.lead{color:var(--soft);max-width:68ch;margin:0 0 16px}
.card{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:16px 20px;margin:16px 0}
pre{background:var(--code);border-radius:8px;padding:12px 16px;overflow-x:auto;margin:8px 0;line-height:1.55}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--rule);vertical-align:top}th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft);font-weight:500}
.search{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--paper);color:var(--ink);font:inherit;margin-bottom:16px}
.ep{background:var(--paper);border:1px solid var(--rule);border-radius:10px;margin:8px 0}
.ep summary{display:flex;align-items:baseline;gap:12px;padding:10px 16px;cursor:pointer;list-style:none;flex-wrap:wrap}
.ep summary::-webkit-details-marker{display:none}.ep[open] summary{border-bottom:1px solid var(--rule)}
.m{display:inline-block;min-width:56px;text-align:center;font:600 11px/1 ui-monospace,Menlo,monospace;padding:5px 6px;border-radius:6px;color:#fff}
.m.GET{background:var(--get)}.m.POST{background:var(--post)}.m.PUT{background:var(--put)}.m.PATCH{background:var(--patch)}.m.DELETE{background:var(--del)}
@media (prefers-color-scheme:dark){.m{color:#1a130e}}
.p{font-weight:500}.s{color:var(--soft);flex:1 1 240px}
.ep .body{padding:12px 16px 16px}.tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:var(--code);color:var(--soft);margin-right:6px}
.tag.warn{background:color-mix(in srgb,var(--put) 16%,transparent);color:var(--put)}
.copy{float:right;font-size:12px;border:1px solid var(--rule);background:var(--paper);color:var(--soft);border-radius:6px;padding:2px 8px;cursor:pointer}
.hidden{display:none}.note{font-size:13px;color:var(--soft)}
@media(max-width:900px){.layout{grid-template-columns:1fr}nav{position:static;height:auto;border:0;border-bottom:1px solid var(--rule)}main{padding:24px 16px 64px}}
`;

const JS = `
const q=document.getElementById('q');
q&&q.addEventListener('input',()=>{const t=q.value.trim().toLowerCase();document.querySelectorAll('.ep').forEach(e=>{e.classList.toggle('hidden',!!t&&!e.dataset.s.includes(t))});document.querySelectorAll('section.grp').forEach(s=>{s.classList.toggle('hidden',!!t&&!s.querySelector('.ep:not(.hidden)'));if(t&&!s.classList.contains('hidden'))s.querySelectorAll('.ep:not(.hidden)').forEach(e=>e.open=true)})});
document.addEventListener('click',e=>{const b=e.target.closest('.copy');if(!b)return;navigator.clipboard&&navigator.clipboard.writeText(b.nextElementSibling.textContent).then(()=>{const o=b.textContent;b.textContent='Đã chép';setTimeout(()=>b.textContent=o,1200)})});
`;

export function renderDocs(app, origin) {
  const { groups } = buildCatalog(app);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const nav = groups.map((g) => `<a href="#${slug(g.id)}"><span>${esc(g.title)}</span><small>${g.items.length}</small></a>`).join('');
  const sections = groups.map((g) => `
<section class="grp" id="${slug(g.id)}">
  <h2 class="sec">${esc(g.title)}${g.session ? ' <span class="tag warn">chỉ đăng nhập</span>' : ''}</h2>
  <p class="lead">${esc(g.intro)}</p>
  ${g.items.map((r) => {
    const ex = EXAMPLES[`${r.method} ${r.path}`];
    const pp = pathParams(r.path);
    return `<details class="ep" data-s="${esc(`${r.method} ${r.path} ${r.summary}`.toLowerCase())}">
    <summary><span class="m ${r.method}">${r.method}</span><code class="p">${esc(r.path)}</code><span class="s">${esc(r.summary)}</span></summary>
    <div class="body">
      ${WRITE.has(r.method) && !g.session ? '<span class="tag">cần quyền write</span>' : ''}${g.session ? '<span class="tag warn">không dùng API key</span>' : ''}
      ${pp.length || r.params.length ? `<h3>Tham số</h3><table><tbody>${pp.map((n) => `<tr><td><code>${n}</code></td><td>trên đường dẫn</td></tr>`).join('')}${r.params.map((n) => `<tr><td><code>${esc(n)}</code></td><td>truy vấn, không bắt buộc</td></tr>`).join('')}</tbody></table>` : ''}
      ${ex ? `<h3>Ví dụ thân yêu cầu</h3>${ex.note ? `<p class="note">${esc(ex.note)}</p>` : ''}<pre>${esc(JSON.stringify(ex.body, null, 2))}</pre>` : ''}
      <h3>Gọi thử</h3><button class="copy" type="button">Chép</button><pre>${esc(curlFor(r, origin))}</pre>
    </div></details>`;
  }).join('')}
</section>`).join('');

  const errRows = ERROR_CODES.map(([c, s, d]) => `<tr><td><code>${c}</code></td><td>${s}</td><td>${esc(d).replace(/`([^`]+)`/g, '<code>$1</code>')}</td></tr>`).join('');
  const events = EVENT_TYPES.map((e) => `<code>${e}</code>`).join(' · ');

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mở Sổ API v1</title><style>${CSS}</style></head><body>
<div class="layout">
<nav><div class="brand">Mở Sổ API<small>v1 · ${total} đường dẫn</small></div>
<h2>Bắt đầu</h2><a href="#bat-dau">Xác thực &amp; gọi thử</a><a href="#quy-uoc">Quy ước chung</a><a href="#loi">Mã lỗi</a><a href="#webhook">Webhook</a>
<h2>Tài nguyên</h2>${nav}</nav>
<main>
<h1>Mở Sổ API</h1>
<p class="lead">Mọi thứ giao diện làm được thì API cũng làm được. Dùng để nối phần mềm kế toán, Zapier, hoặc viết công cụ riêng. Đặc tả máy đọc: <a href="${origin}/api/v1/docs/openapi.json">openapi.json</a> (nhập được vào Postman, Insomnia, Swagger).</p>

<h2 class="sec" id="bat-dau">Xác thực &amp; gọi thử</h2>
<div class="card"><p><b>1.</b> Vào <b>Cài đặt → API &amp; webhook → Tạo API key</b>. Khoá dạng <code>tk_live_…</code> chỉ hiện một lần, chép lại ngay. Chọn <code>read</code> để chỉ xem, thêm <code>write</code> để tạo/sửa.</p>
<p><b>2.</b> Gửi khoá trong header <code>Authorization</code>:</p>
<pre>export MOSO_KEY=tk_live_xxxxxxxx
curl '${origin}/api/v1/shops' \\
  -H "Authorization: Bearer $MOSO_KEY"</pre>
<p><b>3.</b> Kết quả luôn nằm trong <code>data</code>:</p>
<pre>{ "data": [ { "id": "shp_01J…", "name": "Nước hoa ô tô", … } ] }</pre>
<p class="note">Mỗi API key thuộc đúng một tài khoản và chỉ thấy dữ liệu của tài khoản đó. Nhóm “Hệ thống” và “Đăng nhập” chỉ dùng được khi đăng nhập bằng giao diện, không dùng được bằng API key.</p></div>

<h2 class="sec" id="quy-uoc">Quy ước chung</h2>
<div class="card"><table><tbody>
<tr><td><b>Tiền</b></td><td>Số nguyên VND (đồng). Không có số thập phân, không có dấu phân cách. <code>1250000</code> là 1.250.000 ₫.</td></tr>
<tr><td><b>Số lượng</b></td><td>Số nguyên; vật tư hỗ trợ tối đa 3 số lẻ.</td></tr>
<tr><td><b>ID</b></td><td>Chuỗi có tiền tố: <code>shp_</code> shop, <code>whs_</code> kho, <code>prd_</code> sản phẩm, <code>var_</code> biến thể, <code>cus_</code> khách, <code>ord_</code> đơn, <code>pur_</code> phiếu nhập, <code>exp_</code> chi phí. Mã hiển thị cho người đọc (<code>DH-261103-001</code>) là trường riêng, không dùng làm ID.</td></tr>
<tr><td><b>Thời gian</b></td><td>ISO-8601 UTC (<code>2026-11-03T03:04:05.000Z</code>). Báo cáo theo ngày dùng ngày kinh doanh giờ Việt Nam (<code>YYYY-MM-DD</code>). Tham số <code>from</code>, <code>to</code> tính cả hai đầu.</td></tr>
<tr><td><b>Phân trang</b></td><td><code>?limit=50&amp;cursor=…</code>. Trả <code>next_cursor</code>; hết dữ liệu thì <code>null</code>. Truyền lại đúng giá trị đó cho trang kế.</td></tr>
<tr><td><b>Chống trùng</b></td><td>Gửi header <code>Idempotency-Key: &lt;chuỗi duy nhất&gt;</code> khi tạo đơn hoặc phiếu nhập. Gửi lại cùng khoá trả kết quả cũ, không tạo thêm.</td></tr>
<tr><td><b>Nhiều giá trị</b></td><td>Một số bộ lọc nhận nhiều giá trị cách nhau dấu phẩy: <code>shop_id=a,b</code>, <code>status=confirmed,shipping</code>.</td></tr>
<tr><td><b>Không xoá cứng</b></td><td>Dữ liệu nghiệp vụ được lưu trữ (<code>archived_at</code>) hoặc huỷ, không xoá khỏi sổ. Các route <code>DELETE</code> phần lớn là huỷ/lưu trữ.</td></tr>
</tbody></table></div>

<h2 class="sec" id="loi">Mã lỗi</h2>
<p class="lead">Lỗi luôn có dạng <code>{ "error": { "code", "message", "details" } }</code> kèm mã HTTP tương ứng. Dựa vào <code>code</code> để xử lý, không dựa vào <code>message</code> (câu chữ có thể đổi).</p>
<div class="card"><table><thead><tr><th>Mã</th><th>HTTP</th><th>Ý nghĩa</th></tr></thead><tbody>${errRows}</tbody></table>
<p class="note">Bảng chỉ liệt kê các mã hay gặp. Mỗi route còn có mã riêng của nghiệp vụ, đều dạng chữ hoa gạch dưới.</p></div>

<h2 class="sec" id="webhook">Webhook</h2>
<p class="lead">Đăng ký URL và danh sách sự kiện ở Cài đặt → API &amp; webhook (hoặc <code>POST /system/webhooks</code>). Mỗi sự kiện gửi một <code>POST</code> JSON tới URL của bạn.</p>
<div class="card"><h3>Header</h3><table><tbody>
<tr><td><code>X-Moso-Event</code></td><td>Loại sự kiện, ví dụ <code>order.created</code></td></tr>
<tr><td><code>X-Moso-Delivery</code></td><td>ID lần gửi. Dùng để bỏ qua bản trùng.</td></tr>
<tr><td><code>X-Moso-Signature</code></td><td><code>sha256=</code> + HMAC-SHA256 của thân yêu cầu, khoá là secret của webhook</td></tr></tbody></table>
<h3>Thân</h3><pre>{
  "id": "evt_01J…",
  "type": "order.created",
  "created_at": "2026-11-03T03:04:05.000Z",
  "shop_id": "shp_01J…",
  "entity": { "type": "order", "id": "ord_01J…" },
  "data": { … }
}</pre>
<h3>Kiểm tra chữ ký (Node.js)</h3><pre>import crypto from 'node:crypto';
function valid(rawBody, header, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(header || '');
  return a.length === b.length &amp;&amp; crypto.timingSafeEqual(a, b);
}</pre>
<h3>Kiểm tra chữ ký (Python)</h3><pre>import hmac, hashlib
def valid(raw_body: bytes, header: str, secret: str) -&gt; bool:
    expected = 'sha256=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or '')</pre>
<p class="note"><b>Quan trọng:</b> tính chữ ký trên thân thô (bytes nhận được), không parse rồi dựng lại JSON.</p>
<h3>Gửi lại khi thất bại</h3><p>Trả mã 2xx trong 10 giây là thành công. Ngược lại app thử lại sau 1 phút, 5 phút, 30 phút, 2 giờ, 12 giờ (tối đa 6 lần). Xem log và gửi lại tay ở Cài đặt → API &amp; webhook.</p>
<h3>Sự kiện</h3><p>${events}</p></div>

<h2 class="sec" style="margin-top:56px">Tài nguyên</h2>
<input class="search" id="q" type="search" placeholder="Tìm đường dẫn hoặc mô tả, ví dụ: đơn, kho, /orders…" aria-label="Tìm trong tài liệu">
${sections}
</main></div><script>${JS}</script></body></html>`;
}
