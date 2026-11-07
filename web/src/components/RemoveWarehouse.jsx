import { useState } from 'react';
import { api } from '../api.js';
import { Async, ErrorBox, Field, Modal, useAction, useAsync } from './ui.jsx';
import { vnd, num } from '../lib.js';

/**
 * Gỡ một kho: cảnh báo hậu quả, chuyển hàng còn lại sang kho khác, gõ tên kho để xác nhận.
 * Kho chưa từng dùng thì xoá hẳn; kho đã có lịch sử thì đóng (ẩn) để sổ kho, đơn và phiếu nhập cũ vẫn đọc được.
 */
export default function RemoveWarehouse({ warehouse, warehouses, onClose, onDone }) {
  const impact = useAsync(() => api.get(`/warehouses/${warehouse.id}/impact`), [warehouse.id]);
  const [dest, setDest] = useState('');
  const [typed, setTyped] = useState('');
  const { busy, error, run } = useAction();
  const others = warehouses.filter((w) => w.id !== warehouse.id && !w.archived_at);

  return (
    <Modal title={`Gỡ kho “${warehouse.name}”`} onClose={onClose}>
      <Async state={impact}>{({ data: d }) => {
        const blocked = d.blockers.length > 0;
        const needDest = d.needs_transfer;
        const ready = !blocked && typed.trim() === warehouse.name && (!needDest || !!dest);
        return (
          <div className="stack">
            <div className="alert err small" role="alert">
              <b>Việc này không hoàn tác được.</b> Kho bị gỡ khỏi mọi shop và không còn xuất hiện khi nhập, bán, chuyển kho.
            </div>

            <div className="stack" style={{ gap: 8 }}>
              <div className="eyebrow">Ảnh hưởng</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>{d.stock.lines > 0 ? <>Kho còn <b>{num(d.stock.lines)} mặt hàng</b>, tổng {num(d.stock.qty)} sản phẩm, trị giá {vnd(d.stock.value)}. Phải chuyển sang kho khác trước.</> : 'Kho không còn hàng.'}</li>
                <li>{d.shops.length ? <>Đang nằm trong danh sách kho của shop: <b>{d.shops.map((s) => s.name).join(', ')}</b>. Sẽ được gỡ khỏi các shop này.</> : 'Không shop nào đang dùng kho này.'}</li>
                {d.draft_orders_with_plan.length > 0 && <li>{d.draft_orders_with_plan.length} đơn nháp đang chia hàng từ kho này ({d.draft_orders_with_plan.slice(0, 3).join(', ')}{d.draft_orders_with_plan.length > 3 ? '…' : ''}). Kế hoạch chia kho của các đơn đó bị xoá, đơn tự chia lại khi xác nhận.</li>}
                <li>{d.mode === 'delete'
                  ? 'Kho chưa từng có biến động, phiếu nhập hay đơn nào nên sẽ được xoá hẳn.'
                  : <>Kho đã có lịch sử ({num(d.history.movements)} biến động kho, {num(d.history.purchases)} phiếu nhập, {num(d.history.orders)} đơn/phân bổ). Lịch sử được giữ nguyên: kho chỉ bị <b>đóng</b> (ẩn), không xoá.</>}</li>
              </ul>
            </div>

            {d.blockers.map((b) => <div key={b.code} className="alert warn small" role="alert">{b.message}</div>)}

            {needDest && !blocked && (
              <Field label="Chuyển toàn bộ hàng sang kho" hint="Tạo một phiếu chuyển kho, giữ nguyên giá vốn từng mặt hàng.">
                <select value={dest} onChange={(e) => setDest(e.target.value)}>
                  <option value="">— Chọn kho nhận —</option>
                  {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            )}

            {!blocked && (
              <Field label={`Gõ đúng tên kho “${warehouse.name}” để xác nhận`}>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={warehouse.name} autoComplete="off" />
              </Field>
            )}
            <ErrorBox error={error} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={onClose}>Không gỡ</button>
              <button
                type="button" className="btn danger" disabled={!ready || busy}
                onClick={() => run(async () => { const r = await api.post(`/warehouses/${warehouse.id}/remove`, { confirm: true, transfer_to: needDest ? dest : undefined }); onDone(r.data); })}
              >{d.mode === 'delete' ? 'Xoá kho' : 'Gỡ và đóng kho'}</button>
            </div>
          </div>
        );
      }}</Async>
    </Modal>
  );
}
