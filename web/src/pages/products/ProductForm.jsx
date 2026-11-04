import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Field, Modal, useAction, useAsync } from '../../components/ui.jsx';
import ImageGallery from '../../components/ImageGallery.jsx';
import ProductThumb from '../../components/ProductThumb.jsx';
import FieldInput from '../../components/FieldInput.jsx';
import { applyToAll, cleanOptions, mergeRows, rebaseSkus, skuBase } from '../../lib/matrix.js';
import { flattenTree, indent } from '../../lib/categories.js';

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const blankRow = () => ({ sku: '', default_price: 0, opening_cost: '', opening_qty: '', barcode: '', min_stock: 0, active: true, option_values: {}, image_id: null });

/** Dữ liệu ban đầu của form từ một sản phẩm đã có (GET /products/:id) hoặc sản phẩm trống */
export function initialForm(p, shopId, isAll) {
  if (!p) return { name: '', category_id: '', brand: '', unit: 'cái', description: '', consumption_days: '', images: [], shop_ids: isAll ? [] : [shopId], mode: 'single', options: [{ name: '', values: [] }], rows: [blankRow()], removed: [], opening_warehouse_id: '', custom: {} };
  const hasOptions = (p.options || []).length > 0;
  // Ma trận: chỉ các biến thể còn khớp thuộc tính hiện tại (biến thể đã lưu trữ do bỏ giá trị không hiện lại)
  const live = hasOptions ? p.variants.filter((v) => p.options.every((o) => o.values.includes(v.option_values?.[o.name]))) : p.variants;
  return {
    id: p.id, existing: true, name: p.name, category_id: p.category_id || '', brand: p.brand || '', unit: p.unit || 'cái', description: p.description || '',
    consumption_days: p.consumption_days ?? '', images: (p.images || []).map((i) => ({ id: i.id, url: i.url })),
    shop_ids: [...new Set(p.variants.flatMap((v) => (v.listings || []).map((l) => l.shop_id)))],
    mode: hasOptions ? 'matrix' : p.variants.length > 1 ? 'list' : 'single',
    options: hasOptions ? p.options : [{ name: '', values: [] }],
    rows: live.map((v) => ({ id: v.id, sku: v.sku, name: v.name || '', default_price: v.default_price, min_stock: v.min_stock, barcode: v.barcode || '', option_values: v.option_values || {}, image_id: v.image_id || null, active: !v.archived_at, kind: v.kind })),
    removed: [], opening_warehouse_id: '', custom: {},
  };
}

/** Dựng nội dung gửi lên API từ form. Tách riêng để test. */
export function buildPayload(f, { customShopId } = {}) {
  const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  const variant = (r) => ({
    ...(r.id ? { id: r.id } : {}),
    sku: r.sku,
    ...(f.mode === 'list' ? { name: r.name || null } : {}),
    barcode: r.barcode || null,
    default_price: Number(r.default_price) || 0,
    min_stock: Number(r.min_stock) || 0,
    ...(f.mode === 'matrix' ? { option_values: r.option_values, image_id: r.image_id || null, active: r.active !== false } : {}),
    ...(!r.id && num(r.opening_qty) > 0 ? { opening_qty: num(r.opening_qty), opening_cost: num(r.opening_cost) ?? 0 } : {}),
  });
  const rows = f.mode === 'single' ? f.rows.slice(0, 1) : f.rows;
  const payload = {
    name: f.name.trim(), unit: f.unit || 'cái', category_id: f.category_id || null, brand: f.brand || null, description: f.description || null,
    consumption_days: f.consumption_days ? Number(f.consumption_days) : null,
    images: f.images.map(({ id }) => ({ id })),
    variants: [...rows.map(variant), ...f.removed.filter((r) => r.id).map((r) => ({ id: r.id, remove: true }))],
    ...(f.mode === 'matrix' ? { options: cleanOptions(f.options) } : {}),
  };
  if (f.opening_warehouse_id) payload.opening_warehouse_id = f.opening_warehouse_id;
  if (Object.keys(f.custom).length) (payload.custom = f.custom, (payload.custom_shop_id = customShopId));
  if (!f.existing) payload.shop_ids = f.shop_ids;
  return payload;
}

