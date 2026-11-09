import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import NotificationSettings from './NotificationSettings.jsx';
import AuditLog from './AuditLog.jsx';
import RemoveWarehouse from '../components/RemoveWarehouse.jsx';
import ShopColors from '../components/ShopColors.jsx';
import { colorProblem } from '../lib/colors.js';
import { Async, Card, Chips, Tabs, Empty, ErrorBox, Field, Modal, Note, useAction, useAsync, PageHeader, Toolbar } from '../components/ui.jsx';
import { vnd, fmtDate } from '../lib.js';
import FieldsManager from '../components/FieldsManager.jsx';
import FormulaEditor from '../components/FormulaEditor.jsx';
import MoneyInput from '../components/MoneyInput.jsx';

const TABS = [['shops', 'Shop & kho'], ['platforms', 'Nền tảng'], ['shipping', 'Vận chuyển'], ['health', 'Ngưỡng & kho'], ['fields', 'Trường tuỳ chỉnh'], ['metrics', 'Chỉ số báo cáo'], ['tax', 'Thuế ước tính'], ['api', 'API & webhook'], ['notify', 'Thông báo'], ['audit', 'Nhật ký'], ['backup', 'Sao lưu'], ['account', 'Tài khoản']];

export default function Settings() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'shops');
  return (
    <div className="page stack">
      <PageHeader title="Cài đặt" />
      <Toolbar><Tabs options={TABS} value={tab} onChange={setTab} wrap="lg" /></Toolbar>
      {tab === 'shops' && <Shops />}{tab === 'platforms' && <Platforms />}{tab === 'shipping' && <Carriers />}{tab === 'health' && <><Thresholds /><CostingMethod /></>}{tab === 'fields' && <Fields />}
      {tab === 'metrics' && <Metrics />}{tab === 'tax' && <Tax />}{tab === 'api' && <ApiAndHooks />}{tab === 'notify' && <NotificationSettings />}{tab === 'audit' && <AuditLog />}{tab === 'backup' && <Backup />}{tab === 'account' && <Account />}
    </div>
  );
}

