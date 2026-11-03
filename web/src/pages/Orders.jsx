import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, DateRange, Empty, ErrorBox, Field, LoadMore, Modal, StatusBadge, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd, num, fmtDate, STATUS, PAY_STATUS, METHODS } from '../lib.js';

const TABS = [['', 'Tất cả'], ['draft', 'Nháp'], ['confirmed', 'Đã xác nhận'], ['shipping', 'Đang giao'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã huỷ'], ['returned', 'Trả hàng']];

export function OrderList() {
  const { shopId, channels } = useSession();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const [channel, setChannel] = useState('');
  const [text, setText] = useState('');
  const dq = useDebounced(text);
  const [range, setRange] = useState({ from: '', to: '' });
  const [extra, setExtra] = useState([]);
  const [cursor, setCursor] = useState(null);
  const nav = useNavigate();
  const params = { shop_id: shopId === 'all' ? undefined : shopId, status: status || undefined, channel: channel || undefined, q: dq || undefined, from: range.from || undefined, to: range.to || undefined };
  const state = useAsync(async () => { setExtra([]); setCursor(null); return api.get('/orders', { ...params, limit: 50 }); }, [shopId, status, channel, dq, range.from, range.to]);
  const more = async (next) => {
    const r = await api.get('/orders', { ...params, limit: 50, cursor: next });
    setExtra((e) => [...e, ...r.data]);
    setCursor(r.next_cursor);
  };

  return (
    <div className="page stack">
      <div className="page-head"><h1>Đơn hàng</h1><div className="row"><Link to="/import" className="btn">Import</Link><Link to="/pos" className="btn primary">+ Đơn mới</Link></div></div>
      <Chips options={TABS} value={status} onChange={(v) => setSp(v ? { status: v } : {})} />
      <div className="row wrap">
        <input placeholder="Tìm mã đơn, tên, SĐT, mã vận đơn…" value={text} onChange={(e) => setText(e.target.value)} className="grow" style={{ minWidth: 220 }} aria-label="Tìm đơn" />
        <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 160 }} aria-label="Kênh"><option value="">Mọi kênh</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </div>
      <Async state={state}>
        {(res) => {
          const rows = [...res.data, ...extra];
          const next = extra.length || cursor ? cursor : res.next_cursor;
          if (!rows.length) return <Empty>Chưa có đơn nào khớp bộ lọc.</Empty>;
          return (
            <Card flat>
              <div className="table-wrap"><table>
                <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Khách</th><th>Kênh</th><th>Trạng thái</th><th>Thu tiền</th><th className="num">Tổng</th></tr></thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                      <td><b>{o.code}</b>{o.external_id && <div className="small muted">{o.external_id}</div>}{o.stock_warning ? <div className="small h-yellow">⚠ âm kho</div> : null}</td>
                      <td>{fmtDate(o.business_date)}</td>
                      <td>{o.customer_name || <span className="muted">Khách lẻ</span>}<div className="small muted">{o.shop_name}</div></td>
                      <td>{channels.find((c) => c.id === o.channel_id)?.name}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="small">{PAY_STATUS[o.payment_status]}</td>
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
    </div>
  );
}

const NEXT = { draft: [['confirmed', 'Xác nhận (trừ kho)']], confirmed: [['shipping', 'Đang giao'], ['completed', 'Hoàn thành']], shipping: [['completed', 'Hoàn thành']] };

export function OrderDetail() {
  const { id } = useParams();
  const { channels } = useSession();
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
                <div className="row wrap"><StatusBadge status={o.status} /><span className="badge">{PAY_STATUS[o.payment_status]}</span></div>
              </div>
              <ErrorBox error={act.error} />
              {o.stock_warning ? <div className="alert warn">Đơn này làm tồn kho âm. Kiểm tra kho thực tế và điều chỉnh nếu cần.</div> : null}
              {o.needs_refund && <div className="alert warn">Đã thu nhiều hơn số cần thu ({vnd(o.paid_amount)}). Cần hoàn lại khách.</div>}
              <div className="row wrap no-print">
                {(NEXT[o.status] || []).map(([st, label]) => <button key={st} className={`btn ${st === NEXT[o.status][0][0] ? 'primary' : ''}`} disabled={act.busy} onClick={() => doStatusForce(st)}>{label}</button>)}
                {['draft', 'confirmed', 'shipping'].includes(o.status) && <button className="btn danger" disabled={act.busy} onClick={() => { setForm({ note: '' }); setModal('cancel'); }}>Huỷ đơn</button>}
                {o.amount_due > 0 && !['cancelled', 'draft'].includes(o.status) && <button className="btn" onClick={() => { setForm({ amount: o.amount_due, method: 'cash' }); setModal('pay'); }}>Thu tiền ({vnd(o.amount_due)})</button>}
                {['confirmed', 'shipping', 'completed'].includes(o.status) && <button className="btn" onClick={() => { setForm({ lines: {}, reason: '', refund: 0, method: 'cash' }); setModal('return'); }}>Trả hàng</button>}
                <a className="btn" href={`/api/v1/orders/${o.id}/receipt`} target="_blank" rel="noreferrer">In phiếu</a>
              </div>

              <div className="grid cols-2">
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
                    {o.returned_amount > 0 && <Row l="Hàng trả" v={-o.returned_amount} />}
                    <Row l="Giá vốn" v={-o.cogs_amount} />
                    <Row l="Lợi nhuận gộp" v={o.gross_profit} bold />
                    <Row l="Đã thu" v={o.paid_amount} />
                  </div>
                </Card>
              </div>

              <Card title="Sản phẩm" flat>
                <div className="table-wrap"><table>
                  <thead><tr><th>Sản phẩm</th><th className="num">SL</th><th className="num">Đơn giá</th><th className="num">Giá vốn</th><th className="num">Thành tiền</th></tr></thead>
                  <tbody>{o.lines.map((l) => (
                    <tr key={l.id}><td>{l.name}<div className="small muted">{l.sku}{l.returned_qty > 0 && ` · đã trả ${l.returned_qty}`}</div></td><td className="num">{num(l.qty)}</td><td className="num">{vnd(l.unit_price)}</td><td className="num muted">{vnd(l.unit_cost)}</td><td className="num">{vnd(l.line_total)}</td></tr>
                  ))}</tbody>
                </table></div>
              </Card>

              <div className="grid cols-2">
                <Card title="Thanh toán">
                  {o.payments.length === 0 ? <span className="muted small">Chưa có khoản thu nào.</span> : o.payments.filter((p) => !p.voided_at).map((p) => (
                    <div key={p.id} className="row between small"><span>{fmtDate(p.paid_at)} · {METHODS[p.method] || p.method}{p.direction === 'out' && ' (hoàn)'}</span><b>{p.direction === 'out' ? '−' : ''}{vnd(p.amount)}</b></div>
                  ))}
                </Card>
                <Card title="Lịch sử">
                  {o.history.map((h) => <div key={h.id} className="small"><span className="muted">{fmtDate(h.created_at)}</span> · {h.from_status ? `${STATUS[h.from_status]} → ` : ''}{STATUS[h.to_status]}{h.note && ` (${h.note})`}</div>)}
                  {o.returns.map((r) => <div key={r.id} className="small h-yellow">{r.code}: trả hàng {vnd(r.goods_amount)}{r.reason && ` — ${r.reason}`}</div>)}
                </Card>
              </div>

              {modal === 'cancel' && (
                <Modal title="Huỷ đơn" onClose={() => setModal(null)} footer={<button className="btn danger" disabled={act.busy} onClick={() => doStatus('cancelled', form.note)}>Xác nhận huỷ</button>}>
                  <p className="muted small">Hàng đã trừ kho sẽ được cộng lại.</p>
                  <Field label="Lý do"><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'pay' && (
                <Modal title="Thu tiền" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/payments`, { amount: Number(form.amount), method: form.method }); setModal(null); state.reload(); })}>Ghi nhận</button>}>
                  <Field label="Số tiền"><input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                  <Field label="Phương thức"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'return' && (
                <Modal title="Trả hàng" onClose={() => setModal(null)} footer={
                  <button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => {
                    const lines = Object.entries(form.lines).filter(([, v]) => v.qty > 0).map(([order_line_id, v]) => ({ order_line_id, qty: v.qty, restock: v.restock !== false }));
                    if (!lines.length) throw new Error('Chọn ít nhất 1 sản phẩm trả');
                    await api.post(`/orders/${o.id}/returns`, { lines, reason: form.reason || null, refund: Number(form.refund) > 0 ? { amount: Number(form.refund), method: form.method } : null });
                    setModal(null); state.reload();
                  })}>Ghi nhận trả hàng</button>}>
                  {o.lines.map((l) => {
                    const left = l.qty - l.returned_qty;
                    const cur = form.lines?.[l.id] || { qty: 0, restock: true };
                    return left > 0 && (
                      <div key={l.id} className="stack" style={{ gap: 4 }}>
                        <div className="row between"><span>{l.name}</span><span className="muted small">còn {left}</span></div>
                        <div className="row">
                          <input type="number" min="0" max={left} value={cur.qty} onChange={(e) => setForm({ ...form, lines: { ...form.lines, [l.id]: { ...cur, qty: Math.min(left, Math.max(0, Number(e.target.value) || 0)) } } })} style={{ width: 90 }} aria-label="Số lượng trả" />
                          <label className="check small"><input type="checkbox" checked={cur.restock} onChange={(e) => setForm({ ...form, lines: { ...form.lines, [l.id]: { ...cur, restock: e.target.checked } } })} />Nhập lại kho (bỏ chọn nếu hàng hỏng)</label>
                        </div>
                      </div>
                    );
                  })}
                  <Field label="Lý do"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
                  <Field label="Tiền hoàn cho khách (0 nếu chưa hoàn)"><input type="number" min="0" value={form.refund} onChange={(e) => setForm({ ...form, refund: e.target.value })} /></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
            </>
          );
        }}
      </Async>
    </div>
  );
}

const Row = ({ l, v, bold }) => <div className="row between" style={bold ? { fontWeight: 700 } : undefined}><span>{l}</span><span className="num">{vnd(v)}</span></div>;
