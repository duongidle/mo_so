import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Empty, ErrorBox, Field, Modal, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd, num, fmtDate, METHODS } from '../lib.js';

const ST = { draft: 'Nháp', received: 'Đã nhận', cancelled: 'Đã huỷ' };

export default function Purchases() {
  const [tab, setTab] = useState('purchases');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(false);
  const [view, setView] = useState(null);
  const state = useAsync(() => (tab === 'purchases' ? api.get('/purchases', { status: status || undefined }) : api.get('/suppliers')), [tab, status]);
  return (
    <div className="page stack">
      <div className="page-head"><h1>Nhập hàng</h1><button className="btn primary" onClick={() => setForm(true)}>+ Phiếu nhập</button></div>
      <Chips options={[['purchases', 'Phiếu nhập'], ['suppliers', 'Nhà cung cấp']]} value={tab} onChange={setTab} />
      {tab === 'purchases' && <Chips options={[['', 'Tất cả'], ['draft', 'Nháp'], ['received', 'Đã nhận'], ['cancelled', 'Đã huỷ']]} value={status} onChange={setStatus} />}
      <Async state={state}>
        {({ data }) => tab === 'purchases' ? (!data.length ? <Empty>Chưa có phiếu nhập.</Empty> : (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Mã</th><th>Ngày</th><th>Nhà cung cấp</th><th>Trạng thái</th><th className="num">Tổng</th><th className="num">Còn nợ</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={() => setView(p.id)}>
                <td><b>{p.code}</b></td><td>{fmtDate(p.ordered_at)}</td><td>{p.supplier_name || <span className="muted">—</span>}</td><td>{ST[p.status]}</td>
                <td className="num">{vnd(p.total_amount)}</td><td className="num">{p.status === 'received' && p.total_amount > p.paid_amount ? <b className="h-yellow">{vnd(p.total_amount - p.paid_amount)}</b> : '—'}</td>
              </tr>))}</tbody>
          </table></div></Card>)
        ) : <Suppliers list={data} reload={state.reload} />}
      </Async>
      {form && <PurchaseForm onClose={() => setForm(false)} onSaved={() => { setForm(false); state.reload(); }} />}
      {view && <PurchaseView id={view} onClose={() => { setView(null); state.reload(); }} />}
    </div>
  );
}

function Suppliers({ list, reload }) {
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <>
      <div><button className="btn" onClick={() => setF({ name: '', phone: '' })}>+ Nhà cung cấp</button></div>
      {!list.length ? <Empty>Chưa có nhà cung cấp.</Empty> : <Card flat>{list.map((s) => <div key={s.id} className="pick"><span>{s.name}<div className="small muted">{s.phone}</div></span>{s.debt > 0 && <b className="h-yellow">Nợ {vnd(s.debt)}</b>}</div>)}</Card>}
      {f && <Modal title="Thêm nhà cung cấp" onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/suppliers', f); setF(null); reload(); })}>Lưu</button>}>
        <Field label="Tên"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Điện thoại"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><ErrorBox error={error} />
      </Modal>}
    </>
  );
}