function Shops() {
  const { shops, warehouses, industries, reload } = useSession();
  const [f, setF] = useState(null);
  const [rm, setRm] = useState(null); // kho đang được gỡ
  const [notice, setNotice] = useState('');
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    const isShop = f.type === 'shop';
    const base = isShop ? '/shops' : '/warehouses';
    const payload = isShop ? { code: f.code, name: f.name, industry: f.industry || 'general', receipt_footer: f.receipt_footer || null, phone: f.phone || null, address: f.address || null, ...(f.id ? { ui_colors: f.ui_colors || null } : {}) } : { code: f.code, name: f.name, address: f.address || null };
    const saved = f.id ? await api.patch(`${base}/${f.id}`, payload) : await api.post(base, payload);
    // Danh sách kho của shop (thứ tự = ưu tiên lấy hàng), kho đầu là kho chính
    if (isShop) await api.put(`/shops/${saved.data.id}/warehouses`, { warehouse_ids: f.warehouse_ids || [] });
    setF(null); reload();
  });
  return (
    <>
      <Card title="Shop" actions={<button className="btn sm" onClick={() => setF({ type: 'shop', code: '', name: '', warehouse_ids: warehouses[0] ? [warehouses[0].id] : [] })}>+ Shop</button>}>
        {shops.map((s) => <div key={s.id} className="pick" onClick={() => setF({ type: 'shop', ...s, warehouse_ids: s.warehouse_ids || [] })}><span><b>{s.name}</b> <span className="muted small">{s.code}</span></span><span className="row"><span className="badge plain">{industries.find((i) => i.id === s.industry)?.name || 'Bán lẻ chung'}</span><span className="muted small">Kho: {(s.warehouse_ids || []).map((id) => warehouses.find((w) => w.id === id)?.name).filter(Boolean).join(' → ') || '—'}</span></span></div>)}
      </Card>
      {notice && <div className="alert ok small" role="status">{notice}</div>}
      <Card title="Kho" actions={<button className="btn sm" onClick={() => setF({ type: 'wh', code: '', name: '' })}>+ Kho</button>}>
        {warehouses.map((w) => <div key={w.id} className="pick" onClick={() => setF({ type: 'wh', ...w })}><span><b>{w.name}</b> <span className="muted small">{w.code}</span></span></div>)}
      </Card>
      {rm && <RemoveWarehouse warehouse={rm} warehouses={warehouses} onClose={() => setRm(null)} onDone={(r) => { setRm(null); reload(); setNotice(r.mode === 'deleted' ? `Đã xoá kho ${r.name}.` : r.transferred ? `Đã chuyển ${r.transferred.lines} mặt hàng sang kho khác và đóng kho ${r.name}. Lịch sử cũ được giữ nguyên.` : `Đã đóng kho ${r.name}. Lịch sử cũ được giữ nguyên.`); }} />}
      {f && (
        <Modal title={`${f.id ? 'Sửa' : 'Thêm'} ${f.type === 'shop' ? 'shop' : 'kho'}`} onClose={() => setF(null)} footer={<>{f.type === 'wh' && f.id && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { setRm(f); setF(null); }}>Gỡ kho…</button>}<button className="btn primary" disabled={busy || (f.type === 'shop' && !!colorProblem(f.ui_colors || {}))} onClick={save}>Lưu</button></>}>
          <div className="grid cols-2"><Field label="Tên"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field><Field label="Mã (dùng trong mã chứng từ)"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field></div>
          {f.type === 'shop' && <>
            <Field label="Ngành bán" hint={industries.find((i) => i.id === (f.industry || 'general'))?.description}>
              <select value={f.industry || 'general'} onChange={(e) => setF({ ...f, industry: e.target.value })}>{industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            </Field>
            {f.id && f.industry && f.industry !== shops.find((x) => x.id === f.id)?.industry && <div className="alert warn small">Đổi ngành sẽ đổi giao diện của shop{industries.find((i) => i.id === f.industry)?.customer_field_labels.length ? ` và thêm các trường thông tin khách: ${industries.find((i) => i.id === f.industry).customer_field_labels.join(', ')}` : ''}. Trường và dữ liệu khách đã có của shop vẫn được giữ nguyên.</div>}
            <WarehouseOrder ids={f.warehouse_ids || []} warehouses={warehouses} onChange={(ids) => setF({ ...f, warehouse_ids: ids })} />
            <Field label="Điện thoại in trên phiếu"><input value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Dòng cuối phiếu bán hàng"><input value={f.receipt_footer || ''} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} /></Field>
            {f.id && <ShopColors value={f.ui_colors || null} themeName={industries.find((i) => i.id === (f.industry || 'general'))?.name} onChange={(ui_colors) => setF({ ...f, ui_colors })} />}</>}
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

/** Kho của shop theo thứ tự ưu tiên: đơn lấy hàng từ kho đầu tiên, thiếu thì lấy tiếp kho sau */
function WarehouseOrder({ ids, warehouses, onChange }) {
  const move = (i, d) => { const a = [...ids]; [a[i], a[i + d]] = [a[i + d], a[i]]; onChange(a); };
  const free = warehouses.filter((w) => !ids.includes(w.id));
  return (
    <Field label="Kho lấy hàng khi bán" hint="Đơn lấy từ kho trên cùng trước; thiếu thì lấy tiếp kho kế tiếp. Kho đầu là kho chính.">
      <div className="stack" style={{ gap: 8 }}>
        {ids.length === 0 && <span className="muted small">Chưa có kho nào, shop chưa bán được hàng.</span>}
        {ids.map((id, i) => (
          <div key={id} className="row between">
            <span>{i + 1}. {warehouses.find((w) => w.id === id)?.name || id}{i === 0 && <span className="muted small"> (kho chính)</span>}</span>
            <span className="row">
              <button type="button" className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
              <button type="button" className="btn sm" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
              <button type="button" className="btn sm" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label="Bỏ kho">Bỏ</button>
            </span>
          </div>
        ))}
        {free.length > 0 && (
          <select value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])} aria-label="Thêm kho">
            <option value="">+ Thêm kho…</option>
            {free.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>
    </Field>
  );
}

const FEATURE = { import: 'Nhập đơn từ file', reconciliation: 'Đối soát tiền sàn trả về' };

/** Nền tảng bán hàng: bật = kênh hiện ở bộ chọn, có mẫu import và (với sàn) đối soát tiền về. Tắt chỉ ẩn kênh, không mất dữ liệu. */
/** Hãng vận chuyển: thêm/sửa/ẩn ở đây, form giao hàng chỉ chọn từ danh sách */
export function Carriers() {
  const list = useAsync(() => api.get('/carriers', { include_archived: 1 }), []);
  const { busy, error, run } = useAction();
  const [f, setF] = useState(null);
  const save = () => run(async () => {
    const body = { name: f.name, tracking_url: f.tracking_url || null, remit_note: f.remit_note || null };
    if (f.id) await api.patch(`/carriers/${f.id}`, body); else await api.post('/carriers', body);
    setF(null); list.reload();
  });
  return (
    <>
      <Note>Hãng ở đây là danh sách để chọn khi giao đơn và đối soát COD. Ẩn một hãng chỉ bỏ nó khỏi bộ chọn, vận đơn cũ vẫn giữ.</Note>
      <Card title="Hãng vận chuyển" actions={<button className="btn sm" onClick={() => setF({ name: '', tracking_url: '', remit_note: '' })}>+ Hãng</button>}>
        <Async state={list}>{({ data }) => (
          <>
            {!data.length && <span className="muted small">Chưa có hãng nào. Thêm hãng bạn hay dùng (GHN, GHTK, Viettel Post…).</span>}
            {data.map((c) => (
              <div key={c.id} className="pick" onClick={() => setF({ ...c, tracking_url: c.tracking_url || '', remit_note: c.remit_note || '' })}>
                <span><b>{c.name}</b>{c.tracking_url && <span className="small muted"> · {c.tracking_url}</span>}</span>
                {c.archived_at && <span className="badge plain">Đã ẩn</span>}
              </div>
            ))}
          </>
        )}</Async>
      </Card>
      {f && (
        <Modal title={f.id ? 'Sửa hãng' : 'Thêm hãng'} onClose={() => setF(null)} footer={<>
          {f.id && <button className="btn" disabled={busy} onClick={() => run(async () => { await api.patch(`/carriers/${f.id}`, { archived: !f.archived_at }); setF(null); list.reload(); })}>{f.archived_at ? 'Dùng lại' : 'Ẩn hãng'}</button>}
          <button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>Lưu</button></>}>
          <Field label="Tên hãng"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus aria-label="Tên hãng" /></Field>
          <Field label="Link tra cứu (dùng {code} cho mã vận đơn)" hint="Ví dụ https://donhang.ghn.vn/?order_code={code}"><input value={f.tracking_url} onChange={(e) => setF({ ...f, tracking_url: e.target.value })} aria-label="Link tra cứu" /></Field>
          <Field label="Ghi chú đối soát"><input value={f.remit_note} onChange={(e) => setF({ ...f, remit_note: e.target.value })} aria-label="Ghi chú đối soát" placeholder="Ví dụ: đối soát thứ 2, 4, 6" /></Field>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

export function Platforms() {
  const { platforms, allChannels, reload } = useSession();
  const { busy, error, run } = useAction();
  const [f, setF] = useState(null);
  const toggle = (p) => run(async () => { await api.post(`/platforms/${p.id}/${p.enabled ? 'disable' : 'enable'}`); await reload(); });
  const custom = allChannels.filter((c) => c.id.startsWith('ch_'));
  const save = () => run(async () => {
    if (f.id) await api.patch(`/channels/${f.id}`, { name: f.name, ...(f.locked ? {} : { is_marketplace: !!f.is_marketplace }) });
    else await api.post('/channels', { name: f.name, is_marketplace: !!f.is_marketplace });
    setF(null); await reload();
  });
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>Bật nền tảng bạn đang bán. Bán trực tiếp và “Khác” luôn có. Tắt một nền tảng chỉ ẩn kênh khỏi bộ chọn, đơn cũ và tiền đang treo vẫn giữ nguyên.</p>
      <div className="grid cols-2">
        {platforms.map((p) => (
          <Card key={p.id} title={p.name} actions={<span className={`badge ${p.enabled ? 'h-green' : 'plain'}`}>{p.enabled ? 'Đang kết nối' : 'Chưa kết nối'}</span>}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="small">{p.description}</span>
              <span className="small muted">Chức năng: {p.features.map((x) => FEATURE[x] || x).join(' · ')}{p.order_count ? ` · đã có ${p.order_count} đơn` : ''}</span>
              <div><button className={`btn ${p.enabled ? '' : 'primary'}`} disabled={busy} onClick={() => toggle(p)}>{p.enabled ? 'Ngắt kết nối' : 'Kết nối'}</button></div>
            </div>
          </Card>
        ))}
      </div>
      <ErrorBox error={error} />
      <Card title="Kênh tuỳ chỉnh" actions={<button className="btn sm" onClick={() => setF({ name: '', is_marketplace: false })}>+ Kênh</button>}>
        {!custom.length && <span className="muted small">Chưa có kênh riêng. Thêm kênh cho nơi bán chưa có ở trên (cửa hàng đối tác, sàn khác…).</span>}
        {custom.map((c) => (
          <div key={c.id} className="pick" onClick={() => setF({ ...c, is_marketplace: !!c.is_marketplace, locked: false })}>
            <span><b>{c.name}</b></span>
            <span className="row"><span className="badge plain">{c.is_marketplace ? 'Sàn (sàn trừ phí rồi trả tiền)' : 'Kênh thường'}</span>{c.archived_at && <span className="badge plain">Đã tắt</span>}</span>
          </div>
        ))}
      </Card>
      {f && (
        <Modal title={f.id ? 'Sửa kênh' : 'Thêm kênh'} onClose={() => setF(null)} footer={<>
          {f.id && <button className="btn" disabled={busy} onClick={() => run(async () => { await api.patch(`/channels/${f.id}`, { archived: !f.archived_at }); setF(null); await reload(); })}>{f.archived_at ? 'Bật lại' : 'Tắt kênh'}</button>}
          <button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>Lưu</button></>}>
          <Field label="Tên kênh"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <label className="check"><input type="checkbox" checked={!!f.is_marketplace} onChange={(e) => setF({ ...f, is_marketplace: e.target.checked })} />Là sàn: sàn thu tiền khách, trừ phí rồi mới trả cho shop</label>
          <div className="small muted">Kênh sàn có đối soát tiền về (ghi nhận bằng chuyển khoản). Đã có đơn thì không đổi loại kênh được.</div>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

function Thresholds() {
  const { settings, reload, shops } = useSession();
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
        <div className="grid cols-3">
          <Field label="Khách được nợ (ngày, 0 = không đặt hạn)" hint="Hạn thanh toán mặc định cho đơn còn nợ mà không đặt hạn riêng."><input type="number" min="0" value={s.payment_terms_days ?? 0} onChange={(e) => setS({ ...s, payment_terms_days: Number(e.target.value) })} /></Field>
          <Field label="Nhận trả hàng trong (ngày, 0 = không giới hạn)" hint="Tính từ ngày đơn hoàn thành. Quá hạn vẫn nhận được nếu bạn xác nhận."><input type="number" min="0" value={s.return_window_days ?? 0} onChange={(e) => setS({ ...s, return_window_days: Number(e.target.value) })} /></Field>
          <Field label="Báo đơn sàn chưa nhận tiền sau (ngày, 0 = tắt)" hint="Đơn giao xong quá số ngày này mà sàn chưa trả: nên khiếu nại."><input type="number" min="0" value={s.payout_overdue_days ?? 10} onChange={(e) => setS({ ...s, payout_overdue_days: Number(e.target.value) })} /></Field>
          <Field label="Cảnh báo hàng sắp hết hạn dùng (ngày)" hint="Lô còn dưới số ngày này tới hạn dùng được đánh dấu sắp hết hạn."><input type="number" min="1" value={s.expiry_warn_days ?? 30} onChange={(e) => setS({ ...s, expiry_warn_days: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Chi phí chung chia về shop theo" hint="Chi phí không gắn shop nào (tiền thuê mặt bằng, phần mềm…) được chia về các shop khi xem báo cáo từng shop"><select value={s.expense_allocation} onChange={(e) => setS({ ...s, expense_allocation: e.target.value })}><option value="revenue">Doanh thu thuần (shop bán nhiều gánh nhiều)</option><option value="equal">Chia đều cho các shop</option><option value="fixed">Tỷ lệ cố định tự đặt</option></select></Field>
        {s.expense_allocation === 'fixed' && (() => {
          const fixed = s.expense_allocation_fixed || {};
          const total = shops.reduce((a, x) => a + (Number(fixed[x.id]) || 0), 0);
          return (
            <div className="stack" style={{ gap: 8 }}>
              {shops.map((x) => <div key={x.id} className="row between"><span>{x.name}</span><span className="row"><input type="number" min="0" max="100" style={{ width: 90 }} aria-label={`Tỷ lệ ${x.name}`} value={fixed[x.id] ?? ''} onChange={(e) => setS({ ...s, expense_allocation_fixed: { ...fixed, [x.id]: e.target.value === '' ? 0 : Number(e.target.value) } })} /><span className="muted">%</span></span></div>)}
              <div className={`small ${total === 100 ? 'h-green' : 'h-yellow'}`}>Tổng {total}%{total === 100 ? '' : total === 0 ? ' (chưa đặt: hệ thống sẽ chia đều)' : ' (không cộng đủ 100% cũng được, hệ thống chia theo tỷ lệ tương đối)'}</div>
            </div>
          );
        })()}
        <label className="check"><input type="checkbox" checked={s.allow_negative_stock} onChange={(e) => setS({ ...s, allow_negative_stock: e.target.checked })} />Cho phép bán âm kho (không khuyến khích)</label>
        <ErrorBox error={error} />{saved && <div className="alert ok">Đã lưu.</div>}
        <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.patch('/settings', s); setSaved(true); reload(); })}>Lưu</button></div>
      </div>
    </Card>
  );
}

/** Phương pháp tính giá vốn: bình quân gia quyền (mặc định) hoặc FIFO. LIFO không có vì không được chấp nhận trong kế toán Việt Nam (Thông tư 200). */
function CostingMethod() {
  const state = useAsync(() => api.get('/costing-method'), []);
  const { busy, error, run } = useAction();
  const [pick, setPick] = useState(null);
  return (
    <Card title="Phương pháp tính giá vốn">
      <Async state={state}>
        {({ data }) => {
          const now = data.method;
          const target = pick && pick !== now ? data.methods.find((m) => m.id === pick) : null;
          return (
            <div className="stack">
              <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label="Phương pháp giá vốn">
                {data.methods.map((m) => (
                  <label key={m.id} className="check" style={{ alignItems: 'flex-start' }}>
                    <input type="radio" name="costing" checked={(pick ?? now) === m.id} onChange={() => setPick(m.id)} />
                    <span><b>{m.label}</b>{m.id === now && <span className="badge plain" style={{ marginLeft: 8 }}>Đang dùng</span>}<div className="small muted">{m.short}</div></span>
                  </label>
                ))}
              </div>
              <div className="small muted">Không có LIFO (nhập sau xuất trước): kế toán Việt Nam không dùng phương pháp này.</div>
              {target && (
                <div className="alert warn small">
                  <b>Đổi sang {target.label}</b>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    <li>Giá trị tồn kho hiện tại ({vnd(data.stock_value)}) không đổi.</li>
                    <li>Đơn đã bán giữ nguyên giá vốn đã chụp. Phương pháp mới chỉ áp cho lần xuất kho sau đó.</li>
                    {target.id === 'fifo'
                      ? <li>Hàng đang có trong kho được coi là một lô nhập duy nhất, tại giá bình quân hiện tại. Từ giờ mỗi lần nhập là một lô giá riêng.</li>
                      : <li>Các lô giá được gộp lại: giá vốn lấy bình quân của hàng còn trong kho.</li>}
                    <li>Có thể đổi lại bất cứ lúc nào. Nên đổi đầu kỳ, sau khi chốt kho.</li>
                  </ul>
                  <div style={{ marginTop: 8 }}><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.put('/costing-method', { method: target.id }); setPick(null); state.reload(); })}>Đổi sang {target.label}</button></div>
                </div>
              )}
              <ErrorBox error={error} />
            </div>
          );
        }}
      </Async>
    </Card>
  );
}

const TAX_BASE = { net_revenue: 'Doanh thu thuần (hàng sau trả)', revenue_with_shipping: 'Doanh thu thuần + phí ship khách trả', net_profit: 'Lợi nhuận ròng ước tính' };
/** Ước tính thuế: app KHÔNG tự đặt mức thuế nào. Bạn (hoặc kế toán) nhập tỷ lệ theo quy định đang áp dụng với hộ kinh doanh của mình. */
function Tax() {
  const { settings, reload } = useSession();
  const [enabled, setEnabled] = useState(!!settings.tax_enabled);
  const [rules, setRules] = useState(() => structuredClone(settings.tax_rules || []));
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const set = (i, k, v) => { setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setSaved(false); };
  return (
    <Card title="Ước tính thuế">
      <div className="stack">
        <div className="alert warn small">Mức thuế và ngưỡng miễn thuế của hộ kinh doanh thay đổi theo từng thời kỳ nên hệ thống <b>không tự điền</b>. Nhập theo quy định đang áp dụng (hỏi kế toán hoặc chi cục thuế). Kết quả chỉ là <b>ước tính</b> để thấy lợi nhuận sau thuế, không phải tờ khai.</div>
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />Hiện ước tính thuế trong báo cáo Lợi nhuận</label>
        {rules.map((r, i) => (
          <div key={i} className="card flat stack" style={{ gap: 8 }}>
            <div className="grid cols-2 collapse">
              <Field label="Tên khoản thuế"><input value={r.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Ví dụ: Thuế GTGT" /></Field>
              <Field label="Tỷ lệ (%)"><input type="number" min="0" max="100" step="0.01" value={r.rate_pct} onChange={(e) => set(i, 'rate_pct', Number(e.target.value))} /></Field>
            </div>
            <div className="grid cols-2 collapse">
              <Field label="Tính trên"><select value={r.base} onChange={(e) => set(i, 'base', e.target.value)}>{Object.entries(TAX_BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Ngưỡng miễn thuế cả năm (₫)" hint="Chỉ phần vượt ngưỡng (cộng dồn từ đầu năm) mới chịu thuế. 0 = không có ngưỡng"><MoneyInput value={r.exempt_threshold_year ?? 0} onChange={(e) => set(i, 'exempt_threshold_year', Number(e.target.value))} /></Field>
            </div>
            <div><button className="btn sm danger" onClick={() => { setRules(rules.filter((_, j) => j !== i)); setSaved(false); }}>Xoá khoản này</button></div>
          </div>
        ))}
        <div><button className="btn sm" disabled={rules.length >= 10} onClick={() => { setRules([...rules, { name: '', rate_pct: 0, base: 'net_revenue', exempt_threshold_year: 0 }]); setSaved(false); }}>+ Khoản thuế</button></div>
        <ErrorBox error={error} />{saved && <div className="alert ok">Đã lưu.</div>}
        <div><button className="btn primary" disabled={busy || rules.some((r) => !r.name.trim())} onClick={() => run(async () => { await api.patch('/settings', { tax_enabled: enabled, tax_rules: rules }); setSaved(true); reload(); })}>Lưu</button></div>
      </div>
    </Card>
  );
}

function Fields() {
  const { shops, shop, isAll } = useSession();
  return (
    <Card title="Trường tuỳ chỉnh">
      <FieldsManager shop={isAll ? null : shop} shops={shops} />
    </Card>
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
        <p className="small muted">Công thức trên số liệu tổng hợp của kỳ báo cáo. Gõ {'{'} để chọn biến, ví dụ {'{net_revenue} / {order_count}'}.</p>
        <Async state={state}>{({ data }) => !data.length ? <Empty>Chưa có chỉ số.</Empty> : data.map((m) => (
          <div key={m.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}><span><b>{m.name}</b><div className="small muted"><code>{m.formula}</code>{m.shop_id && ` · ${shops.find((s) => s.id === m.shop_id)?.name}`}</div></span>
            <button className="btn sm" onClick={() => run(async () => { await api.del(`/custom/metrics/${m.id}`); state.reload(); })}>Xoá</button></div>
        ))}</Async>
      </Card>
      {f && (
        <Modal wide title="Thêm chỉ số" onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/custom/metrics', { ...f, shop_id: f.shop_id || null }); setF(null); state.reload(); })}>Lưu</button>}>
          <div className="grid cols-2"><Field label="Tên"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Khoá"><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field></div>
          <FormulaEditor entity="metric" shopId={f.shop_id || null} value={f.formula} onChange={(formula) => setF({ ...f, formula })} />
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
            {d.status !== 'success' && <button className="btn sm" style={{ marginLeft: 8 }} onClick={async () => { await api.post(`/system/webhook-deliveries/${d.id}/retry`); setDeliv({ ...deliv, rows: (await api.get(`/system/webhooks/${deliv.hook.id}/deliveries`)).data }); }}>Gửi lại</button>}</span></div>
        ))}
      </Modal>}
    </>
  );
}

const BACKUP_KEYS = ['backup_enabled', 'backup_time', 'backup_frequency', 'backup_weekday', 'backup_keep_days', 'backup_keep_weeks', 'backup_include_images'];
const WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Backup() {
  const { settings, reload } = useSession();
  const list = useAsync(() => api.get('/system/backups'), []);
  const status = useAsync(() => api.get('/system/backup/status'), []);
  const exp = useAsync(() => api.get('/system/export'), []);
  const [f, setF] = useState(() => Object.fromEntries(BACKUP_KEYS.map((k) => [k, settings[k]])));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k, v) => { setF({ ...f, [k]: v }); setSaved(false); };
  const refresh = () => { list.reload(); status.reload(); };
  const st = status.data?.data;
  return (
    <>
      <Card title="Lịch sao lưu tự động">
        <div className="stack">
          <label className="check"><input type="checkbox" checked={!!f.backup_enabled} onChange={(e) => set('backup_enabled', e.target.checked)} />Tự động sao lưu theo lịch</label>
          <div className="grid cols-3">
            <Field label="Giờ sao lưu"><input type="time" value={f.backup_time} disabled={!f.backup_enabled} onChange={(e) => set('backup_time', e.target.value)} /></Field>
            <Field label="Tần suất"><select value={f.backup_frequency} disabled={!f.backup_enabled} onChange={(e) => set('backup_frequency', e.target.value)}><option value="daily">Mỗi ngày</option><option value="weekly">Mỗi tuần</option></select></Field>
            {f.backup_frequency === 'weekly' && <Field label="Vào"><select value={f.backup_weekday} disabled={!f.backup_enabled} onChange={(e) => set('backup_weekday', Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></Field>}
          </div>
          <div className="grid cols-2">
            <Field label="Giữ bản của mỗi ngày trong (ngày)" hint="Mỗi ngày giữ bản mới nhất."><input type="number" min="1" max="365" value={f.backup_keep_days} onChange={(e) => set('backup_keep_days', Number(e.target.value))} /></Field>
            <Field label="Giữ thêm bản của mỗi tuần trong (tuần)" hint="Mỗi tuần giữ bản mới nhất. 0 = không giữ thêm."><input type="number" min="0" max="104" value={f.backup_keep_weeks} onChange={(e) => set('backup_keep_weeks', Number(e.target.value))} /></Field>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="small muted">Dữ liệu được sao lưu</span>
            <label className="check"><input type="checkbox" checked disabled />Cơ sở dữ liệu: shop, sản phẩm, đơn, kho, khách, sổ sách, cài đặt (luôn sao lưu)</label>
            <label className="check"><input type="checkbox" checked={!!f.backup_include_images} onChange={(e) => set('backup_include_images', e.target.checked)} />Ảnh sản phẩm</label>
          </div>
          <Note>{st ? (st.config.enabled ? `Lần tới: ${st.next_at ? fmtDate(st.next_at) : '—'}. ` : 'Đang tắt sao lưu tự động. ') + (st.last_backup_at ? `Gần nhất: ${fmtDate(st.last_backup_at)}.` : 'Chưa có bản sao lưu nào.') : ''}</Note>
          <ErrorBox error={error} />{saved && <div className="alert ok">Đã lưu lịch sao lưu.</div>}
          <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.patch('/settings', f); setSaved(true); reload(); status.reload(); })}>Lưu lịch</button></div>
        </div>
      </Card>
      <Card title="Bản sao lưu" actions={<><a className="btn sm" href="/api/v1/system/backup/download">Tải bản mới nhất</a><button className="btn sm primary" disabled={busy} onClick={() => run(async () => { await api.post('/system/backups'); refresh(); })}>Sao lưu ngay</button></>}>
        <Async state={list}>{({ data }) => !data.length ? <Empty>Chưa có bản sao lưu.</Empty> : data.slice(0, 10).map((b) => <div key={b.name} className="row between small" style={{ padding: '8px 0' }}><a href={`/api/v1/system/backups/${b.name}`}>{b.name}</a><span className="muted">{fmtSize(b.size)} · {fmtDate(b.created_at)}</span></div>)}</Async>
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
