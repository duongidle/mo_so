import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd } from '../lib.js';

const ELEMENTS = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];
const blank = () => ({ name: '', unit: 'cái', consumption_days: '', elements: [], variants: [{ sku: '', name: '', default_price: 0, min_stock: 0 }], shop_ids: [] });

export default function Products() {
  const { shopId, shops, isAll } = useSession();
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
            <thead><tr><th>Sản phẩm</th><th>SKU</th><th>Ngũ hành</th><th className="num">Giá bán</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={async () => { const full = await api.get(`/products/${p.id}`); setEdit({ ...full.data, consumption_days: full.data.consumption_days ?? '', shop_ids: (full.data.listings || []).map((l) => l.shop_id), _existing: true }); }}>
                <td><b>{p.name}</b><div className="small muted">{p.variant_count ?? p.variants?.length ?? ''} biến thể</div></td>
                <td className="small">{(p.variants || []).map((v) => v.sku).join(', ') || p.sku}</td>
                <td className="small">{(p.elements || []).join(', ')}</td>
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
  const { shops } = useSession();
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const setV = (i, k, v) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const save = () => run(async () => {
    const payload = {
      name: f.name, unit: f.unit || 'cái', consumption_days: f.consumption_days ? Number(f.consumption_days) : null, elements: f.elements,
      variants: f.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), sku: v.sku, name: v.name || null, default_price: Number(v.default_price) || 0, min_stock: Number(v.min_stock) || 0 })),
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
      <div><div className="small muted" style={{ marginBottom: 4 }}>Ngũ hành hợp (vật phẩm phong thuỷ)</div>
        <div className="row wrap">{ELEMENTS.map((e) => <label key={e} className="check"><input type="checkbox" checked={f.elements.includes(e)} onChange={() => setF({ ...f, elements: toggle(f.elements, e) })} />{e}</label>)}</div></div>
      <h3>Biến thể</h3>
      {f.variants.map((v, i) => (
        <div key={i} className="grid cols-2" style={{ borderBottom: '1px solid var(--hairline)', paddingBottom: 10 }}>
          <Field label="SKU"><input value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value.toUpperCase())} /></Field>
          <Field label="Tên biến thể (mùi, size…)"><input value={v.name || ''} onChange={(e) => setV(i, 'name', e.target.value)} /></Field>
          <Field label="Giá bán mặc định"><input type="number" min="0" value={v.default_price} onChange={(e) => setV(i, 'default_price', e.target.value)} /></Field>
          <Field label="Tồn tối thiểu"><input type="number" min="0" value={v.min_stock} onChange={(e) => setV(i, 'min_stock', e.target.value)} /></Field>
        </div>
      ))}
      <button className="btn sm" onClick={() => setF({ ...f, variants: [...f.variants, { sku: '', name: '', default_price: 0, min_stock: 0 }] })}>+ Biến thể</button>
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
