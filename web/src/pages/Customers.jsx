import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, StatusBadge, SearchBox, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import FieldInput, { fieldText } from '../components/FieldInput.jsx';
import { vnd, fmtDate } from '../lib.js';
import { Element, ELEMENT_ORDER } from '../components/Motif.jsx';
import ExportCustomers from '../components/ExportCustomers.jsx';
import Icon from '../components/Icon.jsx';
import FieldsManager from '../components/FieldsManager.jsx';

/** So sánh hai hồ sơ và xác nhận gộp: `target` được giữ, `source` bị gộp vào (không hoàn tác được). */
function MergeDialog({ targetId, sourceId, onClose, onDone }) {
  const t = useAsync(() => api.get(`/customers/${targetId}`), [targetId]);
  const sr = useAsync(() => api.get(`/customers/${sourceId}`), [sourceId]);
  const { busy, error, run } = useAction();
  const col = (c, role) => (
    <div className="stack" style={{ gap: 4 }}>
      <span className="eyebrow">{role}</span>
      <b>{c.name}</b>
      <span className="small muted">{c.code} · {c.phone || 'chưa có SĐT'}</span>
      {c.facebook_url && <span className="small">{c.facebook_url}</span>}
      <span className="small">{c.order_count} đơn · {vnd(c.total_spent)}</span>
      <span className="small muted">Gần nhất: {fmtDate(c.last_order_at)} · {c.notes.length} ghi chú</span>
    </div>
  );
  return (
    <Modal title="Gộp hai hồ sơ khách" onClose={onClose} footer={<button className="btn primary" disabled={busy || !t.data || !sr.data} onClick={() => run(async () => { await api.post(`/customers/${targetId}/merge`, { source_id: sourceId }); onDone(); })}>Gộp</button>}>
      <Async state={t}>{({ data: a }) => <Async state={sr}>{({ data: b }) => (
        <>
          <div className="grid cols-2 collapse">{col(a, 'Giữ lại')}{col(b, 'Gộp vào hồ sơ giữ lại')}</div>
          <div className="alert warn small">Toàn bộ đơn hàng và ghi chú của hồ sơ bên phải chuyển sang hồ sơ bên trái. Thông tin còn thiếu (SĐT phụ, Facebook, địa chỉ, thông tin riêng từng shop) được bổ sung; nếu cả hai đã có thì giữ của hồ sơ bên trái. Hồ sơ bên phải bị đánh dấu đã gộp. <b>Không hoàn tác được.</b></div>
        </>
      )}</Async>}</Async>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Danh sách khách nghi trùng (cùng tên hoặc SĐT chéo) để chọn giữ hồ sơ nào */
function DuplicatesModal({ onClose }) {
  const state = useAsync(() => api.get('/customers/duplicates'), []);
  const [pair, setPair] = useState(null);
  return (
    <Modal title="Khách nghi trùng" wide onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>Cùng tên, hoặc SĐT của người này là SĐT phụ của người kia. Kiểm tra kỹ trước khi gộp: hai người trùng tên chưa chắc là một.</p>
      <Async state={state}>{({ data }) => !data.length ? <Empty>Không có khách nào nghi trùng.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Hồ sơ A</th><th>Hồ sơ B</th><th>Lý do</th><th /></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={`${d.a_id}${d.b_id}`}>
              <td><b>{d.a_name}</b><div className="small muted">{d.a_code} · {d.a_phone || '—'}</div></td>
              <td><b>{d.b_name}</b><div className="small muted">{d.b_code} · {d.b_phone || '—'}</div></td>
              <td className="small">{d.reason === 'phone' ? 'SĐT trùng chéo' : 'Trùng tên'}</td>
              <td><div className="row wrap"><button className="btn sm" onClick={() => setPair({ target: d.a_id, source: d.b_id })}>Giữ A, gộp B</button><button className="btn sm" onClick={() => setPair({ target: d.b_id, source: d.a_id })}>Giữ B, gộp A</button></div></td>
            </tr>))}</tbody>
        </table></div>
      )}</Async>
      {pair && <MergeDialog targetId={pair.target} sourceId={pair.source} onClose={() => setPair(null)} onDone={() => { setPair(null); state.reload(); }} />}
    </Modal>
  );
}

