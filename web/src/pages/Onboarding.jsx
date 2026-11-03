import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { ErrorBox, Field, Modal, useAction, useAsync } from '../components/ui.jsx';
import { slugify } from '../components/FieldInput.jsx';
import { Seal } from '../components/Motif.jsx';

const STEPS = [['shop', 'Shop'], ['warehouse', 'Kho'], ['product', 'Sản phẩm']];

function Stepper({ current }) {
  const idx = STEPS.findIndex(([k]) => k === current);
  return (
    <ol className="stepper" aria-label="Các bước thiết lập">
      {STEPS.map(([k, label], i) => (
        <li key={k} className={i < idx ? 'done' : i === idx ? 'on' : ''} aria-current={i === idx ? 'step' : undefined}><span>{i < idx ? '✓' : i + 1}</span>{label}</li>
      ))}
    </ol>
  );
}

/** Mã shop gợi ý từ tên: chữ cái đầu mỗi từ, không dấu, tối đa 6 ký tự */
export const suggestCode = (name) => slugify(name).split('_').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 6);

/**
 * Màn hình đầu tiên của tài khoản mới (chưa có shop nào): tạo shop. Sau đó các cửa sổ hướng dẫn
 * (GettingStarted) dẫn tiếp qua tạo kho đầu tiên và sản phẩm đầu tiên.
 */
export default function Onboarding() {
  const { industries, reload, user, onLogout } = useSession();
  const [f, setF] = useState({ name: '', code: '', codeTouched: false, industry: 'general', phone: '', address: '' });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setName = (e) => { const name = e.target.value; setF({ ...f, name, code: f.codeTouched ? f.code : suggestCode(name) }); };
  const picked = industries.find((i) => i.id === f.industry);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/shops', { name: f.name, code: f.code, industry: f.industry, phone: f.phone || null, address: f.address || null });
      await reload();
    });
  };

  return (
    <div className="page stack" style={{ maxWidth: 760 }}>
      <div className="row between wrap">
        <div className="row"><img src="/logo-mark.svg" alt="" width="40" height="40" style={{ borderRadius: 10 }} /><div><div className="eyebrow">Xin chào, {user.displayName}</div><h1>Tạo shop đầu tiên</h1></div></div>
        <button className="btn sm" onClick={onLogout}>Đăng xuất</button>
      </div>
      <Stepper current="shop" />
      <p className="muted" style={{ margin: 0 }}>Shop là một mảng kinh doanh của bạn (ví dụ “Nước hoa ô tô”). Bạn có thể thêm shop khác bất cứ lúc nào trong Cài đặt. Tài khoản này chỉ thấy các shop do chính bạn tạo.</p>
      <form className="card stack" onSubmit={submit}>
        <div className="grid cols-2">
          <Field label="Tên shop"><input value={f.name} onChange={setName} placeholder="vd: Nước hoa ô tô" required autoFocus /></Field>
          <Field label="Mã shop" hint="Dùng trong mã đơn hàng, vd DH-NHOT-261103-001"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase(), codeTouched: true })} maxLength={6} required /></Field>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">Ngành bán</div>
          <div className="grid cols-2 collapse">
            {industries.map((i) => (
              <label key={i.id} className={`pick-card ${f.industry === i.id ? 'on' : ''}`}>
                <input type="radio" name="industry" value={i.id} checked={f.industry === i.id} onChange={() => setF({ ...f, industry: i.id })} />
                <span><b>{i.name}</b><span className="small muted" style={{ display: 'block' }}>{i.description}</span></span>
              </label>
            ))}
          </div>
          {picked?.customer_field_labels?.length > 0 && <p className="small muted" style={{ margin: 0 }}>Thông tin khách tạo sẵn: {picked.customer_field_labels.join(', ')}. Sau này thêm bớt tuỳ ý. Giao diện của shop đổi theo ngành.</p>}
        </div>
        <div className="grid cols-2">
          <Field label="Điện thoại (in trên phiếu bán hàng)"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Địa chỉ"><input value={f.address} onChange={set('address')} /></Field>
        </div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || !f.name || !f.code}>{busy ? 'Đang tạo…' : 'Tạo shop và tiếp tục'}</button></div>
      </form>
    </div>
  );
}

/**
 * Hướng dẫn sau khi có shop đầu tiên: (1) tạo kho đầu tiên → (2) tạo sản phẩm đầu tiên. Tự hiện khi thiếu bước,
 * "Để sau" ẩn trong phiên làm việc này; thẻ ở Tổng quan mở lại được.
 */
export function useSetupProgress() {
  const { warehouses, shops } = useSession();
  // Chỉ xét shop ĐẦU TIÊN của tài khoản: shop thứ hai, thứ ba chưa có sản phẩm là chuyện bình thường, không được che màn hình bằng hướng dẫn
  const target = shops[0];
  const products = useAsync(() => (target ? api.get('/products', { shop_id: target.id, limit: 1 }) : Promise.resolve({ data: [] })), [target?.id]);
  const hasWarehouse = !!target?.default_warehouse_id && warehouses.some((w) => w.id === target.default_warehouse_id);
  const hasProduct = (products.data?.data?.length || 0) > 0;
  const loading = products.loading && !products.data;
  const step = loading ? null : !hasWarehouse ? 'warehouse' : !hasProduct ? 'product' : null;
  return { shop: target, hasWarehouse, hasProduct, step, loading, reload: products.reload };
}

