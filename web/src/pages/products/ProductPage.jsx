import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { Async, useAsync } from '../../components/ui.jsx';
import { useLeaveGuard } from '../../components/leaveGuard.js';
import ProductForm, { initialForm } from './ProductForm.jsx';
import ComboForm, { initialCombo } from './ComboForm.jsx';

/** Trang đầy đủ để thêm/sửa sản phẩm hoặc combo: /products/new, /products/combo/new, /products/:id (combo tự nhận từ dữ liệu) */
export default function ProductPage({ combo }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { shopId, isAll } = useSession();
  const { setDirty } = useLeaveGuard();
  const state = useAsync(() => (id ? api.get(`/products/${id}`) : Promise.resolve({ data: null })), [id]);
  const back = () => nav('/products');
  return (
    <Async state={state}>
      {({ data }) => <Loaded key={data?.id || 'new'} data={data} combo={combo} shopId={shopId} isAll={isAll} onClose={back} onSaved={back} onDirty={setDirty} onRemoved={(r) => nav('/products', { state: { notice: r.mode === 'deleted' ? `Đã xoá sản phẩm ${r.name}.` : `Đã ngừng kinh doanh ${r.name}${r.written_off ? ` và xuất huỷ ${r.written_off.qty} sản phẩm còn trong kho` : ''}. Khôi phục ở tab “Đã ngừng kinh doanh”.` } })} />}
    </Async>
  );
}

function Loaded({ data, combo, shopId, isAll, onClose, onSaved, onDirty, onRemoved }) {
  const isCombo = combo || data?.variants.some((v) => v.kind === 'bundle');
  const init = useMemo(() => (isCombo ? initialCombo(data, shopId, isAll) : initialForm(data, shopId, isAll)), [data, isCombo, shopId, isAll]);
  return isCombo
    ? <ComboForm init={init} onClose={onClose} onSaved={onSaved} onDirty={onDirty} onRemoved={onRemoved} />
    : <ProductForm init={init} onClose={onClose} onSaved={onSaved} onDirty={onDirty} onRemoved={onRemoved} />;
}
