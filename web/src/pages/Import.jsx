import { useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, ErrorBox, Field, Kpi, Modal, useAction, useAsync } from '../components/ui.jsx';
import { vnd, fmtDate } from '../lib.js';
import ProfileEditor from '../components/ProfileEditor.jsx';
import { rowsToOrders, missingColumns } from '../lib/importRows.js';

export { rowsToOrders };

const ACTION = { created: ['Tạo mới', 'h-green'], updated: ['Cập nhật', 'h-yellow'], unchanged: ['Không đổi', 'muted'], error: ['Lỗi', 'h-red'] };

/** Nhập đơn từ file Excel/CSV. Mở từ trang Đơn hàng. */
export default function ImportPanel({ onClose, defaultShop }) {
  const { shops, channels, platforms } = useSession();
  // Mặc định theo nền tảng đầu tiên đang bật có nhập file (không có thì mẫu chuẩn)
  const startPlatform = platforms.find((p) => p.enabled && p.features.includes('import'));
  const profiles = useAsync(() => api.get('/imports/profiles'), []);
  const batches = useAsync(() => api.get('/imports/batches'), []);
  const [shop, setShop] = useState(defaultShop && defaultShop !== 'all' ? defaultShop : shops[0]?.id);
  const [profileId, setProfileId] = useState(startPlatform?.import_profile_id || 'imp_standard');
  const [channel, setChannel] = useState(startPlatform?.channel_id || 'other');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [final, setFinal] = useState(null);
  const [editing, setEditing] = useState(null); // { profile } | { profile: null } khi tạo mới
  const { busy, error, run } = useAction();

  const profile = profiles.data?.data?.find((p) => p.id === profileId);
  const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const onFile = (f) => run(async () => {
    setPreview(null); setFinal(null); setParsed(null); setFile(f);
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '', dateNF: 'yyyy-mm-dd hh:mm:ss' });
    if (!rows.length) throw new Error('File không có dòng dữ liệu nào.');
    setParsed({ rows, columns: Object.keys(rows[0]) });
  });

  const missing = parsed && profile ? missingColumns(parsed.columns, profile.column_map, profile.options) : [];

  const send = (commit) => run(async () => {
    const { orders, errors } = rowsToOrders(parsed.rows, profile.column_map);
    if (errors.length && !confirm(`${errors.length} dòng không đọc được và sẽ bị bỏ qua:\n${errors.slice(0, 5).join('\n')}\n\nTiếp tục với các dòng còn lại?`)) return;
    const results = [];
    for (const part of chunks(orders, 200)) {
      const r = await api.post(`/imports/orders/${commit ? 'commit' : 'preview'}`, { shop_id: shop, channel_id: channel, profile_id: profileId, file_name: file?.name, orders: part });
      results.push(...r.data.results);
    }
    const summary = { total: results.length, created: 0, updated: 0, unchanged: 0, error: 0, warning: results.filter((r) => r.warning).length };
    results.forEach((r) => (summary[r.action] += 1));
    (commit ? setFinal : setPreview)({ summary, results, skipped: errors });
    if (commit) { batches.reload(); setPreview(null); }
  });

  const show = final || preview;
  return (
    <Modal title="Nhập đơn từ file" wide onClose={onClose}>
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0 }}>Dùng cho file xuất đơn từ sàn (Shopee, TikTok Shop…) hoặc file theo mẫu chuẩn của Mở Sổ (Facebook, Zalo, hàng loạt). Chọn đúng mẫu map cột của nền tảng. Đơn đã có sẽ được cập nhật, không tạo trùng.</p>
        <a className="btn sm" href="/api/v1/imports/template.csv">Tải file mẫu chuẩn</a>
      </div>
      <Card title="1. Chọn file">
        <div className="grid cols-2">
          <Field label="Vào shop"><select value={shop} onChange={(e) => setShop(e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Mẫu map cột">
            <div className="row"><select value={profileId} onChange={(e) => { setProfileId(e.target.value); const p = profiles.data.data.find((x) => x.id === e.target.value); if (p) setChannel(p.channel_id); }}>{profiles.data?.data?.filter((p) => p.id === profileId || channels.some((c) => c.id === p.channel_id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button className="btn sm" type="button" onClick={() => setEditing({ profile })} disabled={!profile}>Sửa</button>
              <button className="btn sm" type="button" onClick={() => setEditing({ profile: null })}>Mẫu mới</button></div>
          </Field>
          <Field label="Kênh"><select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="File Excel / CSV" hint="File được đọc ngay trên máy này, không tải thô lên server."><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} /></Field>
        </div>
        {profile?.options?.note && <p className="small muted">{profile.options.note}</p>}
        {parsed && <p className="small">Đọc được <b>{parsed.rows.length}</b> dòng, <b>{parsed.columns.length}</b> cột.</p>}
        {missing.length > 0 && <div className="alert warn small">Không thấy các cột mà mẫu đang mong đợi: {[...new Set(missing.map(([k, c]) => `“${c}” (${k})`))].join(', ')}. Dữ liệu các trường này sẽ trống. Nếu sàn đã đổi tên cột, sửa mẫu map cột trong Cài đặt.</div>}
        <ErrorBox error={error} />
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={!parsed || busy} onClick={() => send(false)}>{busy ? 'Đang xử lý…' : 'Xem trước (chưa ghi gì)'}</button></div>
      </Card>

      {editing && <ProfileEditor profile={editing.profile} channels={channels} columns={parsed?.columns || []} rows={parsed?.rows || []} onClose={() => setEditing(null)}
        onSaved={(p) => { setEditing(null); profiles.reload(); setProfileId(p.id); setChannel(p.channel_id); setPreview(null); }} />}

      {show && (
        <Card title={final ? '3. Kết quả' : '2. Xem trước'}>
          <div className="grid cols-4">
            <Kpi label="Tạo mới" value={show.summary.created} /><Kpi label="Cập nhật" value={show.summary.updated} />
            <Kpi label="Không đổi" value={show.summary.unchanged} /><Kpi label="Lỗi" value={show.summary.error} tone={show.summary.error ? 'red' : undefined} />
          </div>
          {show.summary.warning > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>{show.summary.warning} đơn có cảnh báo (xem cột Chi tiết). Cảnh báo không chặn việc ghi, nhưng nên kiểm lại các đơn đó.</div>}
          {show.skipped?.length > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>{show.skipped.length} dòng đã bị bỏ qua vì thiếu mã đơn/SKU.</div>}
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 360, overflowY: 'auto' }}><table>
            <thead><tr><th>Mã đơn</th><th>Kết quả</th><th>Chi tiết</th></tr></thead>
            <tbody>{show.results.map((r, i) => (
              <tr key={i}><td>{r.external_id}</td><td className={ACTION[r.action][1]}><b>{ACTION[r.action][0]}</b></td><td className="small">{r.error || (r.changes ? Object.entries(r.changes).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('; ') : '')}{r.warning && <div style={{ color: 'var(--terracotta)' }}>Cảnh báo: {r.warning}</div>}</td></tr>
            ))}</tbody>
          </table></div>
          {!final && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy || show.summary.created + show.summary.updated === 0} onClick={() => send(true)}>Ghi vào hệ thống ({show.summary.created + show.summary.updated} đơn)</button>
              {show.summary.error > 0 && <span className="small muted">Đơn lỗi sẽ không được ghi; sửa file rồi import lại phần đó.</span>}
            </div>
          )}
        </Card>
      )}

      <Card title="Lịch sử import" flat>
        <Async state={batches}>{({ data }) => !data.length ? <div className="empty">Chưa import lần nào.</div> : (
          <div className="table-wrap"><table><tbody>{data.slice(0, 10).map((b) => <tr key={b.id}><td>{fmtDate(b.created_at)}</td><td>{b.shop_name}<div className="small muted">{b.file_name}</div></td><td className="small">+{b.created_count} · ~{b.updated_count} · ={b.unchanged_count} · ✕{b.error_count}</td></tr>)}</tbody></table></div>
        )}</Async>
      </Card>
    </Modal>
  );
}
