import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Empty, Kpi, Note, useAsync } from '../components/ui.jsx';
import { vnd, fmtDate } from '../lib.js';

const BUCKET = { overdue: 'Quá hạn', due_soon: 'Sắp đến hạn', later: 'Chưa đến hạn', no_due: 'Chưa đặt hạn' };
const TONE = { overdue: 'red', due_soon: 'yellow', later: '', no_due: '' };
const ACTION = { supplier: 'Trả tiền', purchase_ship: 'Trả ship', order_ship: 'Trả ship', refund: 'Hoàn tiền', supplier_refund: 'Ghi thu', recurring: 'Xem' };
const KIND_HELP = {
  supplier: 'Phiếu nhập đã nhận hàng mà chưa trả đủ nhà cung cấp.',
  purchase_ship: 'Ship nhập hàng trả riêng cho bên vận chuyển, chưa thanh toán.',
  order_ship: 'Phí ship shop chịu trên đơn giao qua hãng, chưa trả hãng.',
  refund: 'Khách đã trả nhiều hơn số phải thu (thường sau khi trả hàng), shop còn nợ lại.',
  supplier_refund: 'Phiếu nhập đã trả dư sau khi trả hàng hoặc được NCC giảm giá: NCC còn nợ shop. Đây là khoản phải thu, không tính vào tổng phải trả.',
  recurring: 'Kỳ sắp tới của các khoản chi lặp lại. Chưa phải nợ, chỉ để chuẩn bị tiền.',
};

/** Một chỗ xem mọi khoản shop phải trả hoặc sắp phải chi. Mỗi dòng dẫn tới chứng từ để ghi thanh toán. */
export default function Payables() {
  const { shopId, isAll, shops } = useSession();
  const [kind, setKind] = useState('all');
  const state = useAsync(() => api.get('/payables', { shop_id: isAll ? undefined : shopId }), [shopId, isAll]);
  const shopName = (id) => shops.find((s) => s.id === id)?.name;
  return (
    <Async state={state}>
      {(res) => {
        const rows = res.data.filter((r) => kind === 'all' || r.kind === kind);
        const kinds = Object.keys(res.kinds).filter((k) => res.data.some((r) => r.kind === k));
        return (
          <>
            <div className="grid cols-3">
              <Kpi label="Tổng phải trả" value={vnd(res.total)} hint="Không gồm chi phí định kỳ" />
              <Kpi label="Đã quá hạn" value={res.overdue.count ? vnd(res.overdue.amount) : '0 ₫'} tone={res.overdue.count ? 'red' : undefined} hint={`${res.overdue.count} khoản`} />
              <Kpi label={`Đến hạn trong ${res.lookahead} ngày`} value={vnd(res.due_soon.amount)} tone={res.due_soon.count ? 'yellow' : undefined} hint={`${res.due_soon.count} khoản`} />
            </div>
            {res.receivable_total > 0 && <Note>NCC còn nợ shop {vnd(res.receivable_total)} (khoản phải thu, không cộng vào tổng phải trả).</Note>}
            <Note>Hạn trả nhà cung cấp đặt ở phiếu nhập. Ship, hoàn tiền khách chưa có hạn nên xếp cuối. Nhấn mã chứng từ để ghi thanh toán.</Note>
            {kinds.length > 1 && <Chips options={[['all', 'Tất cả'], ...kinds.map((k) => [k, res.kinds[k]])]} value={kind} onChange={setKind} />}
            {!rows.length ? <Card><Empty>Không có khoản nào phải trả. Shop đang không nợ ai.</Empty></Card> : (
              <Card flat className="list-card">
                <table className="table">
                  <thead><tr><th>Khoản phải trả</th><th>Hạn</th><th className="num">Còn phải trả</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.kind}:${r.ref_id}`}>
                        <td>
                          <Link to={r.link}><b>{r.code}</b></Link> · {r.party}
                          <div className="small muted" title={KIND_HELP[r.kind]}>{res.kinds[r.kind]}{isAll && shopName(r.shop_id) ? ` · ${shopName(r.shop_id)}` : ''}{r.total !== r.amount && r.kind !== 'recurring' ? ` · tổng ${vnd(r.total)}` : ''}</div>
                        </td>
                        <td>
                          <span className={TONE[r.bucket] ? `h-${TONE[r.bucket]}` : 'muted'}>{r.due_date ? fmtDate(r.due_date) : BUCKET.no_due}</span>
                          {r.bucket !== 'no_due' && <div className={`small ${TONE[r.bucket] ? `h-${TONE[r.bucket]}` : 'muted'}`}>{r.bucket === 'overdue' ? `Quá hạn ${r.days_overdue} ngày` : r.days_overdue === 0 ? 'Hôm nay' : BUCKET[r.bucket]}</div>}
                        </td>
                        <td className="num">{vnd(r.amount)}</td>
                        <td className="num"><Link className="btn sm" to={r.link}>{ACTION[r.kind]}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        );
      }}
    </Async>
  );
}
