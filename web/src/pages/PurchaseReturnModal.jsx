import { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, Modal, useAction } from '../components/ui.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import MoneyFill from '../components/MoneyFill.jsx';
import { vnd, num, METHODS } from '../lib.js';

/** Phần NCC hoàn lại cho một dòng trả: tỷ lệ số lượng trên giá trị mua còn lại của dòng (xem trước, máy chủ tính lại) */
export const previewCredit = (l, q) => (!(q > 0) || !(l.returnable_qty > 0) ? 0 : q >= l.returnable_qty ? l.remaining_value : Math.round((l.remaining_value * q) / l.returnable_qty));

/** Số NCC sẽ nợ shop sau khi trừ `credit` vào phiếu: dùng để gợi ý hoàn tiền ngay */
export const owesAfter = (p, credit) => Math.max(0, p.paid_amount - (p.total_amount - p.returned_amount - p.allowance_amount - credit));

function RefundFields({ owes, now, setNow, method, setMethod, amount, setAmount }) {
  if (owes <= 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small">Phiếu đã trả nhiều hơn số còn phải trả: NCC còn nợ shop <b>{vnd(owes)}</b>.</p>
      <label className="check small"><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} />NCC hoàn tiền ngay (không tick thì để treo ở Công nợ phải trả, thu sau)</label>
      {now && (
        <div className="row wrap">
          <MoneyFill fill={owes} label="Hết" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Số tiền NCC hoàn" />
          <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Phương thức NCC hoàn">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
      )}
    </div>
  );
}

/** Trả hàng cho nhà cung cấp theo dòng của phiếu nhập đã nhận */
export function PurchaseReturnModal({ purchase: p, onClose, onDone }) {
  const act = useAction();
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(false);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const picked = p.lines.map((l) => ({ l, q: Number(qtys[l.id]) || 0 })).filter((x) => x.q > 0);
  const credit = picked.reduce((a, x) => a + previewCredit(x.l, x.q), 0);
  const owes = owesAfter(p, credit);
  const owesNew = Math.max(0, owes - p.supplier_owes);
  const submit = () => act.run(async () => {
    if (!picked.length) throw new Error('Nhập số lượng trả ở ít nhất một dòng');
    await api.post(`/purchases/${p.id}/returns`, {
      lines: picked.map((x) => ({ purchase_line_id: x.l.id, qty: x.q })),
      reason: reason || null,
      refund: now ? { now: true, method, amount: Number(amount || owesNew) } : undefined,
    });
    onDone();
  });
  return (
    <Modal title="Trả hàng cho nhà cung cấp" onClose={onClose} footer={<button className="btn primary" disabled={act.busy} onClick={submit}>Lập phiếu trả</button>}>
      <p className="muted small">Hàng xuất khỏi kho theo giá nhập. Nợ NCC giảm bằng giá mua của hàng trả (đã trừ chiết khấu); phí ship và phí khác không tự hoàn. Chỉ trả được số còn trong kho.</p>
      <div className="stack" style={{ gap: 8 }}>
        {p.lines.map((l) => (
          <div key={l.id} className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span>{l.product_name || l.sku}<span className="sub">{l.sku} · còn trả được {num(l.returnable_qty)}</span></span>
            <input className="num" style={{ width: 96 }} inputMode="decimal" value={qtys[l.id] ?? ''} placeholder="0" disabled={!(l.returnable_qty > 0)} onChange={(e) => setQtys({ ...qtys, [l.id]: e.target.value })} aria-label={`Số lượng trả ${l.sku}`} />
          </div>
        ))}
      </div>
      <Field label="Lý do (tuỳ chọn)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hàng lỗi, giao sai, cân thiếu…" /></Field>
      {credit > 0 && <p className="small" role="status">NCC trả lại <b>{vnd(credit)}</b>. {owes > 0 ? '' : `Nợ NCC còn ${vnd(Math.max(0, p.total_amount - p.returned_amount - p.allowance_amount - credit - p.paid_amount))}.`}</p>}
      <RefundFields owes={owes} now={now} setNow={setNow} method={method} setMethod={setMethod} amount={amount || String(owesNew)} setAmount={setAmount} />
      <ErrorBox error={act.error} />
    </Modal>
  );
}

/** NCC bớt tiền sau khi đã nhận (hàng xấu, cân thiếu mà không trả hàng) */
export function PurchaseAllowanceModal({ purchase: p, onClose, onDone }) {
  const act = useAction();
  const max = p.lines.reduce((a, l) => a + Math.max(0, l.remaining_value), 0);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(false);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const a = Number(value) || 0;
  const owes = owesAfter(p, a);
  const owesNew = Math.max(0, owes - p.supplier_owes);
  const submit = () => act.run(async () => {
    if (!(a > 0)) throw new Error('Nhập số tiền NCC bớt');
    await api.post(`/purchases/${p.id}/allowances`, { amount: a, reason: reason || null, refund: now ? { now: true, method, amount: Number(amount || owesNew) } : undefined });
    onDone();
  });
  return (
    <Modal title="NCC giảm giá sau khi nhận" onClose={onClose} footer={<button className="btn primary" disabled={act.busy} onClick={submit}>Ghi nhận giảm giá</button>}>
      <p className="muted small">Dùng khi NCC bớt tiền mà không lấy lại hàng. Nợ NCC giảm; phần ứng với hàng còn tồn làm giảm giá vốn tồn kho, phần ứng với hàng đã bán ghi thu nhập khác (giá vốn đã chụp trên đơn không đổi). Nhập 100 kg nhưng cân lại 97 kg thì dùng Trả hàng NCC 3 kg thay vì giảm giá.</p>
      <Field label={`Số tiền NCC bớt (tối đa ${vnd(max)})`}><MoneyFill fill={max} label="Tối đa" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field>
      <Field label="Lý do"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hàng xấu, cân thiếu…" /></Field>
      <RefundFields owes={owes} now={now} setNow={setNow} method={method} setMethod={setMethod} amount={amount || String(owesNew)} setAmount={setAmount} />
      <ErrorBox error={act.error} />
    </Modal>
  );
}
