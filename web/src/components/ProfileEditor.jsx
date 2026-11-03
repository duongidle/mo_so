import { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, Modal, useAction } from './ui.jsx';
import { STATUS } from '../lib.js';

/** Các trường của đơn mà một mẫu import có thể lấy từ cột trong file. multi = cộng nhiều cột (các khoản tiền). */
export const IMPORT_FIELDS = [
  ['external_id', 'Mã đơn (bắt buộc)', false], ['ordered_at', 'Ngày đặt', false], ['status', 'Trạng thái đơn', false],
  ['customer_name', 'Tên khách', false], ['customer_phone', 'Số điện thoại', false], ['shipping_address', 'Địa chỉ nhận', false], ['shopee_username', 'Tên tài khoản trên sàn', false],
  ['sku', 'SKU (bắt buộc)', false], ['sku_fallback', 'SKU dự phòng khi cột SKU trống', false], ['qty', 'Số lượng', false], ['unit_price', 'Đơn giá', false],
  ['line_discount', 'Giảm giá dòng', true], ['order_discount', 'Giảm giá cả đơn', true], ['shipping_fee', 'Phí ship khách trả', true],
  ['platform_fee', 'Phí sàn (cộng nhiều cột)', true], ['seller_shipping', 'Phí ship shop chịu', true],
  ['note', 'Ghi chú của khách', false], ['tracking_code', 'Mã vận đơn', false], ['carrier', 'Đơn vị vận chuyển', false], ['paid_amount', 'Đã thanh toán', true],
];

const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);

/** Đoán trạng thái của app từ chữ trạng thái trong file (người dùng chỉnh lại được) */
export function guessStatus(text) {
  const t = String(text).toLowerCase();
  if (/h[ủu][yỷ]|cancel/.test(t)) return 'cancelled';
  if (/trả hàng|hoàn tiền|return|refund/.test(t)) return 'returned';
  if (/hoàn thành|đã giao|completed|delivered/.test(t)) return 'completed';
  if (/đang giao|vận chuyển|shipping/.test(t)) return 'shipping';
  return 'confirmed';
}

