import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, Modal, useAction } from '../components/ui.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import { vnd } from '../lib.js';
import { computeReturn } from '../lib/returnForm.js';
import { lineAmount } from '../lib/money.js';

/** Đổi hàng trong một giao dịch; phần hàng trả được nhập lại kho theo lựa chọn, chênh lệch được thu/cấn tự động. */
export default function ExchangeModal({ order, methodList, onClose, onDone }) {
  const [returned, setReturned] = useState({});
  const [lines, setLines] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [shipping, setShipping] = useState('0');
  const [reason, setReason] = useState('Đổi hàng');
  const [method, setMethod] = useState('cash');
  const action = useAction();
  useEffect(() => {
    let off = false;
    const timer = setTimeout(() => api.get('/variants', { shop_id: order.shop_id, q: query || undefined, limit: 12 }).then((r) => !off && setResults(r.data)).catch(() => !off && setResults([])), 180);
    return () => { off = true; clearTimeout(timer); };
  }, [order.shop_id, query]);

  const returnForm = { lines: returned, refund: null, shipOn: false, shipRefund: '', fee: '', shipCost: '' };
  const returnTotal = computeReturn(order, returnForm);
  const creditIssued = returnTotal.refund;
  const newTotal = useMemo(() => lines.reduce((sum, l) => sum + lineAmount(l.qty, l.unit_price) - l.discount_amount, 0) + (Number(shipping) || 0), [lines, shipping]);
  const creditUsed = Math.min(creditIssued, newTotal);
  const cashDue = newTotal - creditUsed;
  const chosenReturns = Object.entries(returned).filter(([, r]) => r.qty > 0);
  const add = (v) => {
    setLines((prev) => {
      const found = prev.find((l) => l.variant_id === v.id);
      return found ? prev.map((l) => l.variant_id === v.id ? { ...l, qty: l.qty + 1 } : l) : [...prev, { variant_id: v.id, qty: 1, unit_price: v.price || 0, discount_amount: 0, sku: v.sku, name: [v.product_name, v.variant_name].filter(Boolean).join(' — ') }];
    });
    setQuery(''); setResults([]);
  };
  const submit = () => action.run(async () => {
    const result = await api.post(`/orders/${order.id}/exchange`, {
      return_lines: chosenReturns.map(([order_line_id, r]) => ({ order_line_id, qty: r.qty, restock: r.restock !== false })),
      new_lines: lines.map(({ variant_id, qty, unit_price, discount_amount }) => ({ variant_id, qty, unit_price, discount_amount })),
      reason, shipping_fee: Math.max(0, Number(shipping) || 0), payment_method: method,
    });
    onDone(result.data);
  });

  return <Modal title={`Đổi hàng · ${order.code}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn primary" disabled={action.busy || !chosenReturns.length || !lines.length} onClick={submit}>Ghi nhận đổi hàng</button></>}>
    <div className="stack">
      <b>Hàng khách trả</b>
      {order.lines.filter((l) => l.qty > l.returned_qty).map((l) => {
        const left = l.qty - l.returned_qty; const r = returned[l.id] || { qty: 0, restock: true };
        return <div className="row between wrap" key={l.id}><span>{l.name} <span className="muted small">· còn {left}</span></span><div className="row"><input aria-label={`Số lượng trả ${l.sku}`} type="number" min="0" max={left} value={r.qty} onChange={(e) => setReturned({ ...returned, [l.id]: { ...r, qty: Math.min(left, Math.max(0, Number(e.target.value) || 0)) } })} style={{ width: 78 }} /><label className="check small"><input type="checkbox" checked={r.restock} onChange={(e) => setReturned({ ...returned, [l.id]: { ...r, restock: e.target.checked } })} />Nhập kho</label></div></div>;
      })}
      <div className="row between"><span>Giá trị trả có thể cấn</span><b className="num">{vnd(creditIssued)}</b></div>
      <Field label="Lý do"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <hr />
      <b>Hàng khách đổi</b>
      <Field label="Tìm sản phẩm"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên hoặc SKU" /></Field>
      {results.length > 0 && <div className="stack">{results.map((v) => <button type="button" className="btn" key={v.id} onClick={() => add(v)}>{v.product_name}{v.variant_name ? ` — ${v.variant_name}` : ''} · {v.sku} · {vnd(v.price || 0)}</button>)}</div>}
      {lines.map((l) => <div className="row between wrap" key={l.variant_id}><span>{l.name}<div className="small muted">{l.sku}</div></span><div className="row"><input aria-label={`Số lượng đổi ${l.sku}`} type="number" min="1" value={l.qty} onChange={(e) => setLines(lines.map((x) => x.variant_id === l.variant_id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} style={{ width: 70 }} /><MoneyInput aria-label={`Đơn giá ${l.sku}`} value={l.unit_price} onChange={(e) => setLines(lines.map((x) => x.variant_id === l.variant_id ? { ...x, unit_price: Math.max(0, Number(e.target.value) || 0) } : x))} /></div></div>)}
      <Field label="Phí ship khách trả"><MoneyInput value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
      <div className="row between"><span>Tiền hàng đổi</span><b className="num">{vnd(newTotal)}</b></div>
      <div className="row between"><span>Cấn tiền khách gửi</span><span className="num">{vnd(creditUsed)}</span></div>
      {cashDue > 0 && <><div className="row between"><span>Khách cần trả thêm</span><b className="num">{vnd(cashDue)}</b></div><Field label="Thu thêm bằng"><select value={method} onChange={(e) => setMethod(e.target.value)}>{methodList(method).filter(([k]) => k !== 'customer_credit').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></>}
      {creditIssued > creditUsed && <p className="small muted">Phần còn lại {vnd(creditIssued - creditUsed)} được giữ thành tiền khách gửi tại shop này.</p>}
      <ErrorBox error={action.error} />
    </div>
  </Modal>;
}
