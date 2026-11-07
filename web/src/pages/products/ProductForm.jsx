import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Field, Fold, Modal, Section, useAction, useAsync } from '../../components/ui.jsx';
import { useDirty } from '../../components/useDirty.js';
import FormPage from '../../components/FormPage.jsx';
import { RemoveProductButton } from '../../components/RemoveProduct.jsx';
import ImageGallery from '../../components/ImageGallery.jsx';
import ProductThumb from '../../components/ProductThumb.jsx';
import FieldInput from '../../components/FieldInput.jsx';
import { applyToAll, assignCombo, cleanOptions, comboChoices, effectiveRenames, hasDuplicateCombos, noteAttrRename, noteValueRename, rebaseSkus, reconcile, skuBase, combinations } from '../../lib/matrix.js';
import { flattenTree, indent } from '../../lib/categories.js';
import MoneyInput from '../../components/MoneyInput.jsx';

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const blankRow = () => ({ sku: '', default_price: 0, opening_cost: '', opening_qty: '', barcode: '', min_stock: 0, active: true, option_values: {}, image_id: null });

/** Dữ liệu ban đầu của form từ một sản phẩm đã có (GET /products/:id) hoặc sản phẩm trống */
export function initialForm(p, shopId, isAll) {
  if (!p) return { name: '', item_type: 'product', default_supplier_id: '', category_id: '', brand: '', unit: 'cái', description: '', consumption_days: '', images: [], shop_ids: isAll ? [] : [shopId], mode: 'single', options: [{ name: '', values: [] }], rows: [blankRow()], removed: [], opening_warehouse_id: '', custom: {}, renames: [] };
  const hasOptions = (p.options || []).length > 0;
  // Ma trận: chỉ các biến thể còn khớp thuộc tính hiện tại (biến thể đã lưu trữ do bỏ giá trị không hiện lại)
  const live = hasOptions ? p.variants.filter((v) => p.options.every((o) => o.values.includes(v.option_values?.[o.name]))) : p.variants;
  const form = {
    id: p.id, existing: true, name: p.name, item_type: p.item_type || 'product', default_supplier_id: p.default_supplier_id || '', category_id: p.category_id || '', brand: p.brand || '', unit: p.unit || 'cái', description: p.description || '',
    consumption_days: p.consumption_days ?? '', images: (p.images || []).map((i) => ({ id: i.id, url: i.url })),
    shop_ids: [...new Set(p.variants.flatMap((v) => (v.listings || []).map((l) => l.shop_id)))],
    mode: hasOptions ? 'matrix' : p.variants.length > 1 ? 'list' : 'single',
    options: hasOptions ? p.options : [{ name: '', values: [] }],
    rows: live.map((v) => ({ id: v.id, sku: v.sku, name: v.name || '', default_price: v.default_price, min_stock: v.min_stock, barcode: v.barcode || '', option_values: v.option_values || {}, image_id: v.image_id || null, active: !v.archived_at, kind: v.kind })),
    removed: [], opening_warehouse_id: '', custom: {}, renames: [],
  };
  // Bản gốc để quay lại khi bỏ tick "Có biến thể" (chỉ có nghĩa với sản phẩm chưa có thuộc tính)
  return { ...form, origMode: form.mode, origRows: form.rows, origOptions: form.options };
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
    name: f.name.trim(), item_type: f.item_type || 'product', default_supplier_id: f.default_supplier_id || null, unit: f.unit || 'cái', category_id: f.category_id || null, brand: f.brand || null, description: f.description || null,
    consumption_days: f.consumption_days ? Number(f.consumption_days) : null,
    images: f.images.map(({ id }) => ({ id })),
    variants: [...rows.map(variant), ...f.removed.filter((r) => r.id).map((r) => ({ id: r.id, remove: true }))],
    ...(f.mode === 'matrix' ? { options: cleanOptions(f.options) } : {}),
    ...(f.mode === 'matrix' && f.existing && effectiveRenames(f.renames).length ? { option_renames: effectiveRenames(f.renames) } : {}),
  };
  if (f.opening_warehouse_id) payload.opening_warehouse_id = f.opening_warehouse_id;
  if (Object.keys(f.custom).length) (payload.custom = f.custom, (payload.custom_shop_id = customShopId));
  if (!f.existing) payload.shop_ids = f.shop_ids;
  return payload;
}

