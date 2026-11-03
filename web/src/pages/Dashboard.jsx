import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Kpi, StatusBadge, useAsync } from '../components/ui.jsx';
import { vnd, num, pct, STATUS } from '../lib.js';

export default function Dashboard() {
  const { shopId } = useSession();
  const state = useAsync(() => api.get('/reports/dashboard', { shop_id: shopId === 'all' ? undefined : shopId }), [shopId]);
  return (
    <div className="page stack">
      <div className="page-head"><h1>Tổng quan</h1></div>
      <Async state={state}>
        {({ data: d }) => {
          const cur = d.period.current;
          const reds = d.health.data.filter((h) => h.status === 'red' || h.status === 'yellow');
          return (
            <>
              {reds.length > 0 && (
                <Card title="Cần để ý">
                  <div className="stack">
                    {reds.map((h) => (
                      <div key={h.key} className="row between">
                        <span>{h.label}</span>
                        <span className={`h-${h.status}`} style={{ fontWeight: 600 }}>{h.value === null ? '—' : String(h.value).replace('.', ',')} {h.status === 'red' ? '● Đỏ' : '● Vàng'}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              <div className="grid cols-4">
                <Kpi label="Doanh thu hôm nay" value={vnd(d.today.net_revenue)} hint={`${d.today.order_count} đơn`} />
                <Kpi label="Doanh thu tháng" value={vnd(cur.net_revenue)} delta={d.period.change_pct.net_revenue} />
                <Kpi label="Lợi nhuận gộp tháng" value={vnd(cur.gross_profit)} delta={d.period.change_pct.gross_profit} hint={`Biên ${pct(cur.gross_margin_pct)}`} />
                <Kpi label="Lãi ròng ước tính" value={vnd(cur.net_profit_estimate)} hint={`Chi phí ${vnd(cur.expenses_amount)}`} />
              </div>
              <div className="grid cols-2">
                <Card title="Đơn đang chờ xử lý" actions={<Link to="/orders" className="small">Xem đơn</Link>}>
                  {Object.keys(d.pending_orders).length === 0 ? <span className="muted">Không có đơn nào đang chờ.</span> : (
                    <div className="stack">
                      {Object.entries(d.pending_orders).map(([st, n]) => (
                        <Link key={st} to={`/orders?status=${st}`} className="row between"><StatusBadge status={st} /><b>{n}</b></Link>
                      ))}
                    </div>
                  )}
                </Card>
                <Card title="Tiền" actions={<Link to="/expenses" className="small">Đối soát</Link>}>
                  <div className="stack small">
                    <div className="row between"><span>Đã thu trong tháng</span><b>{vnd(d.cashflow.cash_in)}</b></div>
                    <div className="row between"><span>Khách còn nợ ({d.cashflow.customer_receivable_orders} đơn)</span><b>{vnd(d.cashflow.customer_receivable)}</b></div>
                    <div className="row between"><span>Shopee đang treo ({d.cashflow.marketplace_pending_orders} đơn)</span><b>{vnd(d.cashflow.marketplace_pending)}</b></div>
                    <div className="row between"><span>Nợ nhà cung cấp</span><b>{vnd(d.cashflow.supplier_payable)}</b></div>
                  </div>
                </Card>
              </div>
              <Card title="Hàng sắp hết" actions={<Link to="/stock?filter=low" className="small">Xem kho</Link>}>
                {d.low_stock.length === 0 ? <span className="muted">Chưa có mặt hàng nào dưới mức tối thiểu.</span> : (
                  <div className="table-wrap"><table><tbody>
                    {d.low_stock.map((i) => (
                      <tr key={i.variant_id}><td>{i.product_name} <span className="muted small">{i.sku}</span></td><td className="num">còn {num(i.on_hand)}</td><td className="num muted small">{i.days_left === null ? '' : `~${i.days_left} ngày`}</td></tr>
                    ))}
                  </tbody></table></div>
                )}
              </Card>
            </>
          );
        }}
      </Async>
    </div>
  );
}
