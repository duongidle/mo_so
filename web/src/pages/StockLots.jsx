import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Empty, Kpi, useAsync } from '../components/ui.jsx';
import { vnd, num, fmtDate } from '../lib.js';

const ST = { expired: ['Hết hạn', 'st-cancelled'], expiring: ['Sắp hết hạn', 'st-returned'], ok: ['Còn hạn', 'st-completed'], no_expiry: ['Không ghi hạn', 'plain'] };

/** Tab Lô & hạn dùng của Kho: lô nào sắp hết hạn, hết hạn. Hàng xuất ưu tiên lô hết hạn sớm nhất. */
export default function StockLots() {
  const { shopId, isAll } = useSession();
  const [view, setView] = useState('risk');
  const shop_id = isAll ? undefined : shopId;
  const sum = useAsync(() => api.get('/stock-lots/summary', { shop_id }), [shop_id]);
  const list = useAsync(() => api.get('/stock-lots', { shop_id, within_days: view === 'risk' ? 3650 : undefined }), [shop_id, view]);
  return (
    <div className="stack">
      <Async state={sum}>
        {({ data: s }) => (
          <div className="grid cols-3">
            <Kpi label="Đã hết hạn" value={`${num(s.expired.qty)} cái`} hint={`${s.expired.lots} lô · giá vốn ${vnd(s.expired.value)}`} tone={s.expired.lots ? 'red' : undefined} />
            <Kpi label={`Sắp hết hạn (≤ ${s.warn_days} ngày)`} value={`${num(s.expiring.qty)} cái`} hint={`${s.expiring.lots} lô · giá vốn ${vnd(s.expiring.value)}`} tone={s.expiring.lots ? 'yellow' : undefined} />
            <Kpi label="Cách tính" value="Hết hạn trước, xuất trước" hint="Bán, chuyển kho, hao hụt đều lấy lô hết hạn sớm nhất" />
          </div>
        )}
      </Async>
      <Chips options={[['risk', 'Có hạn dùng'], ['all', 'Tất cả lô']]} value={view} onChange={setView} />
      <Async state={list}>
        {({ data }) => !data.length ? <Empty>Chưa có lô nào. Ghi số lô và hạn dùng ở dòng hàng khi lập phiếu nhập.</Empty> : (
          <Card flat className="list-card"><div className="table-wrap"><table className="stackable">
            <thead><tr><th>Sản phẩm</th><th>Lô</th><th>Kho</th><th className="num">Còn</th><th>Hạn dùng</th><th>Tình trạng</th></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id}>
                <td>{l.product_name}{l.variant_name ? ` — ${l.variant_name}` : ''}<span className="sub">{l.sku}</span></td>
                <td>{l.lot_no || '—'}</td><td>{l.warehouse_name}</td><td className="num"><b>{num(l.qty)}</b></td>
                <td>{l.expiry_date ? fmtDate(l.expiry_date) : '—'}{l.days_left !== null && <span className="sub">{l.days_left < 0 ? `quá ${-l.days_left} ngày` : `còn ${l.days_left} ngày`}</span>}</td>
                <td><span className={`badge ${ST[l.status][1]}`}>{ST[l.status][0]}</span></td>
              </tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
    </div>
  );
}
