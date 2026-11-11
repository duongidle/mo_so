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
import MoneyFill from '../components/MoneyFill.jsx';
import { lineAmount } from '../lib/money.js';
import { PurchaseReturnModal, PurchaseAllowanceModal } from './PurchaseReturnModal.jsx';

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

/** Tồn hiện tại của món: "Chưa có ở kho này" khi món chưa từng nhập vào kho đó, đỏ khi hết, vàng khi sắp hết (dưới mức tối thiểu), mờ khi bình thường */
function StockTag({ n, min = 0, never, scope }) {
  const v = Number(n) || 0;
  const low = v <= (Number(min) || 0);
  const cls = never ? 'muted' : v <= 0 ? 'h-red' : low ? 'h-yellow' : 'muted';
  const text = never ? 'Chưa có ở kho này' : v <= 0 ? 'Hết hàng' : low ? `Sắp hết · còn ${v}` : `Còn ${v}`;
  return <span className={`small ${cls}`} style={{ whiteSpace: 'nowrap', fontWeight: !never && low ? 600 : 400 }} title={scope}>{text}</span>;
}

/** Tên món kèm biến thể để phân biệt các món trùng tên */
const itemName = (productName, variantName) => (variantName && variantName !== productName ? `${productName} · ${variantName}` : productName);

