import StockLots from './StockLots.jsx';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Tabs, Empty, ErrorBox, Field, Kpi, Modal, useAction, useAsync, useDebounced, PageHeader, Toolbar } from '../components/ui.jsx';
import { vnd, num, fmtDate, moveLabel, STOCK_REASONS } from '../lib.js';
import StockCounts from './StockCounts.jsx';
import StockClose from './StockClose.jsx';
import { ConversionList } from './Conversions.jsx';
import ProductThumb from '../components/ProductThumb.jsx';
import { flattenTree, indent } from '../lib/categories.js';
import MoneyInput from '../components/MoneyInput.jsx';

export default function Stock() {
  const { shopId, isAll, warehouses } = useSession();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get('filter') || '';
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [cat, setCat] = useState('');
  const cats = useAsync(() => api.get('/categories'), []);
  const [tab, setTab] = useState(sp.get('tab') || 'stock');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [adj, setAdj] = useState(null);
  const [hist, setHist] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const [issue, setIssue] = useState(false);
  const state = useAsync(() => api.get('/stock', { shop_id: isAll ? undefined : shopId, warehouse_id: wh || undefined, q: dq || undefined, category_id: cat || undefined, filter: filter || undefined }), [shopId, wh, dq, filter, cat]);
  const moves = useAsync(() => (tab === 'moves' ? api.get('/stock-movements', { warehouse_id: wh || undefined, limit: 100 }) : null), [tab, wh]);
  const report = useAsync(() => (tab === 'reports' ? api.get('/inventory-reports', { warehouse_id: wh || undefined, from: period.from || undefined, to: period.to || undefined }) : null), [tab, wh, period]);
  const consumption = useAsync(() => (tab === 'consumption' ? api.get('/material-consumption', { warehouse_id: wh || undefined, from: period.from || undefined, to: period.to || undefined }) : null), [tab, wh, period]);

  return (
    <div className="page stack">
      <PageHeader title="Kho" actions={<><Link to="/stock/conversions/new" className="btn">Đóng gói</Link><button className="btn" onClick={() => setIssue(true)}>Xuất vật tư</button>{warehouses.length > 1 && <button className="btn" onClick={() => setTransfer(true)}>Chuyển kho</button>}<button className="btn" onClick={() => setAdj({ kind: 'adjust', lines: [] })}>Điều chỉnh nhanh</button></>} />
      <Toolbar><Tabs options={[['stock', 'Tồn kho'], ['moves', 'Lịch sử biến động'], ['counts', 'Kiểm kê'], ['lots', 'Lô & hạn dùng'], ['conversions', 'Đóng gói'], ['close', 'Chốt kho'], ['reports', 'Báo cáo'], ['consumption', 'Tiêu hao vật tư']]} value={tab} onChange={setTab} /></Toolbar>
      {tab === 'counts' ? <StockCounts /> : tab === 'conversions' ? <ConversionList /> : tab === 'lots' ? <StockLots /> : tab === 'close' ? <StockClose /> : <>
      <Toolbar>
        <select value={wh} onChange={(e) => setWh(e.target.value)} aria-label="Kho"><option value="">Mọi kho</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        {['reports', 'consumption'].includes(tab) && <><input aria-label="Từ ngày" type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} /><input aria-label="Đến ngày" type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} /></>}
        {tab === 'reports' && <a className="btn" href={`/api/v1/inventory-reports/export${qs({ warehouse_id: wh || undefined, from: period.from || undefined, to: period.to || undefined })}`}>Xuất CSV</a>}
        {tab === 'consumption' && <a className="btn" href={`/api/v1/material-consumption/export${qs({ warehouse_id: wh || undefined, from: period.from || undefined, to: period.to || undefined })}`}>Xuất CSV</a>}
        {tab === 'stock' && <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Danh mục"><option value="">Mọi danh mục</option>{flattenTree(cats.data?.data || []).map((c) => <option key={c.id} value={c.id}>{indent(c)}</option>)}</select>}
        {tab === 'stock' && <input placeholder="Tìm SKU, tên…" value={q} onChange={(e) => setQ(e.target.value)} className="grow" aria-label="Tìm" />}
        {tab === 'stock' && <div className="push"><Chips options={[['', 'Tất cả'], ['in_stock', 'Còn hàng'], ['low', 'Sắp hết'], ['slow', 'Bán chậm'], ['negative', 'Âm kho']]} value={filter} onChange={(v) => setSp(v ? { filter: v } : {})} /></div>}
      </Toolbar>
      {tab === 'stock' ? (
        <>
          <Async state={state}>
            {(r) => (
              <>
                <div className="grid cols-3"><Kpi label="Giá trị tồn" value={vnd(r.summary.total_value)} /><Kpi label="Sắp hết" value={r.summary.low} tone={r.summary.low ? 'yellow' : undefined} /><Kpi label="Bán chậm" value={r.summary.slow} /></div>
                {!r.data.length ? <Empty>Không có mặt hàng nào.</Empty> : (
                  <Card flat className="list-card sticky-head"><div className="table-wrap"><table>
                    <thead><tr><th>Sản phẩm</th><th className="num">Tồn</th><th className="num">Giá vốn BQ</th><th className="num">Giá trị</th><th className="num">Còn đủ</th></tr></thead>
                    <tbody>{r.data.map((i) => (
                      <tr key={i.variant_id} className="click" onClick={() => setHist(i)}>
                        <td><div className="row" style={{ gap: 8 }}><ProductThumb src={i.image_url} name={i.product_name} size={36} /><div>{i.product_name}{i.variant_name ? ` — ${i.variant_name}` : ''}{i.is_bundle && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}<div className="small muted">{i.sku}{i.is_bundle && ' · bán được theo thành phần'}</div></div></div></td>
                        <td className="num"><b className={i.is_negative ? 'h-red' : i.is_low ? 'h-yellow' : ''}>{num(i.on_hand)}</b>{i.reserved_qty > 0 && <div className="small muted">giữ {num(i.reserved_qty)} cho đơn nháp</div>}{i.is_low && <div className="small h-yellow">sắp hết</div>}{i.is_slow && <div className="small muted">bán chậm</div>}</td>
                        <td className="num">{i.is_bundle ? '—' : vnd(i.avg_cost)}</td><td className="num">{i.is_bundle ? '—' : vnd(i.stock_value)}</td>
                        <td className="num small">{i.days_left === null ? '—' : `${i.days_left} ngày`}</td>
                      </tr>))}</tbody>
                  </table></div></Card>
                )}
              </>
            )}
          </Async>
        </>
      ) : tab === 'moves' ? (
        <Async state={moves}>{(r) => r && (
          <Card flat className="list-card sticky-head"><div className="table-wrap"><table>
            <thead><tr><th>Thời gian</th><th>Sản phẩm</th><th>Loại</th><th className="num">SL</th><th className="num">Tồn sau</th></tr></thead>
            <tbody>{r.data.map((m) => <tr key={m.id}><td className="small">{fmtDate(m.created_at)}</td><td>{m.product_name}<div className="small muted">{m.sku}</div></td><td>{moveLabel(m)}</td><td className="num">{m.qty > 0 ? '+' : ''}{num(m.qty)}</td><td className="num">{num(m.balance_after)}</td></tr>)}</tbody>
          </table></div></Card>
        )}</Async>
      ) : tab === 'reports' ? (
        <Async state={report}>{(r) => r && <>
          <div className="grid cols-3"><Kpi label="Mặt hàng" value={num(r.data.summary.item_count)} /><Kpi label="Giá trị tồn hiện tại" value={vnd(r.data.summary.inventory_value)} /><Kpi label="Sắp hết" value={num(r.data.summary.low_stock_count)} tone={r.data.summary.low_stock_count ? 'yellow' : undefined} /></div>
          <div className="small muted">Đối chiếu TK 156: {vnd(r.data.summary.ledger_156_value)} · Chênh lệch: {vnd(r.data.summary.valuation_difference)}. Tồn đầu/cuối và nhập/xuất theo khoảng ngày; giá trị tồn và giá vốn bình quân là hiện tại.</div>
          <div className="small muted">Báo cáo tồn lâu chưa khả dụng: hệ thống chưa theo dõi tồn theo lô nhập.</div>
          <Card flat className="list-card sticky-head"><div className="table-wrap"><table><thead><tr><th>Mặt hàng</th><th className="num">Tồn đầu</th><th className="num">Nhập kỳ</th><th className="num">Xuất kỳ</th><th className="num">Tồn cuối</th><th className="num">Giá trị tồn hiện tại</th></tr></thead><tbody>{r.data.items.map((i) => <tr key={i.variant_id}><td>{i.product_name}<div className="small muted">{i.sku}</div></td><td className="num">{num(i.opening_qty)} {i.unit}</td><td className="num">{num(i.in_qty)}</td><td className="num">{num(i.out_qty)}</td><td className="num">{num(i.ending_qty)} {i.unit}</td><td className="num">{vnd(i.stock_value)}</td></tr>)}</tbody></table></div></Card>
        </>}</Async>
      ) : (
        <Async state={consumption}>{(r) => r && <Card flat className="list-card sticky-head"><div className="table-wrap"><table><thead><tr><th>Ngày</th><th>Vật tư</th><th>Nghiệp vụ</th><th>Đơn / mục đích</th><th className="num">Số lượng</th><th className="num">Giá trị</th></tr></thead><tbody>{r.data.map((m) => <tr key={m.ref_id + m.sku + m.business_date}><td>{fmtDate(m.business_date)}</td><td>{m.product_name}<div className="small muted">{m.sku}</div></td><td>{m.ref_type === 'packaging_run' ? 'Đóng gói' : 'Vận hành'}</td><td>{m.order_code || m.purpose || m.issue_code || '—'}</td><td className="num">{num(Math.abs(m.qty))} {m.unit}</td><td className="num">{vnd(m.amount)}</td></tr>)}</tbody></table></div></Card>}</Async>
      )}
      </>}
      {hist && <History item={hist} warehouseId={wh} warehouses={warehouses} onClose={() => setHist(null)} />}
      {transfer && <TransferModal onClose={() => setTransfer(false)} onSaved={() => { setTransfer(false); state.reload(); moves.reload(); }} />}
      {issue && <MaterialIssue onClose={() => setIssue(false)} onSaved={() => { setIssue(false); state.reload(); moves.reload(); }} />}
      {adj && <Adjust onClose={() => setAdj(null)} onSaved={() => { setAdj(null); state.reload(); }} />}
    </div>
  );
}

