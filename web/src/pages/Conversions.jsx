import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, PageHeader, Section, Fold, useAction, useAsync, useDebounced } from '../components/ui.jsx';
import FormPage from '../components/FormPage.jsx';
import { useLeaveGuard } from '../components/leaveGuard.js';
import { vnd, num, fmtDate } from '../lib.js';

const itemName = (p, v) => (v && v !== p ? `${p} · ${v}` : p);
const ST = { done: ['Đã ghi', 'st-completed'], cancelled: ['Đã huỷ', 'st-cancelled'] };

/** Tab "Đóng gói" của Kho: danh sách phiếu đóng gói / chuyển đổi hàng (nhập theo kg, bán theo hộp). */
export function ConversionList() {
  const { shopId, isAll } = useSession();
  const nav = useNavigate();
  const state = useAsync(() => api.get('/conversions', { shop_id: isAll ? undefined : shopId, limit: 100 }), [shopId, isAll]);
  return (
    <div className="stack">
      <div className="row between">
        <span className="small muted">Đóng hàng nhập theo kg thành hộp để bán: giá vốn hộp lấy từ giá trị hàng nguồn và bao bì đã dùng.</span>
        <Link to="/stock/conversions/new" className="btn primary">+ Phiếu đóng gói</Link>
      </div>
      <Async state={state}>
        {({ data }) => !data.length ? <Empty>Chưa có phiếu đóng gói. Lập phiếu khi đóng hàng nhập theo kg thành hộp, túi.</Empty> : (
          <Card flat className="list-card"><div className="table-wrap"><table className="stackable">
            <thead><tr><th>Phiếu</th><th>Hàng nguồn</th><th>Thành phẩm</th><th className="num">Giá trị</th><th>Trạng thái</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/stock/conversions/${c.id}`)}>
                <td><b>{c.code}</b><span className="sub">{fmtDate(c.converted_at)} · {c.warehouse_name}</span></td>
                <td className="hide-sm small">{c.sources_text}</td>
                <td className="small">{c.outputs_text}</td>
                <td className="num">{vnd(c.source_value)}</td>
                <td><span className={`badge ${ST[c.voided_at ? 'cancelled' : 'done'][1]}`}>{ST[c.voided_at ? 'cancelled' : 'done'][0]}</span></td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
    </div>
  );
}

/** Ô tìm mặt hàng. Nguồn: chỉ hàng đang có tồn ở KHO ĐÃ CHỌN (phiếu chỉ lấy từ một kho); hàng chỉ có ở kho khác hiện mờ, kèm nhắc chuyển kho trước.
 *  Thành phẩm: chỉ hàng bán của shop đang chọn, không lọc theo kho vì hộp mới thường chưa từng nằm trong kho này. */
function ItemSearch({ wh, shopId, kind, onPick, exclude, placeholder }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const isSource = kind === 'source';
  const here = useAsync(() => (dq && isSource ? api.get('/stock', { warehouse_id: wh, q: dq, limit: 10 }) : null), [dq, wh, isSource]);
  const any = useAsync(() => (dq ? api.get('/stock', isSource ? { q: dq, limit: 10 } : { shop_id: shopId || undefined, q: dq, limit: 10 }) : null), [dq, shopId, isSource]);
  const list = (r) => (Array.isArray(r.data?.data) ? r.data.data : []).filter((x) => !x.is_bundle && !exclude.includes(x.variant_id));
  let rows;
  if (isSource) {
    const atWh = list(here).filter((r) => r.on_hand > 0);
    const ids = new Set(atWh.map((r) => r.variant_id));
    const elsewhere = list(any).filter((r) => r.on_hand > 0 && !ids.has(r.variant_id)).map((r) => ({ ...r, other: true }));
    rows = [...atWh, ...elsewhere];
  } else rows = list(any).filter((r) => r.item_type === 'product');
  return (
    <div className="stack" style={{ gap: 4 }}>
      <input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} />
      {rows.length > 0 && <div className="pick-list">{rows.map((r) => (
        <div key={r.variant_id} className="pick" style={r.other ? { opacity: 0.55, cursor: 'not-allowed' } : undefined} onClick={() => { if (r.other) return; onPick(r); setQ(''); }}>
          <span>{itemName(r.product_name, r.variant_name)} <span className="muted small">{r.sku}</span></span>
          <span className="small muted">{r.other ? 'Không có ở kho này, chuyển kho trước' : isSource ? `Còn ${num(r.on_hand)} ${r.unit}` : ''}</span>
        </div>
      ))}</div>}
    </div>
  );
}

/** Trang lập phiếu đóng gói: cột chính là hàng nguồn và thành phẩm, cột phụ là kho, ghi chú, giá trị và giá vốn mỗi thành phẩm xem trước. */
export function ConversionForm({ onClose, onSaved, onDirty }) {
  const { warehouses, shops, shopId, isAll } = useSession();
  const [wh, setWh] = useState((!isAll && shops?.find((x) => x.id === shopId)?.default_warehouse_id) || warehouses[0]?.id);
  const [note, setNote] = useState('');
  const [sources, setSources] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [suggested, setSuggested] = useState({});
  const { busy, error, run } = useAction();
  const dirty = sources.length > 0 || outputs.length > 0 || !!note;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const lots = useAsync(() => (wh && sources.length ? api.get('/stock-lots', { warehouse_id: wh }) : null), [wh, sources.length]);
  const lotsOf = (variantId) => (Array.isArray(lots.data?.data) ? lots.data.data : []).filter((l) => l.variant_id === variantId);

  const updS = (id, p) => setSources((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const updO = (id, p) => setOutputs((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const addSource = (r) => setSources((l) => [...l, { id: r.variant_id, sku: r.sku, name: itemName(r.product_name, r.variant_name), unit: r.unit, qty: '', lot_id: '', on_hand: r.on_hand }]);
  const addOutput = (r) => setOutputs((l) => [...l, { id: r.variant_id, sku: r.sku, name: itemName(r.product_name, r.variant_name), unit: r.unit, qty: '', weight: '', lot_no: '', expiry_date: '' }]);

  const validOut = outputs.filter((o) => Number(o.qty) > 0);
  const validSrc = sources.filter((s) => Number(s.qty) > 0);
  const body = () => ({
    warehouse_id: wh, note: note.trim() || null,
    sources: validSrc.map((s) => ({ variant_id: s.id, qty: Number(s.qty), lot_id: s.lot_id || null })),
    outputs: validOut.map((o) => ({ variant_id: o.id, qty: Number(o.qty), weight: Number(o.weight) > 0 ? Number(o.weight) : null, ...(o.lot_no !== '' ? { lot_no: o.lot_no } : {}), ...(o.expiry_date ? { expiry_date: o.expiry_date } : {}) })),
  });
  const key = JSON.stringify(validSrc.length && validOut.length ? body() : null);
  const dkey = useDebounced(key, 300);
  const prev = useAsync(() => (dkey !== 'null' ? api.post('/conversions/preview', JSON.parse(dkey)) : null), [dkey]);
  const pv = prev.data?.data;
  const outPv = (id) => pv?.outputs.find((o) => o.variant_id === id);

  const suggest = () => run(async () => {
    const r = await api.post('/conversions/suggest', { warehouse_id: wh, outputs: validOut.map((o) => ({ variant_id: o.id, qty: Number(o.qty) })) });
    const norm = {};
    setSources((cur) => {
      let next = [...cur];
      for (const s of r.data.sources) {
        norm[s.variant_id] = s.qty;
        const at = next.findIndex((x) => x.id === s.variant_id);
        if (at >= 0) next[at] = { ...next[at], qty: s.qty };
        else next.push({ id: s.variant_id, sku: s.sku, name: itemName(s.product_name, s.variant_name), unit: s.unit, qty: s.qty, lot_id: '', on_hand: s.on_hand });
      }
      return next;
    });
    setSuggested(norm);
  });

  const lackStock = validSrc.filter((s) => Number(s.qty) > Number(s.on_hand));
  const save = () => run(async () => {
    const res = await api.post('/conversions', body(), { 'Idempotency-Key': crypto.randomUUID?.() });
    onDirty?.(false);
    onSaved(res.data);
  });

  return (
    <FormPage
      title="Phiếu đóng gói"
      sub="Chọn hàng nguồn (kg, bao bì) đã dùng và thành phẩm (hộp, túi) nhận được. Giá vốn thành phẩm = giá trị hàng nguồn đã xuất, hao hụt khi đóng nằm sẵn trong giá vốn."
      onBack={onClose}
      error={<ErrorBox error={error} />}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Huỷ</button>
        <button type="button" className="btn primary" disabled={busy || !validSrc.length || !validOut.length || validOut.some((o) => !Number.isInteger(Number(o.qty))) || lackStock.length > 0} onClick={save}>Ghi phiếu đóng gói</button>
      </>}
      side={<>
        <Section title="Kho & ghi chú">
          <div className="stack">
            <Field label="Kho đóng gói"><select value={wh} onChange={(e) => { setWh(e.target.value); setSources([]); }}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Ghi chú"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Section>
        <Section title="Giá vốn xem trước">
          <div className="stack">
            {!pv ? <span className="small muted">Nhập số lượng nguồn và thành phẩm để xem giá vốn.</span> : <>
              <div className="ledger-line"><span>Giá trị hàng nguồn xuất</span><span className="num">{vnd(pv.source_value)}</span></div>
              {pv.outputs.map((o) => <div key={o.variant_id} className="ledger-line"><span>{outputs.find((x) => x.id === o.variant_id)?.sku}: {num(o.qty)} × {vnd(o.unit_cost)}</span><span className="num">{vnd(o.amount)}</span></div>)}
              <div className="ledger-line total"><span>Giá trị thành phẩm</span><span className="num">{vnd(pv.outputs.reduce((a, o) => a + o.amount, 0))}</span></div>
              <div className="small muted">Giá vốn tính theo bình quân hoặc lớp FIFO hiện tại. Giá trị nhập luôn bằng giá trị xuất, không sinh lãi lỗ.</div>
            </>}
          </div>
        </Section>
      </>}
    >
      <Section title={`Thành phẩm nhận được${outputs.length ? ` (${outputs.length})` : ''}`} actions={<button type="button" className="btn sm" disabled={busy || !validOut.length} onClick={suggest}>Gợi ý hàng nguồn</button>}>
        <div className="stack">
          <ItemSearch wh={wh} shopId={isAll ? null : shopId} kind="output" onPick={addOutput} exclude={[...outputs.map((o) => o.id), ...sources.map((s) => s.id)]} placeholder="Tìm thành phẩm (hộp, túi…) để thêm" />
          {!outputs.length ? <div className="of-empty muted">Chưa có thành phẩm. Gõ SKU ở ô trên rồi chọn.</div> : outputs.map((o) => (
            <div key={o.id} className="stack" style={{ gap: 8 }}>
              <div className="pl-row">
                <div className="pl-name"><div>{o.name}</div><div className="small muted">{o.sku}</div></div>
                <input type="number" min="1" step="1" inputMode="numeric" value={o.qty} onChange={(e) => updO(o.id, { qty: e.target.value })} aria-label={`Số lượng thành phẩm ${o.sku}`} placeholder="Số lượng" />
                <b className="num">{outPv(o.id) ? `${vnd(outPv(o.id).unit_cost)} / ${o.unit || 'đv'}` : ''}</b>
                <span />
                <button type="button" className="btn sm" aria-label={`Bỏ ${o.sku}`} onClick={() => setOutputs((l) => l.filter((x) => x.id !== o.id))}>✕</button>
              </div>
              {Number(o.qty) > 0 && !Number.isInteger(Number(o.qty)) && <div className="alert err small">Số lượng thành phẩm phải là số nguyên.</div>}
              <Fold title="Lô, hạn dùng và cách chia giá vốn">
                <div className="grid cols-2 collapse">
                  <Field label="Số lô thành phẩm" hint="Bỏ trống: lấy số lô của hàng nguồn"><input value={o.lot_no} onChange={(e) => updO(o.id, { lot_no: e.target.value })} aria-label={`Số lô ${o.sku}`} /></Field>
                  <Field label="Hạn dùng" hint="Bỏ trống: lấy hạn sớm nhất của lô nguồn"><input type="date" value={o.expiry_date} onChange={(e) => updO(o.id, { expiry_date: e.target.value })} aria-label={`Hạn dùng ${o.sku}`} /></Field>
                  {outputs.length > 1 && <Field label="Trọng số chia giá vốn" hint="Bỏ trống: theo lượng nguồn quy đổi, không có thì theo giá bán"><input type="number" min="0" step="any" value={o.weight} onChange={(e) => updO(o.id, { weight: e.target.value })} aria-label={`Trọng số ${o.sku}`} /></Field>}
                </div>
              </Fold>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Hàng nguồn đã dùng${sources.length ? ` (${sources.length})` : ''}`}>
        <div className="stack">
          <ItemSearch wh={wh} shopId={null} kind="source" onPick={addSource} exclude={[...outputs.map((o) => o.id), ...sources.map((s) => s.id)]} placeholder="Tìm hàng nguồn (kg, hộp rỗng, tem…) để thêm" />
          {!sources.length ? <div className="of-empty muted">Chưa có hàng nguồn. Thêm thành phẩm rồi nhấn “Gợi ý hàng nguồn”, hoặc tự tìm ở ô trên.</div> : sources.map((s) => {
            const sl = lotsOf(s.id);
            const norm = suggested[s.id];
            return (
              <div key={s.id} className="stack" style={{ gap: 4 }}>
                <div className="pl-row">
                  <div className="pl-name"><div>{s.name}</div><div className="small muted">{s.sku} · còn {num(s.on_hand)} {s.unit}</div></div>
                  <input type="number" min="0.001" step="any" inputMode="decimal" value={s.qty} onChange={(e) => updS(s.id, { qty: e.target.value })} aria-label={`Số lượng nguồn ${s.sku}`} placeholder="Số lượng" />
                  <span className="small">{pv?.sources.find((x) => x.variant_id === s.id) ? vnd(pv.sources.find((x) => x.variant_id === s.id).amount) : ''}</span>
                  <span />
                  <button type="button" className="btn sm" aria-label={`Bỏ ${s.sku}`} onClick={() => setSources((l) => l.filter((x) => x.id !== s.id))}>✕</button>
                </div>
                {Number(s.qty) > Number(s.on_hand) && <div className="alert err small">Không đủ tồn: cần {num(s.qty)}, kho chỉ còn {num(s.on_hand)}.</div>}
                {norm !== undefined && Number(s.qty) > 0 && Number(s.qty) !== norm && <div className="small muted">Định mức {num(norm)}, thực tế {num(s.qty)} ({Number(s.qty) > norm ? '+' : '−'}{num(Math.abs(Math.round((Number(s.qty) - norm) * 1000) / 1000))}). Phần chênh nằm trong giá vốn thành phẩm.</div>}
                {sl.length > 0 && (
                  <label className="small muted">Lô lấy hàng <select value={s.lot_id} onChange={(e) => updS(s.id, { lot_id: e.target.value })} aria-label={`Lô nguồn ${s.sku}`}>
                    <option value="">Theo hạn dùng sớm nhất</option>
                    {sl.map((l) => <option key={l.id} value={l.id}>{l.lot_no || '(không số lô)'} · còn {num(l.qty)}{l.expiry_date ? ` · hạn ${fmtDate(l.expiry_date)}` : ''}</option>)}
                  </select></label>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </FormPage>
  );
}

export function NewConversionPage() {
  const nav = useNavigate();
  const { setDirty } = useLeaveGuard();
  return <ConversionForm onClose={() => nav('/stock?tab=conversions')} onSaved={(c) => nav(`/stock/conversions/${c.id}`)} onDirty={setDirty} />;
}

/** Chi tiết phiếu đóng gói: nguồn, lô đã rút, thành phẩm và giá vốn, định mức so với thực tế; huỷ phiếu cần lý do. */
export function ConversionPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const state = useAsync(() => api.get(`/conversions/${id}`), [id]);
  const [voiding, setVoiding] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <div className="page stack">
      <Async state={state}>
        {({ data: c }) => (
          <>
            <PageHeader
              title={c.code}
              sub={`${fmtDate(c.converted_at)} · ${c.warehouse_name}${c.note ? ` · ${c.note}` : ''}`}
              actions={<><button type="button" className="btn sm" onClick={() => nav('/stock?tab=conversions')}>← Quay lại</button>{!c.voided_at && <button type="button" className="btn" onClick={() => setVoiding({ reason: '' })}>Huỷ phiếu</button>}</>}
            />
            {c.voided_at && <div className="alert warn">Phiếu đã huỷ ngày {fmtDate(c.voided_at)}: {c.void_reason}</div>}
            <Section title="Hàng nguồn đã xuất">
              <div className="table-wrap"><table className="stackable">
                <thead><tr><th>Hàng</th><th className="num">Số lượng</th><th className="num">Định mức</th><th>Lô đã rút</th><th className="num">Giá trị</th></tr></thead>
                <tbody>{c.sources.map((s) => (
                  <tr key={s.id}>
                    <td>{itemName(s.product_name, s.variant_name)}<span className="sub">{s.sku}</span></td>
                    <td className="num">{num(s.qty)} {s.unit}</td>
                    <td className="num">{s.norm_qty == null ? <span className="muted">—</span> : <>{num(s.norm_qty)}{s.norm_diff !== 0 && <span className="sub">{s.norm_diff > 0 ? `dùng nhiều hơn ${num(s.norm_diff)}` : `dùng ít hơn ${num(-s.norm_diff)}`}</span>}</>}</td>
                    <td className="small">{s.lots.length ? s.lots.map((l) => `${l.lot_no || '(không số lô)'} ×${num(l.qty)}${l.expiry_date ? ` · hạn ${fmtDate(l.expiry_date)}` : ''}`).join('; ') : <span className="muted">—</span>}</td>
                    <td className="num">{vnd(s.amount)}</td>
                  </tr>))}</tbody>
              </table></div>
            </Section>
            <Section title="Thành phẩm nhập kho">
              <div className="table-wrap"><table className="stackable">
                <thead><tr><th>Hàng</th><th className="num">Số lượng</th><th className="num">Giá vốn / đơn vị</th><th>Lô, hạn</th><th className="num">Giá trị</th></tr></thead>
                <tbody>{c.outputs.map((o) => (
                  <tr key={o.id}>
                    <td>{itemName(o.product_name, o.variant_name)}<span className="sub">{o.sku}</span></td>
                    <td className="num">{num(o.qty)} {o.unit}</td>
                    <td className="num">{vnd(o.unit_cost)}{o.slices.length > 1 && <span className="sub">{o.slices.map((x) => `${num(x.qty)} × ${vnd(x.unitCost)}`).join(' + ')}</span>}</td>
                    <td className="small">{[o.lot_no, o.expiry_date && `hạn ${fmtDate(o.expiry_date)}`].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                    <td className="num">{vnd(o.amount)}</td>
                  </tr>))}</tbody>
              </table></div>
              <div className="ledger-line total"><span>Giá trị xuất = giá trị nhập</span><span className="num">{vnd(c.source_value)}</span></div>
              <div className="small muted">Phiếu đóng gói không tạo lãi lỗ: giá trị tồn chỉ chuyển từ hàng nguồn sang thành phẩm.</div>
            </Section>
            {voiding && (
              <Modal title={`Huỷ ${c.code}`} onClose={() => setVoiding(null)} footer={<><button className="btn" onClick={() => setVoiding(null)}>Quay lại</button><button className="btn primary" disabled={busy || !voiding.reason.trim()} onClick={() => run(async () => { await api.post(`/conversions/${c.id}/void`, { reason: voiding.reason.trim() }); setVoiding(null); state.reload(); })}>Huỷ phiếu</button></>}>
                <p className="small">Hàng nguồn và bao bì được nhập lại đúng giá, đúng lô; thành phẩm bị rút khỏi kho. Chỉ huỷ được khi thành phẩm còn đủ trong kho.</p>
                <Field label="Lý do"><input value={voiding.reason} onChange={(e) => setVoiding({ reason: e.target.value })} autoFocus aria-label="Lý do huỷ" /></Field>
                <ErrorBox error={error} />
              </Modal>
            )}
          </>
        )}
      </Async>
    </div>
  );
}
