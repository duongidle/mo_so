import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Tabs, Empty, ErrorBox, Field, Kpi, Modal, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import { vnd, num, fmtDate, MOVE_TYPES } from '../lib.js';
import StockCounts from './StockCounts.jsx';

export default function Stock() {
  const { shopId, isAll, warehouses } = useSession();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get('filter') || '';
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [tab, setTab] = useState('stock');
  const [adj, setAdj] = useState(null);
  const [hist, setHist] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const state = useAsync(() => api.get('/stock', { shop_id: isAll ? undefined : shopId, warehouse_id: wh || undefined, q: dq || undefined, filter: filter || undefined }), [shopId, wh, dq, filter]);
  const moves = useAsync(() => (tab === 'moves' ? api.get('/stock-movements', { warehouse_id: wh || undefined, limit: 100 }) : null), [tab, wh]);

  return (
    <div className="page stack">
      <div className="page-head"><h1>Kho</h1><div className="row">{warehouses.length > 1 && <button className="btn" onClick={() => setTransfer(true)}>Chuyển kho</button>}<button className="btn" onClick={() => setAdj({ kind: 'adjust', lines: [] })}>Điều chỉnh nhanh</button></div></div>
      <Tabs options={[['stock', 'Tồn kho'], ['moves', 'Lịch sử biến động'], ['counts', 'Kiểm kê']]} value={tab} onChange={setTab} />
      {tab === 'counts' ? <StockCounts /> : <>
      <div className="row wrap">
        <select value={wh} onChange={(e) => setWh(e.target.value)} style={{ width: 200 }} aria-label="Kho"><option value="">Mọi kho</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        {tab === 'stock' && <input placeholder="Tìm SKU, tên…" value={q} onChange={(e) => setQ(e.target.value)} className="grow" aria-label="Tìm" />}
      </div>
      {tab === 'stock' ? (
        <>
          <Chips options={[['', 'Tất cả'], ['in_stock', 'Còn hàng'], ['low', 'Sắp hết'], ['slow', 'Bán chậm'], ['negative', 'Âm kho']]} value={filter} onChange={(v) => setSp(v ? { filter: v } : {})} />
          <Async state={state}>
            {(r) => (
              <>
                <div className="grid cols-3"><Kpi label="Giá trị tồn" value={vnd(r.summary.total_value)} /><Kpi label="Sắp hết" value={r.summary.low} tone={r.summary.low ? 'yellow' : undefined} /><Kpi label="Bán chậm" value={r.summary.slow} /></div>
                {!r.data.length ? <Empty>Không có mặt hàng nào.</Empty> : (
                  <Card flat><div className="table-wrap"><table>
                    <thead><tr><th>Sản phẩm</th><th className="num">Tồn</th><th className="num">Giá vốn BQ</th><th className="num">Giá trị</th><th className="num">Còn đủ</th></tr></thead>
                    <tbody>{r.data.map((i) => (
                      <tr key={i.variant_id} className="click" onClick={() => setHist(i)}>
                        <td>{i.product_name}{i.variant_name ? ` — ${i.variant_name}` : ''}{i.is_bundle && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}<div className="small muted">{i.sku}{i.is_bundle && ' · bán được theo thành phần'}</div></td>
                        <td className="num"><b className={i.is_negative ? 'h-red' : i.is_low ? 'h-yellow' : ''}>{num(i.on_hand)}</b>{i.is_low && <div className="small h-yellow">sắp hết</div>}{i.is_slow && <div className="small muted">bán chậm</div>}</td>
                        <td className="num">{i.is_bundle ? '—' : vnd(i.avg_cost)}</td><td className="num">{i.is_bundle ? '—' : vnd(i.stock_value)}</td>
                        <td className="num small">{i.days_left === null ? '—' : `${i.days_left} ngày`}</td>
                      </tr>))}</tbody>
                  </table></div></Card>
                )}
              </>
            )}
          </Async>
        </>
      ) : (
        <Async state={moves}>{(r) => r && (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Thời gian</th><th>Sản phẩm</th><th>Loại</th><th className="num">SL</th><th className="num">Tồn sau</th></tr></thead>
            <tbody>{r.data.map((m) => <tr key={m.id}><td className="small">{fmtDate(m.created_at)}</td><td>{m.product_name}<div className="small muted">{m.sku}</div></td><td>{MOVE_TYPES[m.type] || m.type}</td><td className="num">{m.qty > 0 ? '+' : ''}{num(m.qty)}</td><td className="num">{num(m.balance_after)}</td></tr>)}</tbody>
          </table></div></Card>
        )}</Async>
      )}
      </>}
      {hist && <History item={hist} onClose={() => setHist(null)} />}
      {transfer && <TransferModal onClose={() => setTransfer(false)} onSaved={() => { setTransfer(false); state.reload(); moves.reload(); }} />}
      {adj && <Adjust onClose={() => setAdj(null)} onSaved={() => { setAdj(null); state.reload(); }} />}
    </div>
  );
}

function History({ item, onClose }) {
  const s = useAsync(() => api.get('/stock-movements', { variant_id: item.variant_id, limit: 30 }), [item.variant_id]);
  return (
    <Modal title={`${item.product_name} · ${item.sku}`} onClose={onClose}>
      <Async state={s}>{(r) => r.data.map((m) => <div key={m.id} className="row between small"><span>{fmtDate(m.created_at)} · {MOVE_TYPES[m.type] || m.type}</span><b>{m.qty > 0 ? '+' : ''}{m.qty} → {m.balance_after}</b></div>)}</Async>
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
  const found = useAsync(() => (dq ? api.get('/variants', { warehouse_id: wh, q: dq, all: '1', limit: 8 }) : null), [dq, wh]);
  const { busy, error, run } = useAction();
  const add = (v) => { setLines((l) => (l.some((x) => x.id === v.id) ? l : [...l, { id: v.id, sku: v.sku, name: v.product_name, on_hand: v.on_hand, counted: v.on_hand, change: 0, unit_cost: '' }])); setQ(''); };
  const upd = (id, p) => setLines((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const save = () => run(async () => {
    await api.post('/stock-adjustments', {
      warehouse_id: wh, kind, reason: reason || null,
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
          {(kind === 'opening' || kind === 'adjust' || kind === 'count') && <input type="number" min="0" placeholder="Giá vốn" value={l.unit_cost} onChange={(e) => upd(l.id, { unit_cost: e.target.value })} style={{ width: 100 }} aria-label="Giá vốn" />}
        </div>
      ))}
      <Field label="Lý do"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
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
