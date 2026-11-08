import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Empty, ErrorBox, Field, Modal, PageHeader, Section, Tabs, Toolbar, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import FormPage from '../components/FormPage.jsx';
import { useLeaveGuard } from '../components/leaveGuard.js';
import { vnd, num, fmtDate, METHODS } from '../lib.js';
import CustomFieldsPanel from '../components/CustomFieldsPanel.jsx';
import MoneyInput from '../components/MoneyInput.jsx';

const ST = { draft: 'Nháp', received: 'Đã nhận', cancelled: 'Đã huỷ' };
const ST_CLASS = { draft: 'st-draft', received: 'st-completed', cancelled: 'st-cancelled' };
const PurchaseBadge = ({ status }) => <span className={`badge ${ST_CLASS[status]}`}>{ST[status]}</span>;

export default function Purchases() {
  const nav = useNavigate();
  const [tab, setTab] = useState('purchases');
  const [status, setStatus] = useState('');
  const state = useAsync(() => (tab === 'purchases' ? api.get('/purchases', { status: status || undefined }) : api.get('/suppliers')), [tab, status]);
  return (
    <div className="page stack">
      <PageHeader title="Nhập hàng" actions={<Link to="/purchases/new" className="btn primary">+ Phiếu nhập</Link>} />
      <Toolbar>
        <Tabs options={[['purchases', 'Phiếu nhập'], ['suppliers', 'Nhà cung cấp']]} value={tab} onChange={setTab} />
        {tab === 'purchases' && <Chips options={[['', 'Tất cả'], ['draft', 'Nháp'], ['received', 'Đã nhận'], ['cancelled', 'Đã huỷ']]} value={status} onChange={setStatus} />}
      </Toolbar>
      <Async state={state}>
        {({ data }) => tab === 'purchases' ? (!data.length ? <Empty>Chưa có phiếu nhập.</Empty> : (
          <Card flat className="list-card"><div className="table-wrap"><table className="stackable">
            <thead><tr><th>Phiếu</th><th>Nhà cung cấp</th><th>Trạng thái</th><th className="num">Tổng</th><th className="num">Còn nợ</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/purchases/${p.id}`)}>
                <td><b>{p.code}</b><span className="sub">{fmtDate(p.ordered_at)}</span></td>
                <td className="hide-sm">{p.supplier_name || <span className="muted">—</span>}</td>
                <td><PurchaseBadge status={p.status} /></td>
                <td className="num">{vnd(p.total_amount)}</td>
                <td className="num hide-sm">{p.status === 'received' && p.total_amount > p.paid_amount ? <b className="h-yellow">{vnd(p.total_amount - p.paid_amount)}</b> : <span className="muted">—</span>}</td>
              </tr>))}</tbody>
          </table></div></Card>)
        ) : <Suppliers list={data} reload={state.reload} />}
      </Async>
    </div>
  );
}

function Suppliers({ list, reload }) {
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <>
      <div><button className="btn" onClick={() => setF({ name: '', phone: '' })}>+ Nhà cung cấp</button></div>
      {!list.length ? <Empty>Chưa có nhà cung cấp.</Empty> : <Card flat className="list-card">{list.map((s) => <div key={s.id} className="pick"><span>{s.name}<div className="small muted">{s.phone}</div></span>{s.debt > 0 && <b className="h-yellow">Nợ {vnd(s.debt)}</b>}</div>)}</Card>}
      {f && <Modal title="Thêm nhà cung cấp" onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/suppliers', f); setF(null); reload(); })}>Lưu</button>}>
        <Field label="Tên"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Điện thoại"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><ErrorBox error={error} />
      </Modal>}
    </>
  );
}

/** Trang phiếu nhập mới: cột chính là các dòng hàng, cột phụ là nhà cung cấp, phí, thanh toán */
export function PurchaseForm({ onClose, onSaved, onDirty, initial }) {
  const { warehouses } = useSession();
  const editing = !!initial; // sửa phiếu nháp: lưu bằng PATCH, nhận hàng là bước riêng
  const [wh, setWh] = useState(initial?.warehouse_id ?? warehouses[0]?.id);
  const [supplier, setSupplier] = useState(initial?.supplier_id ?? '');
  const [lines, setLines] = useState(() => initial?.lines.map((l) => ({ id: l.variant_id, sku: l.sku, name: l.product_name, qty: l.qty, unit_cost: l.unit_cost, lot_no: l.lot_no || '', expiry_date: l.expiry_date || '' })) ?? []);
  const [fees, setFees] = useState({ shipping_fee: initial?.shipping_fee ?? 0, other_fee: initial?.other_fee ?? 0, discount_amount: initial?.discount_amount ?? 0 });
  const [paid, setPaid] = useState(0);
  const [shipTo, setShipTo] = useState(initial?.shipping_payee ?? 'supplier'); // ai nhận tiền ship: nhà cung cấp hay bên vận chuyển
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const sup = useAsync(() => api.get('/suppliers'), []);
  const found = useAsync(() => (dq ? api.get('/variants', { q: dq, all: '1', limit: 8 }) : null), [dq]);
  const { busy, error, run } = useAction();
  const sub = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const carrier = shipTo === 'carrier' ? Number(fees.shipping_fee) || 0 : 0;
  const total = sub - (Number(fees.discount_amount) || 0) + (Number(fees.shipping_fee) || 0) - carrier + (Number(fees.other_fee) || 0);
  const upd = (id, p) => { setTouched(true); setLines((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x))); };
  const [touched, setTouched] = useState(false);
  const dirty = editing ? touched : lines.length > 0 || !!supplier || Number(paid) > 0 || Object.values(fees).some((v) => Number(v) > 0);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const save = (receive) => run(async () => {
    const payload = {
      supplier_id: supplier || null, warehouse_id: wh, shipping_payee: shipTo, due_date: dueDate || null, ...Object.fromEntries(Object.entries(fees).map(([k, v]) => [k, Number(v) || 0])),
      lines: lines.map((l) => ({ variant_id: l.id, qty: Number(l.qty), unit_cost: Number(l.unit_cost), lot_no: l.lot_no?.trim() || null, expiry_date: l.expiry_date || null })),
    };
    if (editing) {
      await api.patch(`/purchases/${initial.id}`, payload);
      if (receive) {
        await api.post(`/purchases/${initial.id}/receive`);
        if (Number(paid) > 0) await api.post(`/purchases/${initial.id}/payments`, { amount: Number(paid) });
      }
    } else {
      await api.post('/purchases', { ...payload, receive, paid_amount: receive ? Number(paid) || 0 : 0 }, { 'Idempotency-Key': crypto.randomUUID?.() });
    }
    onDirty?.(false);
    onSaved();
  });
  return (
    <FormPage
      title={editing ? `Sửa phiếu nhập ${initial.code}` : 'Phiếu nhập hàng'}
      sub="Tìm SKU để thêm hàng. Phí và chiết khấu được chia vào giá vốn từng dòng theo giá trị."
      onBack={onClose}
      error={<ErrorBox error={error} />}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Huỷ</button>
        <button type="button" className="btn" disabled={busy || !lines.length} onClick={() => save(false)}>{editing ? 'Lưu thay đổi' : 'Lưu nháp'}</button>
        <button type="button" className="btn primary" disabled={busy || !lines.length} onClick={() => save(true)}>Nhận hàng &amp; lưu</button>
      </>}
      side={<>
        <Section title="Nhà cung cấp & kho">
          <div className="stack">
            <Field label="Nhà cung cấp"><select value={supplier} onChange={(e) => { setTouched(true); setSupplier(e.target.value); }}><option value="">— Không có —</option>{sup.data?.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Nhập vào kho"><select value={wh} onChange={(e) => { setTouched(true); setWh(e.target.value); }}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          </div>
        </Section>
        <Section title="Phí & thanh toán">
          <div className="stack">
            <Field label="Phí ship nhập"><MoneyInput value={fees.shipping_fee} onChange={(e) => { setTouched(true); setFees({ ...fees, shipping_fee: e.target.value }); }} /></Field>
            {Number(fees.shipping_fee) > 0 && (
              <Field label="Ship trả cho" hint={shipTo === 'carrier' ? 'Vẫn tính vào giá vốn, nhưng không cộng vào số nợ nhà cung cấp. Trả bên vận chuyển ở trang chi tiết phiếu.' : 'Nhà cung cấp thu hộ: cộng vào số nợ nhà cung cấp.'}>
                <select value={shipTo} onChange={(e) => { setTouched(true); setShipTo(e.target.value); }}><option value="supplier">Nhà cung cấp</option><option value="carrier">Bên vận chuyển</option></select>
              </Field>
            )}
            <Field label="Phí khác"><MoneyInput value={fees.other_fee} onChange={(e) => { setTouched(true); setFees({ ...fees, other_fee: e.target.value }); }} /></Field>
            <Field label="Chiết khấu"><MoneyInput value={fees.discount_amount} onChange={(e) => { setTouched(true); setFees({ ...fees, discount_amount: e.target.value }); }} /></Field>
            <Field label="Hạn trả nhà cung cấp (tuỳ chọn)" hint="Khoản còn nợ hiện ở Chi phí & quỹ → Công nợ phải trả"><input type="date" value={dueDate} onChange={(e) => { setTouched(true); setDueDate(e.target.value); }} aria-label="Hạn trả nhà cung cấp" /></Field>
            <Field label="Đã trả nhà cung cấp" hint="Chỉ ghi nhận khi nhấn Nhận hàng & lưu"><MoneyInput value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <div>
              <div className="ledger-line"><span>Tiền hàng</span><span className="num">{vnd(sub)}</span></div>
              {carrier > 0 && <div className="ledger-line"><span>Ship trả bên vận chuyển</span><span className="num">{vnd(carrier)}</span></div>}
              <div className="ledger-line total"><span>{carrier > 0 ? 'Phải trả nhà cung cấp' : 'Tổng cộng'}</span><span className="num">{vnd(total)}</span></div>
            </div>
          </div>
        </Section>
      </>}
    >
      <Section title={`Hàng nhập${lines.length ? ` (${lines.length})` : ''}`}>
        <div className="stack">
          <input placeholder="Tìm SKU hoặc tên để thêm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm SKU" autoFocus />
          {found.data?.data?.length > 0 && <div className="pick-list">{found.data.data.map((v) => <div key={v.id} className="pick" onClick={() => { setTouched(true); setLines((l) => (l.some((x) => x.id === v.id) ? l : [...l, { id: v.id, sku: v.sku, name: v.product_name, qty: 1, unit_cost: v.avg_cost || 0 }])); setQ(''); }}><span>{v.product_name} <span className="muted small">{v.sku}</span></span></div>)}</div>}
          {!lines.length ? <div className="of-empty muted">Chưa có dòng hàng nào. Gõ SKU ở ô trên rồi chọn.</div> : (
            <div className="pl-lines">
              <div className="pl-head small muted"><span>Hàng</span><span>Số lượng</span><span>Giá nhập</span><span className="num">Thành tiền</span><span /></div>
              {lines.map((l) => (
                <div key={l.id} className="pl-wrap">
                <div className="pl-row">
                  <div className="pl-name"><div>{l.name}</div><div className="small muted">{l.sku}</div></div>
                  <input type="number" min="1" value={l.qty} onChange={(e) => upd(l.id, { qty: e.target.value })} aria-label="Số lượng" />
                  <MoneyInput value={l.unit_cost} onChange={(e) => upd(l.id, { unit_cost: e.target.value })} aria-label="Giá nhập" />
                  <b className="num">{vnd((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</b>
                  <button type="button" className="btn sm" aria-label={`Bỏ ${l.sku}`} onClick={() => { setTouched(true); setLines((ls) => ls.filter((x) => x.id !== l.id)); }}>✕</button>
                </div>
                <div className="pl-lot small muted">
                  <label>Lô <input value={l.lot_no || ''} onChange={(e) => upd(l.id, { lot_no: e.target.value })} aria-label={`Số lô ${l.sku}`} placeholder="tuỳ chọn" /></label>
                  <label>Hạn dùng <input type="date" value={l.expiry_date || ''} onChange={(e) => upd(l.id, { expiry_date: e.target.value })} aria-label={`Hạn dùng ${l.sku}`} /></label>
                </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>
    </FormPage>
  );
}

export function NewPurchasePage() {
  const nav = useNavigate();
  const { setDirty } = useLeaveGuard();
  const back = () => nav('/purchases');
  return <PurchaseForm onClose={back} onSaved={back} onDirty={setDirty} />;
}

/** Một dòng thanh toán; khoản đã huỷ gạch ngang, khoản còn hiệu lực có nút huỷ */
function PayLine({ x, ship, can, busy, onVoid }) {
  const voided = !!x.voided_at;
  return (
    <div className="row between small muted" style={voided ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
      <span>{fmtDate(x.paid_at)} · {METHODS[x.method]} · {vnd(x.amount)}{ship ? ' (ship)' : ''}{voided ? ' · đã huỷ' : ''}</span>
      {can && !voided && <button type="button" className="btn sm" disabled={busy} onClick={() => onVoid(x)}>Huỷ khoản này</button>}
    </div>
  );
}

/** Sửa phiếu nhập nháp: nạp phiếu rồi dùng lại form tạo phiếu */
export function EditPurchasePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { setDirty } = useLeaveGuard();
  const s = useAsync(() => api.get(`/purchases/${id}`), [id]);
  const back = () => nav(`/purchases/${id}`);
  return (
    <Async state={s}>{({ data: p }) => p.status !== 'draft'
      ? <div className="page"><Empty action={<button type="button" className="btn" onClick={back}>Quay lại phiếu</button>}>Chỉ sửa được phiếu nháp. Phiếu đã nhận hoặc đã huỷ thì huỷ phiếu rồi tạo phiếu mới nếu cần đổi hàng.</Empty></div>
      : <PurchaseForm initial={p} onClose={back} onSaved={back} onDirty={setDirty} />}</Async>
  );
}

/** Trang chi tiết phiếu nhập: hàng, thanh toán, nhận hàng, huỷ, trả nợ */
export function PurchasePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = useAsync(() => api.get(`/purchases/${id}`), [id]);
  const { busy, error, run } = useAction();
  const [pay, setPay] = useState('');
  const [shipPay, setShipPay] = useState('');
  const [refund, setRefund] = useState(null); // phương thức NCC hoàn tiền khi huỷ phiếu đã trả tiền
  const voidPay = (x) => confirm(`Huỷ khoản ${vnd(x.amount)} đã ghi ngày ${fmtDate(x.paid_at)}? Khoản này sẽ tính lại vào số còn nợ.`) && run(async () => { await api.post(`/payments/${x.id}/void`, {}); s.reload(); });
  return (
    <div className="page stack">
      <Async state={s}>{({ data: p }) => (
        <>
          <PageHeader title={p.code} sub={`${p.supplier_name || 'Không có nhà cung cấp'} · ${fmtDate(p.ordered_at)}`} actions={<><PurchaseBadge status={p.status} /><button type="button" className="btn sm" onClick={() => nav('/purchases')}>← Quay lại</button></>} />
          <div className="form-grid">
            <div className="stack">
              <Section title="Hàng nhập" flush>
                <div className="table-wrap"><table><tbody>{p.lines.map((l) => <tr key={l.id}><td>{l.name || l.sku}<span className="sub">{num(l.qty)} × {vnd(l.unit_cost)}</span></td><td className="num small">giá vốn thực<br /><b>{vnd(l.landed_unit_cost)}</b></td></tr>)}</tbody></table></div>
              </Section>
              <CustomFieldsPanel bare entity="purchase" id={p.id} shopId={p.shop_id} />
            </div>
            <div className="stack">
              <Section title="Thanh toán">
                <div className="stack">
                  <div>
                    <div className="ledger-line"><span>Tổng</span><b className="num">{vnd(p.total_amount)}</b></div>
                    <div className="ledger-line"><span>Đã trả</span><b className="num">{vnd(p.paid_amount)}</b></div>
                  </div>
                  {p.payments?.map((x) => <PayLine key={x.id} x={x} can={p.status !== 'cancelled' && x.direction === 'out'} busy={busy} onVoid={voidPay} />)}
                  {p.carrier_amount > 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <div>
                        <div className="ledger-line"><span>Ship trả bên vận chuyển</span><b className="num">{vnd(p.carrier_amount)}</b></div>
                        <div className="ledger-line"><span>Đã trả ship</span><b className="num">{vnd(p.carrier_paid_amount)}</b></div>
                      </div>
                      {p.carrier_payments?.map((x) => <PayLine key={x.id} x={x} ship can={p.status !== 'cancelled' && x.direction === 'out'} busy={busy} onVoid={voidPay} />)}
                      {p.status === 'received' && p.carrier_debt > 0 && (
                        <div className="row"><MoneyInput placeholder={`Trả ship (còn ${p.carrier_debt})`} value={shipPay} onChange={(e) => setShipPay(e.target.value)} /><button className="btn" disabled={busy || !shipPay} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/carrier-payments`, { amount: Number(shipPay) }); setShipPay(''); s.reload(); })}>Ghi trả ship</button></div>
                      )}
                    </div>
                  )}
                  {p.status === 'received' && p.debt > 0 && (
                    <div className="row"><MoneyInput placeholder={`Trả nợ (còn ${p.debt})`} value={pay} onChange={(e) => setPay(e.target.value)} /><button className="btn" disabled={busy || !pay} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/payments`, { amount: Number(pay) }); setPay(''); s.reload(); })}>Ghi trả</button></div>
                  )}
                </div>
              </Section>
              <Section title="Thao tác">
                <div className="stack">
                  <ErrorBox error={error} />
                  <div className="row wrap">
                    {p.status === 'draft' && <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/receive`); s.reload(); })}>Nhận hàng</button>}
                    {p.status === 'draft' && <Link className="btn" to={`/purchases/${p.id}/edit`}>Sửa phiếu</Link>}
                    {p.status !== 'cancelled' && p.paid_amount === 0 && !(p.carrier_paid_amount > 0) && <button className="btn danger" disabled={busy} onClick={() => confirm('Huỷ phiếu? Nếu đã nhận, kho sẽ bị trừ lại.') && run(async () => { await api.post(`/purchases/${p.id}/cancel`, {}); s.reload(); })}>Huỷ phiếu</button>}
                    {p.status !== 'cancelled' && (p.paid_amount > 0 || p.carrier_paid_amount > 0) && <button className="btn danger" disabled={busy} onClick={() => setRefund('bank')}>Huỷ phiếu</button>}
                  </div>
                  {refund && (
                    <div className="alert warn stack small" style={{ gap: 8 }}>
                      <span>Phiếu đã trả <b>{vnd(p.paid_amount + p.carrier_paid_amount)}</b>{p.carrier_paid_amount > 0 ? ' (gồm tiền ship cho bên vận chuyển)' : ''}. Huỷ phiếu nghĩa là số tiền này được hoàn lại. Hoàn bằng cách nào?</span>
                      <div className="row wrap">
                        <select value={refund} onChange={(e) => setRefund(e.target.value)} aria-label="Phương thức hoàn tiền">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        <button className="btn danger" disabled={busy} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/cancel`, { refund_method: refund }); setRefund(null); s.reload(); })}>Huỷ phiếu và ghi nhận hoàn tiền</button>
                        <button className="btn" onClick={() => setRefund(null)}>Không huỷ</button>
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            </div>
          </div>
        </>
      )}</Async>
    </div>
  );
}