export default function ProductForm({ init, onClose, onSaved, onDirty, onRemoved }) {
  const { shops, shopId, isAll, warehouses } = useSession();
  const [f, setF] = useState(init);
  useDirty(f, onDirty);
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState(null);
  const cats = useAsync(() => api.get('/categories'), []);
  const suppliers = useAsync(() => api.get('/suppliers'), []);
  const supplierRows = Array.isArray(suppliers.data?.data) ? suppliers.data.data : [];
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

  const ctx = { base };
  const apply = (options, rows, removedPool, extra = {}) => {
    const r = reconcile([...rows, ...removedPool], options, ctx);
    set({ options, rows: r.rows, removed: r.removed.filter((x) => x.id), ...extra });
  };
  const setOptions = (options) => apply(options, f.rows, f.removed);
  const renameAttr = (i, name) => {
    const old = f.options[i].name;
    const n = name.trim();
    if (!n || n === old || f.options.some((o, j) => j !== i && o.name.toLowerCase() === n.toLowerCase())) return;
    const re = (r) => ({ ...r, option_values: Object.fromEntries(Object.entries(r.option_values || {}).map(([k, v]) => [k === old ? n : k, v])) });
    apply(f.options.map((o, j) => (j === i ? { ...o, name: n } : o)), f.rows.map(re), f.removed.map(re), f.existing ? { renames: noteAttrRename(f.renames, old, n) } : {});
  };
  const renameValue = (i, oldV, newV) => {
    const n = newV.trim();
    const o = f.options[i];
    if (!n || n === oldV || o.values.some((v) => v.toLowerCase() === n.toLowerCase())) return;
    const re = (r) => (r.option_values?.[o.name] === oldV ? { ...r, option_values: { ...r.option_values, [o.name]: n } } : r);
    apply(f.options.map((x, j) => (j === i ? { ...x, values: x.values.map((v) => (v === oldV ? n : v)) } : x)), f.rows.map(re), f.removed.map(re), f.existing ? { renames: noteValueRename(f.renames, o.name, oldV, n) } : {});
  };
  const removeAttr = (i) => {
    const name = f.options[i].name;
    const strip = (r) => ({ ...r, option_values: Object.fromEntries(Object.entries(r.option_values || {}).filter(([k]) => k !== name)) });
    apply(f.options.filter((_, j) => j !== i), f.rows.map(strip), f.removed.map(strip));
  };
  const pickCombo = (i, ov) => {
    const r = assignCombo(f.rows, f.options, i, ov, ctx);
    set({ rows: r.rows, removed: [...f.removed, ...r.removed.filter((x) => x.id)] });
  };
  const switchMode = (matrix) => {
    if (!f.existing) {
      if (matrix) set({ mode: 'matrix', options: f.options.some((o) => o.name && o.values.length) ? f.options : [{ name: 'Mùi', values: [] }], rows: [], removed: [] });
      else set({ mode: 'single', rows: [{ ...blankRow(), sku: base }], removed: [] });
    } else if (matrix) {
      // Giữ nguyên các biến thể đang có: chúng sẽ được gán vào một tổ hợp khi nhập giá trị thuộc tính
      set({ mode: 'matrix', options: [{ name: 'Mùi', values: [] }], removed: [], renames: [] });
    } else set({ mode: f.origMode, rows: f.origRows, options: f.origOptions, removed: [], renames: [] });
  };
  const setRow = (i, patch) => set({ rows: f.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const hasWarehouseChoice = warehouses.length > 1;
  const needsWarehouse = !f.existing || f.rows.some((r) => !r.id);

  const send = async () => {
    const payload = buildPayload(f, { customShopId: fieldShop });
    if (f.existing) await api.patch(`/products/${f.id}`, payload);
    else await api.post('/products', payload);
    onDirty?.(false);
    onSaved();
  };
  const doSave = () => run(async () => { await send(); setConfirm(null); });
  // Biến thể sẽ ngừng bán khi lưu: bị bỏ khỏi ma trận, hoặc bỏ tick "đang bán". Hỏi lại trước khi ghi.
  const save = () => run(async () => {
    if (f.existing) {
      const wasActive = new Set((init.rows || []).filter((r) => r.id && r.active !== false).map((r) => r.id));
      const ids = [...new Set([...f.removed.filter((r) => r.id).map((r) => r.id), ...f.rows.filter((r) => r.id && r.active === false && wasActive.has(r.id)).map((r) => r.id)])];
      if (ids.length) {
        const pv = await api.post(`/products/${f.id}/removal-preview`, { variant_ids: ids });
        if (pv.data.length) { setConfirm(pv.data); return; }
      }
    }
    await send();
  });

  const matrix = f.mode === 'matrix';
  const canSave = !busy && f.name.trim() && !(matrix && (!combinations(f.options).length || hasDuplicateCombos(f.rows, f.options)));
  const single = f.mode === 'single' && f.rows[0];

  return (
    <FormPage
      title={f.existing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}
      sub={f.existing ? f.name : 'Điền tên và giá là đủ để bán. Phần còn lại có thể bổ sung sau.'}
      onBack={onClose}
      footer={<>{f.existing && f.id && <RemoveProductButton product={{ id: f.id, name: f.name }} onRemoved={(r) => { onDirty?.(false); (onRemoved || onClose)(r); }} />}<button type="button" className="btn" onClick={onClose}>Huỷ</button><button type="button" className="btn primary" disabled={!canSave} onClick={save}>Lưu</button></>}
      error={<ErrorBox error={error} />}
      side={<>
        <Section title="Ảnh"><ImageGallery images={f.images} onChange={(images) => set({ images })} /></Section>
        <Section title="Phân loại">
          <div className="stack">
            <Field label="Loại mặt hàng"><select value={f.item_type || 'product'} onChange={(e) => set({ item_type: e.target.value, ...(e.target.value === 'product' ? {} : { shop_ids: [] }) })}><option value="product">Hàng hóa bán</option><option value="packaging">Vật liệu đóng gói</option><option value="supply">Vật tư vận hành</option></select></Field>
            <Field label="Danh mục">
              <select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}>
                <option value="">Chưa phân loại</option>
                {catList.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}
              </select>
            </Field>
            <Field label="Thương hiệu"><input value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
            <Field label="Đơn vị"><input value={f.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>
            <Field label="Nhà cung cấp mặc định"><select value={f.default_supplier_id || ''} onChange={(e) => set({ default_supplier_id: e.target.value })}><option value="">Chưa chọn</option>{supplierRows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Fold title="Nhắc mua lại">
              <Field label="Chu kỳ dùng hết (ngày)" hint="Để nhắc khách mua lại"><input type="number" min="1" value={f.consumption_days} onChange={(e) => set({ consumption_days: e.target.value })} /></Field>
            </Fold>
          </div>
        </Section>
        {f.existing && f.item_type === 'product' && <PackagingSpec productId={f.id} />}
        {!f.existing && f.item_type === 'product' && (
          <Section title="Bán ở shop">
            <div className="stack" style={{ gap: 8 }}>{shops.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={f.shop_ids.includes(s.id)} onChange={() => set({ shop_ids: toggle(f.shop_ids, s.id) })} />{s.name}</label>)}</div>
          </Section>
        )}
        <ProductFields productId={f.id} shopId={fieldShop} value={f.custom} onChange={(custom) => set({ custom })} />
      </>}
    >
      <Section title="Thông tin cơ bản">
        <div className="stack">
          <Field label="Tên sản phẩm"><input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
          <Field label="Mô tả"><textarea rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
      </Section>

      {(f.mode === 'single' || f.mode === 'list') && (
        <Section title={f.mode === 'list' ? 'Biến thể' : 'Giá & kho'} actions={(!f.existing || f.origMode !== 'matrix') && (
          <label className="check small"><input type="checkbox" checked={false} onChange={(e) => switchMode(e.target.checked)} />Có biến thể (mùi, size, màu…)</label>
        )}>
          {single && (
            <div className="stack">
              <div className="grid cols-2 collapse">
                <Field label="SKU"><input value={f.rows[0].sku} onChange={(e) => setRow(0, { sku: e.target.value.toUpperCase(), skuEdited: true })} /></Field>
                <Field label="Giá bán"><MoneyInput value={f.rows[0].default_price} onChange={(e) => setRow(0, { default_price: e.target.value })} /></Field>
                {!f.rows[0].id && <>
                  <Field label="Giá vốn"><MoneyInput value={f.rows[0].opening_cost} onChange={(e) => setRow(0, { opening_cost: e.target.value })} /></Field>
                  <Field label="Tồn đầu kỳ"><input type="number" min="0" value={f.rows[0].opening_qty} onChange={(e) => setRow(0, { opening_qty: e.target.value })} /></Field>
                </>}
              </div>
              <Fold title="Thêm thông tin (mã vạch, tồn tối thiểu)">
                <div className="grid cols-2 collapse">
                  <Field label="Mã vạch"><input value={f.rows[0].barcode} onChange={(e) => setRow(0, { barcode: e.target.value })} /></Field>
                  <Field label="Tồn tối thiểu"><input type="number" min="0" value={f.rows[0].min_stock} onChange={(e) => setRow(0, { min_stock: e.target.value })} /></Field>
                </div>
              </Fold>
            </div>
          )}
          {f.mode === 'list' && (
            <div className="stack">
              {f.rows.map((r, i) => (
                <div key={r.id || i} className="grid cols-2 collapse" style={{ borderBottom: '1px solid var(--hair)', paddingBottom: 12 }}>
                  <Field label="SKU"><input value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Tên biến thể"><input value={r.name || ''} onChange={(e) => setRow(i, { name: e.target.value })} /></Field>
                  <Field label="Giá bán"><MoneyInput value={r.default_price} onChange={(e) => setRow(i, { default_price: e.target.value })} /></Field>
                  <Field label="Tồn tối thiểu"><input type="number" min="0" value={r.min_stock} onChange={(e) => setRow(i, { min_stock: e.target.value })} /></Field>
                  {!r.id && <>
                    <Field label="Giá vốn"><MoneyInput value={r.opening_cost} onChange={(e) => setRow(i, { opening_cost: e.target.value })} /></Field>
                    <Field label="Tồn đầu kỳ"><input type="number" min="0" value={r.opening_qty} onChange={(e) => setRow(i, { opening_qty: e.target.value })} /></Field>
                  </>}
                </div>
              ))}
              <div><button type="button" className="btn sm" onClick={() => set({ rows: [...f.rows, blankRow()] })}>+ Biến thể</button></div>
            </div>
          )}
        </Section>
      )}

      {matrix && (
        <Section title="Biến thể" actions={(!f.existing || f.origMode !== 'matrix') && (
          <label className="check small"><input type="checkbox" checked onChange={(e) => switchMode(e.target.checked)} />Có biến thể (mùi, size, màu…)</label>
        )}>
          <Matrix f={f} set={set} setOptions={setOptions} setRow={setRow} images={f.images} renameAttr={renameAttr} renameValue={renameValue} removeAttr={removeAttr} pickCombo={pickCombo} />
        </Section>
      )}

      {needsWarehouse && hasWarehouseChoice && f.rows.some((r) => !r.id && Number(r.opening_qty) > 0) && (
        <Section title="Kho nhập tồn đầu kỳ">
          <select value={f.opening_warehouse_id} onChange={(e) => set({ opening_warehouse_id: e.target.value })} aria-label="Kho nhập tồn đầu kỳ">
            <option value="">Kho mặc định của shop</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Section>
      )}

      {confirm && (
        <Modal title="Xác nhận bỏ biến thể" onClose={() => setConfirm(null)} footer={<><button className="btn" onClick={() => setConfirm(null)}>Quay lại</button><button className="btn primary" disabled={busy} onClick={doSave}>Vẫn lưu</button></>}>
          <p>Các biến thể sau sẽ ngừng bán khi lưu:</p>
          <ul className="small" aria-label="Biến thể sẽ ngừng bán">
            {confirm.map((v) => (
              <li key={v.id}><b>{v.sku}</b>{Object.values(v.option_values || {}).length ? ` (${Object.values(v.option_values).join(' / ')})` : v.name ? ` (${v.name})` : ''}{' — '}{v.outcome === 'deleted' ? 'xoá hẳn vì chưa có lịch sử' : 'lưu trữ, giữ lịch sử kho và đơn'}</li>
            ))}
          </ul>
        </Modal>
      )}
    </FormPage>
  );
}

function PackagingSpec({ productId }) {
  const available = useAsync(() => api.get('/products', { item_type: 'packaging', unlisted: '1', limit: 200 }), []);
  const state = useAsync(() => api.get(`/packaging-specs/${productId}`), [productId]);
  const [lines, setLines] = useState([]);
  const { busy, error, run } = useAction();
  useEffect(() => { if (Array.isArray(state.data?.data)) setLines(state.data.data.map((x) => ({ material_variant_id: x.material_variant_id, qty: x.qty }))); }, [state.data]);
  const materials = (Array.isArray(available.data?.data) ? available.data.data : []).flatMap((p) => (Array.isArray(p.variants) ? p.variants : []).filter((v) => v.kind !== 'bundle' && !v.archived_at).map((v) => ({ id: v.id, label: `${p.name}${v.name ? ` — ${v.name}` : ''} · ${v.sku} (${p.unit})` })));
  const patch = (i, value) => setLines((rows) => rows.map((x, j) => j === i ? { ...x, ...value } : x));
  return <Section title="Định mức đóng gói"><div className="stack">
    {lines.map((line, i) => <div className="row" key={`${i}-${line.material_variant_id}`}><select aria-label="Vật liệu đóng gói" value={line.material_variant_id} onChange={(e) => patch(i, { material_variant_id: e.target.value })}><option value="">Chọn vật tư</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select><input aria-label="Định mức" type="number" min="0.001" step="0.001" value={line.qty} onChange={(e) => patch(i, { qty: e.target.value })} style={{ width: 100 }} /><button className="btn sm" type="button" onClick={() => setLines((rows) => rows.filter((_, j) => j !== i))} aria-label="Bỏ vật liệu">✕</button></div>)}
    <div className="row"><button type="button" className="btn sm" onClick={() => setLines((rows) => [...rows, { material_variant_id: materials[0]?.id || '', qty: 1 }])} disabled={!materials.length}>+ Thêm vật tư</button><button type="button" className="btn sm primary" disabled={busy} onClick={() => run(async () => { await api.put(`/packaging-specs/${productId}`, { lines: lines.filter((x) => x.material_variant_id).map((x) => ({ ...x, qty: Number(x.qty) })) }); state.reload(); })}>Lưu định mức</button></div>
    <div className="small muted">Định mức chỉ gợi ý lượng dự kiến; kho chỉ giảm khi xác nhận đóng gói đơn.</div><ErrorBox error={error} />
  </div></Section>;
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
    <Section title="Thông tin riêng của shop">
      <div className="stack" style={{ gap: 8 }}>
        {fields.map((fd) => {
          const cur = fd.key in value ? value[fd.key] : values[fd.key];
          return <Field key={fd.id} label={fd.type === 'boolean' ? '' : fd.label}><FieldInput field={fd} value={cur} onChange={(v) => onChange({ ...value, [fd.key]: v })} /></Field>;
        })}
      </div>
    </Section>
  );
}

/** Ô nhập có sửa khi rời ô / Enter: tránh đổi nhãn từng phím (giữa chừng có thể rỗng hoặc trùng) */
function CommitInput({ value, onCommit, ...rest }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const done = () => { if (text.trim() && text.trim() !== value) onCommit(text); else setText(value); };
  return <input {...rest} value={text} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())} />;
}