export default function ProductForm({ init, onClose, onSaved }) {
  const { shops, shopId, isAll, warehouses } = useSession();
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const cats = useAsync(() => api.get('/categories'), []);
  const catList = useMemo(() => flattenTree(cats.data?.data || []), [cats.data]);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const fieldShop = !isAll ? shopId : f.shop_ids[0];
  const base = useMemo(() => skuBase(f.name), [f.name]);

  // Mã SKU tự sinh đi theo tên sản phẩm cho đến khi người dùng sửa tay
  useEffect(() => {
    if (f.mode === 'matrix') setF((x) => ({ ...x, rows: rebaseSkus(x.rows, x.options, skuBase(x.name)) }));
    else if (!f.existing) setF((x) => (x.rows[0].skuEdited ? x : { ...x, rows: [{ ...x.rows[0], sku: skuBase(x.name) }] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const setOptions = (options) => {
    const merged = mergeRows(f.rows, options, { base });
    set({ options, rows: merged.rows, removed: [...f.removed.filter((r) => !merged.rows.some((n) => n.id === r.id)), ...merged.removed].filter((r, i, a) => a.findIndex((x) => x.id === r.id && x.sku === r.sku) === i) });
  };
  const switchMode = (matrix) => {
    if (matrix) {
      const options = f.options.some((o) => o.name && o.values.length) ? f.options : [{ name: 'Mùi', values: [] }];
      set({ mode: 'matrix', options, rows: [], removed: f.rows.filter((r) => r.id) });
    } else set({ mode: 'single', rows: [{ ...blankRow(), sku: base }], removed: [] });
  };
  const setRow = (i, patch) => set({ rows: f.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const hasWarehouseChoice = warehouses.length > 1;
  const needsWarehouse = !f.existing || f.rows.some((r) => !r.id);

  const save = () => run(async () => {
    const payload = buildPayload(f, { customShopId: fieldShop });
    if (f.existing) await api.patch(`/products/${f.id}`, payload);
    else await api.post('/products', payload);
    onSaved();
  });

  return (
    <Modal wide title={f.existing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>Lưu</button>}>
      <Field label="Tên sản phẩm"><input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
      <div className="grid cols-2">
        <Field label="Danh mục">
          <select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}>
            <option value="">Chưa phân loại</option>
            {catList.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}
          </select>
        </Field>
        <Field label="Thương hiệu"><input value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
        <Field label="Đơn vị"><input value={f.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>
        <Field label="Chu kỳ dùng hết (ngày)" hint="Để nhắc khách mua lại"><input type="number" min="1" value={f.consumption_days} onChange={(e) => set({ consumption_days: e.target.value })} /></Field>
      </div>
      <Field label="Mô tả"><textarea rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div><div className="small muted" style={{ marginBottom: 6 }}>Ảnh sản phẩm</div><ImageGallery images={f.images} onChange={(images) => set({ images })} /></div>
      <ProductFields productId={f.id} shopId={fieldShop} value={f.custom} onChange={(custom) => set({ custom })} />

      {!f.existing && (
        <label className="check"><input type="checkbox" checked={f.mode === 'matrix'} onChange={(e) => switchMode(e.target.checked)} />Có biến thể (mùi, size, màu…)</label>
      )}

      {f.mode === 'single' && f.rows[0] && (
        <div className="grid cols-2">
          <Field label="SKU"><input value={f.rows[0].sku} onChange={(e) => setRow(0, { sku: e.target.value.toUpperCase(), skuEdited: true })} /></Field>
          <Field label="Mã vạch"><input value={f.rows[0].barcode} onChange={(e) => setRow(0, { barcode: e.target.value })} /></Field>
          <Field label="Giá bán"><input type="number" min="0" value={f.rows[0].default_price} onChange={(e) => setRow(0, { default_price: e.target.value })} /></Field>
          <Field label="Tồn tối thiểu"><input type="number" min="0" value={f.rows[0].min_stock} onChange={(e) => setRow(0, { min_stock: e.target.value })} /></Field>
          {!f.rows[0].id && <>
            <Field label="Giá vốn"><input type="number" min="0" value={f.rows[0].opening_cost} onChange={(e) => setRow(0, { opening_cost: e.target.value })} /></Field>
            <Field label="Tồn đầu kỳ"><input type="number" min="0" value={f.rows[0].opening_qty} onChange={(e) => setRow(0, { opening_qty: e.target.value })} /></Field>
          </>}
        </div>
      )}

      {f.mode === 'list' && (
        <div className="stack">
          <h3>Biến thể</h3>
          {f.rows.map((r, i) => (
            <div key={r.id || i} className="grid cols-2" style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 10 }}>
              <Field label="SKU"><input value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value.toUpperCase() })} /></Field>
              <Field label="Tên biến thể"><input value={r.name || ''} onChange={(e) => setRow(i, { name: e.target.value })} /></Field>
              <Field label="Giá bán"><input type="number" min="0" value={r.default_price} onChange={(e) => setRow(i, { default_price: e.target.value })} /></Field>
              <Field label="Tồn tối thiểu"><input type="number" min="0" value={r.min_stock} onChange={(e) => setRow(i, { min_stock: e.target.value })} /></Field>
              {!r.id && <>
                <Field label="Giá vốn"><input type="number" min="0" value={r.opening_cost} onChange={(e) => setRow(i, { opening_cost: e.target.value })} /></Field>
                <Field label="Tồn đầu kỳ"><input type="number" min="0" value={r.opening_qty} onChange={(e) => setRow(i, { opening_qty: e.target.value })} /></Field>
              </>}
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => set({ rows: [...f.rows, blankRow()] })}>+ Biến thể</button>
        </div>
      )}

      {f.mode === 'matrix' && <Matrix f={f} set={set} setOptions={setOptions} setRow={setRow} images={f.images} existing={f.existing} />}

      {needsWarehouse && hasWarehouseChoice && f.rows.some((r) => !r.id && Number(r.opening_qty) > 0) && (
        <Field label="Kho nhập tồn đầu kỳ">
          <select value={f.opening_warehouse_id} onChange={(e) => set({ opening_warehouse_id: e.target.value })}>
            <option value="">Kho mặc định của shop</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      )}
      {!f.existing && <div><div className="small muted" style={{ marginBottom: 4 }}>Bán ở shop</div><div className="row wrap">{shops.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={f.shop_ids.includes(s.id)} onChange={() => set({ shop_ids: toggle(f.shop_ids, s.id) })} />{s.name}</label>)}</div></div>}
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Trường thông tin sản phẩm của shop (vd Ngũ hành hợp của shop phong thuỷ). Chỉ gửi các trường đã đổi. */
function ProductFields({ productId, shopId, value, onChange }) {
  const state = useAsync(async () => {
    if (!shopId) return { fields: [], values: {} };
    const [fl, vl] = await Promise.all([
      api.get('/custom/fields', { entity_type: 'product', shop_id: shopId }),
      productId ? api.get(`/custom/values/product/${productId}`, { shop_id: shopId }) : Promise.resolve({ data: {} }),
    ]);
    return { fields: fl.data.filter((x) => x.type !== 'formula'), values: vl.data };
  }, [productId, shopId]);
  if (!state.data?.fields.length) return null;
  const { fields, values } = state.data;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {fields.map((fd) => {
        const cur = fd.key in value ? value[fd.key] : values[fd.key];
        return <Field key={fd.id} label={fd.type === 'boolean' ? '' : fd.label}><FieldInput field={fd} value={cur} onChange={(v) => onChange({ ...value, [fd.key]: v })} /></Field>;
      })}
    </div>
  );
}

function TagInput({ values, onChange, label }) {
  const [text, setText] = useState('');
  const commit = () => {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...values, ...parts.filter((p) => !values.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setText('');
  };
  return (
    <div className="tag-input">
      {values.map((v) => <span key={v} className="tag">{v}<button type="button" aria-label={`Bỏ ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>✕</button></span>)}
      <input value={text} aria-label={label} placeholder={values.length ? '' : 'Nhập giá trị rồi bấm Enter'} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)); }} />
    </div>
  );
}

function Matrix({ f, set, setOptions, setRow, images, existing }) {
  const [all, setAll] = useState({ default_price: '', opening_cost: '', opening_qty: '' });
  const upd = (i, patch) => setOptions(f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  // Sản phẩm đã có: không đổi tên/số thuộc tính (các biến thể cũ sẽ mất đúng tổ hợp), chỉ thêm/bớt giá trị
  const lockedStructure = existing && f.rows.some((r) => r.id);
  return (
    <div className="stack">
      <h3>Thuộc tính</h3>
      {f.options.map((o, i) => (
        <div key={i} className="grid cols-2" style={{ alignItems: 'end' }}>
          <Field label={`Thuộc tính ${i + 1}`}><input value={o.name} disabled={lockedStructure} placeholder="Mùi, Size, Màu…" onChange={(e) => upd(i, { name: e.target.value })} /></Field>
          <Field label="Giá trị"><TagInput values={o.values} label={`Giá trị của ${o.name || 'thuộc tính'}`} onChange={(values) => upd(i, { values })} /></Field>
        </div>
      ))}
      {!lockedStructure && f.options.length < 3 && <button type="button" className="btn sm" onClick={() => set({ options: [...f.options, { name: '', values: [] }] })}>+ Thuộc tính</button>}
      {f.removed.length > 0 && <div className="alert">Bỏ giá trị sẽ ngừng bán {f.removed.length} biến thể: có lịch sử kho/đơn thì lưu trữ, chưa dùng thì xoá hẳn.</div>}
      {f.rows.length === 0 && <span className="small muted">Nhập ít nhất một thuộc tính và một giá trị để sinh bảng biến thể.</span>}
      {f.rows.length > 0 && (
        <div className="table-wrap"><table className="matrix">
          <thead><tr><th>Ảnh</th><th>Biến thể</th><th>SKU</th><th className="num">Giá bán</th><th className="num">Giá vốn</th><th className="num">Tồn đầu kỳ</th><th>Mã vạch</th><th>Bán</th></tr></thead>
          <tbody>
            <tr className="apply-all">
              <td colSpan={3}><b>Áp dụng cho tất cả</b></td>
              <td><input type="number" min="0" aria-label="Giá bán cho tất cả" value={all.default_price} onChange={(e) => setAll({ ...all, default_price: e.target.value })} /></td>
              <td><input type="number" min="0" aria-label="Giá vốn cho tất cả" value={all.opening_cost} onChange={(e) => setAll({ ...all, opening_cost: e.target.value })} /></td>
              <td><input type="number" min="0" aria-label="Tồn đầu kỳ cho tất cả" value={all.opening_qty} onChange={(e) => setAll({ ...all, opening_qty: e.target.value })} /></td>
              <td colSpan={2}><button type="button" className="btn sm" onClick={() => {
                // Tồn đầu kỳ và giá vốn chỉ áp cho dòng mới (dòng đã có không ghi lại tồn đầu kỳ)
                const patch = { ...all };
                set({ rows: f.rows.map((r) => (r.id ? { ...r, ...(patch.default_price !== '' ? { default_price: patch.default_price } : {}) } : applyToAll([r], patch)[0])) });
              }}>Áp dụng</button></td>
            </tr>
            {f.rows.map((r, i) => (
              <tr key={r.id || r.sku + i} className={r.active === false ? 'off' : ''}>
                <td>
                  <select aria-label={`Ảnh của ${r.sku}`} value={r.image_id || ''} onChange={(e) => setRow(i, { image_id: e.target.value || null })} style={{ minWidth: 70 }} disabled={!images.length}>
                    <option value="">—</option>{images.map((im, n) => <option key={im.id} value={im.id}>Ảnh {n + 1}</option>)}
                  </select>
                  <ProductThumb src={images.find((im) => im.id === r.image_id)?.url} name={r.sku} size={28} />
                </td>
                <td>{Object.values(r.option_values).join(' / ')}</td>
                <td><input className="sku" aria-label={`SKU ${Object.values(r.option_values).join(' ')}`} value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value.toUpperCase(), autoSku: false })} /></td>
                <td><input type="number" min="0" aria-label={`Giá bán ${r.sku}`} value={r.default_price} onChange={(e) => setRow(i, { default_price: e.target.value })} /></td>
                <td>{r.id ? <span className="muted small">đã có</span> : <input type="number" min="0" aria-label={`Giá vốn ${r.sku}`} value={r.opening_cost} onChange={(e) => setRow(i, { opening_cost: e.target.value })} />}</td>
                <td>{r.id ? <span className="muted small">đã có</span> : <input type="number" min="0" aria-label={`Tồn đầu kỳ ${r.sku}`} value={r.opening_qty} onChange={(e) => setRow(i, { opening_qty: e.target.value })} />}</td>
                <td><input aria-label={`Mã vạch ${r.sku}`} value={r.barcode} onChange={(e) => setRow(i, { barcode: e.target.value })} /></td>
                <td><label className="check"><input type="checkbox" checked={r.active !== false} onChange={(e) => setRow(i, { active: e.target.checked })} aria-label={`Đang bán ${r.sku}`} /></label></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
