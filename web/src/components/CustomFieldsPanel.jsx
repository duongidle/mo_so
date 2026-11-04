import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Async, ErrorBox, Field, useAction, useAsync } from './ui.jsx';
import FieldInput, { fieldText } from './FieldInput.jsx';

/**
 * Nhập và xem giá trị trường tuỳ chỉnh của một bản ghi (sản phẩm, đơn hàng, phiếu nhập).
 * Chỉ hiện các trường áp dụng cho shop của bản ghi: trường toàn hệ thống + trường riêng của shop đó.
 * Trường công thức chỉ đọc. Khách hàng có chỗ riêng (thông tin theo từng shop), không dùng component này.
 * `bare` = chỉ nội dung, không bọc thẻ (dùng trong cửa sổ).
 */
export default function CustomFieldsPanel({ entity, id, shopId, title = 'Thông tin thêm', bare = false, hideWhenEmpty = true }) {
  const state = useAsync(async () => {
    const [f, v] = await Promise.all([
      api.get('/custom/fields', { entity_type: entity, shop_id: shopId || undefined }),
      api.get(`/custom/values/${entity}/${id}`),
    ]);
    return { fields: f.data, values: v.data };
  }, [entity, id, shopId]);
  const [draft, setDraft] = useState(null);
  const { busy, error, run } = useAction();

  return (
    <Async state={state}>
      {({ fields, values }) => {
        if (!fields.length) {
          if (hideWhenEmpty) return null;
          return <Wrap bare={bare} title={title}><span className="muted small">Chưa có trường nào. Thêm trong <Link to="/settings">Cài đặt → Trường tuỳ chỉnh</Link>.</span></Wrap>;
        }
        const editable = fields.filter((f) => f.type !== 'formula');
        const save = () => run(async () => {
          const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(values[k] ?? null)));
          if (Object.keys(changed).length) await api.put(`/custom/values/${entity}/${id}`, changed);
          setDraft(null);
          state.reload();
        });
        const editing = draft !== null;
        return (
          <Wrap bare={bare} title={title} actions={!editing && editable.length > 0 && <button className="btn sm" onClick={() => setDraft({ ...values })}>Sửa</button>}>
            {editing ? (
              <div className="stack">
                {editable.map((f) => <Field key={f.id} label={f.type === 'boolean' ? '' : `${f.label}${f.required ? ' *' : ''}`}><FieldInput field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} /></Field>)}
                <ErrorBox error={error} />
                <div className="row"><button className="btn primary" disabled={busy} onClick={save}>Lưu</button><button className="btn" onClick={() => setDraft(null)}>Huỷ</button></div>
              </div>
            ) : fields.map((f) => <div key={f.id} className="ledger-line"><span className="muted">{f.label}{f.type === 'formula' && <span className="small"> (tự tính)</span>}</span><b style={{ textAlign: 'right' }}>{fieldText(f, values[f.key])}</b></div>)}
          </Wrap>
        );
      }}
    </Async>
  );
}

function Wrap({ bare, title, actions, children }) {
  if (bare) return <div className="stack" style={{ gap: 8 }}><div className="row between"><h3>{title}</h3>{actions}</div>{children}</div>;
  return <section className="card"><div className="card-head"><h3>{title}</h3><div className="row">{actions}</div></div>{children}</section>;
}
