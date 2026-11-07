import { useState } from 'react';
import { api } from '../api.js';
import { Async, ErrorBox, Field, Modal, useAction, useAsync } from './ui.jsx';
import { vnd, num } from '../lib.js';

/**
 * Gỡ một sản phẩm: cảnh báo hậu quả, xác nhận xuất huỷ phần hàng còn lại, gõ tên để xác nhận.
 * Sản phẩm chưa từng dùng thì xoá hẳn; đã có lịch sử thì "ngừng kinh doanh" (ẩn, khôi phục được) để đơn, sổ kho, báo cáo cũ vẫn đúng.
 */
export default function RemoveProduct({ product, onClose, onDone }) {
  const impact = useAsync(() => api.get(`/products/${product.id}/removal-impact`), [product.id]);
  const [writeOff, setWriteOff] = useState(false);
  const [typed, setTyped] = useState('');
  const { busy, error, run } = useAction();

  return (
    <Modal title={`Xoá sản phẩm “${product.name}”`} onClose={onClose}>
      <Async state={impact}>{({ data: d }) => {
        const blocked = d.blockers.length > 0;
        const ready = !blocked && typed.trim() === product.name && (!d.needs_write_off || writeOff);
        const h = d.history;
        return (
          <div className="stack">
            <div className="alert err small" role="alert">
              <b>Sản phẩm sẽ không còn xuất hiện khi bán, nhập hàng, kiểm kê.</b> {d.mode === 'delete' ? 'Việc xoá hẳn không hoàn tác được.' : 'Bạn khôi phục lại được ở Sản phẩm → Đã ngừng kinh doanh.'}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="eyebrow">Ảnh hưởng</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>{d.mode === 'delete'
                  ? 'Chưa từng có đơn, phiếu nhập, kiểm kê hay biến động kho nào, nên sẽ được xoá hẳn và SKU được giải phóng.'
                  : <>Đã có lịch sử ({num(h.orders)} đơn, {num(h.purchases)} phiếu nhập, {num(h.movements)} biến động kho). Lịch sử và báo cáo cũ được giữ nguyên: sản phẩm chỉ bị <b>ngừng kinh doanh</b> (ẩn), không xoá. SKU vẫn được giữ chỗ.</>}</li>
                <li>{d.stock.lines > 0 ? <>Còn <b>{num(d.stock.qty)} sản phẩm</b> trong kho ({d.stock.by_warehouse.join(', ')}), trị giá {vnd(d.stock.value)}. Số hàng này phải xuất huỷ.</> : 'Không còn hàng trong kho.'}</li>
                {d.selling_in_shops.length > 0 && <li>Đang niêm yết ở shop: <b>{d.selling_in_shops.join(', ')}</b>. Sẽ tắt niêm yết.</li>}
                {d.own_packaging_specs > 0 && <li>Định mức đóng gói của sản phẩm ({d.own_packaging_specs} dòng) sẽ bị xoá.</li>}
              </ul>
            </div>
            {d.blockers.map((b) => <div key={b.code} className="alert warn small" role="alert">{b.message}</div>)}
            {!blocked && d.needs_write_off && (
              <label className="check small">
                <input type="checkbox" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />
                Xuất huỷ {num(d.stock.qty)} sản phẩm còn trong kho: app lập phiếu hàng hỏng, giá vốn {vnd(d.stock.value)} tính vào chi phí hàng hỏng
              </label>
            )}
            {!blocked && (
              <Field label={`Gõ đúng tên sản phẩm “${product.name}” để xác nhận`}>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={product.name} autoComplete="off" />
              </Field>
            )}
            <ErrorBox error={error} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={onClose}>Không xoá</button>
              <button type="button" className="btn danger" disabled={!ready || busy}
                onClick={() => run(async () => { const r = await api.post(`/products/${product.id}/remove`, { confirm: true, write_off: writeOff }); onDone(r.data); })}>
                {d.mode === 'delete' ? 'Xoá sản phẩm' : 'Ngừng kinh doanh'}
              </button>
            </div>
          </div>
        );
      }}</Async>
    </Modal>
  );
}

/** Nút "Xoá sản phẩm…" đặt ở chân form sửa; mở hộp xác nhận */
export function RemoveProductButton({ product, onRemoved }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setOpen(true)}>Xoá sản phẩm…</button>
      {open && <RemoveProduct product={product} onClose={() => setOpen(false)} onDone={(r) => { setOpen(false); onRemoved(r); }} />}
    </>
  );
}
