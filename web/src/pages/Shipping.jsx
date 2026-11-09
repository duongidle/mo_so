import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Empty, ErrorBox, Field, Kpi, Modal, useAction, useAsync } from '../components/ui.jsx';
import { vnd, fmtDate } from '../lib.js';
import { FIELDS, guessMapping, rowsFromSheet } from '../lib/carrierStatement.js';

const BUCKETS = [['', 'Tất cả'], ['in_transit', 'Đang giao'], ['unreconciled', 'Đã giao, chưa đối soát'], ['returned', 'Hoàn hàng'], ['done', 'Đã đối soát']];
const ST = { in_transit: 'Đang giao', delivered: 'Đã giao', returned: 'Hoàn hàng', lost: 'Thất lạc' };
const RESULT = { applied: 'Ghi nhận', not_found: 'Không thấy vận đơn', already_reconciled: 'Đã đối soát trước', skipped: 'Bỏ qua' };

/** Tab Vận chuyển của Chi phí & đối soát: vận đơn, tiền COD hãng đang giữ, nhập bảng đối soát của hãng */
export default function Shipping() {
  const { shopId, isAll } = useSession();
  const [bucket, setBucket] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [open, setOpen] = useState(null); // 'statement'
  const [voiding, setVoiding] = useState(null); // phiếu đối soát đang xem để huỷ
  const carriers = useAsync(() => api.get('/carriers'), []);
  const summary = useAsync(() => api.get('/shipments/summary', { carrier_id: carrierId || undefined, shop_id: isAll ? undefined : shopId }), [carrierId, shopId]);
  const list = useAsync(() => api.get('/shipments', { bucket: bucket || undefined, carrier_id: carrierId || undefined, shop_id: isAll ? undefined : shopId }), [bucket, carrierId, shopId]);
  const stmts = useAsync(() => api.get('/carrier-statements', { carrier_id: carrierId || undefined }), [carrierId]);
  const { busy, error, run } = useAction();
  const [picked, setPicked] = useState({});
  const reload = () => { summary.reload(); list.reload(); stmts.reload(); };
  const mark = (id, status) => run(async () => { await api.post(`/shipments/${id}/status`, { status }); reload(); });
  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="row wrap">
          <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)} aria-label="Hãng vận chuyển"><option value="">Mọi hãng</option>{(carriers.data?.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Link className="btn" to="/settings?tab=shipping">Quản lý hãng</Link>
        </div>
        <span className="row">{Object.values(picked).some(Boolean) && <a className="btn" target="_blank" rel="noreferrer" href={`/api/v1/orders/labels?ids=${Object.keys(picked).filter((k) => picked[k]).join(',')}`}>In nhãn ({Object.values(picked).filter(Boolean).length})</a>}<button className="btn primary" onClick={() => setOpen('statement')}>Nhập bảng đối soát của hãng</button></span>
      </div>
      <Async state={summary}>
        {({ data: s }) => (
          <div className="grid cols-3">
            <Kpi label="Đang giao" value={String(s.in_transit.n)} hint={`COD đang trên đường: ${vnd(s.in_transit.cod)}`} />
            <Kpi label="Đã giao, hãng đang giữ tiền" value={vnd(s.unreconciled.cod)} hint={`${s.unreconciled.n} vận đơn chờ hãng đối soát`} tone={s.unreconciled.n ? 'yellow' : undefined} />
            <Kpi label="Hãng báo hoàn" value={String(s.returned.n)} hint="Hàng chưa về thì xác nhận ở chi tiết đơn" />
          </div>
        )}
      </Async>
      <Chips options={BUCKETS} value={bucket} onChange={setBucket} />
      <ErrorBox error={error} />
      <Async state={list}>
        {({ data }) => !data.length ? <Empty>Chưa có vận đơn nào. Giao đơn cho hãng ở trang chi tiết đơn (nút “Giao cho hãng vận chuyển”).</Empty> : (
          <Card flat className="list-card"><div className="table-wrap"><table className="stackable">
            <thead><tr><th style={{ width: 28 }} /><th>Vận đơn</th><th>Đơn</th><th className="num">COD</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{data.map((s) => (
              <tr key={s.id}>
                <td><input type="checkbox" aria-label={`Chọn ${s.tracking_code} để in nhãn`} style={{ width: 20, minHeight: 20 }} checked={!!picked[s.order_id]} onChange={(e) => setPicked({ ...picked, [s.order_id]: e.target.checked })} /></td>
                <td><b>{s.tracking_link ? <a href={s.tracking_link} target="_blank" rel="noreferrer">{s.tracking_code}</a> : s.tracking_code}</b><span className="sub">{s.carrier_name} · {fmtDate(s.shipped_at)}</span></td>
                <td><Link to={`/orders/${s.order_id}`}>{s.order_code}</Link><span className="sub">{s.customer_name}</span></td>
                <td className="num">{vnd(s.cod_amount)}</td>
                <td><span className="badge plain">{ST[s.status]}</span>{s.statement_id ? <span className="sub">Đã đối soát</span> : null}</td>
                <td>{s.status === 'in_transit' && <span className="row"><button className="btn sm" disabled={busy} onClick={() => mark(s.id, 'delivered')}>Đã giao</button><button className="btn sm" disabled={busy} onClick={() => mark(s.id, 'returned')}>Hoàn</button></span>}</td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
      <Async state={stmts}>
        {({ data }) => data.length > 0 && (
          <Card title="Phiếu đối soát đã chốt">
            {data.slice(0, 8).map((s) => (
              <div key={s.id} className="row between small wrap" style={s.voided_at ? { opacity: 0.6 } : undefined}>
                <span style={s.voided_at ? { textDecoration: 'line-through' } : undefined}><b>{s.code}</b> · {s.carrier_name} · {fmtDate(s.statement_date)} · {s.line_count} dòng</span>
                <span className="row">
                  <span>COD {vnd(s.total_cod)} − phí {vnd(s.total_fees)} = <b>{vnd(s.net_amount)}</b></span>
                  {s.voided_at ? <span className="badge plain" title={s.void_reason || ''}>Đã huỷ</span> : <button className="btn sm" onClick={() => setVoiding(s)}>Huỷ phiếu</button>}
                </span>
              </div>
            ))}
          </Card>
        )}
      </Async>
      {open === 'statement' && <StatementModal carriers={carriers.data?.data || []} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
      {voiding && <VoidStatementModal statement={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); reload(); }} />}
    </div>
  );
}

/** Huỷ cả phiếu đối soát: cho xem trước từng thứ sẽ được hoàn tác và những gì đang cản, rồi bắt ghi lý do */
function VoidStatementModal({ statement, onClose, onDone }) {
  const { busy, error, run } = useAction();
  const [reason, setReason] = useState('');
  const pv = useAsync(() => api.get(`/carrier-statements/${statement.id}/void-preview`), [statement.id]);
  const canSubmit = pv.data?.data?.can_void && reason.trim().length >= 3;
  return (
    <Modal
      title={`Huỷ phiếu đối soát ${statement.code}`}
      onClose={onClose}
      footer={<button className="btn primary" disabled={busy || !canSubmit} onClick={() => run(async () => { await api.post(`/carrier-statements/${statement.id}/void`, { reason: reason.trim() }); onDone(); })}>Huỷ phiếu đối soát</button>}
    >
      <Async state={pv}>
        {({ data }) => (
          <div className="stack small">
            {data.blockers.length > 0 ? (
              <div className="alert warn">
                <b>Chưa huỷ được:</b>
                {data.blockers.map((b, i) => <div key={i}>{b.order_code ? `${b.order_code}: ` : ''}{b.message}</div>)}
              </div>
            ) : (
              <>
                <p className="muted">Huỷ phiếu sẽ hoàn tác toàn bộ những gì lúc chốt phiếu đã ghi. Phiếu vẫn được giữ lại để tra cứu, đánh dấu đã huỷ. Vận đơn trở về trạng thái trước đó nên đối soát lại được.</p>
                <ul className="stack" style={{ gap: 4, paddingLeft: 18 }}>
                  {data.undo.payments > 0 && <li>Huỷ {data.undo.payments} khoản thanh toán qua hãng ({vnd(data.undo.payments_amount)}): tiền COD đã thu và phí giao đã bù</li>}
                  {data.undo.expenses > 0 && <li>Huỷ {data.undo.expenses} chi phí vận chuyển ({vnd(data.undo.expenses_amount)})</li>}
                  {data.undo.returns > 0 && <li>Gỡ {data.undo.returns} phiếu trả hàng chờ hàng về, đơn quay lại “Đang giao”</li>}
                  {data.undo.orders_reopened > 0 && <li>Đưa {data.undo.orders_reopened} đơn từ “Hoàn thành” về “Đang giao”</li>}
                  <li>Trả {data.undo.shipments} vận đơn về trạng thái trước đối soát</li>
                </ul>
              </>
            )}
            <Field label="Lý do huỷ" hint="Ghi vào nhật ký, ví dụ: hãng gửi nhầm bảng, chọn nhầm cột."><input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Lý do huỷ phiếu đối soát" disabled={!data.can_void} /></Field>
          </div>
        )}
      </Async>
      <ErrorBox error={error} />
    </Modal>
  );
}

function StatementModal({ carriers, onClose, onDone }) {
  const { busy, error, run } = useAction();
  const [carrierId, setCarrierId] = useState(carriers[0]?.id || '');
  const [parsed, setParsed] = useState(null); // { rows, columns }
  const [map, setMap] = useState({});
  const [preview, setPreview] = useState(null);
  const [date, setDate] = useState('');
  const onFile = (f) => run(async () => {
    setPreview(null);
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
    if (!rows.length) throw new Error('File không có dòng dữ liệu nào.');
    const columns = Object.keys(rows[0]);
    setParsed({ rows, columns });
    setMap(guessMapping(columns));
  });
  const payload = parsed && map.tracking_code ? rowsFromSheet(parsed.rows, map) : [];
  const body = { carrier_id: carrierId, rows: payload };
  return (
    <Modal title="Nhập bảng đối soát của hãng" onClose={onClose} footer={preview?.summary.applied ? <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/carrier-statements', { ...body, date: date || undefined }); onDone(); })}>Chốt đối soát ({preview.summary.applied} vận đơn)</button> : <button className="btn primary" disabled={busy || !carrierId || !payload.length} onClick={() => run(async () => setPreview((await api.post('/carrier-statements/preview', body)).data))}>Xem trước</button>}>
      <p className="muted small">Tải file đối soát từ hãng (Excel/CSV). File đọc ngay trên máy này. Giao thành công thì ghi thu COD và trừ phí; hãng báo hoàn thì lập phiếu trả chờ hàng về.</p>
      <Field label="Hãng"><select value={carrierId} onChange={(e) => { setCarrierId(e.target.value); setPreview(null); }} aria-label="Hãng đối soát">{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="File đối soát"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} /></Field>
      {parsed && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Cột nào là gì? ({parsed.rows.length} dòng)</b>
          {FIELDS.map(([k, label, required]) => (
            <div key={k} className="row between"><span className="small">{label}{required && ' *'}</span>
              <select value={map[k] || ''} onChange={(e) => { setMap({ ...map, [k]: e.target.value || undefined }); setPreview(null); }} aria-label={label}><option value="">{required ? 'Chọn cột…' : 'Không có'}</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          ))}
          <Field label="Ngày đối soát (mặc định hôm nay)"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Ngày đối soát" /></Field>
        </div>
      )}
      {preview && (
        <div className="stack small">
          <div className={`alert ${preview.summary.problems ? 'warn' : 'ok'}`}>Ghi nhận {preview.summary.applied} vận đơn · COD {vnd(preview.summary.cod_stated)} · phí {vnd(preview.summary.fees)} · tiền hãng chuyển về {vnd(preview.summary.cod_stated - preview.summary.fees)}{preview.summary.problems ? ` · ${preview.summary.problems} dòng không ghi được` : ''}</div>
          <div className="table-wrap" style={{ maxHeight: 220 }}><table><tbody>{preview.lines.map((l, i) => <tr key={i}><td>{l.tracking_code}<span className="sub">{l.order_code}</span></td><td>{RESULT[l.result]}{l.warning ? <span className="sub h-yellow">{l.warning}</span> : null}</td><td className="num">{vnd(l.cod_stated)}</td></tr>)}</tbody></table></div>
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
