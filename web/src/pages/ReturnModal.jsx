import { api } from '../api.js';
import { ErrorBox, Field, Modal } from '../components/ui.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import { vnd } from '../lib.js';
import { codRefusedForm, computeReturn, returnSummary } from '../lib/returnForm.js';

export const emptyReturnForm = (marketplace = false) => ({ lines: {}, reason: '', shipOn: false, shipRefund: '', fee: '', shipCost: '', refund: null, method: 'cash', toCredit: false, awaitingGoods: marketplace });

/** Form trả hàng: dòng hàng → khối tiền → cần trả khách → tiền trả ngay → giải thích kết quả */
export default function ReturnModal({ order: o, form, setForm, act, methodList, onClose, onDone }) {
  const r = computeReturn(o, form);
  const mp = !!o.is_marketplace;
  const set = (patch) => setForm({ ...form, ...patch });
  const submit = () => act.run(async () => {
    const lines = r.lines.filter((l) => l.qty > 0).map((l) => ({ order_line_id: l.id, qty: l.qty, restock: form.lines[l.id]?.restock !== false }));
    if (!lines.length) throw new Error('Chọn ít nhất 1 sản phẩm trả');
    await api.post(`/orders/${o.id}/returns`, {
      lines,
      reason: form.reason || null,
      shipping_refund_amount: r.shipRefund,
      return_fee_amount: r.fee,
      return_shipping_cost: r.shipCost,
      awaiting_goods: mp && !!form.awaitingGoods,
      refund: r.refund > 0 ? { amount: r.refund, method: form.toCredit ? 'customer_credit' : form.method, to_credit: !!form.toCredit } : null,
    });
    onDone();
  });
  return (
    <Modal title="Trả hàng" onClose={onClose} footer={<button className="btn primary" disabled={act.busy} onClick={submit}>Ghi nhận trả hàng</button>}>
      {!mp && o.status !== 'draft' && (
        <button type="button" className="btn small" onClick={() => setForm(codRefusedForm(o, form))}>Khách không nhận hàng (COD)</button>
      )}
      {o.lines.map((l) => {
        const left = l.qty - l.returned_qty;
        const cur = form.lines?.[l.id] || { qty: 0, restock: true };
        const val = r.lines.find((x) => x.id === l.id)?.value || 0;
        return left > 0 && (
          <div key={l.id} className="stack" style={{ gap: 4 }}>
            <div className="row between"><span>{l.name}</span><span className="muted small">còn {left}</span></div>
            <div className="row wrap">
              <input type="number" min="0" max={left} value={cur.qty} onChange={(e) => set({ lines: { ...form.lines, [l.id]: { ...cur, qty: Math.min(left, Math.max(0, Number(e.target.value) || 0)) } } })} style={{ width: 90 }} aria-label="Số lượng trả" />
              <label className="check small"><input type="checkbox" checked={cur.restock} onChange={(e) => set({ lines: { ...form.lines, [l.id]: { ...cur, restock: e.target.checked } } })} />Nhập lại kho (bỏ chọn nếu hàng hỏng)</label>
              {cur.qty > 0 && <span className="small num">Giá trị trả: {vnd(val)}</span>}
            </div>
          </div>
        );
      })}
      <Field label="Lý do"><input value={form.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
      <div className="row between"><span>Tổng tiền hàng trả</span><b className="num">{vnd(r.goods)}</b></div>
      {!mp && o.shipping_fee > 0 && r.shipLeft > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <label className="check small"><input type="checkbox" checked={!!form.shipOn} onChange={(e) => set({ shipOn: e.target.checked, shipRefund: e.target.checked && !form.shipRefund ? String(r.shipLeft) : form.shipRefund })} />Hoàn cả phí ship cho khách (còn {vnd(r.shipLeft)})</label>
          {form.shipOn && <Field label="Phí ship hoàn khách"><MoneyInput value={form.shipRefund} onChange={(e) => set({ shipRefund: e.target.value })} /></Field>}
        </div>
      )}
      {!mp && <Field label="Phí trả hàng shop giữ lại (0 nếu không thu)"><MoneyInput value={form.fee} onChange={(e) => set({ fee: e.target.value })} /></Field>}
      <Field label="Phí ship chiều về shop chịu (0 nếu không có)"><MoneyInput value={form.shipCost} onChange={(e) => set({ shipCost: e.target.value })} /></Field>
      {mp ? (
        <>
          <label className="check small"><input type="checkbox" checked={!!form.awaitingGoods} onChange={(e) => set({ awaitingGoods: e.target.checked })} />Hàng chưa về kho (chờ nhận hàng trước khi cộng tồn)</label>
          <p className="muted small">Đơn sàn: sàn tự hoàn tiền cho người mua rồi trừ vào tiền trả shop, nên không có phần trả khách, hoàn ship hay phí trả hàng. Nếu hàng chưa về, tồn kho và giá vốn chỉ cập nhật khi bấm “Đã nhận hàng”.</p>
        </>
      ) : (
        <>
          <div className="row between" style={{ fontWeight: 700 }}><span>Cần trả khách</span><span className="num">{vnd(r.due)}</span></div>
          <Field label={`${form.toCredit ? 'Chuyển thành tiền khách gửi' : 'Tiền trả khách ngay'} (tối đa ${vnd(r.maxRefund)}; 0 nếu chưa thu)`}><MoneyInput value={form.refund == null ? String(r.refund) : form.refund} onChange={(e) => set({ refund: e.target.value })} /></Field>
          {r.refund > 0 && o.customer_id && <label className="check small"><input type="checkbox" checked={!!form.toCredit} onChange={(e) => set({ toCredit: e.target.checked })} />Chuyển khoản này thành tiền khách gửi dùng cho đơn sau trong shop này</label>}
          {r.refund > 0 && !form.toCredit && <Field label="Phương thức"><select value={form.method} onChange={(e) => set({ method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        </>
      )}
      {r.goods > 0 && <p className="small" role="status">{returnSummary(r, vnd, mp)}</p>}
      <ErrorBox error={act.error} />
    </Modal>
  );
}
