import { useState } from 'react';
import { api } from '../api.js';
import { Async, Chips, Empty, ErrorBox, Field, Modal, useAction, useAsync } from './ui.jsx';
import FormulaEditor from './FormulaEditor.jsx';
import FieldInput, { slugify } from './FieldInput.jsx';

export const ENTITIES = { order: 'Đơn hàng', product: 'Sản phẩm', purchase: 'Phiếu nhập', customer: 'Khách hàng' };
export const TYPES = { text: 'Văn bản', number: 'Số', money: 'Tiền', date: 'Ngày', select: 'Chọn một', multiselect: 'Chọn nhiều', boolean: 'Có/Không', formula: 'Công thức' };
// Ngày sinh / năm sinh nay là thông tin chung của khách (hồ sơ khách), không còn vai trò của trường riêng
const ROLES = {
  customer: { element: 'Mệnh (ghi đè; để trống thì tự tính từ ngày sinh)' },
  product: { element: 'Ngũ hành hợp của sản phẩm' },
};
const OLD_ROLE = { birth_date: 'Ngày sinh (cũ, nay là thông tin chung)', birth_year: 'Năm sinh (cũ, nay là thông tin chung)' };
const ROLE_TYPE = {};

/** Ô sửa danh sách lựa chọn dạng thẻ: Enter hoặc dấu phẩy để thêm, bấm × để bỏ */
export function OptionsEditor({ value, onChange }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const items = raw.split(',').map((x) => x.trim()).filter((x) => x && !value.includes(x));
    if (items.length) onChange([...value, ...items]);
    setText('');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {value.map((o) => (
          <span key={o} className="chip on" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {o}
            <button type="button" aria-label={`Bỏ ${o}`} onClick={() => onChange(value.filter((x) => x !== o))} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      <input aria-label="Thêm lựa chọn" value={text} placeholder="Gõ lựa chọn rồi nhấn Enter" onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }} onBlur={() => text.trim() && add(text)} />
    </div>
  );
}

/**
 * Quản lý trường tuỳ chỉnh dùng chung (Cài đặt và trang Khách hàng).
 * entities: các đối tượng cho chọn (mặc định cả bốn). shop: shop đang chọn (null = "Tất cả shop"); shops: để chọn phạm vi trường.
 * Trường của khách luôn thuộc một shop = shop đang chọn.
 */
