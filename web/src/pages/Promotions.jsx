import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, useAction, useAsync } from '../components/ui.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import { vnd, fmtDate } from '../lib.js';

const KIND_HELP = {
  order_percent: 'Giảm một phần trăm trên tiền hàng của đơn.',
  order_amount: 'Giảm một số tiền cố định trên đơn.',
  item_percent: 'Giảm phần trăm cho các sản phẩm được chọn.',
  buy_x_get_y: 'Mua đủ X thì tặng Y cái cùng sản phẩm (mua 2 tặng 1: cứ 3 cái thì 1 cái miễn phí).',
  tier_percent: 'Mỗi khách được giảm theo % của hạng khách (cấu hình ở tab Hạng khách).',
  gift: 'Đủ điều kiện thì tặng một sản phẩm khác kèm đơn (giá 0, vẫn trừ kho và tính vào giá vốn).',
};
const blank = () => ({ name: '', kind: 'order_percent', code: '', value: 10, buy_qty: 2, free_qty: 1, min_subtotal: 0, max_discount: '', variant_ids: [], category_ids: [], shop_ids: [], channel_ids: [], gift_variant_id: '', gift_qty: 1, starts_on: '', ends_on: '', usage_limit: '', per_customer_limit: '', stackable: false, active: true });
const toForm = (p) => ({ ...blank(), ...p, code: p.code || '', max_discount: p.max_discount ?? '', gift_variant_id: p.gift_variant_id || '', gift_qty: p.gift_qty || 1, starts_on: p.starts_on || '', ends_on: p.ends_on || '', usage_limit: p.usage_limit ?? '', per_customer_limit: p.per_customer_limit ?? '', variant_ids: p.variant_ids || [], category_ids: p.category_ids || [], shop_ids: p.shop_ids || [], channel_ids: p.channel_ids || [] });
const num = (v) => (v === '' || v == null ? null : Number(v));

