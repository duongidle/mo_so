import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, SearchBox, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { fmtDate, num } from '../lib.js';
import Icon from '../components/Icon.jsx';

const ST = { draft: ['Đang đếm', 'st-confirmed'], completed: ['Đã hoàn tất', 'st-completed'], cancelled: ['Đã huỷ', 'st-cancelled'] };

export default function StockCounts() {
  const { warehouses } = useSession();
  const state = useAsync(() => api.get('/stock-counts'), []);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  return (
    <>
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0, maxWidth: 560 }}>Kiểm kê nhiều bước: tạo phiếu, đếm và nhập số dần (lưu được giữa chừng), cuối cùng hoàn tất để hệ thống tự điều chỉnh tồn theo chênh lệch.</p>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Phiếu kiểm kê</button>
      </div>
      <Async state={state}>{({ data }) => !data.length ? <Empty>Chưa có phiếu kiểm kê nào.</Empty> : (
        <Card flat><div className="table-wrap"><table>
          <thead><tr><th>Phiếu</th><th>Kho</th><th>Trạng thái</th><th className="num">Đã đếm</th><th>Ngày</th></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.id} className="click" onClick={() => setOpenId(c.id)}>
              <td><b>{c.code}</b>{c.note && <div className="small muted">{c.note}</div>}</td><td>{c.warehouse_name}</td>
              <td><span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span></td>
              <td className="num">{c.counted_count}/{c.line_count}</td><td className="small">{fmtDate(c.created_at)}</td>
            </tr>))}</tbody>
        </table></div></Card>
      )}</Async>
      {creating && <CreateCount warehouses={warehouses} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); state.reload(); setOpenId(id); }} />}
      {openId && <CountSheet id={openId} onClose={() => { setOpenId(null); state.reload(); }} />}
    </>
  );
}

function CreateCount({ warehouses, onClose, onCreated }) {
  const [wh, setWh] = useState(warehouses[0]?.id);
  const [mode, setMode] = useState('in_stock');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title="Phiếu kiểm kê mới" onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => onCreated((await api.post('/stock-counts', { warehouse_id: wh, mode, note: note || null })).data.id))}>Tạo phiếu</button>}>
      <Field label="Kho"><select value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      <Field label="Hàng cần đếm">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="in_stock">Mọi sản phẩm đang có tồn trong kho</option>
          <option value="empty">Phiếu trống, tự thêm từng mã</option>
        </select>
      </Field>
      <Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: Kiểm kê cuối tháng 11" /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

