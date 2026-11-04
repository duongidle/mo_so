import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Async, Card, Empty, ErrorBox, Field, Modal, useAction, useAsync } from '../../components/ui.jsx';
import { descendantIds, flattenTree, indent } from '../../lib/categories.js';

/** Quản lý cây danh mục: thêm, đổi tên, chọn cha, sắp thứ tự, lưu trữ; hiện số sản phẩm mỗi mục */
export default function Categories({ onChanged }) {
  const state = useAsync(() => api.get('/categories', { tree: 1 }), []);
  const [edit, setEdit] = useState(null);
  const [archive, setArchive] = useState(null);
  const { error, run } = useAction();
  const reload = () => { state.reload(); onChanged?.(); };

  const swap = (list, c, d) => run(async () => {
    const sibs = list.filter((x) => (x.parent_id || null) === (c.parent_id || null));
    const i = sibs.findIndex((x) => x.id === c.id);
    const o = sibs[i + d];
    if (!o) return;
    // Gán lại thứ tự theo vị trí mới để không phụ thuộc vào giá trị cũ (có thể trùng nhau)
    const order = sibs.map((x) => x.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    await Promise.all(order.map((id, n) => api.patch(`/categories/${id}`, { sort_order: n })));
    reload();
  });

  return (
    <div className="stack">
      <div className="row between"><span className="muted small">Danh mục có thể lồng nhau. Lọc theo danh mục cha gồm cả danh mục con.</span><button className="btn primary" onClick={() => setEdit({ name: '', parent_id: '' })}>+ Danh mục</button></div>
      <ErrorBox error={error} />
      <Async state={state}>
        {({ data }) => {
          const list = flattenTree(data);
          return !list.length ? <Empty>Chưa có danh mục nào. Bấm “+ Danh mục” để thêm.</Empty> : (
            <Card flat>
              {list.map((c) => (
                <div key={c.id} className="cat-row" style={{ paddingLeft: 12 + c.depth * 22 }}>
                  <span className="grow"><b>{c.name}</b> <span className="small muted">{c.product_count} sản phẩm{c.product_count_total !== c.product_count ? ` (${c.product_count_total} gồm con)` : ''}</span></span>
                  <button className="btn sm" onClick={() => swap(data, c, -1)} aria-label={`Đưa ${c.name} lên`}>↑</button>
                  <button className="btn sm" onClick={() => swap(data, c, 1)} aria-label={`Đưa ${c.name} xuống`}>↓</button>
                  <button className="btn sm" onClick={() => setEdit({ id: c.id, name: c.name, parent_id: c.parent_id || '' })}>Sửa</button>
                  <button className="btn sm" onClick={() => setArchive(c)}>Lưu trữ</button>
                </div>
              ))}
            </Card>
          );
        }}
      </Async>
      {edit && <CategoryForm init={edit} all={state.data?.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {archive && <ArchiveForm cat={archive} all={state.data?.data || []} onClose={() => setArchive(null)} onSaved={() => { setArchive(null); reload(); }} />}
    </div>
  );
}

function CategoryForm({ init, all, onClose, onSaved }) {
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  // Không cho chọn chính nó hoặc danh mục con làm cha (server cũng chặn: CATEGORY_CYCLE)
  const options = useMemo(() => flattenTree(all, { exclude: f.id ? descendantIds(all, f.id) : undefined }), [all, f.id]);
  const save = () => run(async () => {
    const body = { name: f.name.trim(), parent_id: f.parent_id || null };
    if (f.id) await api.patch(`/categories/${f.id}`, body);
    else await api.post('/categories', body);
    onSaved();
  });
  return (
    <Modal title={f.id ? 'Sửa danh mục' : 'Thêm danh mục'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>Lưu</button>}>
      <Field label="Tên danh mục"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Nằm trong"><select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}><option value="">— Gốc —</option>{options.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}</select></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

function ArchiveForm({ cat, all, onClose, onSaved }) {
  const [moveTo, setMoveTo] = useState('');
  const { busy, error, run } = useAction();
  const options = flattenTree(all, { exclude: descendantIds(all, cat.id) });
  return (
    <Modal title={`Lưu trữ “${cat.name}”`} onClose={onClose} footer={<button className="btn primary" disabled={busy || (cat.product_count_total > 0 && !moveTo)} onClick={() => run(async () => { await api.patch(`/categories/${cat.id}`, { archived: true, ...(moveTo ? { move_products_to: moveTo } : {}) }); onSaved(); })}>Lưu trữ</button>}>
      {cat.product_count_total > 0
        ? <><p className="small muted">Còn {cat.product_count_total} sản phẩm trong danh mục này. Chọn danh mục để chuyển chúng sang.</p>
          <Field label="Chuyển sản phẩm sang"><select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">— Chọn —</option>{options.map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}</select></Field></>
        : <p className="small muted">Danh mục trống. Lưu trữ chỉ ẩn khỏi danh sách, không xoá dữ liệu.</p>}
      <ErrorBox error={error} />
    </Modal>
  );
}