/** Tab Khuyến mãi của Loyalty & Campaign */
export default function Promotions() {
  const state = useAsync(() => api.get('/loyalty/promotions'), []);
  const [edit, setEdit] = useState(null);
  return (
    <div className="stack">
      <div className="row between"><p className="muted small" style={{ margin: 0 }}>Khuyến mãi tự áp khi đủ điều kiện, hoặc khi khách đọc đúng mã. Máy chủ tính lại lúc tạo đơn nên số giảm luôn khớp.</p><button className="btn primary" onClick={() => setEdit(blank())}>+ Khuyến mãi</button></div>
      <Async state={state}>
        {({ data, kinds }) => !data.length ? <Empty>Chưa có khuyến mãi nào. Nhấn “+ Khuyến mãi” để tạo.</Empty> : (
          <Card flat className="list-card"><div className="table-wrap"><table className="stackable">
            <thead><tr><th>Khuyến mãi</th><th className="hide-sm">Thời gian</th><th className="num">Lượt dùng</th><th className="num hide-sm">Đã giảm</th><th className="num hide-sm">Doanh thu</th><th>Trạng thái</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" tabIndex={0} onClick={() => setEdit(toForm(p))} onKeyDown={(e) => e.key === 'Enter' && setEdit(toForm(p))}>
                <td><b>{p.name}</b><span className="sub">{kinds[p.kind]}{p.code ? ` · mã ${p.code}` : ' · tự áp dụng'}{p.stackable ? ' · cộng dồn được' : ''}</span></td>
                <td className="hide-sm small">{p.starts_on || p.ends_on ? `${p.starts_on ? fmtDate(p.starts_on) : '…'} → ${p.ends_on ? fmtDate(p.ends_on) : '…'}` : 'Không giới hạn'}</td>
                <td className="num">{p.uses}{p.usage_limit ? ` / ${p.usage_limit}` : ''}</td>
                <td className="num hide-sm">{vnd(p.discount_given)}</td>
                <td className="num hide-sm">{vnd(p.revenue)}</td>
                <td>{p.active ? <span className="badge st-completed">Đang chạy</span> : <span className="badge plain">Tắt</span>}</td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
      {edit && <PromoForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} />}
    </div>
  );
}

function PromoForm({ init, onClose, onSaved }) {
  const { shops, channels } = useSession();
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const products = useAsync(() => api.get('/variants', { all: 1, limit: 200 }), []);
  const cats = useAsync(() => api.get('/categories', { tree: 1 }), []);
  const toggle = (key, id) => set({ [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] });
  const needsScope = ['item_percent', 'buy_x_get_y'].includes(f.kind);
  const giftOptions = (products.data?.data || []).filter((v) => v.kind !== 'bundle');
  const save = () => run(async () => {
    const body = {
      name: f.name, kind: f.kind, code: f.code || null,
      value: ['order_percent', 'order_amount', 'item_percent'].includes(f.kind) ? Number(f.value) || 0 : 0,
      buy_qty: ['buy_x_get_y', 'gift'].includes(f.kind) ? Number(f.buy_qty) || null : null, free_qty: f.kind === 'buy_x_get_y' ? Number(f.free_qty) : null,
      gift_variant_id: f.kind === 'gift' ? f.gift_variant_id || null : null, gift_qty: f.kind === 'gift' ? Number(f.gift_qty) || 1 : null,
      min_subtotal: Number(f.min_subtotal) || 0, max_discount: num(f.max_discount),
      variant_ids: f.variant_ids, category_ids: f.category_ids, shop_ids: f.shop_ids, channel_ids: f.channel_ids,
      starts_on: f.starts_on || null, ends_on: f.ends_on || null, usage_limit: num(f.usage_limit), per_customer_limit: num(f.per_customer_limit),
      stackable: !!f.stackable, active: !!f.active,
    };
    if (f.id) await api.put(`/loyalty/promotions/${f.id}`, body); else await api.post('/loyalty/promotions', body);
    onSaved();
  });
  const flatCats = (list, depth = 0) => list.flatMap((c) => [{ ...c, depth }, ...flatCats(c.children || [], depth + 1)]);
  return (
    <Modal title={f.id ? 'Sửa khuyến mãi' : 'Khuyến mãi mới'} onClose={onClose} footer={<>{f.id && <button className="btn danger" disabled={busy} onClick={() => run(async () => { await api.del(`/loyalty/promotions/${f.id}`); onSaved(); })}>Lưu trữ</button>}<button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>Lưu</button></>}>
      <Field label="Tên"><input value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label="Tên khuyến mãi" /></Field>
      <Field label="Loại" hint={KIND_HELP[f.kind]}>
        <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Loại khuyến mãi">
          <option value="order_percent">Giảm % trên đơn</option><option value="order_amount">Giảm số tiền trên đơn</option><option value="item_percent">Giảm % theo sản phẩm</option><option value="buy_x_get_y">Mua X tặng Y</option><option value="tier_percent">Ưu đãi theo hạng khách</option><option value="gift">Tặng quà kèm</option>
        </select>
      </Field>
      {['order_percent', 'item_percent'].includes(f.kind) && <Field label="Giảm (%)"><input type="number" min="1" max="100" value={f.value} onChange={(e) => set({ value: e.target.value })} aria-label="Phần trăm giảm" /></Field>}
      {f.kind === 'order_amount' && <Field label="Giảm (đồng)"><MoneyInput value={f.value} onChange={(e) => set({ value: e.target.value })} /></Field>}
      {f.kind === 'buy_x_get_y' && <div className="grid cols-2"><Field label="Mua (cái)"><input type="number" min="1" value={f.buy_qty} onChange={(e) => set({ buy_qty: e.target.value })} aria-label="Mua" /></Field><Field label="Tặng (cái)"><input type="number" min="1" value={f.free_qty} onChange={(e) => set({ free_qty: e.target.value })} aria-label="Tặng" /></Field></div>}
      {f.kind === 'gift' && (
        <div className="grid cols-2">
          <Field label="Sản phẩm tặng"><select value={f.gift_variant_id} onChange={(e) => set({ gift_variant_id: e.target.value })} aria-label="Sản phẩm tặng"><option value="">Chọn sản phẩm…</option>{giftOptions.map((v) => <option key={v.id} value={v.id}>{v.product_name} · {v.sku}</option>)}</select></Field>
          <Field label="Số lượng tặng mỗi đơn"><input type="number" min="1" value={f.gift_qty} onChange={(e) => set({ gift_qty: e.target.value })} aria-label="Số lượng tặng" /></Field>
          <Field label="Mua tối thiểu trong chương trình (cái, tuỳ chọn)"><input type="number" min="1" value={f.buy_qty} onChange={(e) => set({ buy_qty: e.target.value })} aria-label="Mua tối thiểu" /></Field>
        </div>
      )}
      <Field label="Mã voucher (bỏ trống = tự áp dụng)"><input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} aria-label="Mã voucher" /></Field>
      <div className="grid cols-2"><Field label="Đơn tối thiểu"><MoneyInput value={f.min_subtotal} onChange={(e) => set({ min_subtotal: e.target.value })} /></Field><Field label="Trần giảm mỗi đơn (tuỳ chọn)"><MoneyInput value={f.max_discount} onChange={(e) => set({ max_discount: e.target.value })} /></Field></div>
      <div className="grid cols-2"><Field label="Từ ngày"><input type="date" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value })} aria-label="Từ ngày" /></Field><Field label="Đến ngày"><input type="date" value={f.ends_on} onChange={(e) => set({ ends_on: e.target.value })} aria-label="Đến ngày" /></Field></div>
      <div className="grid cols-2"><Field label="Tổng lượt dùng tối đa"><input type="number" min="1" value={f.usage_limit} onChange={(e) => set({ usage_limit: e.target.value })} aria-label="Tổng lượt" /></Field><Field label="Mỗi khách tối đa"><input type="number" min="1" value={f.per_customer_limit} onChange={(e) => set({ per_customer_limit: e.target.value })} aria-label="Mỗi khách" /></Field></div>
      {!['tier_percent'].includes(f.kind) && (
        <Field label={needsScope ? 'Áp dụng cho sản phẩm / danh mục (bắt buộc)' : 'Chỉ áp dụng cho sản phẩm / danh mục (bỏ trống = tất cả)'}>
          <div className="stack" style={{ gap: 4, maxHeight: 160, overflow: 'auto' }}>
            {(cats.data?.data ? flatCats(cats.data.data) : []).map((c) => <label key={c.id} className="check small" style={{ paddingLeft: c.depth * 12 }}><input type="checkbox" checked={f.category_ids.includes(c.id)} onChange={() => toggle('category_ids', c.id)} />Danh mục: {c.name}</label>)}
            {(products.data?.data || []).map((v) => <label key={v.id} className="check small"><input type="checkbox" checked={f.variant_ids.includes(v.id)} onChange={() => toggle('variant_ids', v.id)} />{v.product_name} · {v.sku}</label>)}
          </div>
        </Field>
      )}
      {shops.length > 1 && <Field label="Shop áp dụng (bỏ trống = tất cả)"><div className="row wrap">{shops.map((s) => <label key={s.id} className="check small"><input type="checkbox" checked={f.shop_ids.includes(s.id)} onChange={() => toggle('shop_ids', s.id)} />{s.name}</label>)}</div></Field>}
      <Field label="Kênh áp dụng (bỏ trống = tất cả)"><div className="row wrap">{channels.map((c) => <label key={c.id} className="check small"><input type="checkbox" checked={f.channel_ids.includes(c.id)} onChange={() => toggle('channel_ids', c.id)} />{c.name}</label>)}</div></Field>
      <label className="check"><input type="checkbox" checked={f.stackable} onChange={(e) => set({ stackable: e.target.checked })} />Cộng dồn với khuyến mãi khác (không tick: chỉ áp cái giảm nhiều nhất)</label>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />Đang chạy</label>
      <ErrorBox error={error} />
    </Modal>
  );
}