function CountSheet({ id, onClose }) {
  const state = useAsync(() => api.get(`/stock-counts/${id}`), [id]);
  const { busy, error, run } = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [confirming, setConfirming] = useState(false);
  const [uncounted, setUncounted] = useState('skip');
  const found = useAsync(() => (dq && state.data ? api.get('/variants', { warehouse_id: state.data.data.warehouse_id, q: dq, all: '1', limit: 8 }) : Promise.resolve({ data: [] })), [dq, state.data?.data?.warehouse_id]);
  const patch = (body) => run(async () => { await api.patch(`/stock-counts/${id}`, body); state.reload(); });

  return (
    <Modal title="Kiểm kê" wide onClose={onClose}>
      <Async state={state}>{({ data: c }) => {
        const draft = c.status === 'draft';
        const varianceLines = c.lines.filter((l) => l.counted_qty !== null && l.variance !== 0);
        return (
          <>
            <div className="row between wrap">
              <div><b>{c.code}</b> <span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span>{c.note && <div className="small muted">{c.note}</div>}</div>
              <div className="small muted">Đã đếm {c.summary.counted}/{c.summary.total} · lệch {c.summary.with_variance}</div>
            </div>
            {draft && c.lines.some((l) => l.moved_since && l.counted_qty === null) && <div className="alert warn small">Có hàng đã bán/nhập từ lúc tạo phiếu (dòng đánh dấu ⚠). Nhập số bạn đếm được ngay lúc đếm: chênh lệch sẽ tính so với tồn hệ thống tại lúc nhập.</div>}
            {draft && (
              <div className="stack" style={{ gap: 8 }}>
                <SearchBox value={q} onChange={setQ} placeholder="Thêm mã vào phiếu (SKU, tên)…" />
                {found.data?.data?.filter((v) => v.kind !== 'bundle' && !c.lines.some((l) => l.variant_id === v.id)).map((v) => (
                  <div key={v.id} className="pick" onClick={async () => { await patch({ add_variant_ids: [v.id] }); setQ(''); }}>{v.product_name}{v.variant_name ? ` — ${v.variant_name}` : ''} <span className="small muted">{v.sku} · tồn {num(v.on_hand)}</span></div>
                ))}
              </div>
            )}
            {!c.lines.length ? <Empty>Phiếu chưa có dòng nào. Tìm mã ở trên để thêm.</Empty> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Sản phẩm</th><th className="num">Tồn hệ thống</th><th className="num">Số đếm</th><th className="num">Chênh lệch</th>{draft && <th>Giá vốn (hàng mới)</th>}<th /></tr></thead>
                <tbody>{c.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.product_name}{l.variant_name ? ` — ${l.variant_name}` : ''}<div className="small muted">{l.sku}{l.moved_since && <span className="h-yellow"> ⚠ tồn hiện tại {num(l.current_on_hand)}</span>}</div></td>
                    <td className="num">{num(l.system_qty)}</td>
                    <td className="num">{draft ? <input type="number" min="0" defaultValue={l.counted_qty ?? ''} key={`${l.id}-${l.counted_qty}`} style={{ width: 90, textAlign: 'right' }} aria-label={`Số đếm ${l.sku}`}
                      onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== l.counted_qty) patch({ lines: [{ variant_id: l.variant_id, counted_qty: v }] }); }} /> : (l.counted_qty ?? '—')}</td>
                    <td className={`num ${l.variance > 0 ? 'h-green' : l.variance < 0 ? 'h-red' : ''}`}><b>{l.variance === null ? '—' : (l.variance > 0 ? '+' : '') + l.variance}</b>{!draft && l.applied_change ? <div className="small muted">đã áp {l.applied_change > 0 ? '+' : ''}{l.applied_change}</div> : null}</td>
                    {draft && <td>{l.variance > 0 && l.system_qty <= 0 ? <input type="number" min="0" defaultValue={l.unit_cost ?? ''} style={{ width: 110 }} aria-label={`Giá vốn ${l.sku}`} onBlur={(e) => patch({ lines: [{ variant_id: l.variant_id, unit_cost: e.target.value === '' ? null : Number(e.target.value) }] })} /> : <span className="muted small">—</span>}</td>}
                    <td>{draft && <button className="btn sm" aria-label={`Bỏ ${l.sku}`} onClick={() => patch({ remove_variant_ids: [l.variant_id] })}>✕</button>}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            <ErrorBox error={error} />
            {draft && (
              <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                <button className="btn danger" disabled={busy} onClick={() => confirm('Huỷ phiếu kiểm kê này? Tồn kho không bị đổi.') && run(async () => { await api.post(`/stock-counts/${id}/cancel`); onClose(); })}>Huỷ phiếu</button>
                <button className="btn primary" disabled={busy || !c.lines.length} onClick={() => setConfirming(true)}>Hoàn tất kiểm kê</button>
              </div>
            )}
            {confirming && (
              <Modal title="Hoàn tất kiểm kê" onClose={() => setConfirming(false)} footer={<button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post(`/stock-counts/${id}/complete`, { uncounted }); setConfirming(false); state.reload(); })}>Áp dụng điều chỉnh</button>}>
                {varianceLines.length === 0 && uncounted === 'skip' ? <p>Không có chênh lệch. Phiếu sẽ được đóng, tồn kho không đổi.</p> : (
                  <div className="stack" style={{ gap: 4 }}>
                    <b>Tồn kho sẽ được điều chỉnh:</b>
                    {varianceLines.map((l) => <div key={l.id} className="ledger-line small"><span>{l.sku}</span><b className={l.variance > 0 ? 'h-green' : 'h-red'}>{l.variance > 0 ? '+' : ''}{l.variance}</b></div>)}
                  </div>
                )}
                {c.summary.uncounted > 0 && (
                  <Field label={`${c.summary.uncounted} dòng chưa đếm`}>
                    <select value={uncounted} onChange={(e) => setUncounted(e.target.value)}><option value="skip">Bỏ qua, giữ nguyên tồn</option><option value="zero">Coi như đếm được 0 (xoá tồn)</option></select>
                  </Field>
                )}
                <p className="small muted" style={{ margin: 0 }}>Sau khi hoàn tất, phiếu không sửa được. Mỗi chênh lệch ghi vào lịch sử kho kèm mã phiếu.</p>
                <ErrorBox error={error} />
              </Modal>
            )}
          </>
        );
      }}</Async>
    </Modal>
  );
}
