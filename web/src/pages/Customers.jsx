import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Async, Card, Empty, ErrorBox, Field, Modal, StatusBadge, useAction, useAsync, useDebounced, Chips } from '../components/ui.jsx';
import { vnd, fmtDate } from '../lib.js';
import { Element } from '../components/Motif.jsx';

const ELEMENTS = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];

export function CustomerList() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [sort, setSort] = useState('recent');
  const [element, setElement] = useState('');
  const [form, setForm] = useState(null);
  const nav = useNavigate();
  const state = useAsync(() => api.get('/customers', { q: dq || undefined, sort, element: element || undefined, limit: 100 }), [dq, sort, element]);
  return (
    <div className="page stack">
      <div className="page-head"><h1>Khách hàng</h1><button className="btn primary" onClick={() => setForm({ name: '', phone: '' })}>+ Khách</button></div>
      <div className="row wrap">
        <input className="grow" placeholder="Tìm tên, SĐT, mã khách…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm khách" style={{ minWidth: 220 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 170 }} aria-label="Sắp xếp"><option value="recent">Mới tạo</option><option value="spent">Chi tiêu cao</option><option value="last_order">Mua gần đây</option><option value="name">Tên A–Z</option></select>
        <select value={element} onChange={(e) => setElement(e.target.value)} style={{ width: 130 }} aria-label="Mệnh"><option value="">Mọi mệnh</option>{ELEMENTS.map((e) => <option key={e}>{e}</option>)}</select>
      </div>
      <Async state={state}>
        {({ data }) => !data.length ? <Empty>Chưa có khách nào khớp.</Empty> : (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Khách</th><th>Mệnh</th><th className="num">Số đơn</th><th className="num">Chi tiêu</th><th>Mua gần nhất</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/customers/${c.id}`)}>
                <td><b>{c.name}</b><div className="small muted">{c.code} · {c.phone || c.facebook_url || ''}</div></td>
                <td><Element name={c.feng_shui?.element} />{c.feng_shui?.approximate && <span className="small muted"> (ước)</span>}</td>
                <td className="num">{c.order_count}</td><td className="num">{vnd(c.total_spent)}</td><td className="small">{fmtDate(c.last_order_at)}</td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
      {form && <CustomerForm init={form} onClose={() => setForm(null)} onSaved={(c) => { setForm(null); nav(`/customers/${c.id}`); }} />}
    </div>
  );
}

function CustomerForm({ init, onClose, onSaved }) {
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const payload = {
      name: f.name, phone: f.phone || null, facebook_url: f.facebook_url || null, address: f.address || null, gender: f.gender || null,
      birth_date: f.birth_date || null, birth_year: f.birth_year ? Number(f.birth_year) : null, element_override: f.element_override || null, note: f.note || null,
    };
    const r = f.id ? await api.patch(`/customers/${f.id}`, payload) : await api.post('/customers', payload);
    onSaved(r.data);
  });
  return (
    <Modal title={f.id ? 'Sửa khách' : 'Thêm khách'} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={save}>Lưu</button>}>
      <Field label="Tên"><input value={f.name} onChange={set('name')} autoFocus /></Field>
      <div className="grid cols-2">
        <Field label="Số điện thoại"><input inputMode="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Link Facebook"><input value={f.facebook_url || ''} onChange={set('facebook_url')} /></Field>
        <Field label="Giới tính"><select value={f.gender || ''} onChange={set('gender')}><option value="">—</option><option value="male">Nam</option><option value="female">Nữ</option><option value="other">Khác</option></select></Field>
        <Field label="Ngày sinh (dương lịch)"><input type="date" value={f.birth_date || ''} onChange={set('birth_date')} /></Field>
        <Field label="Hoặc chỉ năm sinh" hint="Mệnh sẽ là ước tính"><input type="number" value={f.birth_year || ''} onChange={set('birth_year')} /></Field>
        <Field label="Ghi đè mệnh"><select value={f.element_override || ''} onChange={set('element_override')}><option value="">Tự tính</option>{ELEMENTS.map((e) => <option key={e}>{e}</option>)}</select></Field>
      </div>
      <Field label="Địa chỉ"><input value={f.address || ''} onChange={set('address')} /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const state = useAsync(() => api.get(`/customers/${id}`), [id]);
  const orders = useAsync(() => api.get('/orders', { customer_id: id, limit: 20 }), [id]);
  const loy = useAsync(() => api.get(`/loyalty/customers/${id}`), [id]);
  const sug = useAsync(() => api.get(`/loyalty/customers/${id}/suggestions`), [id]);
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <div className="page stack">
      <Async state={state}>
        {({ data: c }) => (
          <>
            <div className="page-head"><div><h1>{c.name}</h1><div className="muted small">{c.code} · {c.phone} {c.facebook_url && <a href={c.facebook_url} target="_blank" rel="noreferrer">Facebook</a>}</div></div><button className="btn" onClick={() => setEdit(c)}>Sửa</button></div>
            <div className="grid cols-3">
              <Card title="Mệnh">{c.feng_shui ? <><Element name={c.feng_shui.element} size="xl" />{c.feng_shui.nap_am && <div className="small">{c.feng_shui.can_chi} · {c.feng_shui.nap_am}</div>}<div className="small muted">{c.feng_shui.source === 'manual' ? 'Ghi đè tay' : c.feng_shui.approximate ? 'Ước tính từ năm sinh (chưa biết ngày)' : 'Tính từ ngày sinh theo âm lịch'}</div><div className="row wrap small" style={{ marginTop: 6 }}>Hợp: {c.feng_shui.compatible_elements.map((e) => <Element key={e} name={e} size="sm" />)}</div></> : <span className="muted small">Chưa có ngày/năm sinh.</span>}</Card>
              <Card title="Hạng"><Async state={loy}>{({ data: l }) => <><b style={{ fontSize: 20 }}>{l.tier.name}</b><div className="small">Chi tiêu 12 tháng: {vnd(l.spent_12m)}</div>{l.next_tier && <div className="small muted">Còn {vnd(l.to_next)} lên {l.next_tier.name}</div>}</>}</Async></Card>
              <Card title="Tổng"><b style={{ fontSize: 20 }}>{vnd(c.total_spent)}</b><div className="small">{c.order_count} đơn</div><div className="small muted">Đầu: {fmtDate(c.first_order_at)} · Gần nhất: {fmtDate(c.last_order_at)}</div></Card>
            </div>
            {c.by_shop.length > 0 && <Card title="Theo shop">{c.by_shop.map((s) => <div key={s.shop_id} className="row between small"><span>{s.shop_name}</span><span>{s.order_count} đơn · {vnd(s.spent)}</span></div>)}</Card>}
            <Async state={sug}>{(r) => r.data.length > 0 && (
              <Card title={`Gợi ý theo mệnh ${r.element}`}>{r.data.map((p) => <div key={p.product_id} className="row between small"><span>{p.name} {p.elements.map((e) => <Element key={e} name={e} label={false} />)}</span><span className="muted">{p.shop_names.join(', ')} · {vnd(p.price)}</span></div>)}{r.approximate && <div className="small muted" style={{ marginTop: 6 }}>Mệnh đang là ước tính.</div>}</Card>
            )}</Async>
            <Card title="Đơn gần đây" flat><Async state={orders}>{(r) => !r.data.length ? <Empty>Chưa có đơn.</Empty> : <div className="table-wrap"><table><tbody>{r.data.map((o) => <tr key={o.id}><td><Link to={`/orders/${o.id}`}>{o.code}</Link><div className="small muted">{o.shop_name}</div></td><td>{fmtDate(o.business_date)}</td><td><StatusBadge status={o.status} /></td><td className="num">{vnd(o.total_amount)}</td></tr>)}</tbody></table></div>}</Async></Card>
            <Card title="Ghi chú">
              {c.notes.map((n) => <div key={n.id} className="small" style={{ marginBottom: 6 }}><span className="muted">{fmtDate(n.created_at)}{n.shop_name && ` · ${n.shop_name}`}</span><br />{n.content}</div>)}
              <div className="row"><input className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thêm ghi chú…" aria-label="Ghi chú" /><button className="btn" disabled={busy || !note} onClick={() => run(async () => { await api.post(`/customers/${c.id}/notes`, { content: note }); setNote(''); state.reload(); })}>Lưu</button></div>
              <ErrorBox error={error} />
            </Card>
            {edit && <CustomerForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); loy.reload(); sug.reload(); }} />}
          </>
        )}
      </Async>
    </div>
  );
}
