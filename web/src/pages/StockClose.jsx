import { useState } from 'react';
import { api } from '../api.js';
import { Async, Badge, ErrorBox, Field, Modal, Section, useAction, useAsync } from '../components/ui.jsx';
import { vnd, num, fmtDate, today } from '../lib.js';

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');

/** Chốt kỳ kho: khoá biến động kho đến hết một ngày, chụp tồn từng kho × biến thể, mở lại có lý do. */
export default function StockClose() {
  const status = useAsync(() => api.get('/stock-close'), []);
  const closes = useAsync(() => api.get('/stock-closes'), []);
  const yesterday = addDays(today(), -1);
  const [date, setDate] = useState(yesterday);
  const [note, setNote] = useState('');
  const preview = useAsync(() => (date ? api.get('/stock-close/preview', { date }) : null), [date, status.data]);
  const [confirm, setConfirm] = useState(false);
  const [reopen, setReopen] = useState(null);
  const [view, setView] = useState(null);
  const { busy, error, run } = useAction();
  const reload = () => { status.reload(); closes.reload(); };

  const doClose = () => run(async () => {
    await api.post('/stock-close', { date, note: note || undefined });
    setConfirm(false); setNote(''); reload();
  });

  return (
    <div className="stack">
      <Async state={status}>{({ data: st }) => (
        <Section
          title="Trạng thái chốt kho"
          actions={st.lock_date && <button type="button" className="btn sm" onClick={() => setReopen({ date: '', reason: '' })}>Mở lại kỳ</button>}
        >
          {!st.lock_date ? (
            <p className="note" style={{ margin: 0 }}>Kho chưa chốt kỳ nào. Biến động kho ở mọi ngày đều còn sửa được. Chốt kho khi đã kiểm kê xong và muốn giữ nguyên số tồn của kỳ đó.</p>
          ) : (
            <div className="stack">
              <div><b>Kho đã chốt đến hết ngày {dmy(st.lock_date)}.</b> Biến động kho có ngày đến hết hôm đó không ghi được nữa.</div>
              {st.active && <div className="small muted">Chụp tồn lúc {fmtDate(st.active.taken_at)}: {num(st.active.line_count)} dòng, tổng {num(st.active.total_qty)} sản phẩm, giá trị {vnd(st.active.total_value)}{st.active.note ? ` · ${st.active.note}` : ''}.</div>}
              {st.changed && (
                <div className="alert warn small" role="alert">
                  <b>Số tồn của kỳ đã chốt đang khác ảnh chụp</b> ({st.changes.length} dòng). Thường do dữ liệu bị sửa ngoài ứng dụng. Mở lại kỳ nếu cần ghi nhận, hoặc kiểm tra lại sổ kho.
                </div>
              )}
            </div>
          )}
        </Section>
      )}</Async>

      <Section title="Chốt kho đến ngày">
        <div className="stack">
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Chốt đến hết ngày" hint="Chỉ chốt đến hôm qua trở về trước.">
              <input type="date" value={date} max={yesterday} min={status.data?.data?.lock_date ? addDays(status.data.data.lock_date, 1) : undefined} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto', minWidth: 160 }} />
            </Field>
            <div style={{ flex: '1 1 280px' }}><Field label="Ghi chú (tuỳ chọn)" hint="Hiện trong lịch sử chốt kho."><input value={note} maxLength={200} placeholder="Ví dụ: Chốt kho tháng 10" onChange={(e) => setNote(e.target.value)} /></Field></div>
          </div>
          <Async state={preview}>{(r) => r && (
            <div className="stack">
              {r.data.blockers.map((b) => <div key={b.code} className="alert err small" role="alert"><b>Chưa chốt được: </b>{b.message}</div>)}
              {r.data.warnings.map((w) => <div key={w.code} className="alert warn small">{w.message}</div>)}
              <div className="small muted">
                Sẽ chụp {num(r.data.line_count)} dòng tồn, tổng {num(r.data.total_qty)} sản phẩm, giá trị {vnd(r.data.total_value)} (theo sổ kho: số lượng × giá vốn của các biến động đến hết ngày {dmy(r.data.date)}).
              </div>
              {r.data.by_warehouse.length > 1 && (
                <div className="table-wrap"><table>
                  <thead><tr><th>Kho</th><th className="num">Dòng</th><th className="num">Số lượng</th><th className="num">Giá trị</th></tr></thead>
                  <tbody>{r.data.by_warehouse.map((w) => <tr key={w.warehouse_id}><td>{w.name}</td><td className="num">{num(w.line_count)}</td><td className="num">{num(w.total_qty)}</td><td className="num">{vnd(w.total_value)}</td></tr>)}</tbody>
                </table></div>
              )}
              <div><button type="button" className="btn primary" disabled={!r.data.can_close || busy} onClick={() => setConfirm(true)}>Chốt kho đến {dmy(date)}</button></div>
            </div>
          )}</Async>
        </div>
      </Section>

      <Section title="Lịch sử chốt kho" flush>
        <Async state={closes}>{({ data }) => !data.length ? <div className="empty" style={{ padding: 16 }}>Chưa có lần chốt nào.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Chốt đến</th><th>Lúc chụp</th><th className="num">Dòng</th><th className="num">Số lượng</th><th className="num">Giá trị</th><th /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><b>{dmy(c.close_date)}</b>{c.note && <span className="sub">{c.note}</span>}</td>
                <td>{fmtDate(c.taken_at)}</td>
                <td className="num">{num(c.line_count)}</td>
                <td className="num">{num(c.total_qty)}</td>
                <td className="num">{vnd(c.total_value)}</td>
                <td className="num">{c.reopened_at ? <Badge tone="plain">Đã mở lại</Badge> : <span className="badge st-completed">Đang hiệu lực</span>} <button type="button" className="btn sm" onClick={() => setView(c.id)}>Xem tồn</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}</Async>
      </Section>

      {confirm && (
        <Modal title={`Chốt kho đến hết ${dmy(date)}?`} onClose={() => setConfirm(false)} footer={<button type="button" className="btn primary" disabled={busy} onClick={doClose}>Chốt kho</button>}>
          <p style={{ margin: 0 }}>Sau khi chốt, mọi biến động kho có ngày đến hết {dmy(date)} sẽ bị khoá. Đơn nhập từ sàn đặt trong kỳ này vẫn được trừ kho, nhưng ghi vào ngày {dmy(addDays(date, 1))} để số kỳ đã chốt không đổi. Mở lại được, nhưng sẽ ghi vào nhật ký.</p>
          <ErrorBox error={error} />
        </Modal>
      )}
      {reopen && (
        <Modal title="Mở lại kỳ kho" onClose={() => setReopen(null)} footer={<button type="button" className="btn danger" disabled={busy || !reopen.reason.trim()} onClick={() => run(async () => { await api.post('/stock-close/reopen', { date: reopen.date || null, reason: reopen.reason }); setReopen(null); reload(); })}>Mở lại</button>}>
          <div className="stack">
            <Field label="Lùi ngày chốt về" hint="Để trống để bỏ chốt hẳn. Phải là ngày trước ngày chốt hiện tại.">
              <input type="date" value={reopen.date} max={status.data?.data?.lock_date ? addDays(status.data.data.lock_date, -1) : undefined} onChange={(e) => setReopen({ ...reopen, date: e.target.value })} style={{ width: 'auto', minWidth: 160 }} />
            </Field>
            <Field label="Lý do (bắt buộc)"><input value={reopen.reason} maxLength={500} placeholder="Ví dụ: Nhập sót phiếu nhập ngày 28/10" onChange={(e) => setReopen({ ...reopen, reason: e.target.value })} /></Field>
            <ErrorBox error={error} />
          </div>
        </Modal>
      )}
      {view && <CloseLines id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function CloseLines({ id, onClose }) {
  const s = useAsync(() => api.get(`/stock-closes/${id}`), [id]);
  return (
    <Modal wide title="Tồn đã chụp" onClose={onClose}>
      <Async state={s}>{({ data: c }) => (
        <div className="stack">
          <div className="small muted">Chốt đến hết {dmy(c.close_date)} · {num(c.line_count)} dòng · giá trị {vnd(c.total_value)}</div>
          <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table>
            <thead><tr><th>Kho</th><th>Sản phẩm</th><th className="num">Số lượng</th><th className="num">Giá trị</th></tr></thead>
            <tbody>{c.lines.map((l) => <tr key={`${l.warehouse_id}${l.variant_id}`}><td>{l.warehouse_name}</td><td>{l.product_name}<span className="sub">{l.sku}</span></td><td className="num">{num(l.qty)} {l.unit}</td><td className="num">{vnd(l.value)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}</Async>
    </Modal>
  );
}