function ColumnPicker({ value, onChange, columns, multi, id }) {
  const [text, setText] = useState('');
  const add = (c) => { const v = c.trim(); if (!v || value.includes(v)) return; onChange(multi ? [...value, v] : [v]); setText(''); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap">
        {value.map((c) => (
          <span key={c} className="chip on" style={{ cursor: 'default', minHeight: 30, padding: '2px 6px 2px 12px' }}>
            {c}{!columns.includes(c) && columns.length > 0 && <span title="Không thấy cột này trong file đang mở" style={{ color: 'var(--champagne)' }}> ⚠</span>}
            <button type="button" aria-label={`Bỏ cột ${c}`} onClick={() => onChange(value.filter((x) => x !== c))} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', marginLeft: 4 }}>✕</button>
          </span>
        ))}
      </div>
      {(multi || value.length === 0) && (
        <input list={`cols-${id}`} value={text} placeholder={columns.length ? 'Chọn cột trong file…' : 'Gõ đúng tên cột trong file…'} aria-label="Thêm cột"
          onChange={(e) => { setText(e.target.value); if (columns.includes(e.target.value)) add(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }} onBlur={() => add(text)} />
      )}
      <datalist id={`cols-${id}`}>{columns.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

/**
 * Tạo/sửa mẫu import: ánh xạ trường của đơn → tên cột trong file, và ánh xạ chữ trạng thái → trạng thái của app.
 * `columns`/`rows` từ file đang mở (nếu có) để gợi ý cột và lấy sẵn các giá trị trạng thái.
 */
export default function ProfileEditor({ profile, channels, columns = [], rows = [], onClose, onSaved }) {
  const isNew = !profile?.id;
  const [name, setName] = useState(profile?.name || '');
  const [channel, setChannel] = useState(profile?.channel_id || channels[0]?.id);
  const [map, setMap] = useState(() => Object.fromEntries(IMPORT_FIELDS.map(([k]) => [k, arr(profile?.column_map?.[k])])));
  const [statusMap, setStatusMap] = useState(() => Object.entries(profile?.status_map || {}));
  const [note, setNote] = useState(profile?.options?.note || '');
  const { busy, error, run } = useAction();

  const statusCol = map.status[0];
  const fileStatuses = statusCol && rows.length ? [...new Set(rows.map((r) => r[statusCol]).filter((v) => v !== undefined && v !== ''))] : [];
  const pullStatuses = () => setStatusMap((cur) => [...cur, ...fileStatuses.filter((v) => !cur.some(([k]) => k === v)).map((v) => [v, guessStatus(v)])]);
  const missingRequired = ['external_id', 'sku'].filter((k) => map[k].length === 0);

  const save = () => run(async () => {
    const column_map = Object.fromEntries(Object.entries(map).filter(([, v]) => v.length).map(([k, v]) => [k, v.length === 1 ? v[0] : v]));
    const status_map = Object.fromEntries(statusMap.filter(([k]) => k.trim()));
    const body = { name, channel_id: channel, column_map, status_map, options: note ? { note } : {} };
    const r = isNew ? await api.post('/imports/profiles', body) : await api.put(`/imports/profiles/${profile.id}`, body);
    onSaved(r.data);
  });

  return (
    <Modal title={isNew ? 'Tạo mẫu import' : 'Sửa mẫu import'} wide onClose={onClose} footer={<button className="btn primary" disabled={busy || !name || missingRequired.length > 0} onClick={save}>Lưu mẫu</button>}>
      <p className="small muted" style={{ margin: 0 }}>{columns.length ? `Đang gợi ý theo ${columns.length} cột của file đã mở. Dấu ⚠ là cột mẫu mong đợi nhưng không có trong file.` : 'Mở một file trước để chọn cột từ danh sách; hoặc gõ đúng tên cột.'}</p>
      <div className="grid cols-2">
        <Field label="Tên mẫu"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Kênh mặc định"><select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <h3>Cột trong file</h3>
      <div className="grid cols-2">
        {IMPORT_FIELDS.map(([k, label, multi]) => (
          <Field key={k} label={label}><ColumnPicker id={k} value={map[k]} columns={columns} multi={multi} onChange={(v) => setMap({ ...map, [k]: v })} /></Field>
        ))}
      </div>
      {missingRequired.length > 0 && <div className="alert err small">Cần chọn cột cho: {missingRequired.map((k) => IMPORT_FIELDS.find((f) => f[0] === k)[1]).join(', ')}.</div>}

      <h3>Trạng thái đơn: chữ trong file → trạng thái của Mở Sổ</h3>
      <p className="small muted" style={{ margin: 0 }}>Chữ nào không có ở đây và app không đoán được sẽ báo lỗi dòng đó, không bỏ qua im lặng.</p>
      {statusMap.map(([k, v], i) => (
        <div className="row" key={i}>
          <input value={k} onChange={(e) => setStatusMap(statusMap.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} aria-label="Chữ trong file" />
          <span>→</span>
          <select value={v} onChange={(e) => setStatusMap(statusMap.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} aria-label="Trạng thái của app">{Object.entries(STATUS).map(([sk, sl]) => <option key={sk} value={sk}>{sl}</option>)}</select>
          <button className="btn sm" aria-label="Bỏ dòng" onClick={() => setStatusMap(statusMap.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row wrap">
        <button className="btn sm" onClick={() => setStatusMap([...statusMap, ['', 'confirmed']])}>+ Thêm dòng</button>
        {fileStatuses.length > 0 && <button className="btn sm" onClick={pullStatuses}>Lấy {fileStatuses.length} giá trị trạng thái từ file</button>}
      </div>
      <Field label="Ghi chú cho mẫu (hiện khi chọn mẫu)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}
