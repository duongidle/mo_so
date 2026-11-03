import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd } from '../lib.js';
import { Element } from '../components/Motif.jsx';
import CustomFieldsPanel from '../components/CustomFieldsPanel.jsx';

const ELEMENTS = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];
const blank = () => ({ name: '', unit: 'cái', consumption_days: '', elements: [], variants: [{ sku: '', name: '', default_price: 0, min_stock: 0 }], shop_ids: [] });

export default function Products() {
  const { shopId, shops, isAll, has } = useSession();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [edit, setEdit] = useState(null);
  const [sync, setSync] = useState(false);
  const state = useAsync(() => api.get('/products', { shop_id: isAll ? undefined : shopId, q: dq || undefined, limit: 200 }), [shopId, dq]);

  return (
    <div className="page stack">
      <div className="page-head"><h1>Sản phẩm</h1>
        <div className="row">{!isAll && shops.length > 1 && <button className="btn" onClick={() => setSync(true)}>Đồng bộ từ shop khác</button>}
          <button className="btn primary" onClick={() => setEdit({ ...blank(), shop_ids: isAll ? [] : [shopId] })}>+ Sản phẩm</button></div>
      </div>
      <input placeholder="Tìm sản phẩm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm sản phẩm" />
      <Async state={state}>
        {({ data }) => !data.length ? <Empty>Chưa có sản phẩm. Bấm “+ Sản phẩm” để thêm.</Empty> : (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Sản phẩm</th><th>SKU</th>{has('feng_shui') && <th>Ngũ hành</th>}<th className="num">Giá bán</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={async () => { const full = await api.get(`/products/${p.id}`); setEdit({ ...full.data, variants: full.data.variants.map((v) => ({ ...v, components: (v.components || []).map((c) => ({ variant_id: c.component_variant_id, qty: c.qty, sku: c.sku, name: c.name })) })), consumption_days: full.data.consumption_days ?? '', shop_ids: (full.data.listings || []).map((l) => l.shop_id), _existing: true }); }}>
                <td><b>{p.name}</b><div className="small muted">{p.variant_count ?? p.variants?.length ?? ''} biến thể</div></td>
                <td className="small">{(p.variants || []).map((v) => v.sku).join(', ') || p.sku}{(p.variants || []).some((v) => v.kind === 'bundle') && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}</td>
                {has('feng_shui') && <td><div className="row wrap">{(p.elements || []).map((e) => <Element key={e} name={e} />)}</div></td>}
                <td className="num">{p.min_price !== undefined ? vnd(p.min_price) : (p.variants || []).length ? vnd(p.variants[0].price ?? p.variants[0].default_price) : ''}</td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
      {edit && <ProductForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} />}
      {sync && <SyncForm onClose={() => setSync(false)} onSaved={() => { setSync(false); state.reload(); }} />}
    </div>
  );
}

function ProductForm({ init, onClose, onSaved }) {
  const { shops, has, shopId } = useSession();
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const setV = (i, k, v) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const save = () => run(async () => {
    const payload = {
      name: f.name, unit: f.unit || 'cái', consumption_days: f.consumption_days ? Number(f.consumption_days) : null, elements: f.elements,
      variants: f.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), sku: v.sku, name: v.name || null, default_price: Number(v.default_price) || 0, min_stock: Number(v.min_stock) || 0, ...(v.kind === 'bundle' ? { kind: 'bundle', components: v.components.map((c) => ({ variant_id: c.variant_id, qty: Number(c.qty) })) } : {}) })),
    };
    if (f._existing) await api.patch(`/products/${f.id}`, payload);
    else await api.post('/products', { ...payload, shop_ids: f.shop_ids });
    onSaved();
  });
  return (
    <Modal title={f._existing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={save}>Lưu</button>}>
      <Field label="Tên sản phẩm"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <div className="grid cols-2">
        <Field label="Đơn vị"><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Chu kỳ dùng hết (ngày)" hint="Để nhắc khách mua lại"><input type="number" min="1" value={f.consumption_days} onChange={(e) => setF({ ...f, consumption_days: e.target.value })} /></Field>
      </div>
      {has('feng_shui') && <div><div className="small muted" style={{ marginBottom: 4 }}>Ngũ hành hợp (vật phẩm phong thuỷ)</div>
        <div className="row wrap">{ELEMENTS.map((e) => <label key={e} className="check"><input type="checkbox" checked={f.elements.includes(e)} onChange={() => setF({ ...f, elements: toggle(f.elements, e) })} />{e}</label>)}</div></div>}
      <h3>Biến thể</h3>
      {f.variants.map((v, i) => (
        <div key={i} className="grid cols-2" style={{ borderBottom: '1px solid var(--hairline)', paddingBottom: 10 }}>
          <Field label="SKU"><input value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value.toUpperCase())} /></Field>
          <Field label="Tên biến thể (mùi, size…)"><input value={v.name || ''} onChange={(e) => setV(i, 'name', e.target.value)} /></Field>
          <Field label="Giá bán mặc định"><input type="number" min="0" value={v.default_price} onChange={(e) => setV(i, 'default_price', e.target.value)} /></Field>
          {v.kind !== 'bundle' && <Field label="Tồn tối thiểu"><input type="number" min="0" value={v.min_stock} onChange={(e) => setV(i, 'min_stock', e.target.value)} /></Field>}
          <Field label="Loại" hint={v.id ? 'Không đổi loại được khi đã có lịch sử kho/đơn' : undefined}>
            <select value={v.kind === 'bundle' ? 'bundle' : 'single'} disabled={!!v.id} onChange={(e) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, kind: e.target.value, components: e.target.value === 'bundle' ? x.components || [] : [] } : x)) })}>
              <option value="single">Sản phẩm đơn</option><option value="bundle">Combo (gồm nhiều sản phẩm)</option>
            </select>
          </Field>
          {v.kind === 'bundle' && <div style={{ gridColumn: '1 / -1' }}><ComponentPicker value={v.components || []} selfId={v.id} onChange={(c) => setV(i, 'components', c)} /></div>}
        </div>
      ))}
      <button className="btn sm" onClick={() => setF({ ...f, variants: [...f.variants, { sku: '', name: '', default_price: 0, min_stock: 0 }] })}>+ Biến thể</button>
      {f._existing ? <CustomFieldsPanel bare entity="product" id={f.id} shopId={shopId === 'all' ? undefined : shopId} /> : <p className="small muted" style={{ margin: 0 }}>Lưu sản phẩm xong, mở lại để nhập các trường tuỳ chỉnh (nếu có).</p>}
      {!f._existing && <div><div className="small muted" style={{ marginBottom: 4 }}>Bán ở shop</div><div className="row wrap">{shops.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={f.shop_ids.includes(s.id)} onChange={() => setF({ ...f, shop_ids: toggle(f.shop_ids, s.id) })} />{s.name}</label>)}</div></div>}
      <ErrorBox error={error} />
    </Modal>
  );
}