export default function FieldsManager({ entities = Object.keys(ENTITIES), shop = null, shops = [], initialEntity }) {
  const [entity, setEntity] = useState(initialEntity && entities.includes(initialEntity) ? initialEntity : entities[0]);
  const [showHidden, setShowHidden] = useState(false);
  const [f, setF] = useState(null);
  const [del, setDel] = useState(null); // trường đang hỏi xoá: { field, usage }
  const { busy, error, run } = useAction();
  const isCustomer = entity === 'customer';
  const needShop = isCustomer && !shop;
  const state = useAsync(
    () => (needShop ? Promise.resolve({ data: [] }) : api.get('/custom/fields', { entity_type: entity, shop_id: isCustomer ? shop.id : undefined, archived: showHidden ? 1 : undefined })),
    [entity, shop?.id, showHidden],
  );

  const open = (x) => setF(x ? { ...x, options: x.options || [], formula: x.formula || '', role: x.role || '', default_value: x.default_value ?? null } : { entity_type: entity, key: '', label: '', type: 'text', options: [], formula: '', role: '', required: false, show_in_list: false, shop_id: '', default_value: null });
  const isSelect = f && ['select', 'multiselect'].includes(f.type);
  const roleChoices = f ? Object.entries(ROLES[f.entity_type] || {}).filter(([k]) => !ROLE_TYPE[k] || ROLE_TYPE[k].includes(f.type)) : [];
  const save = () => run(async () => {
    const common = { label: f.label, required: !!f.required, role: f.role || null, ...(isSelect ? { options: f.options } : {}), ...(f.type === 'formula' ? { formula: f.formula } : { default_value: f.default_value ?? null }) };
    if (f.id) await api.patch(`/custom/fields/${f.id}`, { ...common, ...(f.entity_type === 'customer' ? { show_in_list: !!f.show_in_list } : {}) });
    else await api.post('/custom/fields', { ...common, entity_type: f.entity_type, key: f.key || slugify(f.label), type: f.type, shop_id: f.entity_type === 'customer' ? shop.id : f.shop_id || null, show_in_list: f.entity_type === 'customer' && !!f.show_in_list });
    setF(null); state.reload();
  });
  // Công thức nào (cùng danh sách) đang dùng trường này: nút Xoá tắt kèm lý do. Server vẫn kiểm lại.
  const usedBy = (x, list) => list.filter((o) => o.id !== x.id && o.type === 'formula' && (o.formula || '').includes(`{custom.${x.key}}`));
  const askDelete = (x) => run(async () => {
    const r = await api.get(`/custom/fields/${x.id}/usage`);
    setDel({ field: x, usage: r.data });
  });
  const doDelete = () => run(async () => {
    await api.del(`/custom/fields/${del.field.id}`, { confirm: true });
    setDel(null); state.reload();
  });
  const patch = (id, body) => run(async () => { await api.patch(`/custom/fields/${id}`, body); state.reload(); });
  const move = (list, i, dir) => run(async () => {
    // Đánh số lại cả danh sách theo thứ tự mới để không dính các trường cùng sort_order
    const order = list.map((x) => x.id);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    await Promise.all(order.map((id, idx) => (list.find((x) => x.id === id).sort_order === idx ? null : api.patch(`/custom/fields/${id}`, { sort_order: idx }))));
    state.reload();
  });

  return (
    <div className="stack">
      {entities.length > 1 && <Chips options={entities.map((k) => [k, ENTITIES[k]])} value={entity} onChange={(v) => { setEntity(v); setShowHidden(false); }} />}
      {needShop ? (
        <div className="alert warn small">Thông tin khách là của từng shop. Chọn một shop ở bộ chọn shop (không để “Tất cả shop”) rồi quay lại đây.</div>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {isCustomer ? <>Các trường này chỉ tồn tại ở <b>{shop.name}</b>. Shop khác không thấy, kể cả với cùng một khách.</> : 'Trường toàn hệ thống dùng được ở mọi shop; trường riêng của shop chỉ hiện ở shop đó.'}
          </p>
          <div className="row between wrap">
            <label className="check small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />Xem trường đã ẩn</label>
            {!showHidden && <button type="button" className="btn sm" onClick={() => open(null)}>+ Thêm trường</button>}
          </div>
          <Async state={state}>{({ data }) => (!data.length ? <Empty>{showHidden ? 'Không có trường nào bị ẩn.' : 'Chưa có trường nào.'}</Empty> : data.map((x, i) => (
            <div key={x.id} className="row between wrap" style={{ padding: '8px 0', borderBottom: '1px dotted var(--rule)' }}>
              <span>
                <b>{x.label}</b> <code className="small">{`{custom.${x.key}}`}</code>{x.required && <span className="badge plain" style={{ marginLeft: 8 }}>Bắt buộc</span>}
                <div className="small muted">{TYPES[x.type]}{x.options && `: ${x.options.join(', ')}`}{x.formula && ` = ${x.formula}`}{x.role && ` · vai trò: ${ROLES[x.entity_type]?.[x.role] || OLD_ROLE[x.role] || x.role}`}{x.default_value != null && ` · mặc định: ${[].concat(x.default_value).join(', ')}`}{x.shop_id && !isCustomer && ` · riêng ${shops.find((s) => s.id === x.shop_id)?.name || 'một shop'}`}</div>
              </span>
              <span className="row wrap">
                {showHidden ? <button type="button" className="btn sm" disabled={busy} onClick={() => patch(x.id, { archived: false })}>Hiện lại</button> : (
                  <>
                    <button type="button" className="btn sm" aria-label={`Đưa ${x.label} lên`} disabled={busy || i === 0} onClick={() => move(data, i, -1)}>↑</button>
                    <button type="button" className="btn sm" aria-label={`Đưa ${x.label} xuống`} disabled={busy || i === data.length - 1} onClick={() => move(data, i, 1)}>↓</button>
                    {isCustomer && <label className="check small" title="Hiện thành một cột ở danh sách khách (tối đa 4 cột)"><input type="checkbox" checked={!!x.show_in_list} disabled={busy || x.type === 'formula'} onChange={() => patch(x.id, { show_in_list: !x.show_in_list })} />Cột</label>}
                    <button type="button" className="btn sm" onClick={() => open(x)}>Sửa</button>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => confirm(`Ẩn trường “${x.label}”? Dữ liệu đã nhập vẫn được giữ, hiện lại được.`) && patch(x.id, { archived: true })}>Ẩn</button>
                    {(() => {
                      const by = usedBy(x, data);
                      return <button type="button" className="btn sm danger" disabled={busy || by.length > 0} aria-label={`Xoá ${x.label}`} title={by.length ? `Đang được công thức ${by.map((o) => `“${o.label}”`).join(', ')} dùng. Sửa hoặc xoá công thức đó trước.` : 'Xoá hẳn trường này'} onClick={() => askDelete(x)}>Xoá</button>;
                    })()}
                  </>
                )}
              </span>
            </div>
          )))}</Async>
          <ErrorBox error={error} />
        </>
      )}
      {del && (
        <Modal title={`Xoá trường · ${del.field.label}`} onClose={() => setDel(null)} footer={<button type="button" className="btn danger" disabled={busy || del.usage.referenced_by.length > 0} onClick={doDelete}>Xoá hẳn</button>}>
          {del.usage.referenced_by.length > 0 ? (
            <div className="alert warn small">Đang được công thức {del.usage.referenced_by.map((o) => `“${o.label}”`).join(', ')} dùng nên chưa xoá được.</div>
          ) : del.usage.values_count > 0 ? (
            <div className="stack small" style={{ gap: 8 }}>
              <div>Trường <b>{del.field.label}</b> đang có dữ liệu ở <b>{del.usage.values_count}</b> bản ghi. Xoá hẳn sẽ bỏ trường và toàn bộ dữ liệu đó khỏi các màn hình.</div>
              <div className="muted">Bản sao dữ liệu được ghi vào nhật ký hệ thống để khôi phục tay nếu xoá nhầm. Muốn giữ dữ liệu và chỉ ẩn trường, đóng hộp này rồi nhấn “Ẩn”.</div>
            </div>
          ) : (
            <div className="small">Trường <b>{del.field.label}</b> chưa có dữ liệu nào. Xoá hẳn sẽ giải phóng khoá <code>{del.field.key}</code> để dùng lại.</div>
          )}
          <ErrorBox error={error} />
        </Modal>
      )}
      {f && (
        <Modal wide title={f.id ? `Sửa trường · ${f.label}` : `Thêm trường · ${ENTITIES[f.entity_type]}`} onClose={() => setF(null)} footer={<button type="button" className="btn primary" disabled={busy || !f.label.trim() || (f.type === 'formula' && !f.formula.trim()) || (isSelect && !f.options.length)} onClick={save}>Lưu</button>}>
          <div className="grid cols-2">
            <Field label="Nhãn hiển thị"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} autoFocus /></Field>
            {!f.id && <Field label="Kiểu"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, role: '', default_value: null })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
            {!f.id && <Field label="Khoá (a-z, 0-9, _)" hint="Dùng trong công thức. Để trống: tự lấy từ nhãn. Không đổi được sau này."><input value={f.key} placeholder={slugify(f.label)} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>}
            {!f.id && f.entity_type !== 'customer' && <Field label="Phạm vi" hint="Toàn hệ thống để cộng gộp được giữa các shop"><select value={f.shop_id} onChange={(e) => setF({ ...f, shop_id: e.target.value })}><option value="">Toàn hệ thống</option>{shops.map((s) => <option key={s.id} value={s.id}>Chỉ {s.name}</option>)}</select></Field>}
          </div>
          {isSelect && <div className="stack" style={{ gap: 8 }}><span className="small" style={{ fontWeight: 600 }}>Các lựa chọn</span><OptionsEditor value={f.options} onChange={(options) => setF({ ...f, options })} /></div>}
          {f.type === 'formula' && <FormulaEditor entity={f.entity_type} shopId={f.entity_type === 'customer' ? shop?.id : f.shop_id || shop?.id || null} fieldKey={f.key || (f.id ? f.key : slugify(f.label)) || null} value={f.formula} onChange={(formula) => setF({ ...f, formula })} />}
          {f.type !== 'formula' && f.type !== 'boolean' && (
            <Field label="Giá trị mặc định" hint="Điền sẵn khi tạo bản ghi mới và khi mở form của bản ghi chưa có giá trị. Không tự ghi vào bản ghi cũ.">
              <FieldInput field={{ ...f, options: f.options || [] }} value={f.default_value} onChange={(v) => setF({ ...f, default_value: v })} />
            </Field>
          )}
          {f.type !== 'formula' && <label className="check"><input type="checkbox" checked={!!f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />Bắt buộc nhập (báo lỗi khi lưu mà thiếu)</label>}
          {f.entity_type === 'customer' && f.type !== 'formula' && <label className="check"><input type="checkbox" checked={!!f.show_in_list} onChange={(e) => setF({ ...f, show_in_list: e.target.checked })} />Hiện thành cột ở danh sách khách</label>}
          {roleChoices.length > 0 && <Field label="Vai trò đặc biệt" hint="Cho hệ thống biết trường này là mệnh ghi đè (để trống thì hệ thống tự tính từ ngày sinh của khách). Mỗi vai trò một trường."><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="">Không có</option>{roleChoices.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
          <ErrorBox error={error} />
        </Modal>
      )}
    </div>
  );
}
