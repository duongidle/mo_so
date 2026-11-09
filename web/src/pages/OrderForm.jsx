import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Empty, ErrorBox, Field, Fold, PageHeader, Section, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import MoneyFill from '../components/MoneyFill.jsx';
import Icon from '../components/Icon.jsx';
import ProductThumb from '../components/ProductThumb.jsx';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { vnd, num } from '../lib.js';
import {
  addVariant, allocationProblems, activeEdit, buildPayload, computeTotals, editFromPlanned, editMismatches, lineTotal,
  paymentsFor, previewNotes, serverLines, setCell, startEdit, toMoney, toQty, validateForm,
} from '../lib/orderForm.js';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`);

export default function OrderForm() {
  const { id } = useParams();
  const state = useAsync(() => (id ? api.get(`/orders/${id}`) : Promise.resolve({ data: null })), [id]);
  if (!id) return <Form order={null} />;
  return (
    <Async state={state}>
      {({ data: o }) => (!['draft', 'confirmed'].includes(o.status) ? <Navigate to={`/orders/${o.id}`} replace /> : <Form order={o} />)}
    </Async>
  );
}

function Form({ order }) {
  const isEdit = !!order;
  const nav = useNavigate();
  const { shop: current, shops, channels, allChannels, methodList } = useSession();
  const shop = isEdit ? shops.find((s) => s.id === order.shop_id) : current;
  const shopId = shop?.id;

  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [openSearch, setOpenSearch] = useState(false);
  const [results, setResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [edits, setEdits] = useState({});
  const [channelId, setChannelId] = useState(order?.channel_id || 'direct');
  const [externalId, setExternalId] = useState(order?.external_id || '');
  const [customer, setCustomer] = useState(null);
  const [customerCredit, setCustomerCredit] = useState(0);
  const [address, setAddress] = useState(order?.shipping_address || '');
  const [discount, setDiscount] = useState(order?.discount_amount || 0);
  const [shipping, setShipping] = useState(order?.shipping_fee || 0);
  const [platformFee, setPlatformFee] = useState(order?.platform_fee_amount || 0);
  const [sellerShipping, setSellerShipping] = useState(order?.seller_shipping_amount || 0);
  const [note, setNote] = useState(order?.note || '');
  const [dueDate, setDueDate] = useState(order?.due_date || '');
  const revise = isEdit && order.status === 'confirmed'; // đơn đã xác nhận, hàng còn ở shop: sửa được, kho trừ lại
  const [promoCode, setPromoCode] = useState('');
  const [promo, setPromo] = useState(null); // kết quả POST /loyalty/promotions/evaluate
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState(null);
  const [manualOpen, setManualOpen] = useState({});
  const [localErrors, setLocalErrors] = useState([]);
  const key = useRef(newKey());
  const { busy, error, run, clear } = useAction();

  const channel = (isEdit ? allChannels : channels).find((c) => c.id === channelId);
  const marketplace = !!channel?.is_marketplace;

  useEffect(() => {
    if (!customer?.id || !shopId || marketplace) { setCustomerCredit(0); if (method === 'customer_credit') setMethod('cash'); return undefined; }
    let off = false;
    api.get(`/customers/${customer.id}`, { shop_id: shopId }).then((r) => { if (!off) { const balance = r.data.credit_balance || 0; setCustomerCredit(balance); if (!balance && method === 'customer_credit') setMethod('cash'); } }).catch(() => { if (!off) { setCustomerCredit(0); if (method === 'customer_credit') setMethod('cash'); } });
    return () => { off = true; };
  }, [customer?.id, shopId, marketplace, method]);

  // Tìm sản phẩm niêm yết ở shop
  useEffect(() => {
    if (!shopId) return undefined;
    let off = false;
    api.get('/variants', { shop_id: shopId, channel_id: channelId, q: dq || undefined, limit: 20 }).then((r) => !off && setResults(r.data)).catch(() => !off && setResults([]));
    return () => { off = true; };
  }, [shopId, dq, channelId]);

  // Đổi kênh khi tạo đơn mới: dòng đã thêm lấy lại giá theo kênh (giá riêng của kênh nếu có)
  useEffect(() => {
    if (isEdit || !shopId || !lines.length) return undefined;
    let off = false;
    Promise.all(lines.map((l) => api.get('/variants', { shop_id: shopId, channel_id: channelId, q: l.sku, all: 1, limit: 5 }).then((r) => r.data.find((v) => v.id === l.variant_id)?.price ?? null).catch(() => null)))
      .then((prices) => { if (!off) setLines((ls) => ls.map((l, i) => (prices[i] != null && prices[i] !== l.price ? { ...l, price: prices[i] } : l))); });
    return () => { off = true; };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tạo đơn mới: đổi shop thì giỏ cũ không còn đúng giá/niêm yết
  useEffect(() => { if (!isEdit) { setLines([]); setEdits({}); setCustomer(null); } }, [shopId, isEdit]);

  // Sửa đơn nháp: nạp dòng (kèm giá vốn/tồn từ danh sách biến thể), khách, phân bổ tay đã lưu
  useEffect(() => {
    if (!order) return undefined;
    let off = false;
    (async () => {
      const base = order.lines.map((l) => ({
        uid: l.id, is_gift: !!l.is_gift, variant_id: l.variant_id, sku: l.sku, kind: 'single', name: l.name, image_url: l.image_url, qty: l.qty, price: l.unit_price, discount: l.discount_amount,
        avg_cost: null, on_hand_total: null, stock_by_warehouse: [],
      }));
      const ed = {};
      base.forEach((l, i) => {
        const e = editFromPlanned(l, order.lines[i].planned_allocations, l.variant_id);
        if (e) ed[l.uid] = e;
      });
      if (!off) { setLines(base); setEdits(ed); }
      const enriched = await Promise.all(base.map(async (l) => {
        try {
          const r = await api.get('/variants', { shop_id: order.shop_id, q: l.sku, all: 1, limit: 10 });
          const v = r.data.find((x) => x.id === l.variant_id);
          return v ? { ...l, kind: v.kind, avg_cost: v.avg_cost, on_hand_total: v.on_hand_total, stock_by_warehouse: v.stock_by_warehouse } : l;
        } catch { return l; }
      }));
      if (!off) setLines((cur) => cur.map((l) => enriched.find((e) => e.uid === l.uid) || l));
      if (order.customer_id) {
        try { const c = await api.get(`/customers/${order.customer_id}`); if (!off) setCustomer(c.data); } catch { if (!off) setCustomer({ id: order.customer_id, name: order.customer_name, phone: order.customer_phone }); }
      }
    })();
    return () => { off = true; };
  }, [order]);

  const promoDiscount = !isEdit && promo ? promo.total_discount : 0;
  const totals = useMemo(() => computeTotals({ lines, discount: toMoney(discount) + promoDiscount, shipping, platformFee, sellerShipping, marketplace }), [lines, discount, promoDiscount, shipping, platformFee, sellerShipping, marketplace]);

  // Xem trước phân bổ kho: làm mới (trễ 300ms) khi dòng đổi
  const sig = JSON.stringify(serverLines(lines, edits, { withPrice: false }));
  const dsig = useDebounced(sig, 300);
  useEffect(() => {
    const ls = JSON.parse(dsig);
    if (!shopId || !ls.length) { setPreview(null); setPreviewErr(null); return undefined; }
    let off = false;
    api.post('/orders/allocation-preview', { shop_id: shopId, lines: ls })
      .then((r) => { if (!off) { setPreview(r.data); setPreviewErr(null); } })
      .catch((e) => { if (!off) setPreviewErr(e); });
    return () => { off = true; };
  }, [dsig, shopId]);

  // Khuyến mãi (Loyalty): máy chủ tính, đây chỉ xem trước. Tạo đơn thì máy chủ tính lại.
  useEffect(() => {
    if (isEdit || !shopId || !lines.length) { setPromo(null); return undefined; }
    let off = false;
    const t = setTimeout(() => {
      api.post('/loyalty/promotions/evaluate', { shop_id: shopId, channel_id: channelId, customer_id: customer?.id || null, code: promoCode || null, lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty, unit_price: l.price, discount_amount: l.discount || 0 })) })
        .then((r) => !off && setPromo(r.data)).catch(() => !off && setPromo(null));
    }, 300);
    return () => { off = true; clearTimeout(t); };
  }, [dsig, shopId, channelId, customer?.id, promoCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const upd = (uid, patch) => setLines((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const pick = (v) => { setLines((ls) => addVariant(ls, v)); setQ(''); setOpenSearch(false); };
  const problems = allocationProblems(lines, edits);
  const notes = previewNotes(preview);
  const onCustomer = (c) => {
    setCustomer(c);
    if (c?.address && !address.trim()) setAddress(c.address);
  };

  const finish = (o) => nav(`/orders/${o.id}`);
  const submit = (status) => {
    const errs = validateForm({ lines, discount, edits, totals });
    setLocalErrors(errs);
    if (errs.length) return undefined;
    return run(async () => {
      const common = { shopId, channelId, externalId, customerId: customer?.id, address, lines, edits, discount, shipping, platformFee, sellerShipping, marketplace, note, dueDate };
      const collected = method === 'customer_credit' && paid === '' ? Math.min(totals.amountDue, customerCredit) : paid;
      const payments = paymentsFor(status, collected, totals.amountDue, method);
      const askNegative = (e) => e.code === 'STOCK_NOT_ENOUGH' && status !== 'draft' && window.confirm(`${e.message}\n\nVẫn xác nhận và cho phép âm kho?`);
      try {
        if (!isEdit) {
          const body = buildPayload({ ...common, status, payments });
          try {
            finish((await api.post('/orders', { ...body, auto_promotions: true, promotion_code: promoCode || null }, { 'Idempotency-Key': key.current })).data);
          } catch (e) {
            key.current = newKey(); // lỗi 4xx được lưu theo khoá; thử lại phải dùng khoá mới
            if (!askNegative(e)) throw e;
            finish((await api.post('/orders', { ...body, auto_promotions: true, promotion_code: promoCode || null, allow_negative_stock: true }, { 'Idempotency-Key': key.current })).data);
          }
          return;
        }
        await api.patch(`/orders/${order.id}`, buildPayload(common));
        if (revise) { nav(`/orders/${order.id}`); return; }
        if (status !== 'draft') {
          try { await api.post(`/orders/${order.id}/status`, { status }); } catch (e) {
            if (!askNegative(e)) throw e;
            await api.post(`/orders/${order.id}/status`, { status, allow_negative_stock: true });
          }
          for (const p of payments) await api.post(`/orders/${order.id}/payments`, p);
        }
        nav(`/orders/${order.id}`);
      } catch (e) {
        key.current = newKey();
        throw e;
      }
    });
  };

  if (!shop) return <div className="page"><Empty>Chọn một shop cụ thể (không phải “Tất cả shop”) để tạo đơn.</Empty></div>;

  const itemCount = lines.reduce((a, l) => a + l.qty, 0);
  const lineWarn = (l) => (l.on_hand_total !== null && l.on_hand_total !== undefined && l.qty > l.on_hand_total ? `Tồn chỉ còn ${num(l.on_hand_total)}` : null);

  const showAlloc = lines.length > 0 && (previewErr || (preview && (preview.warehouses.length > 1 || notes.short.length > 0 || notes.elsewhere.length > 0)));

  return (
    <div className="page of stack">
      <PageHeader title={isEdit ? `Sửa đơn ${order.code}` : 'Đơn mới'} sub={`Shop ${shop.name}${isEdit ? ' · đơn nháp' : ''}`} />

      <div className="of-grid">
        <div className="stack of-main">
          <Section title={`Sản phẩm${itemCount ? ` (${itemCount})` : ''}`}>
            <div className="stack">
              <div className="of-search">
                <div className="searchbox">
                  <Icon name="search" />
                  <input
                    value={q}
                    autoFocus={!isEdit}
                    onChange={(e) => { setQ(e.target.value); setOpenSearch(true); }}
                    onFocus={() => setOpenSearch(true)}
                    onBlur={() => setTimeout(() => setOpenSearch(false), 150)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && results.length >= 1 && q) { e.preventDefault(); pick(results[0]); } if (e.key === 'Escape') setOpenSearch(false); }}
                    placeholder="Tìm SKU hoặc tên sản phẩm…"
                    aria-label="Tìm sản phẩm"
                    autoComplete="off"
                  />
                </div>
                {openSearch && (
                  <div className="of-results" role="listbox" aria-label="Kết quả sản phẩm">
                    {results.length === 0 && <div className="small muted" style={{ padding: '12px 16px' }}>{q ? 'Không tìm thấy trong shop này.' : 'Shop chưa niêm yết sản phẩm nào.'}</div>}
                    {results.map((v) => (
                      <div key={v.id} role="option" aria-selected="false" className="pick" onMouseDown={(e) => { e.preventDefault(); pick(v); }}>
                        <ProductThumb src={v.image_url} name={v.product_name} size={44} />
                        <div className="grow">
                          <div>{v.product_name}{v.variant_name ? ` — ${v.variant_name}` : ''}{v.kind === 'bundle' && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}</div>
                          <div className="small muted">
                            {v.sku} · {v.kind === 'bundle' ? 'bán được' : 'tồn'} {num(v.on_hand_total ?? v.on_hand)}
                            {v.stock_by_warehouse?.length > 1 && ` (${v.stock_by_warehouse.map((w) => `${w.warehouse_name} ${num(w.on_hand)}`).join(' · ')})`}
                          </div>
                        </div>
                        <b className="num">{vnd(v.price)}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {lines.length === 0 ? (
                <div className="of-empty muted">Gõ tên hoặc SKU ở ô trên rồi chọn sản phẩm để thêm vào đơn.</div>
              ) : (
                <div className="of-lines">
                  {lines.map((l) => (
                    <div key={l.uid} className="of-line">
                      <ProductThumb src={l.image_url} name={l.name} size={44} />
                      <div className="of-name">
                        <div>{l.name}{l.kind === 'bundle' && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}</div>
                        <div className="small muted">{l.sku}{l.on_hand_total !== null && l.on_hand_total !== undefined ? ` · tồn ${num(l.on_hand_total)}` : ''}</div>
                        {lineWarn(l) && <div className="small h-yellow">{lineWarn(l)}</div>}
                      </div>
                      <div className="of-edit">
                        <span className="qty">
                          <button type="button" onClick={() => upd(l.uid, { qty: l.qty - 1 })} aria-label={`Giảm ${l.sku}`}>−</button>
                          <span>{l.qty}</span>
                          <button type="button" onClick={() => upd(l.uid, { qty: l.qty + 1 })} aria-label={`Tăng ${l.sku}`}>+</button>
                        </span>
                        <label className="of-fld"><span className="small muted">Đơn giá</span>
                          <MoneyInput className="of-money" value={l.price} onChange={(e) => upd(l.uid, { price: toMoney(e.target.value) })} aria-label={`Đơn giá ${l.sku}`} />
                        </label>
                        <label className="of-fld"><span className="small muted">Giảm</span>
                          <MoneyInput className="of-money" value={l.discount} onChange={(e) => upd(l.uid, { discount: toMoney(e.target.value) })} aria-label={`Giảm giá ${l.sku}`} />
                        </label>
                        <b className="num of-total">{vnd(lineTotal(l))}</b>
                      </div>
                      <button type="button" className="btn sm of-remove" onClick={() => upd(l.uid, { qty: 0 })} aria-label={`Bỏ ${l.sku}`}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {showAlloc && (
            <Section title="Lấy hàng từ kho">
              <AllocationPanel
                lines={lines} edits={edits} setEdits={setEdits} preview={preview} previewErr={previewErr} notes={notes}
                manualOpen={manualOpen} setManualOpen={setManualOpen}
              />
            </Section>
          )}

          <Section className="of-more">
            <Fold title="Thêm tuỳ chọn (mã đơn kênh, địa chỉ, ghi chú)">
              <div className="grid cols-2 collapse">
                <Field label="Mã đơn trên kênh (nếu có)">
                  <input value={externalId} onChange={(e) => setExternalId(e.target.value)} disabled={isEdit} aria-label="Mã đơn kênh" />
                </Field>
                <Field label="Địa chỉ giao hàng"><textarea value={address} onChange={(e) => setAddress(e.target.value)} style={{ minHeight: 44 }} aria-label="Địa chỉ giao hàng" /></Field>
              </div>
              <Field label="Ghi chú"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Khách dặn gì, giao giờ nào…" aria-label="Ghi chú đơn" style={{ minHeight: 56 }} /></Field>
            </Fold>
          </Section>
        </div>

        <div className="stack of-side">
          <Section title="Khách hàng">
            <div className="stack">
              <Field label="Bán qua kênh">
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={isEdit} aria-label="Kênh">
                  {(isEdit ? allChannels : channels).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <CustomerPicker shopId={shopId} value={customer} onChange={onCustomer} subtotal={totals.afterLines} onApplyDiscount={(v) => setDiscount(v)} />
            </div>
          </Section>

          {!isEdit && (
            <Section title="Khuyến mãi">
              <div className="stack">
                <Field label="Mã giảm giá (nếu có)"><input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Ví dụ: GIAM50" aria-label="Mã giảm giá" /></Field>
                {promo?.code_status && !promo.code_status.ok && promoCode && <div className="alert err small" role="alert">{promo.code_status.reason}</div>}
                {promo?.applied?.length > 0
                  ? promo.applied.map((a) => <div key={a.id} className="ledger-line"><span>{a.name}</span><span className="num h-green">{a.kind === 'gift' ? `Tặng ${promo.gifts.find((g) => g.promotion_id === a.id)?.product_name || ''} × ${promo.gifts.find((g) => g.promotion_id === a.id)?.qty || 1}` : `−${vnd(a.amount)}`}</span></div>)
                  : <span className="muted small">Chưa có khuyến mãi nào áp dụng cho giỏ hàng này.</span>}
              </div>
            </Section>
          )}

          <Section title="Tiền">
            <div className="stack">
              <div className="grid cols-2 collapse">
                <Field label="Giảm giá đơn"><MoneyInput value={discount} onChange={(e) => setDiscount(toMoney(e.target.value))} aria-label="Giảm giá đơn" /></Field>
                <Field label="Phí ship khách trả"><MoneyInput value={shipping} onChange={(e) => setShipping(toMoney(e.target.value))} aria-label="Phí ship khách trả" /></Field>
                {marketplace && <Field label="Phí sàn"><MoneyInput value={platformFee} onChange={(e) => setPlatformFee(toMoney(e.target.value))} aria-label="Phí sàn" /></Field>}
                <Field label={marketplace ? 'Ship shop chịu' : 'Ship shop tự trả hãng vận chuyển'}><MoneyInput value={sellerShipping} onChange={(e) => setSellerShipping(toMoney(e.target.value))} aria-label="Ship shop chịu" /></Field>
              </div>
              <div>
                <div className="ledger-line"><span>Tạm tính</span><span className="num">{vnd(totals.subtotal)}</span></div>
                {totals.lineDiscount + totals.orderDiscount > 0 && <div className="ledger-line"><span>Giảm giá{promoDiscount > 0 ? ' (gồm khuyến mãi)' : ''}</span><span className="num">−{vnd(totals.lineDiscount + totals.orderDiscount)}</span></div>}
                {toMoney(shipping) > 0 && <div className="ledger-line"><span>Phí ship khách trả</span><span className="num">{vnd(shipping)}</span></div>}
                <div className="ledger-line total"><span>Khách phải trả</span><span className="num" data-testid="total">{vnd(totals.total)}</span></div>
                {toMoney(sellerShipping) > 0 && !marketplace && <div className="ledger-line"><span>Ship shop tự trả</span><span className="num">−{vnd(sellerShipping)}</span></div>}
                {marketplace && <div className="ledger-line"><span>Shop thực nhận</span><span className="num" data-testid="net">{vnd(totals.net)}</span></div>}
                <div className="ledger-line small muted"><span>Lãi gộp (ước tính)</span><span className="num" data-testid="profit">{totals.profit === null ? '—' : vnd(totals.profit)}</span></div>
              </div>
            </div>
          </Section>

          <Section title="Thanh toán">
            <div className="grid cols-2 collapse">
              <Field label={method === 'customer_credit' ? 'Số tiền dùng từ tiền gửi' : 'Số tiền thu'} hint={method === 'customer_credit' ? `Còn ${vnd(customerCredit)} trong shop này` : 'Để trống: Bán xong thu đủ, Xác nhận không thu'}>
                <MoneyFill fill={method === 'customer_credit' ? Math.min(totals.amountDue, customerCredit) : totals.amountDue} label="Thu đủ" value={paid} placeholder={String(method === 'customer_credit' ? Math.min(totals.amountDue, customerCredit) : totals.amountDue)} onChange={(e) => setPaid(e.target.value === '' ? '' : String(toMoney(e.target.value)))} aria-label="Số tiền thu" />
              </Field>
              <Field label="Phương thức">
                <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Phương thức thanh toán">{methodList(method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}{customerCredit > 0 && !marketplace && <option value="customer_credit">Tiền khách gửi</option>}</select>
              </Field>
            </div>
            {!marketplace && <Field label="Hạn thanh toán phần còn nợ (tuỳ chọn)" hint="Để trống: dùng số ngày công nợ mặc định trong Cài đặt (nếu có)"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Hạn thanh toán" /></Field>}
            {customerCredit > 0 && !marketplace && <p className="small muted">Khách còn {vnd(customerCredit)} tiền gửi trong shop này.</p>}
          </Section>
        </div>
      </div>

      <div className="of-actions no-print">
        <div className="of-actions-in">
          <div className="of-sum">
            <span className="small muted">Khách phải trả</span>
            <b className="num">{vnd(totals.total)}</b>
          </div>
          {(localErrors.length > 0 || error) && <div className="of-errors">
            {localErrors.length > 0 && <div className="alert err small" role="alert">{localErrors[0]}</div>}
            <ErrorBox error={error} />
          </div>}
          <div className="of-btns">
            {revise ? (
              <button type="button" className="btn primary" aria-label="Lưu thay đổi" disabled={busy || problems.length > 0} onClick={() => submit('confirmed')}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
            ) : (<>
              <button type="button" className="btn" aria-label="Lưu nháp" disabled={busy} onClick={() => submit('draft')}>Lưu nháp</button>
              <button type="button" className="btn" aria-label="Xác nhận đơn" disabled={busy || problems.length > 0} onClick={() => submit('confirmed')}>Xác nhận</button>
              <button type="button" className="btn primary" aria-label="Bán xong" disabled={busy || problems.length > 0} onClick={() => submit('completed')}>{busy ? 'Đang lưu…' : 'Bán xong'}</button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Phân bổ kho từng dòng: tự động (đề xuất của server) hoặc chia tay theo kho */
function AllocationPanel({ lines, edits, setEdits, preview, previewErr, notes, manualOpen, setManualOpen }) {
  if (previewErr && !preview) return <div className="alert err small">{previewErr.message}</div>;
  if (!preview) return <span className="muted small">Đang tính…</span>;
  const multi = preview.warehouses.length > 1;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {previewErr && <div className="alert err small">{previewErr.message}</div>}
      {!multi && <div className="small muted">Shop lấy hàng từ một kho: <b>{preview.warehouses[0]?.name}</b>.</div>}
      {notes.short.length > 0 && (
        <div className="alert warn small">
          Thiếu hàng: {notes.short.map((s) => `${s.sku} còn ${num(s.on_hand_total)}, cần ${num(s.required)}`).join('; ')}. Xác nhận đơn sẽ hỏi cho phép âm kho.
        </div>
      )}
      {notes.elsewhere.length > 0 && !lines.some((l) => activeEdit(l, edits[l.uid])) && (
        <div className="alert warn small">Có hàng lấy từ kho phụ: {notes.elsewhere.map((e) => `${e.sku} × ${e.qty} từ ${e.warehouse_name}`).join('; ')}.</div>
      )}
      {lines.map((l, i) => {
        const pl = preview.lines[i];
        const fresh = pl && pl.variant_id === l.variant_id && pl.qty === l.qty;
        const edit = activeEdit(l, edits[l.uid]);
        const mism = edit ? editMismatches(edit) : [];
        const open = !!manualOpen[l.uid] && multi;
        return (
          <div key={l.uid} className="of-alloc">
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="small"><b>{l.sku}</b> × {l.qty}</div>
                <div className="small muted">
                  {!fresh ? 'Đang tính…' : pl.items.map((it) => `${it.warehouse_name} × ${it.qty}${l.kind === 'bundle' ? ` (${it.sku})` : ''}`).join(', ')}
                  {edit && ' · chia tay'}
                </div>
              </div>
              {multi && fresh && (
                <button type="button" className="btn sm" onClick={() => {
                  if (open) { setManualOpen({ ...manualOpen, [l.uid]: false }); return; }
                  if (!edit) setEdits({ ...edits, [l.uid]: startEdit(l, pl) });
                  setManualOpen({ ...manualOpen, [l.uid]: true });
                }}>{open ? 'Thu gọn' : 'Chia kho'}</button>
              )}
            </div>
            {open && edit && (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {Object.keys(edit.required).map((vid) => {
                  const stock = preview.stock.find((s) => s.variant_id === vid);
                  const sku = pl?.items.find((it) => it.variant_id === vid)?.sku || l.sku;
                  const sum = Object.values(edit.cells[vid] || {}).reduce((a, n) => a + n, 0);
                  return (
                    <div key={vid} className="stack" style={{ gap: 8 }}>
                      <div className="row between small"><span>{sku}</span><span className={sum === edit.required[vid] ? 'muted' : 'h-red'}>{sum}/{edit.required[vid]}</span></div>
                      {preview.warehouses.map((w) => {
                        const onHand = stock?.warehouses.find((x) => x.warehouse_id === w.id)?.on_hand ?? 0;
                        const val = edit.cells[vid]?.[w.id] || 0;
                        return (
                          <label key={w.id} className="of-cell small">
                            <span className="grow">{w.name}<span className="muted"> · tồn {num(onHand)}</span></span>
                            <input type="number" inputMode="numeric" min="0" value={val} onChange={(e) => setEdits({ ...edits, [l.uid]: setCell(edit, vid, w.id, toQty(e.target.value)) })} aria-label={`${sku} lấy từ ${w.name}`} style={{ width: 84, minHeight: 40 }} />
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
                {mism.length > 0 && <div className="small h-red" role="alert">Chia kho đang lệch: tổng phải bằng số lượng cần.</div>}
                <button type="button" className="btn sm" onClick={() => { const { [l.uid]: _drop, ...rest } = edits; setEdits(rest); setManualOpen({ ...manualOpen, [l.uid]: false }); }}>Về tự động</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
