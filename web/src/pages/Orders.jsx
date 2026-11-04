import ProductThumb from '../components/ProductThumb.jsx';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, DateRange, Empty, ErrorBox, Field, LoadMore, Modal, SearchBox, StatusBadge, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import ImportPanel from './Import.jsx';
import ExportOrders from '../components/ExportOrders.jsx';
import CustomFieldsPanel from '../components/CustomFieldsPanel.jsx';
import { vnd, num, fmtDate, STATUS, PAY_STATUS } from '../lib.js';
import MoneyInput from '../components/MoneyInput.jsx';
import ReturnModal, { emptyReturnForm } from './ReturnModal.jsx';

const TABS = [['', 'Tất cả'], ['draft', 'Nháp'], ['confirmed', 'Đã xác nhận'], ['shipping', 'Đang giao'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã huỷ'], ['returned', 'Trả hàng']];

export function OrderList() {
  const { shopId, allChannels: channels } = useSession();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const [channel, setChannel] = useState(sp.get('channel') || '');
  const [text, setText] = useState('');
  const dq = useDebounced(text);
  const [range, setRange] = useState({ from: sp.get('from') || '', to: sp.get('to') || '' }); // từ link "Xem dữ liệu gốc" của báo cáo
  const [extra, setExtra] = useState([]);
  const [cursor, setCursor] = useState(null);
  const nav = useNavigate();
  const showImport = sp.get('import') === '1';
  const [showExport, setShowExport] = useState(false);
  const setImport = (on) => { const n = new URLSearchParams(sp); on ? n.set('import', '1') : n.delete('import'); setSp(n, { replace: true }); };
  const params = { shop_id: shopId === 'all' ? undefined : shopId, status: status || undefined, channel: channel || undefined, q: dq || undefined, from: range.from || undefined, to: range.to || undefined };
  const state = useAsync(async () => { setExtra([]); setCursor(null); return api.get('/orders', { ...params, limit: 50 }); }, [shopId, status, channel, dq, range.from, range.to]);
  const more = async (next) => {
    const r = await api.get('/orders', { ...params, limit: 50, cursor: next });
    setExtra((e) => [...e, ...r.data]);
    setCursor(r.next_cursor);
  };

  return (
    <div className="page stack">
      <div className="page-head"><h1>Đơn hàng</h1><div className="row"><button className="btn" onClick={() => setImport(true)}><Icon name="upload" />Nhập từ file</button><button className="btn" onClick={() => setShowExport(true)}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất file</button><Link to="/orders/new" className="btn primary"><Icon name="plus" />Đơn mới</Link></div></div>
      <Chips options={TABS} value={status} onChange={(v) => { const n = new URLSearchParams(sp); v ? n.set('status', v) : n.delete('status'); setSp(n); }} />
      <div className="row wrap">
        <SearchBox value={text} onChange={setText} placeholder="Tìm mã đơn, tên, SĐT, mã vận đơn…" />
        <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 160 }} aria-label="Kênh"><option value="">Mọi kênh</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived_at ? ' (đã tắt)' : ''}</option>)}</select>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </div>
      <Async state={state}>
        {(res) => {
          const rows = [...res.data, ...extra];
          const next = extra.length || cursor ? cursor : res.next_cursor;
          if (!rows.length) return <Empty action={<div className="row"><button className="btn" onClick={() => setImport(true)}><Icon name="upload" />Nhập từ file</button><Link to="/orders/new" className="btn primary">Tạo đơn</Link></div>}>Chưa có đơn nào khớp bộ lọc.</Empty>;
          return (
            <Card flat>
              <div className="table-wrap"><table className="stackable">
                <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Khách</th><th>Kênh</th><th>Trạng thái</th><th>Thu tiền</th><th className="num">Tổng</th></tr></thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                      <td><b style={{ whiteSpace: 'nowrap' }}>{o.code}</b>{o.external_id && <div className="small muted">{o.external_id}</div>}{o.stock_warning ? <div className="small h-yellow">⚠ âm kho</div> : null}</td>
                      <td className="hide-sm">{fmtDate(o.business_date)}</td>
                      <td className="full">{o.customer_name || <span className="muted">Khách lẻ</span>}<div className="small muted">{o.shop_name}<span className="only-sm"> · {channels.find((c) => c.id === o.channel_id)?.name} · {fmtDate(o.business_date)}</span></div></td>
                      <td className="hide-sm">{channels.find((c) => c.id === o.channel_id)?.name}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="small hide-sm">{PAY_STATUS[o.payment_status]}</td>
                      <td className="num"><b>{vnd(o.total_amount)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <LoadMore next={next} onMore={() => more(next)} />
            </Card>
          );
        }}
      </Async>
      {showExport && <ExportOrders filters={Object.fromEntries(Object.entries(params).filter(([, v]) => v))} onClose={() => setShowExport(false)} />}
      {showImport && <ImportPanel defaultShop={shopId} onClose={() => { setImport(false); state.reload(); }} />}
    </div>
  );
}