function TagInput({ values, onChange, onRename, label }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const commit = () => {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...values, ...parts.filter((p) => !values.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setText('');
  };
  return (
    <div className="tag-input">
      {values.map((v) => (
        <span key={v} className="tag">
          {editing === v
            ? <CommitInput value={v} aria-label={`Đổi tên giá trị ${v}`} autoFocus style={{ minWidth: 80, minHeight: 28, padding: '0 8px' }} onCommit={(n) => { setEditing(null); onRename(v, n); }} />
            : <span role="button" tabIndex={0} title="Bấm để đổi tên" onClick={() => setEditing(v)} onKeyDown={(e) => e.key === 'Enter' && setEditing(v)}>{v}</span>}
          <button type="button" aria-label={`Bỏ ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>✕</button>
        </span>
      ))}
      <input value={text} aria-label={label} placeholder={values.length ? '' : 'Nhập giá trị rồi bấm Enter'} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)); }} />
    </div>
  );
}

/** Ô chọn ảnh của biến thể: nút ảnh thu nhỏ, bấm mở danh sách ảnh của sản phẩm để chọn */
function ImageCell({ sku, images, value, onChange }) {
  const [open, setOpen] = useState(false);
  const cur = images.find((im) => im.id === value);
  return (
    <>
      <button type="button" className="img-pick" aria-label={`Ảnh của ${sku}`} title={images.length ? 'Chọn ảnh cho biến thể' : 'Thêm ảnh cho sản phẩm trước'} disabled={!images.length} onClick={() => setOpen(true)}>
        <ProductThumb src={cur?.url} name={cur ? sku : '+'} size={36} />
      </button>
      {open && (
        <Modal title={`Ảnh cho ${sku}`} onClose={() => setOpen(false)} footer={<button type="button" className="btn" onClick={() => { onChange(null); setOpen(false); }}>Không dùng ảnh riêng</button>}>
          <div className="img-grid">
            {images.map((im, n) => (
              <button key={im.id} type="button" className={`img-opt ${im.id === value ? 'on' : ''}`} aria-label={`Chọn ảnh ${n + 1}`} aria-pressed={im.id === value} onClick={() => { onChange(im.id); setOpen(false); }}>
                <ProductThumb src={im.url} name={String(n + 1)} size={72} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function Matrix({ f, set, setOptions, setRow, images, renameAttr, renameValue, removeAttr, pickCombo }) {
  const [all, setAll] = useState({ default_price: '', opening_cost: '', opening_qty: '' });
  const upd = (i, patch) => setOptions(f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const choices = comboChoices(f.options);
  const hasExisting = f.rows.some((r) => r.id);
  const dup = hasDuplicateCombos(f.rows, f.options);
  return (
    <div className="stack">
      <div className="eyebrow">Thuộc tính</div>
      {f.options.map((o, i) => (
        <div key={i} className="grid cols-2" style={{ alignItems: 'end' }}>
          <Field label={`Thuộc tính ${i + 1}`}>
            <div className="row" style={{ gap: 8 }}>
              <CommitInput className="grow" value={o.name} placeholder="Mùi, Size, Màu…" aria-label={`Tên thuộc tính ${i + 1}`} onCommit={(n) => (o.name ? renameAttr(i, n) : upd(i, { name: n.trim() }))} />
              {f.options.length > 1 && <button type="button" className="btn sm" aria-label={`Xoá thuộc tính ${o.name || i + 1}`} onClick={() => removeAttr(i)}>✕</button>}
            </div>
          </Field>
          <Field label="Giá trị (bấm vào thẻ để đổi tên)"><TagInput values={o.values} label={`Giá trị của ${o.name || 'thuộc tính'}`} onChange={(values) => upd(i, { values })} onRename={(a, b) => renameValue(i, a, b)} /></Field>
        </div>
      ))}
      {f.options.length < 3 && <div><button type="button" className="btn sm" onClick={() => set({ options: [...f.options, { name: '', values: [] }] })}>+ Thuộc tính</button></div>}
      {hasExisting && choices.length > 0 && <p className="small muted" style={{ margin: 0 }}>Biến thể đã có giữ nguyên SKU, tồn kho và lịch sử. Ở cột Biến thể, chọn mỗi biến thể đã có ứng với tổ hợp nào.</p>}
      {dup && <div className="alert err" role="alert">Hai biến thể đang cùng một tổ hợp. Chọn tổ hợp khác cho một trong hai.</div>}
      {f.removed.length > 0 && <div className="alert">Bỏ giá trị sẽ ngừng bán {f.removed.length} biến thể: có lịch sử kho/đơn thì lưu trữ, chưa dùng thì xoá hẳn.</div>}
      {choices.length === 0 && <span className="small muted">Nhập ít nhất một thuộc tính và một giá trị để sinh bảng biến thể.</span>}
      {choices.length > 0 && (
        <div className="matrix-box">
          <div className="applybar">
            <Field label="Giá bán cho tất cả"><MoneyInput value={all.default_price} onChange={(e) => setAll({ ...all, default_price: e.target.value })} /></Field>
            <Field label="Giá vốn cho tất cả"><MoneyInput value={all.opening_cost} onChange={(e) => setAll({ ...all, opening_cost: e.target.value })} /></Field>
            <Field label="Tồn đầu kỳ cho tất cả"><input type="number" min="0" value={all.opening_qty} onChange={(e) => setAll({ ...all, opening_qty: e.target.value })} /></Field>
            <button type="button" className="btn sm" onClick={() => {
              // Tồn đầu kỳ và giá vốn chỉ áp cho dòng mới (dòng đã có không ghi lại tồn đầu kỳ)
              set({ rows: f.rows.map((r) => (r.id ? { ...r, ...(all.default_price !== '' ? { default_price: all.default_price } : {}) } : applyToAll([r], all)[0])) });
            }}>Áp dụng</button>
          </div>
          <div className="table-wrap matrix-wrap"><table className="matrix">
          <thead><tr><th className="sticky-col">Biến thể</th><th>Ảnh</th><th>SKU</th><th className="num">Giá bán</th><th className="num">Giá vốn</th><th className="num">Tồn đầu kỳ</th><th>Mã vạch</th><th>Bán</th></tr></thead>
          <tbody>
            {f.rows.map((r, i) => (
              <tr key={r.id || r.sku + i} className={r.active === false ? 'off' : ''}>
                <td className="sticky-col mx-name">{r.id
                  ? <select aria-label={`Biến thể hiện có là ${r.sku}`} value={choices.find((c) => c.label === Object.values(r.option_values).join(' / '))?.key ?? ''} onChange={(e) => pickCombo(i, choices.find((c) => c.key === e.target.value).ov)} style={{ minWidth: 130 }}>
                    {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  : <b>{Object.values(r.option_values).join(' / ')}</b>}</td>
                <td className="mx-img"><ImageCell sku={r.sku} images={images} value={r.image_id} onChange={(id) => setRow(i, { image_id: id })} /></td>
                <td data-label="SKU" className="mx-full"><input className="sku" aria-label={`SKU ${Object.values(r.option_values).join(' ')}`} value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value.toUpperCase(), autoSku: false })} /></td>
                <td data-label="Giá bán"><MoneyInput aria-label={`Giá bán ${r.sku}`} value={r.default_price} onChange={(e) => setRow(i, { default_price: e.target.value })} /></td>
                <td data-label="Giá vốn">{r.id ? <span className="muted small">đã có</span> : <MoneyInput aria-label={`Giá vốn ${r.sku}`} value={r.opening_cost} onChange={(e) => setRow(i, { opening_cost: e.target.value })} />}</td>
                <td data-label="Tồn đầu kỳ">{r.id ? <span className="muted small">đã có</span> : <input type="number" min="0" aria-label={`Tồn đầu kỳ ${r.sku}`} value={r.opening_qty} onChange={(e) => setRow(i, { opening_qty: e.target.value })} />}</td>
                <td data-label="Mã vạch"><input aria-label={`Mã vạch ${r.sku}`} value={r.barcode} onChange={(e) => setRow(i, { barcode: e.target.value })} /></td>
                <td className="mx-full"><label className="check"><input type="checkbox" checked={r.active !== false} onChange={(e) => setRow(i, { active: e.target.checked })} aria-label={`Đang bán ${r.sku}`} /> <span className="small">Đang bán</span></label></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        </div>
      )}
    </div>
  );
}
