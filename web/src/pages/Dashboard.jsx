import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, AreaChart, Card, Empty, Kpi, StatusBadge, useAsync } from '../components/ui.jsx';
import { vnd, num, pct, today, addDays } from '../lib.js';

const MONTH = () => `tháng ${Number(today().slice(5, 7))}`;

function greeting(name) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
  const part = h < 11 ? 'buổi sáng' : h < 14 ? 'buổi trưa' : h < 18 ? 'buổi chiều' : 'buổi tối';
  return `Chào ${part}, ${name}`;
}

export default function Dashboard() {
  const { shopId, user } = useSession();
  const shop = shopId === 'all' ? undefined : shopId;
  const state = useAsync(async () => {
    const [dash, series, orders] = await Promise.all([
      api.get('/reports/dashboard', { shop_id: shop }),
      api.get('/reports/revenue', { shop_id: shop, from: addDays(today(), -29), to: today() }),
      api.get('/orders', { shop_id: shop, from: today(), to: today(), limit: 8 }),
    ]);
    return { dash: dash.data, series: series.data, orders: orders.data };
  }, [shopId]);

  return (
    <div className="page stack">
      <div className="page-head"><div><div className="eyebrow">Sổ hôm nay</div><h1>{greeting(user.displayName)}</h1></div></div>
      <Async state={state}>
        {({ dash: d, series, orders }) => {
          const cur = d.period.current;
          const flagged = d.health.data.filter((h) => h.status === 'red' || h.status === 'yellow');
          return (
            <>
              <section className="card hero">
                <div className="eyebrow">Doanh thu {MONTH()}</div>
                <div className="big">{vnd(cur.net_revenue)}</div>
                <div className="delta">
                  {d.period.change_pct.net_revenue === null ? 'Chưa có kỳ trước để so sánh' : `${d.period.change_pct.net_revenue >= 0 ? '▲' : '▼'} ${Math.abs(d.period.change_pct.net_revenue).toString().replace('.', ',')}% so với kỳ trước`} · hôm nay {vnd(d.today.net_revenue)} ({d.today.order_count} đơn)
                </div>
                <AreaChart data={series.map((s) => ({ value: s.net_revenue }))} />
                <div className="row between small" style={{ color: 'color-mix(in srgb, var(--linen) 65%, transparent)', marginTop: 6 }}><span>30 ngày gần nhất</span><span>hôm nay</span></div>
                <div className="stats">
                  <div><b>{vnd(cur.gross_profit)}</b><span>Lợi nhuận gộp · biên {pct(cur.gross_margin_pct)}</span></div>
                  <div><b>{vnd(cur.net_profit_estimate)}</b><span>Lãi ròng ước tính</span></div>
                  <div><b>{num(cur.order_count)}</b><span>Đơn · TB {vnd(cur.aov)}</span></div>
                </div>
              </section>

              <div className="grid cols-2 collapse">
                <Card flat title="Đơn hôm nay" actions={<Link to="/orders" className="small">Xem tất cả</Link>}>
                  {!orders.length ? <Empty>Hôm nay chưa có đơn nào.</Empty> : orders.map((o) => (
                    <Link key={o.id} to={`/orders/${o.id}`} className="pick">
                      <span><b>{o.customer_name || 'Khách lẻ'}</b><div className="small muted">{o.code}</div></span>
                      <span style={{ textAlign: 'right' }}><b className="num">{vnd(o.total_amount)}</b><div><StatusBadge status={o.status} /></div></span>
                    </Link>
                  ))}
                </Card>

                <div className="stack">
                  <Card title={flagged.length ? 'Cần để ý' : 'Sức khoẻ kinh doanh'} actions={<Link to="/reports" className="small">Chi tiết</Link>}>
                    {flagged.length === 0 ? <span className="muted">Mọi chỉ số đang trong ngưỡng an toàn.</span> : flagged.map((h) => (
                      <div key={h.key} className="meter">
                        <span className={`dot h-${h.status}`} />
                        <span className="grow">{h.label}</span>
                        <b className={`h-${h.status}`}>{h.value === null ? '—' : String(h.value).replace('.', ',')}</b>
                      </div>
                    ))}
                  </Card>
                  <Card title="Tiền" actions={<Link to="/expenses" className="small">Đối soát</Link>}>
                    <div className="ledger-line"><span>Đã thu trong tháng</span><b className="num">{vnd(d.cashflow.cash_in)}</b></div>
                    <div className="ledger-line"><span>Khách còn nợ <span className="muted small">({d.cashflow.customer_receivable_orders} đơn)</span></span><b className="num">{vnd(d.cashflow.customer_receivable)}</b></div>
                    <div className="ledger-line"><span>Shopee đang treo <span className="muted small">({d.cashflow.marketplace_pending_orders} đơn)</span></span><b className="num">{vnd(d.cashflow.marketplace_pending)}</b></div>
                    <div className="ledger-line"><span>Nợ nhà cung cấp</span><b className="num">{vnd(d.cashflow.supplier_payable)}</b></div>
                  </Card>
                </div>
              </div>

              <div className="grid cols-2 collapse">
                <Card title="Đang chờ xử lý" actions={<Link to="/orders" className="small">Xem đơn</Link>}>
                  {Object.keys(d.pending_orders).length === 0 ? <span className="muted">Không có đơn nào đang chờ.</span> : Object.entries(d.pending_orders).map(([st, n]) => (
                    <Link key={st} to={`/orders?status=${st}`} className="ledger-line" style={{ color: 'inherit' }}><StatusBadge status={st} /><b>{n}</b></Link>
                  ))}
                </Card>
                <Card title="Hàng sắp hết" actions={<Link to="/stock?filter=low" className="small">Xem kho</Link>}>
                  {d.low_stock.length === 0 ? <span className="muted">Chưa có mặt hàng nào dưới mức tối thiểu.</span> : d.low_stock.slice(0, 6).map((i) => (
                    <div key={i.variant_id} className="ledger-line"><span>{i.product_name} <span className="muted small">{i.sku}</span></span><b className="num h-yellow">còn {num(i.on_hand)}</b></div>
                  ))}
                </Card>
              </div>
            </>
          );
        }}
      </Async>
    </div>
  );
}
