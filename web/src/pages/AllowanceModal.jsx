import { api } from '../api.js';
import { ErrorBox, Field, Modal } from '../components/ui.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import MoneyFill from '../components/MoneyFill.jsx';
import { vnd } from '../lib.js';
import { allowanceSummary, computeAllowance } from '../lib/allowanceForm.js';
import { RETURN_REASONS } from '../lib/returnReasons.js';

export const emptyAllowanceForm = () => ({ amount: '', reasonCode: 'defective', reason: '', refund: null, method: 'cash', toCredit: false });

/** Giảm giá sau bán / bồi thường: khách giữ hàng, shop giảm một khoản tiền hàng. Không có dòng hàng, không đụng kho. */
export default function AllowanceModal({ order: o, form, setForm, act, methodList, onClose, onDone }) {
  const r = computeAllowance(o, form);
  const set = (patch) => setForm({ ...form, ...patch });
  const submit = () => act.run(async () => {
    if (!r.amount) throw new Error('Nhập số tiền giảm');
    await api.post(`/orders/${o.id}/allowances`, {
      amount: r.amount,
      reason_code: form.reasonCode || null,
      reason: form.reason || null,
      refund: r.refund > 0 ? { amount: r.refund, method: form.toCredit ? 'customer_credit' : form.method, to_credit: !!form.toCredit } : null,
    });
    onDone();
  });
  return (
    <Modal title="Giảm giá sau bán / bồi thường" onClose={onClose} footer={<button className="btn primary" disabled={act.busy} onClick={submit}>Ghi nhận giảm giá</button>}>
      <p className="muted small">Khách giữ hàng, shop giảm một khoản tiền hàng (hàng lỗi một phần, giao thiếu, đền bù…). Không nhập kho, không đổi giá vốn.</p>
      <Field label={`Số tiền giảm (tối đa ${vnd(r.max)})`}><MoneyFill fill={r.max} label="Tối đa" value={form.amount} onChange={(e) => set({ amount: e.target.value })} autoFocus /></Field>
      <Field label="Lý do"><select value={form.reasonCode || ''} onChange={(e) => set({ reasonCode: e.target.value })} aria-label="Lý do giảm giá"><option value="">Chọn lý do…</option>{RETURN_REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Ghi chú thêm (tuỳ chọn)"><input value={form.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
      {!r.marketplace && r.maxRefund > 0 && (
        <>
          <Field label={`${form.toCredit ? 'Chuyển thành tiền khách gửi' : 'Tiền hoàn khách ngay'} (tối đa ${vnd(r.maxRefund)})`}><MoneyInput value={form.refund == null ? String(r.refund) : form.refund} onChange={(e) => set({ refund: e.target.value })} /></Field>
          {r.refund > 0 && o.customer_id && <label className="check small"><input type="checkbox" checked={!!form.toCredit} onChange={(e) => set({ toCredit: e.target.checked })} />Chuyển khoản này thành tiền khách gửi dùng cho đơn sau trong shop này</label>}
          {r.refund > 0 && !form.toCredit && <Field label="Phương thức"><select value={form.method} onChange={(e) => set({ method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        </>
      )}
      {r.amount > 0 && <p className="small" role="status">{allowanceSummary(r, vnd)}</p>}
      <ErrorBox error={act.error} />
    </Modal>
  );
}
