import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Async, Card, Chips, Empty, ErrorBox, Field, Modal, PageHeader, SearchBox, Tabs, Toolbar, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd, num } from '../lib.js';
import { Element } from '../components/Motif.jsx';
import ProductThumb from '../components/ProductThumb.jsx';
import ProductImport from '../components/ProductImport.jsx';
import Categories from './products/Categories.jsx';
import { flattenTree, indent } from '../lib/categories.js';

export default function Products() {
  const { shopId, shops, isAll, has } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [notice, setNotice] = useState(loc.state?.notice || '');
  const [tab, setTab] = useState('products');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState('');
  const [itemType, setItemType] = useState('');
  const [cat, setCat] = useState('');
  const [sync, setSync] = useState(false);
  const [importing, setImporting] = useState(false);
  const cats = useAsync(() => api.get('/categories'), []);
  const catList = useMemo(() => flattenTree(cats.data?.data || []), [cats.data]);
  const catName = useMemo(() => Object.fromEntries(catList.map((c) => [c.id, c.name])), [catList]);
  const archivedTab = tab === 'archived';
  const unlistedOnly = type === 'unlisted'; // sản phẩm chưa gắn vào shop nào: không hiện khi lọc theo shop nên cần chip riêng
  const state = useAsync(() => api.get('/products', { shop_id: isAll || itemType || archivedTab || unlistedOnly ? undefined : shopId, unlisted: unlistedOnly ? 'only' : itemType || archivedTab ? '1' : undefined, archived: archivedTab ? 'only' : undefined, q: dq || undefined, type: unlistedOnly ? undefined : type || undefined, item_type: itemType || undefined, category_id: cat || undefined, limit: 200 }), [shopId, dq, type, itemType, cat, tab]);
  const fengShui = has('feng_shui') && !isAll;

  return (
    <div className="page stack">
      <PageHeader
        title="Sản phẩm"
        actions={<>
          {!isAll && shops.length > 1 && <button className="btn" onClick={() => setSync(true)}>Đồng bộ từ shop khác</button>}
          <button className="btn" onClick={() => setImporting(true)}>Nhập từ Excel</button>
          <Link to="/products/combo/new" className="btn">+ Combo</Link>
          <Link to="/products/new" className="btn primary">+ Thêm mặt hàng</Link>
        </>}
      />
      <Toolbar>
        <Tabs options={[['products', 'Sản phẩm'], ['archived', 'Đã ngừng kinh doanh'], ['categories', 'Danh mục']]} value={tab} onChange={setTab} />
        {tab !== 'categories' && <>
          <Chips options={[['', 'Hàng bán'], ['single', 'Đơn lẻ'], ['combo', 'Combo'], ['service', 'Dịch vụ'], ['packaging', 'Đóng gói'], ['supply', 'Vận hành'], ['unlisted', 'Chưa gắn shop']]} value={itemType || type} onChange={(v) => { const material = v === 'packaging' || v === 'supply' || v === 'service'; setItemType(material ? v : ''); setType(material ? '' : v); }} />
          <SearchBox value={q} onChange={setQ} placeholder="Tìm tên, SKU, mã vạch…" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Danh mục">
            <option value="">Mọi danh mục</option>{catList.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}
          </select>
        </>}
      </Toolbar>
      {notice && <div className="alert ok small" role="status">{notice}</div>}
      {tab === 'categories' ? <Categories onChanged={cats.reload} /> : (
        <Async state={state}>
          {({ data }) => !data.length ? <Empty>{archivedTab ? 'Chưa có sản phẩm nào ngừng kinh doanh.' : q || type || cat ? 'Không có sản phẩm khớp bộ lọc.' : 'Chưa có sản phẩm. Nhấn “+ Sản phẩm” để thêm.'}</Empty> : (
            <Card flat className="list-card sticky-head"><div className="table-wrap"><table className="stackable product-table">
              <thead><tr><th>Sản phẩm</th><th className="hide-sm num">Biến thể</th><th className="num">Giá bán</th><th className="num">Tồn</th>{fengShui && <th className="hide-sm">Ngũ hành</th>}<th className="hide-sm">Trạng thái</th></tr></thead>
              <tbody>{data.map((p) => {
                const img = p.image_url || p.variants.find((v) => v.image_url)?.image_url;
                const live = p.variants.filter((v) => !v.archived_at);
                const sellType = p.item_type === 'product' || p.item_type === 'service';
                const prices = sellType ? live.map((v) => v.listings.find((l) => l.shop_id === shopId)?.price ?? v.default_price) : [];
                const isCombo = p.variants.some((v) => v.kind === 'bundle');
                const selling = sellType && (!isAll ? live.some((v) => v.listings.some((l) => l.shop_id === shopId && l.active !== 0 && l.active !== false)) : live.length > 0);
                const low = p.low_stock_count > 0;
                return (
                  <tr key={p.id} className="click" tabIndex={0} onClick={() => nav(`/products/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/products/${p.id}`)}>
                    <td className="pcell"><div className="row" style={{ gap: 12 }}><ProductThumb src={img} name={p.name} size={40} /><div className="grow"><b>{p.name}</b>{p.item_type !== 'product' && <span className="badge plain" style={{ marginLeft: 8 }}>{p.item_type === 'service' ? 'Dịch vụ' : p.item_type === 'packaging' ? 'Đóng gói' : 'Vận hành'}</span>}{isCombo && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}<span className="sub">{[p.category_id && catName[p.category_id], live.slice(0, 2).map((v) => v.sku).join(', ') + (live.length > 2 ? '…' : '')].filter(Boolean).join(' · ')}</span></div></div></td>
                    <td className="hide-sm num">{live.length}</td>
                    <td className="num">{!sellType ? <span className="muted">—</span> : prices.length ? (Math.min(...prices) === Math.max(...prices) ? vnd(prices[0]) : `${vnd(Math.min(...prices))} – ${vnd(Math.max(...prices))}`) : ''}</td>
                    <td className={`num${low ? ' h-red' : ''}`}>{isCombo || p.stock_total === null || p.stock_total === undefined ? <span className="muted">—</span> : <b>{num(p.stock_total)}</b>}{low && <span className="sub h-red">dưới tối thiểu</span>}</td>
                    {fengShui && <td className="hide-sm"><div className="row wrap">{(p.elements || []).map((e) => <Element key={e} name={e} />)}</div></td>}
                    <td className={archivedTab ? '' : 'hide-sm'}>{archivedTab ? <button type="button" className="btn sm" onClick={async (e) => { e.stopPropagation(); await api.post(`/products/${p.id}/restore`); setNotice(`Đã khôi phục ${p.name}.`); state.reload(); }}>Khôi phục</button> : !sellType ? <span className="badge plain">Vật tư kho</span> : selling ? <span className="badge st-completed">Đang bán</span> : <span className="badge plain">Ngừng bán</span>}</td>
                  </tr>);
              })}</tbody>
            </table></div></Card>
          )}
        </Async>
      )}
      {importing && <ProductImport onClose={() => setImporting(false)} onDone={() => { setImporting(false); state.reload(); cats.reload(); }} />}
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