function SyncForm({ onClose, onSaved }) {
  const { shops, shopId } = useSession();
  const [from, setFrom] = useState(shops.find((s) => s.id !== shopId)?.id);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <Modal title="Đồng bộ sản phẩm" onClose={onClose} footer={result ? <button className="btn primary" onClick={onSaved}>Xong</button> : <button className="btn primary" disabled={busy} onClick={() => run(async () => setResult((await api.post('/listings/sync', { from_shop_id: from, to_shop_id: shopId, overwrite_price: overwrite })).data))}>Đồng bộ</button>}>
      <p className="muted small">Sao chép niêm yết và giá của <b>toàn bộ</b> sản phẩm từ shop nguồn sang shop đang chọn. Thông tin sản phẩm dùng chung nên không bị nhân đôi.</p>
      <Field label="Lấy từ shop"><select value={from} onChange={(e) => setFrom(e.target.value)}>{shops.filter((s) => s.id !== shopId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />Ghi đè giá đã có</label>
      {result && <div className="alert ok">Thêm mới {result.created} · cập nhật giá {result.updated} · bỏ qua {result.skipped}</div>}
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Chọn các sản phẩm thành phần của combo. Combo không có tồn riêng: bán combo trừ kho từng thành phần. */
function ComponentPicker({ value, onChange, selfId }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const found = useAsync(() => (dq ? api.get('/variants', { q: dq, all: '1', limit: 8 }) : Promise.resolve({ data: [] })), [dq]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow">Thành phần của combo</div>
      {value.length === 0 && <span className="small muted">Chưa có thành phần nào. Tìm sản phẩm bên dưới để thêm.</span>}
      {value.map((c) => (
        <div className="row" key={c.variant_id}>
          <span className="grow">{c.name || c.sku} <span className="small muted">{c.sku}</span></span>
          <span className="small muted">SL mỗi combo</span>
          <input type="number" min="1" value={c.qty} onChange={(e) => onChange(value.map((x) => (x.variant_id === c.variant_id ? { ...x, qty: e.target.value } : x)))} style={{ width: 80 }} aria-label={`Số lượng ${c.sku}`} />
          <button type="button" className="btn sm" aria-label={`Bỏ ${c.sku}`} onClick={() => onChange(value.filter((x) => x.variant_id !== c.variant_id))}>✕</button>
        </div>
      ))}
      <input placeholder="Tìm sản phẩm để thêm vào combo…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm thành phần" />
      {found.data?.data?.filter((v) => v.kind !== 'bundle' && v.id !== selfId && !value.some((c) => c.variant_id === v.id)).map((v) => (
        <div key={v.id} className="pick" onClick={() => { onChange([...value, { variant_id: v.id, qty: 1, sku: v.sku, name: [v.product_name, v.variant_name].filter(Boolean).join(' — ') }]); setQ(''); }}>
          {v.product_name}{v.variant_name ? ` — ${v.variant_name}` : ''} <span className="small muted">{v.sku}</span>
        </div>
      ))}
    </div>
  );
}
