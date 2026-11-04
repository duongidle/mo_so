import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Field, Modal, useAction, useAsync, useDebounced } from '../../components/ui.jsx';
import ImageGallery from '../../components/ImageGallery.jsx';
import { vnd, num } from '../../lib.js';
import { flattenTree, indent } from '../../lib/categories.js';

/** Giá vốn ước tính (Σ SL × giá vốn bình quân) và số combo bán được (min theo thành phần) */
export function comboStats(components) {
  const known = components.filter((c) => c.avg_cost !== undefined);
  const cost = known.reduce((a, c) => a + (Number(c.qty) || 0) * (c.avg_cost || 0), 0);
  const sellable = components.length && known.length === components.length
    ? Math.min(...components.map((c) => Math.floor(Math.max(0, c.on_hand || 0) / (Number(c.qty) || 1))))
    : null;
  return { cost, sellable, complete: known.length === components.length };
}

export function initialCombo(p, shopId, isAll) {
  if (!p) return { name: '', sku: '', default_price: '', category_id: '', images: [], shop_ids: isAll ? [] : [shopId], components: [] };
  const v = p.variants.find((x) => x.kind === 'bundle') || p.variants[0];
  return {
    id: p.id, variantId: v.id, existing: true, name: p.name, sku: v.sku, default_price: v.default_price, category_id: p.category_id || '',
    images: (p.images || []).map((i) => ({ id: i.id, url: i.url })), shop_ids: [],
    components: (v.components || []).map((c) => ({ variant_id: c.component_variant_id, qty: c.qty, sku: c.sku, name: c.name })),
  };
}

export default function ComboForm({ init, onClose, onSaved }) {
  const { shops, shopId, isAll } = useSession();
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const cats = useAsync(() => api.get('/categories'), []);
  const catList = useMemo(() => flattenTree(cats.data?.data || []), [cats.data]);
  const wh = shops.find((s) => s.id === shopId)?.default_warehouse_id ?? shops[0]?.default_warehouse_id;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const stats = comboStats(f.components);

  // Thành phần của combo đã lưu chưa có giá vốn/tồn: tra lại một lần
  const missing = f.components.filter((c) => c.avg_cost === undefined).map((c) => c.sku).join(',');
  useEffect(() => {
    if (!missing) return;
    let off = false;
    Promise.all(missing.split(',').map((sku) => api.get('/variants', { q: sku, all: '1', warehouse_id: wh, limit: 5 }))).then((rs) => {
      if (off) return;
      const by = new Map(rs.flatMap((r) => r.data).map((v) => [v.id, v]));
      setF((x) => ({ ...x, components: x.components.map((c) => (c.avg_cost === undefined && by.get(c.variant_id) ? { ...c, avg_cost: by.get(c.variant_id).avg_cost, on_hand: by.get(c.variant_id).on_hand } : c)) }));
    }).catch(() => {});
    return () => { off = true; };
  }, [missing, wh]);

  const save = () => run(async () => {
    const components = f.components.map((c) => ({ variant_id: c.variant_id, qty: Number(c.qty) }));
    const common = { name: f.name.trim(), category_id: f.category_id || null, images: f.images.map(({ id }) => ({ id })) };
    if (f.existing) {
      await api.patch(`/products/${f.id}`, { ...common, variants: [{ id: f.variantId, sku: f.sku, default_price: Number(f.default_price) || 0, components }] });
    } else {
      await api.post('/products', { ...common, unit: 'combo', variants: [{ sku: f.sku, kind: 'bundle', default_price: Number(f.default_price) || 0, components }], shop_ids: f.shop_ids });
    }
    onSaved();
  });

  return (
    <Modal wide title={f.existing ? 'Sửa combo' : 'Thêm combo'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name.trim() || !f.sku.trim() || !f.components.length} onClick={save}>Lưu</button>}>
      <Field label="Tên combo"><input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
      <div className="grid cols-2">
        <Field label="SKU"><input value={f.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} /></Field>
        <Field label="Giá bán"><input type="number" min="0" value={f.default_price} onChange={(e) => set({ default_price: e.target.value })} /></Field>
        <Field label="Danh mục">
          <select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}>
            <option value="">Chưa phân loại</option>
            {catList.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}
          </select>
        </Field>
      </div>
      <div><div className="small muted" style={{ marginBottom: 6 }}>Ảnh combo</div><ImageGallery images={f.images} onChange={(images) => set({ images })} max={5} /></div>
      <ComponentPicker value={f.components} warehouseId={wh} selfId={f.variantId} onChange={(components) => set({ components })} />
      {f.components.length > 0 && (
        <div className="ledger-line"><span className="muted">Giá vốn ước tính</span><b>{stats.complete ? vnd(stats.cost) : '…'}</b></div>
      )}
      {f.components.length > 0 && (
        <div className="ledger-line"><span className="muted">Bán được ngay</span><b>{stats.sellable === null ? '…' : `${num(stats.sellable)} combo`}</b></div>
      )}
      {f.components.length > 0 && stats.complete && Number(f.default_price) > 0 && (
        <div className="ledger-line"><span className="muted">Lãi gộp ước tính mỗi combo</span><b>{vnd(Number(f.default_price) - stats.cost)}</b></div>
      )}
      {!f.existing && <div><div className="small muted" style={{ marginBottom: 4 }}>Bán ở shop</div><div className="row wrap">{shops.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={f.shop_ids.includes(s.id)} onChange={() => set({ shop_ids: f.shop_ids.includes(s.id) ? f.shop_ids.filter((x) => x !== s.id) : [...f.shop_ids, s.id] })} />{s.name}</label>)}</div></div>}
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Chọn các sản phẩm thành phần của combo. Combo không có tồn riêng: bán combo trừ kho từng thành phần. */
export function ComponentPicker({ value, onChange, selfId, warehouseId }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const found = useAsync(() => (dq ? api.get('/variants', { q: dq, all: '1', warehouse_id: warehouseId, limit: 8 }) : Promise.resolve({ data: [] })), [dq, warehouseId]);
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
        <div key={v.id} className="pick" onClick={() => { onChange([...value, { variant_id: v.id, qty: 1, sku: v.sku, name: [v.product_name, v.variant_name].filter(Boolean).join(' — '), avg_cost: v.avg_cost, on_hand: v.on_hand }]); setQ(''); }}>
          {v.product_name}{v.variant_name ? ` — ${v.variant_name}` : ''} <span className="small muted">{v.sku}</span>
        </div>
      ))}
    </div>
  );
}