const DISMISS_KEY = 'moso.guide.dismissed';
const readDismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

export function GettingStarted({ progress, open, onClose }) {
  const { reload } = useSession();
  const { step, shop } = progress;
  const [done, setDone] = useState(false);
  if (!shop || (!step && !done) || !open) return null;
  const finish = async () => { await reload(); progress.reload(); };
  if (done && !step) {
    return (
      <Modal title="Sẵn sàng bán hàng" onClose={() => { setDone(false); onClose(true); }}>
        <div className="row" style={{ gap: 14 }}><Seal size={56}>XONG</Seal><p style={{ margin: 0 }}>Shop <b>{shop.name}</b> đã có kho và sản phẩm đầu tiên. Bạn có thể bán hàng ngay, nhập thêm sản phẩm và hàng về, hoặc import đơn từ Shopee.</p></div>
        <div className="row wrap"><a className="btn primary" href="/pos">Bán đơn đầu tiên</a><a className="btn" href="/products">Thêm sản phẩm</a><a className="btn" href="/orders?import=1">Import đơn</a></div>
      </Modal>
    );
  }
  return step === 'warehouse'
    ? <WarehouseStep shop={shop} onClose={() => onClose(false)} onDone={finish} />
    : <ProductStep shop={shop} onClose={() => onClose(false)} onDone={async () => { setDone(true); await finish(); }} />;
}

function WarehouseStep({ shop, onClose, onDone }) {
  const [name, setName] = useState('Kho chính');
  const { busy, error, run } = useAction();
  return (
    <Modal title="Bước 2/3 · Tạo kho đầu tiên" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Để sau</button><button className="btn primary" disabled={busy || !name.trim()} onClick={() => run(async () => {
      const wh = (await api.post('/warehouses', { code: 'K1', name: name.trim() })).data;
      await api.patch(`/shops/${shop.id}`, { default_warehouse_id: wh.id });
      await onDone();
    })}>Tạo kho</button></>}>
      <Stepper current="warehouse" />
      <p style={{ margin: 0 }}>Kho là nơi để hàng thật. Khi bán, hàng được trừ từ <b>kho mặc định của shop</b>. Một kho có thể phục vụ nhiều shop, và bạn thêm kho khác sau cũng được (nhà, cửa hàng…).</p>
      <Field label="Tên kho"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <p className="small muted" style={{ margin: 0 }}>Kho này sẽ là kho mặc định của <b>{shop.name}</b>.</p>
      <ErrorBox error={error} />
    </Modal>
  );
}

function ProductStep({ shop, onClose, onDone }) {
  const [f, setF] = useState({ name: '', sku: '', skuTouched: false, price: '', cost: '', qty: '' });
  const { busy, error, run } = useAction();
  const setName = (e) => { const name = e.target.value; setF({ ...f, name, sku: f.skuTouched ? f.sku : slugify(name).toUpperCase().replaceAll('_', '-').slice(0, 24) }); };
  const qty = Number(f.qty) || 0;
  const needCost = qty > 0 && !(Number(f.cost) > 0);
  const save = () => run(async () => {
    const p = (await api.post('/products', { name: f.name, variants: [{ sku: f.sku, default_price: Number(f.price) || 0 }], shop_ids: [shop.id] })).data;
    if (qty > 0) await api.post('/stock-adjustments', { warehouse_id: shop.default_warehouse_id, kind: 'opening', reason: 'Tồn đầu kỳ', lines: [{ variant_id: p.variants[0].id, change: qty, unit_cost: Number(f.cost) }] });
    await onDone();
  });
  return (
    <Modal title="Bước 3/3 · Tạo sản phẩm đầu tiên" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Để sau</button><button className="btn primary" disabled={busy || !f.name.trim() || !f.sku.trim() || needCost} onClick={save}>Tạo sản phẩm</button></>}>
      <Stepper current="product" />
      <p style={{ margin: 0 }}>Nhập một sản phẩm để thử. Mã SKU là mã riêng của bạn, dùng để tìm nhanh và ghép đơn import từ sàn.</p>
      <div className="grid cols-2">
        <Field label="Tên sản phẩm"><input value={f.name} onChange={setName} autoFocus /></Field>
        <Field label="Mã SKU"><input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase(), skuTouched: true })} /></Field>
        <Field label="Giá bán (₫)"><input type="number" inputMode="numeric" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Giá nhập (₫)" hint="Để tính lợi nhuận"><input type="number" inputMode="numeric" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
      </div>
      <Field label="Số lượng đang có trong kho (để trống nếu chưa có)"><input type="number" inputMode="numeric" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
      {needCost && <div className="alert warn small">Có hàng trong kho thì cần nhập giá nhập để tính giá vốn đúng.</div>}
      <ErrorBox error={error} />
    </Modal>
  );
}

export { readDismissed, DISMISS_KEY };
