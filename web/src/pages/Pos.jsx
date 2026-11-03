import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Card, Field, ErrorBox, useAction, useDebounced, Empty } from '../components/ui.jsx';
import { vnd, num, METHODS } from '../lib.js';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`);

export default function Pos() {
  const { shop, shops, setShopId, channels } = useSession();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [channel, setChannel] = useState('direct');
  const [cust, setCust] = useState({ phone: '', name: '' });
  const [tier, setTier] = useState(null);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [method, setMethod] = useState('cash');
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const { busy, error, run, clear } = useAction();
  const searchRef = useRef(null);

  useEffect(() => {
    if (!shop) return;
    let off = false;
    api.get('/variants', { shop_id: shop.id, warehouse_id: shop.default_warehouse_id, q: dq, limit: 20 }).then((r) => !off && setResults(r.data)).catch(() => !off && setResults([]));
    return () => { off = true; };
  }, [shop, dq]);

  // Đổi shop thì giỏ cũ không còn đúng giá/niêm yết
  useEffect(() => { setCart([]); }, [shop?.id]);

  const sub = useMemo(() => cart.reduce((a, l) => a + l.qty * l.price - l.discount, 0), [cart]);
  const total = Math.max(0, sub - orderDiscount) + shipping;
  const add = (v) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.id === v.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { id: v.id, sku: v.sku, name: v.variant_name ? `${v.product_name} — ${v.variant_name}` : v.product_name, price: v.price, qty: 1, discount: 0, on_hand: v.on_hand }];
    });
    setQ('');
    searchRef.current?.focus();
  };
  const upd = (id, patch) => setCart((c) => c.map((l) => (l.id === id ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));

  const lookup = async () => {
    setTier(null);
    if (cust.phone.replace(/\D/g, '').length < 9) return;
    try {
      const r = await api.get('/customers/lookup', { phone: cust.phone });
      if (r.data) {
        setCust((c) => ({ ...c, name: c.name || r.data.name }));
        const l = await api.get(`/loyalty/customers/${r.data.id}`);
        setTier({ ...l.data, name: r.data.name });
      }
    } catch { /* tra cứu lỗi không chặn bán hàng */ }
  };

  const submit = (status) =>
    run(async () => {
      const payload = {
        shop_id: shop.id,
        channel_id: channel,
        customer: cust.phone || cust.name ? { phone: cust.phone || null, name: cust.name || null } : null,
        lines: cart.map((l) => ({ variant_id: l.id, qty: l.qty, unit_price: l.price, discount_amount: l.discount })),
        discount_amount: orderDiscount,
        shipping_fee: shipping,
        status,
        payments: status === 'completed' && total > 0 ? [{ amount: total, method }] : [],
      };
      const r = await api.post('/orders?source=pos', payload, { 'Idempotency-Key': key.current });
      setDone(r.data);
    });

  const reset = () => {
    setCart([]); setCust({ phone: '', name: '' }); setTier(null); setOrderDiscount(0); setShipping(0); setDone(null); clear();
    key.current = newKey();
  };

  if (!shop) return <div className="page"><Empty>Chưa có shop nào. Tạo shop trong Cài đặt.</Empty></div>;

  if (done) {
    return (
      <div className="page stack" style={{ maxWidth: 520 }}>
        <div className="alert ok"><span className="seal">ĐÃ CHỐT</span> Đơn <b>{done.code}</b> — {vnd(done.total_amount)}</div>
        <div className="row wrap">
          <a className="btn" href={`/api/v1/orders/${done.id}/receipt`} target="_blank" rel="noreferrer">In phiếu A5</a>
          <a className="btn" href={`/api/v1/orders/${done.id}/receipt?size=80mm`} target="_blank" rel="noreferrer">In phiếu 80mm</a>
          <Link className="btn" to={`/orders/${done.id}`}>Xem đơn</Link>
          <button className="btn primary" onClick={reset} autoFocus>Đơn mới</button>
        </div>
      </div>
    );
  }

  const suggested = tier ? Math.round((sub * tier.tier.discount_pct) / 100) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Bán nhanh</h1>
        {shops.length > 1 && <span className="muted small">Shop: <b>{shop.name}</b></span>}
      </div>
      <div className="pos-grid">
        <div className="stack">
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm SKU hoặc tên sản phẩm…" aria-label="Tìm sản phẩm" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && results.length === 1) add(results[0]); }} />
          <div className="card flat">
            {results.length === 0 ? <Empty>{q ? 'Không tìm thấy trong shop này.' : 'Shop chưa niêm yết sản phẩm nào.'}</Empty> : results.map((v) => (
              <div key={v.id} className="pick" onClick={() => add(v)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && add(v)}>
                <div className="grow"><div>{v.product_name}{v.variant_name ? ` — ${v.variant_name}` : ''}</div><div className="small muted">{v.sku} · {v.kind === 'bundle' ? 'combo, bán được' : 'tồn'} {num(v.on_hand)}</div></div>
                <b className="num">{vnd(v.price)}</b>
              </div>
            ))}
          </div>
        </div>

        <Card title={`Giỏ hàng (${cart.reduce((a, l) => a + l.qty, 0)})`}>
          <div className="stack">
            {cart.length === 0 && <span className="muted">Chọn sản phẩm bên trái để thêm vào giỏ.</span>}
            {cart.map((l) => (
              <div key={l.id} className="stack" style={{ gap: 4, borderBottom: '1px solid var(--hairline)', paddingBottom: 8 }}>
                <div className="row between"><span>{l.name}</span><b className="num">{vnd(l.qty * l.price - l.discount)}</b></div>
                <div className="row between">
                  <span className="qty">
                    <button onClick={() => upd(l.id, { qty: l.qty - 1 })} aria-label="Giảm">−</button><span>{l.qty}</span><button onClick={() => upd(l.id, { qty: l.qty + 1 })} aria-label="Tăng">+</button>
                  </span>
                  <span className="row small"><span className="muted">Giá</span>
                    <input type="number" inputMode="numeric" min="0" value={l.price} onChange={(e) => upd(l.id, { price: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 110, minHeight: 36 }} aria-label="Đơn giá" />
                  </span>
                </div>
                {l.qty > l.on_hand && <span className="small h-yellow">Tồn chỉ còn {num(l.on_hand)}</span>}
              </div>
            ))}

            {cart.length > 0 && (
              <>
                <div className="grid cols-2">
                  <Field label="SĐT khách"><input inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} onBlur={lookup} /></Field>
                  <Field label="Tên khách"><input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></Field>
                </div>
                {tier && (
                  <div className="alert warn small">
                    {tier.name}: hạng <b>{tier.tier.name}</b>{tier.tier.discount_pct > 0 && <> — gợi ý giảm {tier.tier.discount_pct}% ({vnd(suggested)}) <button className="btn sm" onClick={() => setOrderDiscount(suggested)}>Áp dụng</button></>}
                  </div>
                )}
                <div className="grid cols-2">
                  <Field label="Giảm giá đơn"><input type="number" inputMode="numeric" min="0" value={orderDiscount} onChange={(e) => setOrderDiscount(Math.max(0, Number(e.target.value) || 0))} /></Field>
                  <Field label="Phí ship khách trả"><input type="number" inputMode="numeric" min="0" value={shipping} onChange={(e) => setShipping(Math.max(0, Number(e.target.value) || 0))} /></Field>
                  <Field label="Kênh">
                    <select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  </Field>
                  <Field label="Thanh toán">
                    <select value={method} onChange={(e) => setMethod(e.target.value)}>{['cash', 'bank', 'cod', 'ewallet', 'card'].map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}</select>
                  </Field>
                </div>
                <div className="row between" style={{ fontSize: 20 }}><b>Khách trả</b><b className="num">{vnd(total)}</b></div>
                <ErrorBox error={error} />
                <button className="btn primary" disabled={busy} onClick={() => submit('completed')} style={{ minHeight: 52, fontSize: 17 }}>{busy ? 'Đang lưu…' : 'Bán ngay'}</button>
                <div className="row">
                  <button className="btn grow" disabled={busy} onClick={() => submit('confirmed')}>Xác nhận (giao sau)</button>
                  <button className="btn" disabled={busy} onClick={() => submit('draft')}>Lưu nháp</button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
