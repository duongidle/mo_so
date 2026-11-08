import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, ErrorBox, Section, useAction, useAsync } from './ui.jsx';
import MoneyInput from './MoneyInput.jsx';
import { vnd } from '../lib.js';

/** Giá bán riêng theo kênh của một sản phẩm đã lưu: bỏ trống = dùng giá niêm yết của shop. */
export default function ChannelPrices({ productId, variants }) {
  const { shops = [], channels = [] } = useSession();
  const state = useAsync(() => api.get('/channel-prices', { product_id: productId }), [productId]);
  const rows = Array.isArray(state.data?.data) ? state.data.data : [];
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState({});
  const [saved, setSaved] = useState(false);
  const live = (variants || []).filter((v) => v.id && v.kind !== 'bundle');
  const cols = shops.flatMap((s) => channels.filter((c) => c.id !== 'other').map((c) => ({ shop: s, ch: c })));
  const key = (v, c) => `${c.shop.id}|${c.ch.id}|${v.id}`;
  useEffect(() => {
    setDraft(Object.fromEntries(rows.map((r) => [`${r.shop_id}|${r.channel_id}|${r.variant_id}`, String(r.price)])));
  }, [state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!live.length || !cols.length) return null;
  const save = () => run(async () => {
    const items = [];
    for (const v of live) for (const c of cols) {
      const k = key(v, c);
      const had = rows.find((r) => `${r.shop_id}|${r.channel_id}|${r.variant_id}` === k);
      const val = draft[k] === undefined || draft[k] === '' ? null : Number(draft[k]);
      if ((had?.price ?? null) !== val) items.push({ shop_id: c.shop.id, channel_id: c.ch.id, variant_id: v.id, price: val });
    }
    if (items.length) await api.put('/channel-prices', items);
    setSaved(true);
    state.reload();
  });
  return (
    <Section title="Giá theo kênh" actions={<button type="button" className="btn sm" disabled={busy} onClick={save}>Lưu giá kênh</button>}>
      <Async state={state}>
        {() => (
          <div className="stack">
            <p className="muted small">Bỏ trống thì kênh đó dùng giá niêm yết của shop. Hay dùng cho Shopee (giá cao hơn để bù phí sàn).</p>
            <div className="table-wrap"><table>
              <thead><tr><th>Biến thể</th>{cols.map((c) => <th key={`${c.shop.id}${c.ch.id}`} className="num">{shops.length > 1 ? `${c.shop.name} · ` : ''}{c.ch.name}</th>)}</tr></thead>
              <tbody>{live.map((v) => (
                <tr key={v.id}><td>{v.sku}<span className="sub">giá gốc {vnd(v.default_price)}</span></td>
                  {cols.map((c) => <td key={`${c.shop.id}${c.ch.id}`} className="num"><MoneyInput value={draft[key(v, c)] ?? ''} onChange={(e) => { setSaved(false); setDraft({ ...draft, [key(v, c)]: e.target.value }); }} aria-label={`Giá ${v.sku} ${c.ch.name}`} /></td>)}
                </tr>))}</tbody>
            </table></div>
            {saved && <div className="alert ok small">Đã lưu giá theo kênh.</div>}
            <ErrorBox error={error} />
          </div>
        )}
      </Async>
    </Section>
  );
}
