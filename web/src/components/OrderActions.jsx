import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Async, ErrorBox, Field, Modal, Section, useAction, useAsync } from './ui.jsx';
import MoneyFill from './MoneyFill.jsx';
import { vnd, fmtDate } from '../lib.js';

const SHIP_STATUS = { in_transit: 'Đang giao', delivered: 'Đã giao', returned: 'Hoàn hàng', lost: 'Thất lạc' };

/** Giao cho hãng vận chuyển: chọn hãng, mã vận đơn, tiền COD hãng thu hộ */
export function ShipModal({ order: o, onClose, onDone }) {
  const carriers = useAsync(() => api.get('/carriers'), []);
  const { busy, error, run } = useAction();
  const [carrierId, setCarrierId] = useState('');
  const [code, setCode] = useState('');
  const [cod, setCod] = useState(String(o.amount_due));
  return (
    <Modal title="Giao cho hãng vận chuyển" onClose={onClose} footer={<button className="btn primary" disabled={busy || !carrierId || !code.trim()} onClick={() => run(async () => { await api.post(`/orders/${o.id}/ship`, { carrier_id: carrierId, tracking_code: code, cod_amount: Number(cod) || 0 }); onDone(); })}>Giao hàng</button>}>
      <Async state={carriers}>
        {({ data }) => (
          <div className="stack">
            {data.length ? (
              <Field label="Hãng vận chuyển"><select value={carrierId} onChange={(e) => setCarrierId(e.target.value)} aria-label="Hãng vận chuyển"><option value="">Chọn hãng…</option>{data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            ) : <p className="muted small">Chưa có hãng nào. Thêm hãng ở <Link to="/settings?tab=shipping">Cài đặt → Vận chuyển</Link>.</p>}
          </div>
        )}
      </Async>
      <Field label="Mã vận đơn"><input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Mã vận đơn" /></Field>
      <Field label={`Tiền hãng thu hộ (COD). Khách còn nợ ${vnd(o.amount_due)}; đặt 0 nếu khách đã trả đủ`}><MoneyFill fill={o.amount_due} label="Thu hộ đủ" value={cod} onChange={(e) => setCod(e.target.value)} /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Tách đơn: chọn số lượng từng dòng chuyển sang đơn nháp mới */
export function SplitModal({ order: o, onClose, onDone }) {
  const { busy, error, run } = useAction();
  const [qty, setQty] = useState({});
  const chosen = Object.entries(qty).filter(([, q]) => q > 0);
  return (
    <Modal title="Tách đơn (giao từng phần)" onClose={onClose} footer={<button className="btn primary" disabled={busy || !chosen.length} onClick={() => run(async () => { const r = await api.post(`/orders/${o.id}/split`, { lines: chosen.map(([id, q]) => ({ order_line_id: id, qty: q })) }); onDone(r.data.child.id); })}>Tách sang đơn mới</button>}>
      <p className="muted small">Số lượng bạn chọn chuyển sang một đơn nháp mới (cùng khách, kênh). Phần còn lại ở đơn này. Phí ship và tiền đã thu ở lại đơn này.</p>
      {o.lines.map((l) => (
        <div key={l.id} className="row between">
          <span>{l.name}<span className="small muted"> · có {l.qty}</span></span>
          <input type="number" min="0" max={l.qty} value={qty[l.id] ?? 0} style={{ width: 90 }} aria-label={`Số lượng tách ${l.sku}`} onChange={(e) => setQty({ ...qty, [l.id]: Math.min(l.qty, Math.max(0, Number(e.target.value) || 0)) })} />
        </div>
      ))}
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Giữ hàng cho đơn nháp tới một ngày (hoặc không hạn) */
export function ReserveModal({ order: o, onClose, onDone }) {
  const { busy, error, run } = useAction();
  const [until, setUntil] = useState(o.reserved_until || '');
  return (
    <Modal title="Giữ hàng cho đơn này" onClose={onClose} footer={<><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post(`/orders/${o.id}/reserve`, { reserve: true, until: until || null }); onDone(); })}>Giữ hàng</button>{o.reserve_stock ? <button className="btn" disabled={busy} onClick={() => run(async () => { await api.post(`/orders/${o.id}/reserve`, { reserve: false }); onDone(); })}>Bỏ giữ</button> : null}</>}>
      <p className="muted small">Hàng được giữ thì đơn khác không bán phần này. Hết hạn thì tự nhả.</p>
      <Field label="Giữ đến ngày (để trống = không hạn)"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Giữ hàng đến ngày" /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Vận đơn của đơn: link tra cứu, COD, đánh dấu giao xong / hoàn */
export function ShipmentsSection({ order: o, reload }) {
  const { busy, error, run } = useAction();
  if (!o.shipments?.length) return null;
  const mark = (id, status) => run(async () => { await api.post(`/shipments/${id}/status`, { status }); reload(); });
  return (
    <Section title="Vận chuyển">
      {o.shipments.map((s) => (
        <div key={s.id} className="row between small wrap">
          <span>{s.carrier_name} · {s.tracking_link ? <a href={s.tracking_link} target="_blank" rel="noreferrer">{s.tracking_code}</a> : s.tracking_code} · COD {vnd(s.cod_amount)} · {SHIP_STATUS[s.status]}{s.statement_id ? ' · đã đối soát' : ''} · {fmtDate(s.shipped_at)}</span>
          {s.status === 'in_transit' && <span className="row"><button className="btn sm" disabled={busy} onClick={() => mark(s.id, 'delivered')}>Đã giao</button><button className="btn sm" disabled={busy} onClick={() => mark(s.id, 'returned')}>Hãng hoàn hàng</button></span>}
        </div>
      ))}
      <ErrorBox error={error} />
    </Section>
  );
}