function PurchaseForm({ onClose, onSaved }) {
  const { warehouses, shops } = useSession();
  const [wh, setWh] = useState(warehouses[0]?.id);
  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState([]);
  const [fees, setFees] = useState({ shipping_fee: 0, other_fee: 0, discount_amount: 0 });
  const [paid, setPaid] = useState(0);
  const [receive, setReceive] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const sup = useAsync(() => api.get('/suppliers'), []);
  const found = useAsync(() => (dq ? api.get('/variants', { q: dq, all: '1', limit: 8 }) : null), [dq]);
  const { busy, error, run } = useAction();
  const sub = lines.reduce((a, l) => a + l.qty * l.unit_cost, 0);
  const total = sub - fees.discount_amount + fees.shipping_fee + fees.other_fee;
  const upd = (id, p) => setLines((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const save = () => run(async () => {
    await api.post('/purchases', {
      supplier_id: supplier || null, warehouse_id: wh, receive, paid_amount: receive ? Number(paid) || 0 : 0, ...Object.fromEntries(Object.entries(fees).map(([k, v]) => [k, Number(v) || 0])),
      lines: lines.map((l) => ({ variant_id: l.id, qty: Number(l.qty), unit_cost: Number(l.unit_cost) })),
    }, { 'Idempotency-Key': crypto.randomUUID?.() });
    onSaved();
  });
  return (
    <Modal title="Phiếu nhập hàng" onClose={onClose} footer={<button className="btn primary" disabled={busy || !lines.length} onClick={save}>{receive ? 'Nhận hàng & lưu' : 'Lưu nháp'}</button>}>
      <div className="grid cols-2">
        <Field label="Nhà cung cấp"><select value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">— Không có —</option>{sup.data?.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Nhập vào kho"><select value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      <input placeholder="Tìm SKU để thêm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm SKU" />
      {found.data?.data?.map((v) => <div key={v.id} className="pick" onClick={() => { setLines((l) => (l.some((x) => x.id === v.id) ? l : [...l, { id: v.id, sku: v.sku, name: v.product_name, qty: 1, unit_cost: v.avg_cost || 0 }])); setQ(''); }}>{v.product_name} <span className="muted small">{v.sku}</span></div>)}
      {lines.map((l) => (
        <div key={l.id} className="row">
          <div className="grow"><div>{l.name}</div><div className="small muted">{l.sku}</div></div>
          <input type="number" min="1" value={l.qty} onChange={(e) => upd(l.id, { qty: e.target.value })} style={{ width: 70 }} aria-label="Số lượng" />
          <input type="number" min="0" value={l.unit_cost} onChange={(e) => upd(l.id, { unit_cost: e.target.value })} style={{ width: 110 }} aria-label="Giá nhập" />
        </div>
      ))}
      <div className="grid cols-3">
        <Field label="Phí ship nhập"><input type="number" min="0" value={fees.shipping_fee} onChange={(e) => setFees({ ...fees, shipping_fee: e.target.value })} /></Field>
        <Field label="Phí khác"><input type="number" min="0" value={fees.other_fee} onChange={(e) => setFees({ ...fees, other_fee: e.target.value })} /></Field>
        <Field label="Chiết khấu"><input type="number" min="0" value={fees.discount_amount} onChange={(e) => setFees({ ...fees, discount_amount: e.target.value })} /></Field>
      </div>
      <p className="small muted">Phí và chiết khấu được chia vào giá vốn từng dòng theo giá trị.</p>
      <label className="check"><input type="checkbox" checked={receive} onChange={(e) => setReceive(e.target.checked)} />Nhận hàng ngay (cộng kho)</label>
      {receive && <Field label="Đã trả nhà cung cấp"><input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>}
      <div className="row between"><b>Tổng cộng</b><b className="num">{vnd(total)}</b></div>
      <ErrorBox error={error} />
    </Modal>
  );
}

function PurchaseView({ id, onClose }) {
  const s = useAsync(() => api.get(`/purchases/${id}`), [id]);
  const { busy, error, run } = useAction();
  const [pay, setPay] = useState('');
  return (
    <Modal title="Phiếu nhập" onClose={onClose}>
      <Async state={s}>{({ data: p }) => (
        <>
          <div className="row between"><b>{p.code}</b><span>{ST[p.status]}</span></div>
          <div className="table-wrap"><table><tbody>{p.lines.map((l) => <tr key={l.id}><td>{l.name || l.sku}<div className="small muted">{num(l.qty)} × {vnd(l.unit_cost)}</div></td><td className="num small">giá vốn thực<br /><b>{vnd(l.landed_unit_cost)}</b></td></tr>)}</tbody></table></div>
          <div className="row between"><span>Tổng</span><b>{vnd(p.total_amount)}</b></div>
          <div className="row between"><span>Đã trả</span><b>{vnd(p.paid_amount)}</b></div>
          {p.payments?.map((x) => <div key={x.id} className="small muted">{fmtDate(x.paid_at)} · {METHODS[x.method]} · {vnd(x.amount)}</div>)}
          <ErrorBox error={error} />
          <div className="row wrap">
            {p.status === 'draft' && <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/receive`); s.reload(); })}>Nhận hàng</button>}
            {p.status !== 'cancelled' && <button className="btn danger" disabled={busy} onClick={() => confirm('Huỷ phiếu? Nếu đã nhận, kho sẽ bị trừ lại.') && run(async () => { await api.post(`/purchases/${p.id}/cancel`, {}); s.reload(); })}>Huỷ phiếu</button>}
          </div>
          {p.status === 'received' && p.debt > 0 && (
            <div className="row"><input type="number" min="1" placeholder={`Trả nợ (còn ${p.debt})`} value={pay} onChange={(e) => setPay(e.target.value)} /><button className="btn" disabled={busy || !pay} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/payments`, { amount: Number(pay) }); setPay(''); s.reload(); })}>Ghi trả</button></div>
          )}
        </>
      )}</Async>
    </Modal>
  );
}