function History({ item, warehouseId, warehouses, onClose }) {
  const s = useAsync(() => api.get('/stock-movements', { variant_id: item.variant_id, warehouse_id: warehouseId || undefined, limit: 30 }), [item.variant_id, warehouseId]);
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || '';
  return (
    <Modal title={`${item.product_name} · ${item.sku}`} onClose={onClose} footer={<Link className="btn" to={`/products/${item.product_id}`}>Mở trang sản phẩm</Link>}>
      <div className="stack">
        <div className="small muted">{warehouseId ? `Lịch sử của kho ${whName(warehouseId)}` : 'Lịch sử ở mọi kho'} · tồn hiện tại {num(item.on_hand)}</div>
        <Async state={s}>{(r) => !r.data.length ? <Empty>Chưa có biến động nào.</Empty> : r.data.map((m) => <div key={m.id} className="row between small"><span>{fmtDate(m.created_at)} · {moveLabel(m)}{!warehouseId && warehouses.length > 1 ? ` · ${whName(m.warehouse_id)}` : ''}</span><b>{m.qty > 0 ? '+' : ''}{m.qty} → {m.balance_after}</b></div>)}</Async>
      </div>
    </Modal>
  );
}

function Adjust({ onClose, onSaved }) {
  const { warehouses } = useSession();
  const [kind, setKind] = useState('count');
  const [wh, setWh] = useState(warehouses[0]?.id);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const found = useAsync(() => (dq ? api.get('/variants', { warehouse_id: wh, q: dq, all: '1', limit: 8 }) : null), [dq, wh]);
  const { busy, error, run } = useAction();
  const add = (v) => { setLines((l) => (l.some((x) => x.id === v.id) ? l : [...l, { id: v.id, sku: v.sku, name: v.product_name, on_hand: v.on_hand, counted: v.on_hand, change: 0, unit_cost: '' }])); setQ(''); };
  const upd = (id, p) => setLines((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const save = () => run(async () => {
    await api.post('/stock-adjustments', {
      warehouse_id: wh, kind, reason: reason || null,
      ...((kind === 'adjust' || kind === 'damage') && (reasonCode || kind === 'damage') ? { reason_code: reasonCode || 'damaged' } : {}),
      lines: lines.map((l) => ({ variant_id: l.id, ...(kind === 'count' ? { counted: Number(l.counted) } : { change: kind === 'damage' ? -Math.abs(Number(l.change)) : Number(l.change) }), ...(l.unit_cost !== '' ? { unit_cost: Number(l.unit_cost) } : {}) })),
    });
    onSaved();
  });
  return (
    <Modal title="Kiểm kê / điều chỉnh kho" onClose={onClose} footer={<button className="btn primary" disabled={busy || !lines.length} onClick={save}>Ghi nhận</button>}>
      <div className="grid cols-2">
        <Field label="Loại"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="count">Kiểm kê (nhập số đếm được)</option><option value="adjust">Điều chỉnh +/−</option><option value="opening">Tồn đầu kỳ</option><option value="damage">Hư hỏng</option></select></Field>
        <Field label="Kho"><select value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      <input placeholder="Tìm SKU để thêm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm SKU" />
      {found.data?.data?.map((v) => <div key={v.id} className="pick" onClick={() => add(v)}>{v.product_name} <span className="muted small">{v.sku}</span></div>)}
      {lines.map((l) => (
        <div key={l.id} className="row">
          <div className="grow"><div>{l.name}</div><div className="small muted">{l.sku} · hiện {l.on_hand}</div></div>
          {kind === 'count' ? <input type="number" min="0" value={l.counted} onChange={(e) => upd(l.id, { counted: e.target.value })} style={{ width: 90 }} aria-label="Số đếm được" /> : <input type="number" value={l.change} onChange={(e) => upd(l.id, { change: e.target.value })} style={{ width: 90 }} aria-label="Số thay đổi" />}
          {(kind === 'opening' || kind === 'adjust' || kind === 'count') && <MoneyInput placeholder="Giá vốn" value={l.unit_cost} onChange={(e) => upd(l.id, { unit_cost: e.target.value })} style={{ width: 100 }} aria-label="Giá vốn" />}
        </div>
      ))}
      {(kind === 'adjust' || kind === 'damage') && <Field label="Lý do giảm kho" hint="Dùng để thống kê hao hụt ở Báo cáo → Hao hụt"><select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-label="Lý do giảm kho"><option value="">{kind === 'damage' ? 'Hỏng, vỡ' : 'Không chọn (tính là Khác)'}</option>{STOCK_REASONS.filter(([c]) => kind !== 'damage' || c !== 'damaged').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></Field>}
      <Field label="Ghi chú"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

function TransferModal({ onClose, onSaved }) {
  const { warehouses } = useSession();
  const [from, setFrom] = useState(warehouses[0]?.id);
  const [to, setTo] = useState(warehouses[1]?.id);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const found = useAsync(() => (dq ? api.get('/variants', { warehouse_id: from, q: dq, all: '1', limit: 8 }) : Promise.resolve({ data: [] })), [dq, from]);
  const { busy, error, run } = useAction();
  const upd = (id, p) => setLines((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return (
    <Modal title="Chuyển kho" onClose={onClose} footer={<button className="btn primary" disabled={busy || !lines.length || from === to} onClick={() => run(async () => { await api.post('/transfers', { from_warehouse_id: from, to_warehouse_id: to, note: note || null, lines: lines.map((l) => ({ variant_id: l.id, qty: Number(l.qty) })) }); onSaved(); })}>Chuyển</button>}>
      <div className="grid cols-2">
        <Field label="Từ kho"><select value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Đến kho"><select value={to} onChange={(e) => setTo(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      {from === to && <div className="alert err small">Kho đi và kho đến phải khác nhau.</div>}
      <input placeholder="Tìm SKU để thêm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm SKU" />
      {found.data?.data?.filter((v) => v.kind !== 'bundle').map((v) => <div key={v.id} className="pick" onClick={() => { setLines((l) => (l.some((x) => x.id === v.id) ? l : [...l, { id: v.id, sku: v.sku, name: v.product_name, qty: 1, on_hand: v.on_hand }])); setQ(''); }}>{v.product_name} <span className="muted small">{v.sku} · tồn {num(v.on_hand)}</span></div>)}
      {lines.map((l) => (
        <div key={l.id} className="row">
          <div className="grow"><div>{l.name}</div><div className="small muted">{l.sku} · có {num(l.on_hand)}</div></div>
          <input type="number" min="1" max={l.on_hand} value={l.qty} onChange={(e) => upd(l.id, { qty: e.target.value })} style={{ width: 90 }} aria-label="Số lượng chuyển" />
          <button className="btn sm" onClick={() => setLines((x) => x.filter((y) => y.id !== l.id))} aria-label={`Bỏ ${l.sku}`}>✕</button>
        </div>
      ))}
      <Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <p className="small muted" style={{ margin: 0 }}>Giá vốn được giữ nguyên khi chuyển.</p>
      <ErrorBox error={error} />
    </Modal>
  );
}

function MaterialIssue({ onClose, onSaved }) {
  const { warehouses, shopId, isAll } = useSession();
  const catalog = useAsync(async () => {
    const [packaging, supplies] = await Promise.all([
      api.get('/products', { item_type: 'packaging', unlisted: '1', limit: 200 }),
      api.get('/products', { item_type: 'supply', unlisted: '1', limit: 200 }),
    ]);
    return [...(packaging.data || []), ...(supplies.data || [])].flatMap((p) => (p.variants || []).filter((v) => v.kind !== 'bundle' && !v.archived_at).map((v) => ({ variant_id: v.id, sku: v.sku, name: `${p.name}${v.name ? ` — ${v.name}` : ''}`, unit: p.unit })));
  }, []);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '');
  const [purpose, setPurpose] = useState('');
  const [account, setAccount] = useState('6428');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState([]);
  const { busy, error, run } = useAction();
  const list = catalog.data || [];
  const found = search ? list.filter((x) => `${x.name} ${x.sku}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  const add = (x) => { setLines((xs) => xs.some((y) => y.variant_id === x.variant_id) ? xs : [...xs, { ...x, qty: 1 }]); setSearch(''); };
  return <Modal title="Xuất vật tư" onClose={onClose} footer={<button className="btn primary" disabled={busy || !lines.length || !purpose.trim()} onClick={() => run(async () => { await api.post('/material-issues', { warehouse_id: warehouseId, purpose, expense_account_code: account, shop_id: isAll ? null : shopId, lines: lines.map((x) => ({ variant_id: x.variant_id, qty: Number(x.qty) })) }); onSaved(); })}>Ghi nhận xuất kho</button>}>
    <div className="grid cols-2"><Field label="Kho xuất"><select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><Field label="Tài khoản chi phí"><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="6428">6428 · Chi phí quản lý khác</option><option value="6422">6422 · Mặt bằng, điện nước</option><option value="6414">6414 · Bao bì</option><option value="6418">6418 · Chi phí bán hàng khác</option></select></Field></div>
    <Field label="Mục đích sử dụng"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
    <input placeholder="Tìm vật liệu đóng gói, vật tư vận hành…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm vật tư" />
    {found.map((x) => <div className="pick" key={x.variant_id} onClick={() => add(x)}>{x.name} <span className="small muted">{x.sku} · {x.unit}</span></div>)}
    {lines.map((x) => <div className="row" key={x.variant_id}><div className="grow">{x.name}<div className="small muted">{x.sku} · {x.unit}</div></div><input type="number" min="0.001" step="0.001" value={x.qty} onChange={(e) => setLines((xs) => xs.map((y) => y.variant_id === x.variant_id ? { ...y, qty: e.target.value } : y))} style={{ width: 90 }} aria-label="Số lượng xuất" /><button className="btn sm" onClick={() => setLines((xs) => xs.filter((y) => y.variant_id !== x.variant_id))} aria-label={`Bỏ ${x.sku}`}>✕</button></div>)}
    <div className="small muted">Giá trị xuất dùng giá vốn bình quân hiện tại và được ghi vào sổ kế toán cùng sổ kho.</div><ErrorBox error={error} />
  </Modal>;
}