const NEXT = { draft: [['confirmed', 'Xác nhận (trừ kho)']], confirmed: [['shipping', 'Đang giao'], ['completed', 'Hoàn thành']], shipping: [['completed', 'Hoàn thành']] };

export function OrderDetail() {
  const { id } = useParams();
  const { allChannels: channels, methodLabels, methodList } = useSession();
  const state = useAsync(() => api.get(`/orders/${id}`), [id]);
  const act = useAction();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});

  return (
    <div className="page stack">
      <Async state={state}>
        {({ data: o }) => {
          const ch = channels.find((c) => c.id === o.channel_id);
          const doStatus = (status, note) => act.run(async () => { await api.post(`/orders/${o.id}/status`, { status, note }); setModal(null); state.reload(); });
          const doStatusForce = (status) => act.run(async () => {
            try { await api.post(`/orders/${o.id}/status`, { status }); } catch (e) {
              if (e.code === 'STOCK_NOT_ENOUGH' && confirm(`${e.message}\n\nVẫn xác nhận và cho phép âm kho?`)) await api.post(`/orders/${o.id}/status`, { status, allow_negative_stock: true });
              else throw e;
            }
            state.reload();
          });
          return (
            <>
              <div className="page-head">
                <div><h1>{o.code}</h1><div className="muted small">{o.shop_name} · {ch?.name} {o.external_id && `· ${o.external_id}`} · {fmtDate(o.ordered_at)}</div></div>
                <div className="row wrap">{o.status === 'completed' && o.payment_status === 'paid' && <span className="seal">ĐÃ CHỐT</span>}<StatusBadge status={o.status} /><span className="badge plain">{PAY_STATUS[o.payment_status]}</span></div>
              </div>
              <ErrorBox error={act.error} />
              {o.stock_warning ? <div className="alert warn">Đơn này làm tồn kho âm. Kiểm tra kho thực tế và điều chỉnh nếu cần.</div> : null}
              {o.refund_owed_amount > 0 ? <div className="alert warn">Còn phải trả khách {vnd(o.refund_owed_amount)} (đã thu {vnd(o.paid_amount)}, số phải thu sau trả hàng thấp hơn). Hoàn bằng nút “Hoàn tiền”.</div> : o.needs_refund && <div className="alert warn">Đã thu nhiều hơn số cần thu ({vnd(o.paid_amount)}). Cần hoàn lại khách.</div>}
              <div className="row wrap no-print">
                {(NEXT[o.status] || []).map(([st, label]) => <button key={st} className={`btn ${st === NEXT[o.status][0][0] ? 'primary' : ''}`} disabled={act.busy} onClick={() => doStatusForce(st)}>{label}</button>)}
                {o.status === 'draft' && <Link className="btn" to={`/orders/${o.id}/edit`}>Sửa</Link>}
                {['draft', 'confirmed', 'shipping'].includes(o.status) && <button className="btn danger" disabled={act.busy} onClick={() => { setForm({ note: '' }); setModal('cancel'); }}>Huỷ đơn</button>}
                {o.amount_due > 0 && !['cancelled', 'draft'].includes(o.status) && <button className="btn" onClick={() => { setForm({ amount: o.amount_due, method: 'cash' }); setModal('pay'); }}>Thu tiền ({vnd(o.amount_due)})</button>}
                {o.refund_owed_amount > 0 && <button className="btn primary" onClick={() => { setForm({ amount: o.refund_owed_amount, method: 'cash' }); setModal('refund'); }}>Hoàn tiền ({vnd(o.refund_owed_amount)})</button>}
                {['confirmed', 'shipping', 'completed'].includes(o.status) && <button className="btn" onClick={() => { setForm(emptyReturnForm()); setModal('return'); }}>Trả hàng</button>}
                <a className="btn" href={`/api/v1/orders/${o.id}/receipt`} target="_blank" rel="noreferrer">In phiếu</a>
              </div>

              <div className="grid cols-2 collapse">
                <Card title="Khách">
                  {o.customer_id ? <Link to={`/customers/${o.customer_id}`}>{o.customer_name}</Link> : <span>{o.customer_name || 'Khách lẻ'}</span>}
                  <div className="small muted">{o.customer_phone}</div><div className="small">{o.shipping_address}</div>
                  {o.tracking_code && <div className="small">Vận đơn: {o.carrier} {o.tracking_code}</div>}
                  {o.note && <div className="small" style={{ marginTop: 6 }}>Ghi chú: {o.note}</div>}
                </Card>
                <Card title="Tiền">
                  <div className="stack small">
                    <Row l="Tiền hàng" v={o.subtotal} />
                    {(o.line_discount_amount + o.discount_amount) > 0 && <Row l="Giảm giá" v={-(o.line_discount_amount + o.discount_amount)} />}
                    {o.shipping_fee > 0 && <Row l="Phí ship khách trả" v={o.shipping_fee} />}
                    <Row l="Khách phải trả" v={o.total_amount} bold />
                    {o.platform_fee_amount > 0 && <Row l="Phí sàn" v={-o.platform_fee_amount} />}
                    {o.seller_shipping_amount > 0 && <Row l="Ship shop chịu" v={-o.seller_shipping_amount} />}
                    {o.returned_goods_amount > 0 && <Row l="Hàng trả" v={-o.returned_goods_amount} />}
                    {o.returned_shipping_amount > 0 && <Row l="Hoàn phí ship khách" v={-o.returned_shipping_amount} />}
                    {o.return_fee_amount > 0 && <Row l="Phí trả hàng thu được" v={o.return_fee_amount} />}
                    {o.return_shipping_cost > 0 && <Row l="Ship chiều về" v={-o.return_shipping_cost} />}
                    <Row l="Giá vốn" v={-o.cogs_amount} />
                    <Row l="Lợi nhuận gộp" v={o.gross_profit} bold />
                    <Row l="Đã thu" v={o.paid_amount} />
                    {o.refund_owed_amount > 0 && <Row l="Còn phải trả khách" v={o.refund_owed_amount} bold />}
                  </div>
                </Card>
              </div>

              <Card title="Sản phẩm" flat>
                <div className="table-wrap"><table>
                  <thead><tr><th>Sản phẩm</th><th className="num">SL</th><th className="num">Đơn giá</th><th className="num">Giá vốn</th><th className="num">Thành tiền</th></tr></thead>
                  <tbody>{o.lines.map((l) => (
                    <tr key={l.id}><td><div className="row" style={{ gap: 10 }}><ProductThumb src={l.image_url} name={l.name} size={36} /><div>{l.name}<div className="small muted">{l.sku}{l.returned_qty > 0 && ` · đã trả ${l.returned_qty}`}</div>{l.allocations?.length > 0 && <div className="small muted">Lấy từ: {l.allocations.map((a) => `${a.warehouse_name}${l.allocations.some((x) => x.sku !== l.sku) ? ` (${a.sku})` : ''} × ${a.qty}`).join(', ')}</div>}{!l.allocations?.length && l.planned_allocations?.length > 0 && <div className="small muted">Dự kiến lấy từ kho đã chọn tay</div>}</div></div></td><td className="num">{num(l.qty)}</td><td className="num">{vnd(l.unit_price)}</td><td className="num muted">{vnd(l.unit_cost)}</td><td className="num">{vnd(l.line_total)}</td></tr>
                  ))}</tbody>
                </table></div>
              </Card>

              <div className="grid cols-2 collapse">
                <Card title="Thanh toán">
                  {o.payments.length === 0 ? <span className="muted small">Chưa có khoản thu nào.</span> : o.payments.filter((p) => !p.voided_at).map((p) => (
                    <div key={p.id} className="row between small"><span>{fmtDate(p.paid_at)} · {methodLabels[p.method] || p.method}{p.direction === 'out' && ' (hoàn)'}</span><b>{p.direction === 'out' ? '−' : ''}{vnd(p.amount)}</b></div>
                  ))}
                </Card>
                <Card title="Lịch sử">
                  {o.history.map((h) => <div key={h.id} className="small"><span className="muted">{fmtDate(h.created_at)}</span> · {h.from_status ? `${STATUS[h.from_status]} → ` : ''}{STATUS[h.to_status]}{h.note && ` (${h.note})`}</div>)}
                  {o.returns.map((r) => <div key={r.id} className="small h-yellow">{r.code}: trả hàng {vnd(r.goods_amount)}{r.shipping_refund_amount > 0 && `, hoàn ship ${vnd(r.shipping_refund_amount)}`}{r.return_fee_amount > 0 && `, phí trả hàng ${vnd(r.return_fee_amount)}`}{r.reason && ` — ${r.reason}`}</div>)}
                </Card>
              </div>

              <CustomFieldsPanel entity="order" id={o.id} shopId={o.shop_id} />

              {modal === 'cancel' && (
                <Modal title="Huỷ đơn" onClose={() => setModal(null)} footer={<button className="btn danger" disabled={act.busy} onClick={() => doStatus('cancelled', form.note)}>Xác nhận huỷ</button>}>
                  <p className="muted small">Hàng đã trừ kho sẽ được cộng lại.</p>
                  <Field label="Lý do"><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'pay' && (
                <Modal title="Thu tiền" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/payments`, { amount: Number(form.amount), method: form.method }); setModal(null); state.reload(); })}>Ghi nhận</button>}>
                  <Field label="Số tiền"><MoneyInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                  <Field label="Phương thức"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'refund' && (
                <Modal title="Hoàn tiền cho khách" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/payments`, { amount: Number(form.amount), method: form.method, direction: 'out' }); setModal(null); state.reload(); })}>Ghi nhận hoàn tiền</button>}>
                  <Field label={`Số tiền (tối đa ${vnd(o.refund_owed_amount)})`}><MoneyInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                  <Field label="Phương thức"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'return' && <ReturnModal order={o} form={form} setForm={setForm} act={act} methodList={methodList} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
            </>
          );
        }}
      </Async>
    </div>
  );
}

const Row = ({ l, v, bold }) => <div className="row between" style={bold ? { fontWeight: 700 } : undefined}><span>{l}</span><span className="num">{vnd(v)}</span></div>;