/** Từ hồ sơ khách: tìm một khách khác để gộp vào hồ sơ này */
function MergeInto({ targetId, onClose, onDone }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const found = useAsync(() => (dq ? api.get('/customers', { q: dq, limit: 8 }) : Promise.resolve({ data: [] })), [dq]);
  const [source, setSource] = useState(null);
  if (source) return <MergeDialog targetId={targetId} sourceId={source} onClose={() => setSource(null)} onDone={onDone} />;
  return (
    <Modal title="Gộp khách khác vào hồ sơ này" onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Tìm khách cần gộp (tên, SĐT)…" autoFocus />
      {found.data?.data?.filter((c) => c.id !== targetId).map((c) => <div key={c.id} className="pick" onClick={() => setSource(c.id)}><span><b>{c.name}</b><div className="small muted">{c.code} · {c.phone || '—'}</div></span><span className="small muted">{c.order_count} đơn</span></div>)}
    </Modal>
  );
}

export function CustomerList() {
  const { shop, isAll, has } = useSession();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [sort, setSort] = useState('recent');
  const [element, setElement] = useState('');
  const [form, setForm] = useState(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tag, setTag] = useState('');
  const dups = useAsync(() => api.get('/customers/duplicates'), []);
  const nav = useNavigate();
  const showMenh = has('feng_shui');
  const shopId = isAll ? undefined : shop?.id;
  // Nhãn là của từng shop: đổi shop thì bỏ nhãn đang lọc
  const tags = useAsync(() => (shopId ? api.get('/customers/tags', { shop_id: shopId }) : Promise.resolve({ data: [] })), [shopId]);
  const activeTag = shopId && (tags.data?.data || []).some((t) => t.tag.toLowerCase() === tag.toLowerCase()) ? tag : '';
  const filters = { q: dq || undefined, tag: activeTag || undefined, element: showMenh ? element || undefined : undefined, shop_id: shopId };
  const state = useAsync(() => api.get('/customers', { ...filters, sort, limit: 100 }), [dq, sort, element, shopId, showMenh, activeTag]);
  return (
    <div className="page stack">
      <div className="page-head">
        <div><h1>Khách hàng</h1><div className="muted small sub">{isAll ? 'Hồ sơ chung của mọi shop. Chọn một shop để xem thông tin riêng của shop đó.' : `Thông tin riêng đang hiển thị: ${shop?.name}`}</div></div>
        <div className="row">
          {dups.data?.data?.length > 0 && <button className="btn" onClick={() => setDupOpen(true)}>Khách trùng <span className="badge plain">{dups.data.data.length}</span></button>}
          {!isAll && <button className="btn" onClick={() => setFieldsOpen(true)}><Icon name="cog" />Thông tin khách của shop</button>}
          <button className="btn" onClick={() => setExportOpen(true)}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất file</button>
          <button className="btn primary" onClick={() => setForm({ name: '', phone: '' })}><Icon name="plus" />Khách</button>
        </div>
      </div>
      <div className="row wrap">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm tên, SĐT, mã khách…" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 170 }} aria-label="Sắp xếp"><option value="recent">Mới tạo</option><option value="spent">Chi tiêu cao</option><option value="last_order">Mua gần đây</option><option value="name">Tên A–Z</option></select>
        {showMenh && <select value={element} onChange={(e) => setElement(e.target.value)} style={{ width: 130 }} aria-label="Mệnh"><option value="">Mọi mệnh</option>{ELEMENT_ORDER.map((e) => <option key={e}>{e}</option>)}</select>}
      </div>
      {shopId && (tags.data?.data || []).length > 0 && (
        <div className="row wrap" aria-label="Lọc theo nhãn">
          <span className="small muted">Nhãn:</span>
          <button className={`chip ${!activeTag ? 'on' : ''}`} onClick={() => setTag('')}>Tất cả</button>
          {tags.data.data.map((t) => <button key={t.tag} className={`chip ${activeTag.toLowerCase() === t.tag.toLowerCase() ? 'on' : ''}`} onClick={() => setTag(t.tag)}>{t.tag} <span className="small muted">{t.count}</span></button>)}
        </div>
      )}
      <Async state={state}>
        {({ data, columns: cols }) => !data.length ? <Empty>{shopId ? 'Chưa có khách nào trong shop này khớp bộ lọc.' : 'Chưa có khách nào khớp.'}</Empty> : (
          <Card flat><div className="table-wrap"><table className="stackable">
            <thead><tr><th>Khách</th>{shopId && <th className="hide-sm">Nhãn</th>}{showMenh && <th>Mệnh</th>}{(cols || []).map((f) => <th key={f.id} className="hide-sm">{f.label}</th>)}<th className="num">Số đơn</th><th className="num">Chi tiêu</th><th>Mua gần nhất</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/customers/${c.id}`)}>
                <td><b>{c.name}</b><div className="small muted">{c.code} · {c.phone || c.facebook_url || ''}</div></td>
                {shopId && <td className="hide-sm">{(c.shop_tags || []).map((t) => <span key={t} className="badge plain" style={{ marginRight: 4 }}>{t}</span>)}</td>}
                {showMenh && <td className="hide-sm"><Element name={c.feng_shui?.element} />{c.feng_shui?.approximate && <span className="small muted"> (ước)</span>}</td>}
                {(cols || []).map((f) => <td key={f.id} className="hide-sm small">{fieldText(f, c.shop_values?.[f.key])}</td>)}
                <td className="num hide-sm">{c.order_count}</td><td className="num">{vnd(c.total_spent)}</td><td className="small hide-sm">{fmtDate(c.last_order_at)}</td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
      {form && <CustomerForm init={form} shop={shopId ? shop : null} onClose={() => setForm(null)} onSaved={(c) => { setForm(null); nav(`/customers/${c.id}`); }} />}
      {exportOpen && <ExportCustomers filters={filters} onClose={() => setExportOpen(false)} />}
      {fieldsOpen && <ShopFieldsManager shop={shop} onClose={() => { setFieldsOpen(false); state.reload(); }} />}
      {dupOpen && <DuplicatesModal onClose={() => { setDupOpen(false); state.reload(); dups.reload(); }} />}
    </div>
  );
}

function CustomerForm({ init, shop, onClose, onSaved }) {
  const [f, setF] = useState(init);
  const [dup, setDup] = useState(null); // số điện thoại đã thuộc một khách có sẵn
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const payload = { name: f.name, phone: f.phone || null, facebook_url: f.facebook_url || null, address: f.address || null, note: f.note || null };
    try {
      const r = f.id ? await api.patch(`/customers/${f.id}`, payload) : await api.post('/customers', { ...payload, ...(shop ? { shop_id: shop.id } : {}) });
      onSaved(r.data);
    } catch (e) {
      // Khách đã có ở shop khác: đề nghị thêm vào shop này thay vì tạo trùng
      if (e.code === 'CUSTOMER_EXISTS' && shop && e.details?.is_member === false) { setDup({ id: e.details.customer_id, message: e.message }); return; }
      throw e;
    }
  });
  const addExisting = () => run(async () => { await api.post(`/customers/${dup.id}/shops`, { shop_id: shop.id }); onSaved({ id: dup.id }); });
  return (
    <Modal title={f.id ? 'Sửa khách' : 'Thêm khách'} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={save}>Lưu</button>}>
      <p className="small muted" style={{ margin: 0 }}>{!f.id && shop ? `Khách sẽ được thêm vào danh sách của ${shop.name}. ` : ''}Đây là thông tin chung, mọi shop đều thấy. Thông tin riêng của từng shop (mệnh, mùi yêu thích…) nhập ở hồ sơ khách sau khi lưu.</p>
      <Field label="Tên"><input value={f.name} onChange={set('name')} autoFocus /></Field>
      <div className="grid cols-2">
        <Field label="Số điện thoại"><input inputMode="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Link Facebook"><input value={f.facebook_url || ''} onChange={set('facebook_url')} /></Field>
      </div>
      <Field label="Địa chỉ"><input value={f.address || ''} onChange={set('address')} /></Field>
      {dup && (
        <div className="alert warn small stack" style={{ gap: 6 }}>
          <span>{dup.message}. Khách này chưa có trong danh sách của {shop.name}.</span>
          <div className="row"><button className="btn sm primary" disabled={busy} onClick={addExisting}>Thêm khách này vào {shop.name}</button></div>
        </div>
      )}
      <ErrorBox error={dup ? null : error} />
    </Modal>
  );
}

/** Thông tin riêng của khách trong một shop: tạo form từ các trường của shop đó */
function ShopProfile({ customerId, shop, profile, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const { busy, error, run } = useAction();
  const fields = profile.fields.filter((f) => f.type !== 'formula');
  const editing = draft !== null;
  const save = () => run(async () => {
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(profile.values[k] ?? null)));
    if (Object.keys(changed).length) await api.put(`/custom/values/customer/${customerId}?shop_id=${shop.id}`, changed);
    setDraft(null); onSaved();
  });
  return (
    <Card title={`Thông tin riêng · ${shop.name}`} actions={<>
      <button className="btn sm" onClick={() => setFieldsOpen(true)}>Chỉnh các trường</button>
      {!editing && fields.length > 0 && <button className="btn sm primary" onClick={() => setDraft({ ...profile.values })}>Sửa</button>}
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>Chỉ shop này thấy. Cùng khách này ở shop khác có thông tin riêng của shop đó.</p>
      {profile.fields.length === 0 ? <span className="muted">Shop này chưa có trường nào. Bấm “Chỉnh các trường” để thêm.</span> : editing ? (
        <div className="stack">
          {fields.map((f) => <Field key={f.id} label={f.type === 'boolean' ? '' : `${f.label}${f.required ? ' *' : ''}`}><FieldInput field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} /></Field>)}
          <ErrorBox error={error} />
          <div className="row"><button className="btn primary" disabled={busy} onClick={save}>Lưu</button><button className="btn" onClick={() => setDraft(null)}>Huỷ</button></div>
        </div>
      ) : (
        profile.fields.map((f) => <div key={f.id} className="ledger-line"><span className="muted">{f.label}</span><b style={{ textAlign: 'right' }}>{fieldText(f, profile.values[f.key])}</b></div>)
      )}
      {fieldsOpen && <ShopFieldsManager shop={shop} onClose={() => { setFieldsOpen(false); onSaved(); }} />}
    </Card>
  );
}

/** Nhãn của khách trong MỘT shop: thêm bằng Enter/dấu phẩy, gợi ý từ các nhãn shop đang dùng */
function ShopTags({ customerId, shop, tags, onSaved }) {
  const [text, setText] = useState('');
  const known = useAsync(() => api.get('/customers/tags', { shop_id: shop.id }), [shop.id, tags.join('|')]);
  const { busy, error, run } = useAction();
  const save = (next) => run(async () => { await api.put(`/customers/${customerId}/tags`, { shop_id: shop.id, tags: next }); onSaved(); });
  const add = (raw) => {
    const items = raw.split(',').map((x) => x.trim()).filter(Boolean);
    setText('');
    if (items.length) save([...tags, ...items]);
  };
  const suggestions = (known.data?.data || []).map((t) => t.tag).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())).slice(0, 8);
  return (
    <Card title={`Nhãn · ${shop.name}`}>
      <p className="small muted" style={{ marginTop: 0 }}>Nhãn chỉ có ở {shop.name}. Cùng khách này ở shop khác có nhãn riêng.</p>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        {tags.length === 0 && <span className="muted small">Chưa có nhãn.</span>}
        {tags.map((t) => <span key={t} className="badge plain">{t} <button className="btn sm" style={{ minHeight: 0, padding: '0 6px', border: 0 }} aria-label={`Bỏ nhãn ${t}`} disabled={busy} onClick={() => save(tags.filter((x) => x !== t))}>✕</button></span>)}
      </div>
      <div className="row">
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Thêm nhãn (VD: VIP, Mua sỉ)…" aria-label="Thêm nhãn" maxLength={30}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } }} />
        <button className="btn" disabled={busy || !text.trim()} onClick={() => add(text)}>Thêm</button>
      </div>
      {suggestions.length > 0 && <div className="row wrap" style={{ marginTop: 8 }}><span className="small muted">Đang dùng:</span>{suggestions.map((t) => <button key={t} className="chip" disabled={busy} onClick={() => save([...tags, t])}>{t}</button>)}</div>}
      <ErrorBox error={error} />
    </Card>
  );
}

/** Xoá khách khỏi danh sách của MỘT shop: nói rõ cái gì mất, cái gì còn */
function RemoveFromShop({ customer, shop, onClose, onDone }) {
  const { busy, error, run } = useAction();
  const others = (customer.by_shop || []).filter((s) => s.shop_id !== shop.id).length;
  return (
    <Modal title={`Xoá khỏi ${shop.name}`} onClose={onClose} footer={<button className="btn danger" disabled={busy} onClick={() => run(async () => { const r = await api.del(`/customers/${customer.id}?shop_id=${shop.id}`); onDone(r.data); })}>Xoá khỏi {shop.name}</button>}>
      <p style={{ margin: 0 }}>Xoá <b>{customer.name}</b> khỏi danh sách khách của <b>{shop.name}</b>.</p>
      <div className="stack small" style={{ gap: 6 }}>
        <div><b>Sẽ mất ở {shop.name}:</b> thông tin riêng, nhãn và ghi chú của shop này.</div>
        <div><b>Vẫn giữ:</b> hồ sơ chung (tên, SĐT…), khách này ở các shop khác{others ? ` (${others} shop có đơn)` : ''}, và toàn bộ lịch sử đơn hàng.</div>
        <div className="muted">Nếu khách mua lại ở {shop.name}, họ tự quay lại danh sách. Dữ liệu bị xoá được ghi vào nhật ký hệ thống.</div>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Quản lý các trường thông tin khách của MỘT shop (dùng chung FieldsManager với Cài đặt). */
function ShopFieldsManager({ shop, onClose }) {
  return (
    <Modal wide title={`Thông tin khách · ${shop.name}`} onClose={onClose}>
      <FieldsManager entities={['customer']} shop={shop} />
    </Modal>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const { shop, isAll, has } = useSession();
  const shopId = isAll ? undefined : shop?.id;
  const state = useAsync(() => api.get(`/customers/${id}`, { shop_id: shopId }), [id, shopId]);
  const orders = useAsync(() => api.get('/orders', { customer_id: id, limit: 20 }), [id]);
  const loy = useAsync(() => api.get(`/loyalty/customers/${id}`), [id]);
  const sug = useAsync(() => (has('feng_shui') && shopId ? api.get(`/loyalty/customers/${id}/suggestions`, { shop_id: shopId }) : Promise.resolve({ data: [] })), [id, shopId, has('feng_shui')]);
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  const reloadAll = () => { state.reload(); loy.reload(); sug.reload(); };
  return (
    <div className="page stack">
      <Async state={state}>
        {({ data: c }) => (
          <>
            <div className="page-head"><div><h1>{c.name}</h1><div className="muted small sub">{c.code} · {c.phone} {c.facebook_url && <a href={c.facebook_url} target="_blank" rel="noreferrer">Facebook</a>}</div></div><div className="row wrap"><button className="btn" onClick={() => setMergeOpen(true)}>Gộp khách trùng</button><button className="btn" onClick={() => setEdit(c)}>Sửa thông tin chung</button>{c.shop_profile && shop && c.is_member && <button className="btn danger" onClick={() => setRemoveOpen(true)}>Xoá khỏi {shop.name}</button>}</div></div>
            <div className="grid cols-3">
              {has('feng_shui') && c.shop_profile?.shop_id === shop?.id && (
                <Card title="Mệnh">{c.feng_shui ? <><Element name={c.feng_shui.element} size="xl" />{c.feng_shui.nap_am && <div className="small">{c.feng_shui.can_chi} · {c.feng_shui.nap_am}</div>}<div className="small muted">{c.feng_shui.source === 'manual' ? 'Ghi đè tay' : c.feng_shui.approximate ? 'Ước tính từ năm sinh (chưa biết ngày)' : 'Tính từ ngày sinh theo âm lịch'}</div><div className="row wrap small" style={{ marginTop: 6 }}>Hợp: {c.feng_shui.compatible_elements.map((e) => <Element key={e} name={e} size="sm" />)}</div></> : <span className="muted small">Chưa có ngày/năm sinh trong thông tin riêng của shop.</span>}</Card>
              )}
              <Card title="Hạng"><Async state={loy}>{({ data: l }) => <><b style={{ fontSize: 20 }}>{l.tier.name}</b><div className="small">Chi tiêu 12 tháng: {vnd(l.spent_12m)}</div>{l.next_tier && <div className="small muted">Còn {vnd(l.to_next)} lên {l.next_tier.name}</div>}</>}</Async></Card>
              <Card title="Tổng"><b style={{ fontSize: 20 }}>{vnd(c.total_spent)}</b><div className="small">{c.order_count} đơn</div><div className="small muted">Đầu: {fmtDate(c.first_order_at)} · Gần nhất: {fmtDate(c.last_order_at)}</div></Card>
            </div>
            {c.shop_profile && shop && c.shop_profile.shop_id === shop.id && !c.is_member && (
              <div className="alert warn row between wrap">
                <span>Khách này chưa có trong danh sách của <b>{shop.name}</b> (đã xoá hoặc chưa thêm). Nhập thông tin riêng hoặc tạo đơn ở shop này sẽ thêm lại.</span>
                <button className="btn sm primary" disabled={busy} onClick={() => run(async () => { await api.post(`/customers/${c.id}/shops`, { shop_id: shop.id }); reloadAll(); })}>Thêm vào {shop.name}</button>
              </div>
            )}
            {c.shop_profile && shop && c.shop_profile.shop_id === shop.id && <ShopTags customerId={c.id} shop={shop} tags={c.shop_profile.tags || []} onSaved={reloadAll} />}
            {c.shop_profile && shop && c.shop_profile.shop_id === shop.id ? <ShopProfile customerId={c.id} shop={shop} profile={c.shop_profile} onSaved={reloadAll} /> : (
              <div className="alert warn">Đang xem tất cả shop. Chọn một shop ở góc trên để xem và sửa thông tin riêng của khách trong shop đó.</div>
            )}
            {c.by_shop.length > 0 && <Card title="Theo shop">{c.by_shop.map((s) => <div key={s.shop_id} className="row between small"><span>{s.shop_name}</span><span>{s.order_count} đơn · {vnd(s.spent)}</span></div>)}</Card>}
            <Async state={sug}>{(r) => r.data?.length > 0 && (
              <Card title={`Gợi ý theo mệnh ${r.element}`}>{r.data.map((p) => <div key={p.product_id} className="row between small"><span>{p.name} {p.elements.map((e) => <Element key={e} name={e} label={false} />)}</span><span className="muted">{vnd(p.price)}</span></div>)}{r.approximate && <div className="small muted" style={{ marginTop: 6 }}>Mệnh đang là ước tính.</div>}</Card>
            )}</Async>
            <Card title="Đơn gần đây" flat><Async state={orders}>{(r) => !r.data.length ? <Empty>Chưa có đơn.</Empty> : <div className="table-wrap"><table><tbody>{r.data.map((o) => <tr key={o.id}><td><Link to={`/orders/${o.id}`}>{o.code}</Link><div className="small muted">{o.shop_name}</div></td><td>{fmtDate(o.business_date)}</td><td><StatusBadge status={o.status} /></td><td className="num">{vnd(o.total_amount)}</td></tr>)}</tbody></table></div>}</Async></Card>
            <Card title="Ghi chú">
              {c.notes.map((n) => <div key={n.id} className="small" style={{ marginBottom: 6 }}><span className="muted">{fmtDate(n.created_at)}{n.shop_name && ` · ${n.shop_name}`}</span><br />{n.content}</div>)}
              <div className="row"><input className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thêm ghi chú…" aria-label="Ghi chú" /><button className="btn" disabled={busy || !note} onClick={() => run(async () => { await api.post(`/customers/${c.id}/notes`, { content: note, shop_id: shopId }); setNote(''); state.reload(); })}>Lưu</button></div>
              <ErrorBox error={error} />
            </Card>
            {removeOpen && <RemoveFromShop customer={c} shop={shop} onClose={() => setRemoveOpen(false)} onDone={() => nav('/customers')} />}
            {mergeOpen && <MergeInto targetId={c.id} onClose={() => setMergeOpen(false)} onDone={() => { setMergeOpen(false); reloadAll(); orders.reload(); }} />}
            {edit && <CustomerForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadAll(); }} />}
          </>
        )}
      </Async>
    </div>
  );
}
