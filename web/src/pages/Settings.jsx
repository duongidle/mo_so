import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Tabs, Empty, ErrorBox, Field, Modal, useAction, useAsync } from '../components/ui.jsx';
import { vnd, fmtDate } from '../lib.js';

const TABS = [['shops', 'Shop & kho'], ['health', 'Ngưỡng & kho'], ['fields', 'Trường tuỳ chỉnh'], ['metrics', 'Chỉ số báo cáo'], ['api', 'API & webhook'], ['backup', 'Sao lưu & xuất'], ['account', 'Tài khoản']];

export default function Settings() {
  const [tab, setTab] = useState('shops');
  return (
    <div className="page stack">
      <div className="page-head"><h1>Cài đặt</h1></div>
      <Tabs options={TABS} value={tab} onChange={setTab} />
      {tab === 'shops' && <Shops />}{tab === 'health' && <Thresholds />}{tab === 'fields' && <Fields />}
      {tab === 'metrics' && <Metrics />}{tab === 'api' && <ApiAndHooks />}{tab === 'backup' && <Backup />}{tab === 'account' && <Account />}
    </div>
  );
}

function Shops() {
  const { shops, warehouses, industries, reload } = useSession();
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    const isShop = f.type === 'shop';
    const base = isShop ? '/shops' : '/warehouses';
    const payload = isShop ? { code: f.code, name: f.name, industry: f.industry || 'general', default_warehouse_id: f.default_warehouse_id || null, receipt_footer: f.receipt_footer || null, phone: f.phone || null, address: f.address || null } : { code: f.code, name: f.name, address: f.address || null };
    if (f.id) await api.patch(`${base}/${f.id}`, payload); else await api.post(base, payload);
    setF(null); reload();
  });
  return (
    <>
      <Card title="Shop" actions={<button className="btn sm" onClick={() => setF({ type: 'shop', code: '', name: '', default_warehouse_id: warehouses[0]?.id })}>+ Shop</button>}>
        {shops.map((s) => <div key={s.id} className="pick" onClick={() => setF({ type: 'shop', ...s })}><span><b>{s.name}</b> <span className="muted small">{s.code}</span></span><span className="row"><span className="badge plain">{industries.find((i) => i.id === s.industry)?.name || 'Bán lẻ chung'}</span><span className="muted small">Kho: {warehouses.find((w) => w.id === s.default_warehouse_id)?.name || '—'}</span></span></div>)}
      </Card>
      <Card title="Kho" actions={<button className="btn sm" onClick={() => setF({ type: 'wh', code: '', name: '' })}>+ Kho</button>}>
        {warehouses.map((w) => <div key={w.id} className="pick" onClick={() => setF({ type: 'wh', ...w })}><span><b>{w.name}</b> <span className="muted small">{w.code}</span></span></div>)}
      </Card>
      {f && (
        <Modal title={`${f.id ? 'Sửa' : 'Thêm'} ${f.type === 'shop' ? 'shop' : 'kho'}`} onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy} onClick={save}>Lưu</button>}>
          <div className="grid cols-2"><Field label="Tên"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field><Field label="Mã (dùng trong mã chứng từ)"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field></div>
          {f.type === 'shop' && <>
            <Field label="Ngành bán" hint={industries.find((i) => i.id === (f.industry || 'general'))?.description}>
              <select value={f.industry || 'general'} onChange={(e) => setF({ ...f, industry: e.target.value })}>{industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            </Field>
            {f.id && f.industry && f.industry !== shops.find((x) => x.id === f.id)?.industry && <div className="alert warn small">Đổi ngành sẽ đổi giao diện của shop{industries.find((i) => i.id === f.industry)?.customer_field_labels.length ? ` và thêm các trường thông tin khách: ${industries.find((i) => i.id === f.industry).customer_field_labels.join(', ')}` : ''}. Trường và dữ liệu khách đã có của shop vẫn được giữ nguyên.</div>}
            <Field label="Kho mặc định (trừ hàng khi bán)"><select value={f.default_warehouse_id || ''} onChange={(e) => setF({ ...f, default_warehouse_id: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Điện thoại in trên phiếu"><input value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Dòng cuối phiếu bán hàng"><input value={f.receipt_footer || ''} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} /></Field></>}
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

function Thresholds() {
  const { settings, reload } = useSession();
  const [s, setS] = useState(() => structuredClone(settings));
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const LABEL = { gross_margin_pct: 'Biên lợi nhuận gộp (%)', cancel_rate_pct: 'Tỷ lệ huỷ đơn (%)', return_rate_pct: 'Tỷ lệ hoàn trả (%)', days_of_inventory: 'Số ngày tồn kho', repeat_rate_pct: 'Tỷ lệ khách mua lại (%)' };
  const th = (k, f, v) => setS({ ...s, health_thresholds: { ...s.health_thresholds, [k]: { ...s.health_thresholds[k], [f]: Number(v) } } });
  return (
    <Card title="Ngưỡng sức khoẻ & kho">
      <div className="stack">
        {Object.entries(s.health_thresholds).map(([k, t]) => (
          <div key={k} className="grid cols-3">
            <span style={{ alignSelf: 'center' }}>{LABEL[k] || k}<div className="small muted">{t.direction === 'higher_better' ? 'càng cao càng tốt' : 'càng thấp càng tốt'}</div></span>
            <Field label="Vàng khi"><input type="number" value={t.warn} onChange={(e) => th(k, 'warn', e.target.value)} /></Field>
            <Field label="Đỏ khi"><input type="number" value={t.bad} onChange={(e) => th(k, 'bad', e.target.value)} /></Field>
          </div>
        ))}
        <div className="grid cols-2">
          <Field label="Cảnh báo sắp hết khi còn ít hơn (ngày bán)"><input type="number" min="1" value={s.low_stock_days} onChange={(e) => setS({ ...s, low_stock_days: Number(e.target.value) })} /></Field>
          <Field label="Hàng bán chậm: không bán trong (ngày)"><input type="number" min="1" value={s.slow_moving_days} onChange={(e) => setS({ ...s, slow_moving_days: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Chi phí chung chia về shop theo"><select value={s.expense_allocation} onChange={(e) => setS({ ...s, expense_allocation: e.target.value })}><option value="revenue">Doanh thu thuần</option><option value="equal">Chia đều</option></select></Field>
        <label className="check"><input type="checkbox" checked={s.allow_negative_stock} onChange={(e) => setS({ ...s, allow_negative_stock: e.target.checked })} />Cho phép bán âm kho (không khuyến khích)</label>
        <ErrorBox error={error} />{saved && <div className="alert ok">Đã lưu.</div>}
        <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.patch('/settings', s); setSaved(true); reload(); })}>Lưu</button></div>
      </div>
    </Card>
  );
}

const ENT = { product: 'Sản phẩm', order: 'Đơn hàng', purchase: 'Phiếu nhập' }; // trường của khách cài trong trang Khách hàng, theo từng shop
const FT = { text: 'Văn bản', number: 'Số', money: 'Tiền', date: 'Ngày', select: 'Chọn một', multiselect: 'Chọn nhiều', boolean: 'Có/Không', formula: 'Công thức' };
function Fields() {
  const { shops } = useSession();
  const state = useAsync(() => api.get('/custom/fields'), []);
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <>
      <Card title="Trường tuỳ chỉnh" actions={<button className="btn sm" onClick={() => setF({ entity_type: 'order', key: '', label: '', type: 'text', options: '', formula: '', shop_id: '' })}>+ Trường</button>}>
        <p className="small muted" style={{ marginTop: 0 }}>Dành cho sản phẩm, đơn hàng, phiếu nhập. Thông tin khách (mệnh, mùi yêu thích…) là của từng shop: cài trong trang <b>Khách hàng</b> → “Thông tin khách của shop”.</p>
        <Async state={state}>{({ data }) => !data.length ? <Empty>Chưa có trường nào.</Empty> : data.map((x) => (
          <div key={x.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
            <span><b>{x.label}</b> <code className="small">{`{custom.${x.key}}`}</code><div className="small muted">{ENT[x.entity_type]} · {FT[x.type]}{x.formula && ` = ${x.formula}`}{x.shop_id && ` · riêng ${shops.find((s) => s.id === x.shop_id)?.name}`}</div></span>
            <button className="btn sm" onClick={() => confirm('Ẩn trường này? Giá trị đã nhập vẫn được giữ.') && run(async () => { await api.patch(`/custom/fields/${x.id}`, { archived: true }); state.reload(); })}>Ẩn</button>
          </div>
        ))}</Async>
        <ErrorBox error={error} />
      </Card>
      {f && (
        <Modal title="Thêm trường tuỳ chỉnh" onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => {
          await api.post('/custom/fields', { entity_type: f.entity_type, key: f.key, label: f.label, type: f.type, shop_id: f.shop_id || null, ...(f.type === 'formula' ? { formula: f.formula } : {}), ...(['select', 'multiselect'].includes(f.type) ? { options: f.options.split(',').map((x) => x.trim()).filter(Boolean) } : {}) });
          setF(null); state.reload();
        })}>Lưu</button>}>
          <div className="grid cols-2">
            <Field label="Áp dụng cho"><select value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })}>{Object.entries(ENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Kiểu"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(FT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Nhãn hiển thị"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
            <Field label="Khoá (a-z, 0-9, _)" hint="Dùng trong công thức"><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
          </div>
          {['select', 'multiselect'].includes(f.type) && <Field label="Các lựa chọn, ngăn bằng dấu phẩy"><input value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} /></Field>}
          {f.type === 'formula' && <Field label="Công thức" hint="Ví dụ: {total_amount} - {cogs_amount} - {custom.phi_dong_goi}. Hàm: IF, ROUND, MIN, MAX, ABS, DAYS_BETWEEN, TODAY"><input value={f.formula} onChange={(e) => setF({ ...f, formula: e.target.value })} /></Field>}
          <Field label="Phạm vi" hint="Toàn hệ thống để cộng gộp được giữa các shop"><select value={f.shop_id} onChange={(e) => setF({ ...f, shop_id: e.target.value })}><option value="">Toàn hệ thống</option>{shops.map((s) => <option key={s.id} value={s.id}>Chỉ {s.name}</option>)}</select></Field>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

function Metrics() {
  const { shops } = useSession();
  const state = useAsync(() => api.get('/custom/metrics'), []);
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <>
      <Card title="Chỉ số báo cáo tuỳ chỉnh" actions={<button className="btn sm" onClick={() => setF({ key: '', name: '', formula: '', format: 'number', shop_id: '' })}>+ Chỉ số</button>}>
        <p className="small muted">Công thức trên số liệu tổng hợp của kỳ báo cáo: {'{net_revenue}'}, {'{gross_profit}'}, {'{order_count}'}, {'{cogs}'}, {'{platform_fee}'}, {'{expenses_amount}'}, {'{net_profit_estimate}'}, {'{aov}'}…</p>
        <Async state={state}>{({ data }) => !data.length ? <Empty>Chưa có chỉ số.</Empty> : data.map((m) => (
          <div key={m.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}><span><b>{m.name}</b><div className="small muted"><code>{m.formula}</code>{m.shop_id && ` · ${shops.find((s) => s.id === m.shop_id)?.name}`}</div></span>
            <button className="btn sm" onClick={() => run(async () => { await api.del(`/custom/metrics/${m.id}`); state.reload(); })}>Xoá</button></div>
        ))}</Async>
      </Card>
      {f && (
        <Modal title="Thêm chỉ số" onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/custom/metrics', { ...f, shop_id: f.shop_id || null }); setF(null); state.reload(); })}>Lưu</button>}>
          <div className="grid cols-2"><Field label="Tên"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Khoá"><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field></div>
          <Field label="Công thức"><input value={f.formula} onChange={(e) => setF({ ...f, formula: e.target.value })} placeholder="{net_revenue} / {order_count}" /></Field>
          <div className="grid cols-2">
            <Field label="Định dạng"><select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="number">Số</option><option value="money">Tiền</option><option value="percent">Phần trăm</option></select></Field>
            <Field label="Áp dụng cho"><select value={f.shop_id} onChange={(e) => setF({ ...f, shop_id: e.target.value })}><option value="">Mọi shop</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

function ApiAndHooks() {
  const keys = useAsync(() => api.get('/system/api-keys'), []);
  const hooks = useAsync(() => api.get('/system/webhooks'), []);
  const evts = useAsync(() => api.get('/system/webhook-events'), []);
  const [newKey, setNewKey] = useState(null);
  const [kf, setKf] = useState(null);
  const [hf, setHf] = useState(null);
  const [deliv, setDeliv] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <>
      <Card title="API key" actions={<><a className="btn sm" href="/api/v1/docs" target="_blank" rel="noreferrer">Tài liệu API</a><button className="btn sm" onClick={() => setKf({ name: '', write: false })}>+ Tạo key</button></>}>
        <Async state={keys}>{({ data }) => !data.length ? <Empty>Chưa có API key.</Empty> : data.map((k) => (
          <div key={k.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
            <span><b>{k.name}</b> <code className="small">{k.prefix}…</code><div className="small muted">{k.scopes.join(' + ')} · {k.last_used_at ? `dùng ${fmtDate(k.last_used_at)}` : 'chưa dùng'}{k.revoked_at && ' · ĐÃ THU HỒI'}</div></span>
            {!k.revoked_at && <button className="btn sm danger" onClick={() => confirm(`Thu hồi key “${k.name}”? Ứng dụng đang dùng sẽ ngừng chạy.`) && run(async () => { await api.del(`/system/api-keys/${k.id}`); keys.reload(); })}>Thu hồi</button>}
          </div>
        ))}</Async>
      </Card>
      <Card title="Webhook" actions={<button className="btn sm" onClick={() => setHf({ name: '', url: '', all: true, types: [] })}>+ Webhook</button>}>
        <Async state={hooks}>{({ data }) => !data.length ? <Empty>Chưa có webhook. Dùng để đẩy đơn/khách sang phần mềm kế toán.</Empty> : data.map((h) => (
          <div key={h.id} className="row between wrap" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
            <span><b>{h.name}</b>{!h.active && <span className="muted"> (tắt)</span>}<div className="small muted">{h.url} · {h.event_types.join(', ')}</div></span>
            <span className="row"><button className="btn sm" onClick={async () => setDeliv({ hook: h, rows: (await api.get(`/system/webhooks/${h.id}/deliveries`)).data })}>Nhật ký</button>
              {h.active && <button className="btn sm danger" onClick={() => run(async () => { await api.del(`/system/webhooks/${h.id}`); hooks.reload(); })}>Tắt</button>}</span>
          </div>
        ))}</Async>
        <ErrorBox error={error} />
      </Card>
      {kf && <Modal title="Tạo API key" onClose={() => setKf(null)} footer={<button className="btn primary" disabled={busy || !kf.name} onClick={() => run(async () => { const r = await api.post('/system/api-keys', { name: kf.name, scopes: kf.write ? ['read', 'write'] : ['read'] }); setKf(null); setNewKey(r.data.key); keys.reload(); })}>Tạo</button>}>
        <Field label="Tên (vd: Phần mềm kế toán)"><input value={kf.name} onChange={(e) => setKf({ ...kf, name: e.target.value })} autoFocus /></Field>
        <label className="check"><input type="checkbox" checked={kf.write} onChange={(e) => setKf({ ...kf, write: e.target.checked })} />Cho phép ghi (tạo đơn, sửa dữ liệu). Mặc định chỉ đọc.</label><ErrorBox error={error} />
      </Modal>}
      {newKey && <Modal title="Sao chép key ngay" onClose={() => setNewKey(null)}><div className="alert warn">Key chỉ hiện <b>một lần</b>. Đóng cửa sổ này là không xem lại được.</div><input readOnly value={newKey} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => navigator.clipboard?.writeText(newKey)}>Sao chép</button></Modal>}
      {hf && <Modal title="Thêm webhook" onClose={() => setHf(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await api.post('/system/webhooks', { name: hf.name, url: hf.url, event_types: hf.all ? ['*'] : hf.types }); setHf(null); setNewKey(r.data.secret); hooks.reload(); })}>Tạo</button>}>
        <Field label="Tên"><input value={hf.name} onChange={(e) => setHf({ ...hf, name: e.target.value })} /></Field>
        <Field label="URL nhận (http/https)"><input value={hf.url} onChange={(e) => setHf({ ...hf, url: e.target.value })} placeholder="https://…" /></Field>
        <label className="check"><input type="checkbox" checked={hf.all} onChange={(e) => setHf({ ...hf, all: e.target.checked })} />Mọi sự kiện</label>
        {!hf.all && <div className="row wrap">{evts.data?.data?.map((t) => <label key={t} className="check small"><input type="checkbox" checked={hf.types.includes(t)} onChange={(e) => setHf({ ...hf, types: e.target.checked ? [...hf.types, t] : hf.types.filter((x) => x !== t) })} />{t}</label>)}</div>}
        <p className="small muted">Mỗi lượt gửi có header X-Moso-Signature = sha256 HMAC của nội dung. Secret hiện một lần sau khi tạo.</p><ErrorBox error={error} />
      </Modal>}
      {deliv && <Modal title={`Nhật ký — ${deliv.hook.name}`} onClose={() => setDeliv(null)}>
        {!deliv.rows.length ? <Empty>Chưa gửi lần nào.</Empty> : deliv.rows.map((d) => (
          <div key={d.id} className="row between small"><span>{fmtDate(d.created_at)} · {d.event_type}</span><span className={d.status === 'success' ? 'h-green' : d.status === 'dead' ? 'h-red' : 'h-yellow'}>{d.status} ({d.attempts}){d.last_error && ` — ${d.last_error}`}
            {d.status !== 'success' && <button className="btn sm" style={{ marginLeft: 6 }} onClick={async () => { await api.post(`/system/webhook-deliveries/${d.id}/retry`); setDeliv({ ...deliv, rows: (await api.get(`/system/webhooks/${deliv.hook.id}/deliveries`)).data }); }}>Gửi lại</button>}</span></div>
        ))}
      </Modal>}
    </>
  );
}

function Backup() {
  const list = useAsync(() => api.get('/system/backups'), []);
  const exp = useAsync(() => api.get('/system/export'), []);
  const { busy, error, run } = useAction();
  return (
    <>
      <Card title="Sao lưu" actions={<><a className="btn sm" href="/api/v1/system/backup/download">Tải bản mới nhất</a><button className="btn sm primary" disabled={busy} onClick={() => run(async () => { await api.post('/system/backups'); list.reload(); })}>Sao lưu ngay</button></>}>
        <p className="small muted">Tự động mỗi ngày, giữ 14 bản ngày và 8 bản tuần trong thư mục <code>data/backups</code>. Nhớ copy thư mục này lên Google Drive / iCloud — mất máy là mất cả bản sao lưu nếu chỉ để trong máy.</p>
        <ErrorBox error={error} />
        <Async state={list}>{({ data }) => !data.length ? <Empty>Chưa có bản sao lưu.</Empty> : data.slice(0, 10).map((b) => <div key={b.name} className="row between small" style={{ padding: '6px 0' }}><a href={`/api/v1/system/backups/${b.name}`}>{b.name}</a><span className="muted">{Math.round(b.size / 1024)} KB · {fmtDate(b.created_at)}</span></div>)}</Async>
      </Card>
      <Card title="Xuất CSV"><div className="row wrap"><Async state={exp}>{({ data }) => data.map((t) => <a key={t} className="btn sm" href={`/api/v1/system/export/${t}.csv`}>{t}</a>)}</Async></div></Card>
    </>
  );
}

function Account() {
  const [f, setF] = useState({ current_password: '', new_password: '' });
  const { busy, error, run } = useAction();
  const [ok, setOk] = useState(false);
  return (
    <Card title="Đổi mật khẩu"><div className="stack" style={{ maxWidth: 360 }}>
      <Field label="Mật khẩu hiện tại"><input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" /></Field>
      <Field label="Mật khẩu mới (tối thiểu 8 ký tự)"><input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" /></Field>
      <ErrorBox error={error} />{ok && <div className="alert ok">Đã đổi. Các thiết bị khác sẽ phải đăng nhập lại.</div>}
      <div><button className="btn primary" disabled={busy || f.new_password.length < 8} onClick={() => run(async () => { await api.post('/auth/change-password', f); setOk(true); setF({ current_password: '', new_password: '' }); })}>Đổi mật khẩu</button></div>
    </div></Card>
  );
}
