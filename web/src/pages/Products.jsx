import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Empty, ErrorBox, Field, Modal, Tabs, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd } from '../lib.js';
import { Element } from '../components/Motif.jsx';
import ProductThumb from '../components/ProductThumb.jsx';
import ProductForm, { initialForm } from './products/ProductForm.jsx';
import ComboForm, { initialCombo } from './products/ComboForm.jsx';
import Categories from './products/Categories.jsx';
import { flattenTree, indent } from '../lib/categories.js';

export default function Products() {
  const { shopId, shops, isAll, has } = useSession();
  const [tab, setTab] = useState('products');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [combo, setCombo] = useState(null);
  const [sync, setSync] = useState(false);
  const cats = useAsync(() => api.get('/categories'), []);
  const catList = useMemo(() => flattenTree(cats.data?.data || []), [cats.data]);
  const state = useAsync(() => api.get('/products', { shop_id: isAll ? undefined : shopId, q: dq || undefined, type: type || undefined, category_id: cat || undefined, limit: 200 }), [shopId, dq, type, cat]);

  const open = async (p) => {
    const full = (await api.get(`/products/${p.id}`)).data;
    if (full.variants.some((v) => v.kind === 'bundle')) setCombo(initialCombo(full, shopId, isAll));
    else setEdit(initialForm(full, shopId, isAll));
  };

  return (
    <div className="page stack">
      <div className="page-head"><h1>Sản phẩm</h1>
        <div className="row">{!isAll && shops.length > 1 && <button className="btn" onClick={() => setSync(true)}>Đồng bộ từ shop khác</button>}
          <button className="btn" onClick={() => setCombo(initialCombo(null, shopId, isAll))}>+ Combo</button>
          <button className="btn primary" onClick={() => setEdit(initialForm(null, shopId, isAll))}>+ Sản phẩm</button></div>
      </div>
      <Tabs options={[['products', 'Sản phẩm'], ['categories', 'Danh mục']]} value={tab} onChange={setTab} />
      {tab === 'categories' ? <Categories onChanged={cats.reload} /> : <>
        <div className="row wrap">
          <input placeholder="Tìm sản phẩm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm sản phẩm" className="grow" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Danh mục" style={{ width: 220 }}>
            <option value="">Mọi danh mục</option>{catList.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}
          </select>
        </div>
        <Chips options={[['', 'Tất cả'], ['single', 'Sản phẩm'], ['combo', 'Combo']]} value={type} onChange={setType} />
        <Async state={state}>
          {({ data }) => !data.length ? <Empty>{q || type || cat ? 'Không có sản phẩm khớp bộ lọc.' : 'Chưa có sản phẩm. Bấm “+ Sản phẩm” để thêm.'}</Empty> : (
            <Card flat><div className="table-wrap"><table>
              <thead><tr><th>Sản phẩm</th><th>SKU</th>{has('feng_shui') && !isAll && <th>Ngũ hành</th>}<th className="num">Giá bán</th></tr></thead>
              <tbody>{data.map((p) => {
                const img = p.image_url || p.variants.find((v) => v.image_url)?.image_url;
                const prices = p.variants.filter((v) => !v.archived_at).map((v) => v.listings.find((l) => l.shop_id === shopId)?.price ?? v.default_price);
                return (
                  <tr key={p.id} className="click" onClick={() => open(p)}>
                    <td><div className="row" style={{ gap: 10 }}><ProductThumb src={img} name={p.name} /><div><b>{p.name}</b><div className="small muted">{p.variants.length} biến thể</div></div></div></td>
                    <td className="small">{p.variants.slice(0, 3).map((v) => v.sku).join(', ')}{p.variants.length > 3 ? '…' : ''}{p.variants.some((v) => v.kind === 'bundle') && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}</td>
                    {has('feng_shui') && !isAll && <td><div className="row wrap">{(p.elements || []).map((e) => <Element key={e} name={e} />)}</div></td>}
                    <td className="num">{prices.length ? (Math.min(...prices) === Math.max(...prices) ? vnd(prices[0]) : `${vnd(Math.min(...prices))} – ${vnd(Math.max(...prices))}`) : ''}</td>
                  </tr>);
              })}</tbody>
            </table></div></Card>
          )}
        </Async>
      </>}
      {edit && <ProductForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} />}
      {combo && <ComboForm init={combo} onClose={() => setCombo(null)} onSaved={() => { setCombo(null); state.reload(); }} />}
      {sync && <SyncForm onClose={() => setSync(false)} onSaved={() => { setSync(false); state.reload(); }} />}
    </div>
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