/** Trang phiếu nhập mới: cột chính là các dòng hàng, cột phụ là nhà cung cấp, phí, thanh toán */
export function PurchaseForm({ onClose, onSaved, onDirty, initial }) {
  const { warehouses } = useSession();
  const editing = !!initial; // sửa phiếu nháp: lưu bằng PATCH, nhận hàng là bước riêng
  const [wh, setWh] = useState(initial?.warehouse_id ?? warehouses[0]?.id);
  const [supplier, setSupplier] = useState(initial?.supplier_id ?? '');
  const [lines, setLines] = useState(() => initial?.lines.map((l) => ({ id: l.variant_id, sku: l.sku, name: itemName(l.product_name, l.variant_name), qty: l.qty, unit_cost: l.unit_cost, lot_no: l.lot_no || '', expiry_date: l.expiry_date || '' })) ?? []);
  const [fees, setFees] = useState({ shipping_fee: initial?.shipping_fee ?? 0, other_fee: initial?.other_fee ?? 0, discount_amount: initial?.discount_amount ?? 0 });
  const [paid, setPaid] = useState(0);
  const [shipTo, setShipTo] = useState(initial?.shipping_payee ?? 'supplier'); // ai nhận tiền ship: nhà cung cấp hay bên vận chuyển
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const sup = useAsync(() => api.get('/suppliers'), []);
  const found = useAsync(() => (dq ? api.get('/variants', { q: dq, all: '1', limit: 8, warehouse_id: wh }) : null), [dq, wh]);
  // Tồn từng món tại kho nhận: hiện cạnh kết quả tìm, ở dòng hàng, và để gợi ý món hết hoặc sắp hết khi chưa gõ gì
  const stock = useAsync(() => api.get('/stock', { warehouse_id: wh, limit: 2000 }), [wh]);
  const stockAll = useAsync(() => api.get('/stock', { limit: 2000 }), []); // tồn tổng mọi kho: để gợi ý món hết hoặc sắp hết
  const stockRows = Array.isArray(stock.data?.data) ? stock.data.data : [];
  const stockOf = new Map(stockRows.map((r) => [r.variant_id, r]));
  const whName = warehouses.find((w) => w.id === wh)?.name;
  const [lotOpen, setLotOpen] = useState(() => new Set());
  const addLine = (v) => { setTouched(true); setLines((l) => (l.some((x) => x.id === v.id) ? l : [...l, { id: v.id, sku: v.sku, name: itemName(v.product_name, v.variant_name), qty: 1, unit_cost: v.avg_cost || 0 }])); setQ(''); };
  const allRows = Array.isArray(stockAll.data?.data) ? stockAll.data.data : [];
  const lowItems = allRows.filter((r) => r.kind !== 'bundle' && r.item_type === 'product' && r.on_hand <= (r.min_stock || 0) && !lines.some((x) => x.id === r.variant_id)).sort((a, b) => a.on_hand - b.on_hand).slice(0, 8);
  const { busy, error, run } = useAction();
  const sub = lines.reduce((a, l) => a + lineAmount(Number(l.qty) || 0, Number(l.unit_cost) || 0), 0);
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
            <Field label="Đã trả nhà cung cấp" hint="Chỉ ghi nhận khi nhấn Nhận hàng & lưu"><MoneyFill fill={total} label="Trả đủ" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
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
          {found.data?.data?.length > 0 && <div className="pick-list">{found.data.data.map((v) => <div key={v.id} className="pick" onClick={() => addLine(v)}><span>{itemName(v.product_name, v.variant_name)} <span className="muted small">{v.sku}</span></span><StockTag n={v.on_hand} min={v.min_stock} never={!!stock.data && !stockOf.has(v.id)} scope={whName ? `Tồn tại ${whName}` : undefined} /></div>)}</div>}
          {!q && lowItems.length > 0 && <div className="stack" style={{ gap: 4 }}>
            <div className="small muted">Hết hoặc sắp hết (tính tổng mọi kho), bấm để thêm:</div>
            <div className="pick-list">{lowItems.map((r) => <div key={r.variant_id} className="pick" onClick={() => addLine({ id: r.variant_id, sku: r.sku, product_name: r.product_name, variant_name: r.variant_name, avg_cost: r.avg_cost })}><span>{itemName(r.product_name, r.variant_name)} <span className="muted small">{r.sku}</span></span><StockTag n={r.on_hand} min={r.min_stock} scope="Tồn tổng các kho" /></div>)}</div>
          </div>}
          {!lines.length ? <div className="of-empty muted">Chưa có dòng hàng nào. Gõ SKU ở ô trên rồi chọn.</div> : (
            <div className="pl-lines">
              <div className="pl-head small muted"><span>Hàng</span><span>Số lượng</span><span>Giá nhập</span><span className="num">Thành tiền</span><span /></div>
              {lines.map((l) => (
                <div key={l.id} className="pl-wrap">
                <div className="pl-row">
                  <div className="pl-name"><div>{l.name}</div><div className="small muted">{l.sku}{stock.data && <> · <StockTag n={stockOf.get(l.id)?.on_hand} min={stockOf.get(l.id)?.min_stock} never={!stockOf.has(l.id)} scope={whName ? `Tồn tại ${whName}` : undefined} /></>}</div></div>
                  <input type="number" min="0.001" step="any" inputMode="decimal" value={l.qty} onChange={(e) => upd(l.id, { qty: e.target.value })} aria-label="Số lượng" />
                  <MoneyInput value={l.unit_cost} onChange={(e) => upd(l.id, { unit_cost: e.target.value })} aria-label="Giá nhập" />
                  <b className="num">{vnd(lineAmount(Number(l.qty) || 0, Number(l.unit_cost) || 0))}</b>
                  <button type="button" className="btn sm" aria-label={`Bỏ ${l.sku}`} onClick={() => { setTouched(true); setLines((ls) => ls.filter((x) => x.id !== l.id)); }}>✕</button>
                </div>
                {(lotOpen.has(l.id) || l.lot_no || l.expiry_date) ? (
                  <div className="pl-lot small muted">
                    <label>Lô <input value={l.lot_no || ''} onChange={(e) => upd(l.id, { lot_no: e.target.value })} aria-label={`Số lô ${l.sku}`} placeholder="tuỳ chọn" /></label>
                    <label>Hạn dùng <input type="date" value={l.expiry_date || ''} onChange={(e) => upd(l.id, { expiry_date: e.target.value })} aria-label={`Hạn dùng ${l.sku}`} /></label>
                  </div>
                ) : <div><button type="button" className="linkbtn small" onClick={() => setLotOpen((x) => new Set(x).add(l.id))}>+ Lô / hạn dùng</button></div>}
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
    <div className="ledger-line pay-line" style={voided ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
      <span className="small muted">
        {fmtDate(x.paid_at)} · {METHODS[x.method]}{ship ? ' · ship' : ''}{voided ? ' · đã huỷ' : ''}
        {can && !voided && <> · <button type="button" className="linkbtn" disabled={busy} onClick={() => onVoid(x)}>Huỷ khoản này</button></>}
      </span>
      <span className="num">{vnd(x.amount)}</span>
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
  const [pay, setPay] = useState(null); // null = chưa gõ: tự điền số còn nợ
  const [shipPay, setShipPay] = useState(null);
  const [refund, setRefund] = useState(null); // phương thức NCC hoàn tiền khi huỷ phiếu đã trả tiền
  const [modal, setModal] = useState(null); // 'return' | 'allowance'
  const [supRefund, setSupRefund] = useState(null);
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
              {(p.returns?.length > 0 || p.allowances?.length > 0) && (
                <Section title="Trả hàng và giảm giá sau nhận">
                  {p.returns.map((x) => (
                    <div key={x.id} className="ledger-line" style={x.voided_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                      <span className="small">{x.code} · trả hàng · {fmtDate(x.returned_at)}{x.reason ? ` · ${x.reason}` : ''}{x.voided_at ? ' · đã huỷ' : ''}{!x.voided_at && <> · <button type="button" className="linkbtn" disabled={busy} onClick={() => confirm(`Huỷ phiếu trả ${x.code}? Hàng nhập lại kho, nợ NCC tăng lại.`) && run(async () => { await api.post(`/purchase-returns/${x.id}/void`, {}); s.reload(); })}>Huỷ phiếu</button></>}</span>
                      <span className="num">−{vnd(x.goods_amount)}</span>
                    </div>
                  ))}
                  {p.allowances.map((x) => (
                    <div key={x.id} className="ledger-line" style={x.voided_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                      <span className="small">{x.code} · NCC giảm giá · {fmtDate(x.allowed_at)}{x.reason ? ` · ${x.reason}` : ''}{x.voided_at ? ' · đã huỷ' : ''}{!x.voided_at && <> · <button type="button" className="linkbtn" disabled={busy} onClick={() => confirm(`Huỷ phiếu giảm giá ${x.code}?`) && run(async () => { await api.post(`/purchase-allowances/${x.id}/void`, {}); s.reload(); })}>Huỷ phiếu</button></>}</span>
                      <span className="num">−{vnd(x.amount)}</span>
                    </div>
                  ))}
                </Section>
              )}
              <CustomFieldsPanel bare entity="purchase" id={p.id} shopId={p.shop_id} />
            </div>
            <div className="stack">
              <Section title="Thanh toán">
                <div className="stack">
                  <div>
                    <div className="ledger-line"><span>Tổng</span><b className="num">{vnd(p.total_amount)}</b></div>
                    {p.returned_amount > 0 && <div className="ledger-line"><span>Hàng đã trả NCC</span><b className="num">−{vnd(p.returned_amount)}</b></div>}
                    {p.allowance_amount > 0 && <div className="ledger-line"><span>NCC giảm giá</span><b className="num">−{vnd(p.allowance_amount)}</b></div>}
                    <div className="ledger-line"><span>Đã trả</span><b className="num">{vnd(p.paid_amount)}</b></div>
                    {p.payments?.map((x) => <PayLine key={x.id} x={x} can={p.status !== 'cancelled' && x.direction === 'out'} busy={busy} onVoid={voidPay} />)}
                  </div>
                  {p.carrier_amount > 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <div>
                        <div className="ledger-line"><span>Ship trả bên vận chuyển</span><b className="num">{vnd(p.carrier_amount)}</b></div>
                        <div className="ledger-line"><span>Đã trả ship</span><b className="num">{vnd(p.carrier_paid_amount)}</b></div>
                        {p.carrier_payments?.map((x) => <PayLine key={x.id} x={x} ship can={p.status !== 'cancelled' && x.direction === 'out'} busy={busy} onVoid={voidPay} />)}
                      </div>
                      {p.status === 'received' && p.carrier_debt > 0 && (
                        <div className="row"><MoneyFill fill={p.carrier_debt} value={shipPay ?? String(p.carrier_debt)} onChange={(e) => setShipPay(e.target.value)} aria-label="Số tiền trả ship" /><button className="btn primary" disabled={busy || !Number(shipPay ?? p.carrier_debt)} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/carrier-payments`, { amount: Number(shipPay ?? p.carrier_debt) }); setShipPay(null); s.reload(); })}>Ghi trả ship</button></div>
                      )}
                    </div>
                  )}
                  {p.status === 'received' && p.supplier_owes > 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <div className="ledger-line"><span>NCC còn nợ shop</span><b className="num">{vnd(p.supplier_owes)}</b></div>
                      <div className="row"><MoneyFill fill={p.supplier_owes} value={supRefund ?? String(p.supplier_owes)} onChange={(e) => setSupRefund(e.target.value)} aria-label="Số tiền NCC hoàn" /><button className="btn primary" disabled={busy || !Number(supRefund ?? p.supplier_owes)} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/supplier-refunds`, { amount: Number(supRefund ?? p.supplier_owes) }); setSupRefund(null); s.reload(); })}>Ghi NCC hoàn tiền</button></div>
                    </div>
                  )}
                  {p.status === 'received' && p.debt > 0 && (
                    <div className="row"><MoneyFill fill={p.debt} value={pay ?? String(p.debt)} onChange={(e) => setPay(e.target.value)} aria-label="Số tiền trả nợ" /><button className="btn primary" disabled={busy || !Number(pay ?? p.debt)} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/payments`, { amount: Number(pay ?? p.debt) }); setPay(null); s.reload(); })}>Ghi trả</button></div>
                  )}
                </div>
              </Section>
              <Section title="Thao tác">
                <div className="stack">
                  <ErrorBox error={error} />
                  <div className="row wrap">
                    {p.status === 'draft' && <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post(`/purchases/${p.id}/receive`); s.reload(); })}>Nhận hàng</button>}
                    {p.status === 'draft' && <Link className="btn" to={`/purchases/${p.id}/edit`}>Sửa phiếu</Link>}
                    {p.status === 'received' && <button className="btn" disabled={busy} onClick={() => setModal('return')}>Trả hàng NCC</button>}
                    {p.status === 'received' && <button className="btn" disabled={busy} onClick={() => setModal('allowance')}>NCC giảm giá</button>}
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
          {modal === 'return' && <PurchaseReturnModal purchase={p} onClose={() => setModal(null)} onDone={() => { setModal(null); s.reload(); }} />}
          {modal === 'allowance' && <PurchaseAllowanceModal purchase={p} onClose={() => setModal(null)} onDone={() => { setModal(null); s.reload(); }} />}
        </>
      )}</Async>
    </div>
  );
}
