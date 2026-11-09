import ProductThumb from '../components/ProductThumb.jsx';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, DateRange, Empty, ErrorBox, Field, LoadMore, Modal, PageHeader, SearchBox, Section, StatusBadge, Toolbar, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import ImportPanel from './Import.jsx';
import ExportOrders from '../components/ExportOrders.jsx';
import CustomFieldsPanel from '../components/CustomFieldsPanel.jsx';
import { vnd, num, fmtDate, STATUS, PAY_STATUS } from '../lib.js';
import MoneyInput from '../components/MoneyInput.jsx';
import MoneyFill from '../components/MoneyFill.jsx';
import ReturnModal, { emptyReturnForm } from './ReturnModal.jsx';
import ExchangeModal from './ExchangeModal.jsx';
import OrderFlow from '../components/OrderFlow.jsx';
import OrderActionBar from '../components/OrderActionBar.jsx';
import { ShipModal, SplitModal, ReserveModal, ShipmentsSection } from '../components/OrderActions.jsx';
import { codRefusedForm } from '../lib/returnForm.js';
import { reasonLabel } from '../lib/returnReasons.js';

const TABS = [['', 'Tất cả'], ['draft', 'Nháp'], ['confirmed', 'Đã xác nhận'], ['shipping', 'Đang giao'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã huỷ'], ['returned', 'Trả hàng']];
const PAY_CLASS = { paid: 'st-completed', partial: 'st-returned', unpaid: 'st-draft', refunded: 'st-returned' };

export function OrderList() {
  const { shopId, allChannels: channels } = useSession();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const [channel, setChannel] = useState(sp.get('channel') || '');
  const [text, setText] = useState('');
  const dq = useDebounced(text);
  const [range, setRange] = useState({ from: sp.get('from') || '', to: sp.get('to') || '' }); // từ link "Xem dữ liệu gốc" của báo cáo
  const [extra, setExtra] = useState([]);
  const [cursor, setCursor] = useState(null);
  const nav = useNavigate();
  const showImport = sp.get('import') === '1';
  const [showExport, setShowExport] = useState(false);
  const setImport = (on) => { const n = new URLSearchParams(sp); on ? n.set('import', '1') : n.delete('import'); setSp(n, { replace: true }); };
  const base = { shop_id: shopId === 'all' ? undefined : shopId, channel: channel || undefined, q: dq || undefined, from: range.from || undefined, to: range.to || undefined };
  const params = { ...base, status: status || undefined };
  const state = useAsync(async () => { setExtra([]); setCursor(null); return api.get('/orders', { ...params, limit: 50 }); }, [shopId, status, channel, dq, range.from, range.to]);
  // Số đơn trên từng tab: cùng bộ lọc với danh sách, trừ trạng thái. Lỗi thì tab chỉ không hiện số.
  const counts = useAsync(() => api.get('/orders/status-counts', base).catch(() => null), [shopId, channel, dq, range.from, range.to]);
  const cnt = counts.data?.data;
  const more = async (next) => {
    const r = await api.get('/orders', { ...params, limit: 50, cursor: next });
    setExtra((e) => [...e, ...r.data]);
    setCursor(r.next_cursor);
  };
  const chName = (id) => channels.find((c) => c.id === id)?.name;

  return (
    <div className="page stack">
      <PageHeader title="Đơn hàng" actions={<><button className="btn" onClick={() => setImport(true)}><Icon name="upload" />Nhập từ file</button><button className="btn" onClick={() => setShowExport(true)}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất file</button><Link to="/orders/new" className="btn primary"><Icon name="plus" />Đơn mới</Link></>} />
      <Toolbar>
        <Chips options={TABS.map(([v, l]) => [v, l, cnt ? (v === '' ? cnt.all : cnt[v] || 0) : undefined])} value={status} onChange={(v) => { const n = new URLSearchParams(sp); v ? n.set('status', v) : n.delete('status'); setSp(n); }} />
      </Toolbar>
      <Toolbar>
        <SearchBox value={text} onChange={setText} placeholder="Tìm mã đơn, tên, SĐT, mã vận đơn…" />
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Kênh"><option value="">Mọi kênh</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived_at ? ' (đã tắt)' : ''}</option>)}</select>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </Toolbar>
      <Async state={state}>
        {(res) => {
          const rows = [...res.data, ...extra];
          const next = extra.length || cursor ? cursor : res.next_cursor;
          if (!rows.length) return <Empty action={<Link to="/orders/new" className="btn primary">Tạo đơn</Link>}>Chưa có đơn nào khớp bộ lọc.</Empty>;
          return (
            <Card flat className="list-card sticky-head">
              <div className="table-wrap"><table className="stackable order-table">
                <thead><tr><th>Đơn</th><th>Khách</th><th className="hide-sm">Kênh</th><th className="hide-sm num">SP</th><th className="num">Khách phải trả</th><th>Thanh toán</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {rows.map((o) => {
                    const debt = o.status === 'completed' && (o.payment_status === 'unpaid' || o.payment_status === 'partial');
                    return (
                      <tr key={o.id} className="click" tabIndex={0} onClick={() => nav(`/orders/${o.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/orders/${o.id}`)}>
                        <td className="o1"><b style={{ whiteSpace: 'nowrap' }}>{o.code}</b>{o.stock_warning ? <span className="dotflag" title="Âm kho" aria-label="Âm kho" /> : null}{debt ? <span className="dotflag red" title="Còn nợ" aria-label="Còn nợ" /> : null}<span className="sub">{fmtDate(o.ordered_at)}{o.external_id ? ` · ${o.external_id}` : ''}</span></td>
                        <td className="o3 full">{o.customer_name || <span className="muted">Khách lẻ</span>}<span className="sub">{o.customer_phone || o.shop_name}<span className="only-sm"> · {chName(o.channel_id)}</span></span></td>
                        <td className="hide-sm"><span className="badge plain">{chName(o.channel_id)}</span></td>
                        <td className="hide-sm num">{num(o.item_count || 0)}</td>
                        <td className="num o2"><b>{vnd(o.total_amount)}</b></td>
                        <td className="o5"><span className={`badge ${PAY_CLASS[o.payment_status] || 'plain'}`}>{PAY_STATUS[o.payment_status]}</span></td>
                        <td className="o4"><StatusBadge status={o.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <LoadMore next={next} onMore={() => more(next)} />
            </Card>
          );
        }}
      </Async>
      {showExport && <ExportOrders filters={Object.fromEntries(Object.entries(params).filter(([, v]) => v))} onClose={() => setShowExport(false)} />}
      {showImport && <ImportPanel defaultShop={shopId} onClose={() => { setImport(false); state.reload(); counts.reload(); }} />}
    </div>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { allChannels: channels, methodLabels, methodList, warehouses } = useSession();
  const state = useAsync(() => api.get(`/orders/${id}`), [id]);
  const act = useAction();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  // Khoản do đối soát, tiền khách gửi hoặc phiếu trả hàng tạo ra thì xử lý ở nơi tạo ra chúng (khớp luật ở máy chủ)
  const voidable = (p) => p.method !== 'customer_credit' && p.method !== 'carrier_payout' && !(p.direction === 'out' && /^(Hoàn tiền trả hàng|Chuyển tiền trả hàng)/.test(p.note || ''));
  const voidPay = (p) => confirm(`Huỷ khoản ${vnd(p.amount)} ghi ngày ${fmtDate(p.paid_at)}? Số đã thu/còn nợ của đơn sẽ tính lại.`) && act.run(async () => { await api.post(`/payments/${p.id}/void`, {}); state.reload(); });

  return (
    <div className="page stack">
      <Async state={state}>
        {({ data: o }) => {
          const ch = channels.find((c) => c.id === o.channel_id);
          // Đơn huỷ đã nhận tiền (cọc): hoàn lại được tới số đã thu. Đơn khác: tới số còn nợ khách
          const refundMax = o.status === 'cancelled' && !o.is_marketplace ? o.paid_amount : o.refund_owed_amount;
          const doStatus = (status, note) => act.run(async () => { await api.post(`/orders/${o.id}/status`, { status, note }); setModal(null); state.reload(); });
          const doStatusForce = (status) => act.run(async () => {
            try { await api.post(`/orders/${o.id}/status`, { status }); } catch (e) {
              if (e.code === 'STOCK_NOT_ENOUGH' && confirm(`${e.message}\n\nVẫn xác nhận và cho phép âm kho?`)) await api.post(`/orders/${o.id}/status`, { status, allow_negative_stock: true });
              else throw e;
            }
            state.reload();
          });
          return (
            <>
              <PageHeader
                title={o.code}
                sub={`${o.shop_name} · ${ch?.name || ''}${o.external_id ? ` · ${o.external_id}` : ''} · ${fmtDate(o.ordered_at)}`}
                actions={<>{o.status === 'completed' && o.payment_status === 'paid' && <span className="seal">ĐÃ CHỐT</span>}<StatusBadge status={o.status} /><span className="badge plain">{PAY_STATUS[o.payment_status]}</span></>}
              />
              <ErrorBox error={act.error} />
              {o.stock_warning ? <div className="alert warn">Đơn này làm tồn kho âm. Kiểm tra kho thực tế và điều chỉnh nếu cần.</div> : null}
              {o.refund_owed_amount > 0 ? <div className="alert warn">Còn phải trả khách {vnd(o.refund_owed_amount)} (đã thu {vnd(o.paid_amount)}, số phải thu sau trả hàng thấp hơn). Hoàn bằng nút “Hoàn tiền”.</div> : o.needs_refund && <div className="alert warn">Đã thu nhiều hơn số cần thu ({vnd(o.paid_amount)}). Cần hoàn lại khách.</div>}
              <OrderFlow order={o} />
              <OrderActionBar
                o={o} busy={act.busy} refundMax={refundMax}
                onStatus={doStatusForce} onModal={setModal}
                onReturn={(form) => { setForm(form); setModal('return'); }}
                onPay={() => { setForm({ amount: o.amount_due, method: 'cash' }); setModal('pay'); }}
                onRefund={() => { setForm({ amount: refundMax, method: 'cash' }); setModal('refund'); }}
                onCancel={() => { setForm({ note: '' }); setModal('cancel'); }}
              />

              <div className="grid cols-2 collapse">
                <Section title="Khách">
                  {o.customer_id ? <Link to={`/customers/${o.customer_id}`}>{o.customer_name}</Link> : <span>{o.customer_name || 'Khách lẻ'}</span>}
                  <div className="small muted">{o.customer_phone}</div><div className="small">{o.shipping_address}</div>
                  {o.tracking_code && <div className="small">Vận đơn: {o.carrier} {o.tracking_code}</div>}
                  {o.note && <div className="small" style={{ marginTop: 8 }}>Ghi chú: {o.note}</div>}
                </Section>
                <Section title="Tiền">
                  <div className="stack small">
                    <Row l="Tiền hàng" v={o.subtotal} />
                    {(o.line_discount_amount + o.discount_amount) > 0 && <Row l="Giảm giá" v={-(o.line_discount_amount + o.discount_amount)} />}
                    {o.shipping_fee > 0 && <Row l="Phí ship khách trả" v={o.shipping_fee} />}
                    <Row l="Khách phải trả" v={o.total_amount} bold />
                    {o.platform_fee_amount > 0 && <Row l="Phí sàn" v={-o.platform_fee_amount} />}
                    {o.seller_shipping_amount > 0 && <Row l="Ship shop chịu" v={-o.seller_shipping_amount} />}
                    {o.returned_goods_amount > 0 && <Row l="Hàng trả" v={-o.returned_goods_amount} />}
                    {o.returned_shipping_amount > 0 && <Row l="Hoàn phí ship khách" v={-o.returned_shipping_amount} />}
                    {o.return_fee_amount > 0 && <Row l="Phí trả hàng thu được" v={o.return_fee_amount} />}
                    {o.return_shipping_cost > 0 && <Row l="Ship chiều về" v={-o.return_shipping_cost} />}
                    <Row l="Giá vốn" v={-o.cogs_amount} />
                    <Row l="Lợi nhuận gộp" v={o.gross_profit} bold />
                    <Row l="Đã thu" v={o.paid_amount} />
                    {o.refund_owed_amount > 0 && <Row l="Còn phải trả khách" v={o.refund_owed_amount} bold />}
                  </div>
                </Section>
              </div>

              <Section flush>
                <div className="table-wrap"><table>
                  <thead><tr><th>Sản phẩm</th><th className="num">SL</th><th className="num">Đơn giá</th><th className="num">Giá vốn</th><th className="num">Thành tiền</th></tr></thead>
                  <tbody>{o.lines.map((l) => (
                    <tr key={l.id}><td><div className="row" style={{ gap: 8 }}><ProductThumb src={l.image_url} name={l.name} size={36} /><div>{l.name}{l.is_gift ? <span className="badge plain" style={{ marginLeft: 8 }}>Quà tặng</span> : null}<div className="small muted">{l.sku}{l.returned_qty > 0 && ` · đã trả ${l.returned_qty}`}</div>{l.allocations?.length > 0 && <div className="small muted">Lấy từ: {l.allocations.map((a) => `${a.warehouse_name}${l.allocations.some((x) => x.sku !== l.sku) ? ` (${a.sku})` : ''} × ${a.qty}`).join(', ')}</div>}{!l.allocations?.length && l.planned_allocations?.length > 0 && <div className="small muted">Dự kiến lấy từ kho đã chọn tay</div>}</div></div></td><td className="num">{num(l.qty)}</td><td className="num">{vnd(l.unit_price)}</td><td className="num muted">{vnd(l.unit_cost)}</td><td className="num">{vnd(l.line_total)}</td></tr>
                  ))}</tbody>
                </table></div>
              </Section>

              <ShipmentsSection order={o} reload={state.reload} />
              {o.parent_order_id && <div className="alert ok small">Đơn này được tách từ một đơn khác. Xem ghi chú đơn.</div>}
              {o.status === 'completed' && o.amount_due > 0 && !o.is_marketplace && <div className="alert warn small row between"><span>Khách còn nợ {vnd(o.amount_due)}{o.due_date ? `, hạn ${fmtDate(o.due_date)}` : ', chưa đặt hạn thanh toán'}.</span><button className="btn sm" onClick={() => { setForm({ due: o.due_date || '' }); setModal('due'); }}>Đặt hạn</button></div>}
              {o.reserve_stock ? <div className="alert warn small">Đang giữ hàng cho đơn này{o.reserved_until ? ` đến ${o.reserved_until}` : ''}.</div> : null}
              <div className="grid cols-2 collapse">
                <Section title="Thanh toán">
                  {o.payments.length === 0 ? <span className="muted small">Chưa có khoản thu nào.</span> : o.payments.map((p) => (
                    <div key={p.id} className="row between small" style={p.voided_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                      <span>{fmtDate(p.paid_at)} · {p.method === 'customer_credit' ? 'Tiền khách gửi' : methodLabels[p.method] || p.method}{p.direction === 'out' && ' (hoàn / cộng tiền gửi)'}{p.voided_at && ' · đã huỷ'}</span>
                      <span className="row"><b>{p.direction === 'out' ? '−' : ''}{vnd(p.amount)}</b>{!p.voided_at && voidable(p) && <button type="button" className="btn sm" disabled={act.busy} onClick={() => voidPay(p)}>Huỷ</button>}</span>
                    </div>
                  ))}
                  {!o.is_marketplace && o.seller_shipping_amount > 0 && (
                    <div className="row between small" style={{ marginTop: 8 }}>
                      <span>Ship shop tự trả hãng vận chuyển: {vnd(o.seller_shipping_amount)}{o.seller_shipping_paid_amount > 0 && ` · đã trả ${vnd(o.seller_shipping_paid_amount)}`}</span>
                      {o.seller_shipping_due > 0 ? <button className="btn sm" onClick={() => { setForm({ amount: o.seller_shipping_due, method: 'cash' }); setModal('sellership'); }}>Ghi đã trả ({vnd(o.seller_shipping_due)})</button> : o.seller_shipping_paid_amount > 0 ? <b className="h-green">Đã trả đủ</b> : null}
                    </div>
                  )}
                  {o.seller_shipping_payments?.map((p) => (
                    <div key={p.id} className="row between small muted" style={p.voided_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                      <span>Trả ship {fmtDate(p.paid_at)} · {vnd(p.amount)}{p.voided_at && ' · đã huỷ'}</span>
                      {!p.voided_at && p.method !== 'carrier_payout' && <button type="button" className="btn sm" disabled={act.busy} onClick={() => voidPay(p)}>Huỷ</button>}
                    </div>
                  ))}
                  <ErrorBox error={act.error} />
                </Section>
                <Section title="Lịch sử">
                  {o.history.map((h) => <div key={h.id} className="small"><span className="muted">{fmtDate(h.created_at)}</span> · {h.from_status ? `${STATUS[h.from_status]} → ` : ''}{STATUS[h.to_status]}{h.note && ` (${h.note})`}</div>)}
                  {o.write_offs?.map((w) => <div key={w.id} className="small h-red">{w.code}: phiếu hàng huỷ, giá vốn {vnd(w.total_cost)} ({w.lines.map((x) => `${x.sku} ×${x.qty}`).join(', ')})</div>)}
                  {o.returns.map((r) => <div key={r.id} className="small h-yellow">{r.code}: trả hàng {vnd(r.goods_amount)}{r.shipping_refund_amount > 0 && `, hoàn ship ${vnd(r.shipping_refund_amount)}`}{r.return_fee_amount > 0 && `, phí trả hàng ${vnd(r.return_fee_amount)}`}{r.awaiting_goods ? <> · <b>Chờ hàng về</b> <button className="btn sm" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/returns/${r.id}/receive`, {}); state.reload(); })}>Đã nhận hàng, nhập kho</button> <button className="btn sm" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/returns/${r.id}/receive`, { damaged_line_ids: r.lines.map((x) => x.order_line_id) }); state.reload(); })}>Hàng về bị hỏng</button></> : r.goods_received_at && o.is_marketplace ? ' · Đã nhận hàng' : ''} · {reasonLabel(r.reason_code)}{r.reason && ` — ${r.reason}`}</div>)}
                </Section>
              </div>

              <CustomFieldsPanel entity="order" id={o.id} shopId={o.shop_id} />

              {modal === 'cancel' && (
                <Modal title="Huỷ đơn" onClose={() => setModal(null)} footer={<button className="btn danger" disabled={act.busy} onClick={() => doStatus('cancelled', form.note)}>Xác nhận huỷ</button>}>
                  <p className="muted small">Hàng đã trừ kho sẽ được cộng lại.</p>
                  <Field label="Lý do"><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'due' && (
                <Modal title="Hạn thanh toán" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.patch(`/orders/${o.id}`, { due_date: form.due || null }); setModal(null); state.reload(); })}>Lưu</button>}>
                  <Field label="Khách thanh toán trước ngày"><input type="date" value={form.due || ''} onChange={(e) => setForm({ ...form, due: e.target.value })} aria-label="Hạn thanh toán" /></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'ship' && <ShipModal order={o} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
              {modal === 'split' && <SplitModal order={o} onClose={() => setModal(null)} onDone={(childId) => { setModal(null); navigate(`/orders/${childId}`); }} />}
              {modal === 'reserve' && <ReserveModal order={o} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
              {modal === 'sellership' && (
                <Modal title="Ghi đã trả ship cho hãng vận chuyển" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/seller-shipping-payments`, { amount: Number(form.amount), method: form.method }); setModal(null); state.reload(); })}>Ghi nhận</button>}>
                  <p className="muted small">Tiền chi ra khỏi quỹ theo phương thức chọn. Không tính vào tiền khách trả của đơn.</p>
                  <Field label="Số tiền"><MoneyInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                  <Field label="Phương thức"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{methodList(form.method).filter(([k]) => k !== 'customer_credit').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'pay' && (
                <Modal title="Thu tiền" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/payments`, { amount: Number(form.amount), method: form.method }); setModal(null); state.reload(); })}>Ghi nhận</button>}>
                  <Field label={`Số tiền (còn phải thu ${vnd(o.amount_due)})`}><MoneyFill fill={o.amount_due} label="Thu đủ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus /></Field>
                  <Field label="Phương thức"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}{o.customer_credit_balance > 0 && !o.is_marketplace && <option value="customer_credit">Tiền khách gửi ({vnd(o.customer_credit_balance)})</option>}</select></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'refund' && (
                <Modal title="Hoàn tiền cho khách" onClose={() => setModal(null)} footer={<button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/orders/${o.id}/payments`, { amount: Number(form.amount), method: form.method, direction: 'out' }); setModal(null); state.reload(); })}>Ghi nhận hoàn tiền</button>}>
                  <Field label={`Số tiền (tối đa ${vnd(refundMax)})`}><MoneyFill fill={refundMax} label="Hoàn đủ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                  <Field label="Phương thức"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}{o.customer_id && !o.is_marketplace && <option value="customer_credit">Chuyển thành tiền khách gửi</option>}</select></Field>
                  <ErrorBox error={act.error} />
                </Modal>
              )}
              {modal === 'return' && <ReturnModal order={o} form={form} setForm={setForm} act={act} methodList={methodList} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
              {modal === 'exchange' && <ExchangeModal order={o} methodList={methodList} onClose={() => setModal(null)} onDone={(result) => navigate(`/orders/${result.created.id}`)} />}
              {modal === 'packaging' && <PackagingModal orderId={o.id} warehouses={warehouses} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
            </>
          );
        }}
      </Async>
    </div>
  );
}

function PackagingModal({ orderId, warehouses, onClose, onDone }) {
  const plan = useAsync(() => api.get(`/orders/${orderId}/packaging-plan`), [orderId]);
  const [lines, setLines] = useState([]);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => { if (plan.data?.data?.lines) setLines(plan.data.data.lines.map((x) => ({ variant_id: x.variant_id, qty: x.qty, name: x.name, sku: x.sku, unit: x.unit }))); }, [plan.data]);
  const change = (variantId, qty) => setLines((xs) => xs.map((x) => x.variant_id === variantId ? { ...x, qty } : x));
  const confirmed = plan.data?.data?.confirmed;
  return <Modal title="Xác nhận vật tư đóng gói" onClose={onClose} footer={confirmed ? <button className="btn primary" onClick={onClose}>Đóng</button> : <button className="btn primary" disabled={busy || !lines.length || !warehouseId} onClick={() => run(async () => { await api.post(`/orders/${orderId}/packaging-confirm`, { warehouse_id: warehouseId, lines: lines.map((x) => ({ variant_id: x.variant_id, qty: Number(x.qty) })), note: note || null }); onDone(); })}>Ghi nhận tiêu hao</button>}>
    <Async state={plan}>{(r) => confirmed ? <div className="alert ok">Đơn đã ghi nhận tiêu hao vật tư lúc {fmtDate(confirmed.created_at)}. Tồn kho không bị trừ thêm.</div> : <>
      {!lines.length ? <div className="alert warn">Chưa có định mức đóng gói cho sản phẩm trong đơn. Thêm định mức ở trang sản phẩm hoặc bỏ qua nếu đơn không dùng vật tư.</div> : lines.map((x) => <div className="row" key={x.variant_id}><div className="grow">{x.name}<div className="small muted">{x.sku} · {x.unit} · dự kiến {num(x.qty)}</div></div><Field label="Thực tế"><input type="number" min="0.001" step="0.001" value={x.qty} onChange={(e) => change(x.variant_id, e.target.value)} /></Field></div>)}
      <Field label="Kho xuất"><select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      <Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="small muted">Chỉ ghi nhận sau khi nhấn xác nhận. Lần xác nhận thứ hai sẽ không trừ kho thêm.</div>
      <ErrorBox error={error} />
    </>}</Async>
  </Modal>;
}

const Row = ({ l, v, bold }) => <div className="row between" style={bold ? { fontWeight: 700 } : undefined}><span>{l}</span><span className="num">{vnd(v)}</span></div>;
