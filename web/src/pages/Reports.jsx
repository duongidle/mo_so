import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Bars, HBars, Async, Card, Chips, Tabs, DateRange, Empty, Kpi, useAsync } from '../components/ui.jsx';
import { vnd, num, pct, monthStart, today, fmtDate, addDays } from '../lib.js';

const TABS = [['revenue', 'Doanh thu'], ['profit', 'Lợi nhuận'], ['channels', 'Kênh'], ['products', 'Sản phẩm'], ['customers', 'Khách'], ['inventory', 'Kho'], ['cash', 'Dòng tiền'], ['custom', 'Chỉ số tuỳ chỉnh'], ['health', 'Sức khoẻ']];
const PRESETS = [['Tháng này', () => [monthStart(), today()]], ['7 ngày', () => [addDays(today(), -6), today()]], ['30 ngày', () => [addDays(today(), -29), today()]]];

export default function Reports() {
  const { shopId, isAll } = useSession();
  const [tab, setTab] = useState('revenue');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const p = { from: range.from, to: range.to, shop_id: isAll ? undefined : shopId };
  const deps = [shopId, range.from, range.to, tab];
  const state = useAsync(() => {
    switch (tab) {
      case 'revenue': return Promise.all([api.get('/reports/overview', p), api.get('/reports/revenue', p)]);
      case 'profit': return Promise.all([api.get('/reports/overview', p), api.get('/reports/shops', p)]);
      case 'channels': return api.get('/reports/channels', p);
      case 'products': return api.get('/reports/products', p);
      case 'customers': return api.get('/reports/customers', p);
      case 'inventory': return api.get('/reports/inventory', { shop_id: p.shop_id });
      case 'cash': return api.get('/reports/cashflow', p);
      case 'custom': return api.get('/reports/custom-metrics', p);
      default: return api.get('/reports/health', p);
    }
  }, deps);

  return (
    <div className="page stack">
      <div className="page-head"><h1>Báo cáo</h1></div>
      <Tabs options={TABS} value={tab} onChange={setTab} />
      <div className="row wrap"><DateRange {...range} onChange={setRange} />{PRESETS.map(([l, f]) => <button key={l} className="btn sm" onClick={() => { const [from, to] = f(); setRange({ from, to }); }}>{l}</button>)}</div>
      <Async state={state}>{(d) => <Body tab={tab} d={d} />}</Async>
    </div>
  );
}

const Row = ({ l, v, bold, neg }) => <div className="row between" style={bold ? { fontWeight: 700, borderTop: '1px solid var(--champagne)', paddingTop: 6 } : undefined}><span>{l}</span><span className="num">{neg ? '− ' : ''}{vnd(v)}</span></div>;

function Body({ tab, d }) {
  if (tab === 'revenue') {
    const [{ data: ov }, series] = d;
    const c = ov.current;
    return (
      <>
        <div className="grid cols-4">
          <Kpi label="Doanh thu thuần" value={vnd(c.net_revenue)} delta={ov.change_pct.net_revenue} />
          <Kpi label="Số đơn" value={num(c.order_count)} delta={ov.change_pct.order_count} />
          <Kpi label="Giá trị đơn TB" value={vnd(c.aov)} delta={ov.change_pct.aov} />
          <Kpi label="Tỷ lệ huỷ / hoàn" value={`${pct(c.cancel_rate_pct)} / ${pct(c.return_rate_pct)}`} />
        </div>
        <Card title="Doanh thu theo ngày"><Bars data={series.data} value="net_revenue" /></Card>
        <Card title="Từ tiền hàng đến doanh thu thuần"><div className="stack small">
          <Row l="Doanh thu gộp (tiền hàng)" v={c.gross_revenue} /><Row l="Giảm giá" v={c.discount_amount} neg /><Row l="Hàng trả" v={c.returned_amount} neg /><Row l="Doanh thu thuần" v={c.net_revenue} bold />
        </div></Card>
      </>
    );
  }
  if (tab === 'profit') {
    const [{ data: ov }, shops] = d;
    const c = ov.current;
    return (
      <>
        <Card title="Lợi nhuận"><div className="stack small">
          <Row l="Doanh thu thuần" v={c.net_revenue} /><Row l="Phí ship khách trả" v={c.shipping_fee} /><Row l="Phí sàn" v={c.platform_fee} neg /><Row l="Ship shop chịu" v={c.seller_shipping} neg /><Row l="Giá vốn" v={c.cogs} neg />
          <Row l={`Lợi nhuận gộp (biên ${pct(c.gross_margin_pct)})`} v={c.gross_profit} bold /><Row l="Chi phí (gồm phần chia từ chi phí chung)" v={c.expenses_amount} neg /><Row l="Lợi nhuận ròng ước tính" v={c.net_profit_estimate} bold />
        </div><p className="small muted" style={{ marginTop: 8 }}>“Ước tính” vì chưa tính thuế và các khoản ngoài sổ.</p></Card>
        <Card title="Theo shop" flat><div className="table-wrap"><table>
          <thead><tr><th>Shop</th><th className="num">Doanh thu</th><th className="num">LN gộp</th><th className="num">Chi phí</th><th className="num">LN ròng</th></tr></thead>
          <tbody>{shops.data.map((s) => <tr key={s.shop_id}><td><b>{s.shop_name}</b></td><td className="num">{vnd(s.net_revenue)}</td><td className="num">{vnd(s.gross_profit)}</td><td className="num">{vnd(s.expenses_amount)}</td><td className="num"><b>{vnd(s.net_profit_estimate)}</b></td></tr>)}</tbody>
        </table></div></Card>
      </>
    );
  }
  if (tab === 'channels') return !d.data.length ? <Empty>Chưa có đơn trong kỳ.</Empty> : (
    <Card flat><div className="table-wrap"><table>
      <thead><tr><th>Kênh</th><th className="num">Đơn</th><th className="num">Doanh thu thuần</th><th className="num">Phí sàn</th><th className="num">LN gộp</th><th className="num">Biên</th><th className="num">Huỷ</th></tr></thead>
      <tbody>{d.data.map((c) => <tr key={c.channel_id}><td><b>{c.channel_name}</b></td><td className="num">{c.order_count}</td><td className="num">{vnd(c.net_revenue)}</td><td className="num">{vnd(c.platform_fee)}</td><td className="num">{vnd(c.gross_profit)}</td><td className="num">{pct(c.gross_margin_pct)}</td><td className="num">{pct(c.cancel_rate_pct)}</td></tr>)}</tbody>
    </table></div></Card>
  );
  if (tab === 'products') return !d.data.length ? <Empty>Chưa bán sản phẩm nào trong kỳ.</Empty> : (
    <Card flat><div className="table-wrap"><table>
      <thead><tr><th>Sản phẩm</th><th className="num">Đã bán</th><th className="num">Doanh thu</th><th className="num">Giá vốn</th><th className="num">LN gộp</th><th className="num">Biên</th></tr></thead>
      <tbody>{d.data.map((p) => <tr key={p.variant_id}><td>{p.product_name}{p.variant_name ? ` — ${p.variant_name}` : ''}<div className="small muted">{p.sku}</div></td><td className="num">{num(p.qty_sold)}</td><td className="num">{vnd(p.revenue)}</td><td className="num">{vnd(p.cogs)}</td><td className="num">{vnd(p.gross_profit)}</td><td className="num">{pct(p.margin_pct)}</td></tr>)}</tbody>
    </table></div></Card>
  );
  if (tab === 'customers') {
    const c = d.data;
    return (
      <>
        <div className="grid cols-4"><Kpi label="Khách mua trong kỳ" value={c.buyers} /><Kpi label="Khách mới" value={c.new_customers} /><Kpi label="Khách quay lại" value={c.returning_customers} /><Kpi label="Tỷ lệ mua lại" value={pct(c.repeat_rate_pct)} /></div>
        <Card title="Khách chi nhiều nhất" flat><div className="table-wrap"><table><tbody>{c.top_customers.map((t) => <tr key={t.customer_id}><td><b>{t.name}</b><div className="small muted">{t.code} · {t.phone}</div></td><td className="num">{t.order_count} đơn</td><td className="num">{vnd(t.net_revenue)}</td></tr>)}</tbody></table></div></Card>
      </>
    );
  }
  if (tab === 'inventory') {
    const i = d.data;
    return (
      <>
        <div className="grid cols-3"><Kpi label="Giá trị tồn" value={vnd(i.stock_value)} /><Kpi label="Số ngày tồn" value={i.days_of_inventory === null ? '—' : `${i.days_of_inventory} ngày`} hint="Tính theo giá vốn bán 30 ngày gần nhất" /><Kpi label="Số SKU" value={i.sku_count} /></div>
        <Card title={`Sắp hết (${i.low_stock.length})`}>{i.low_stock.map((x) => <div key={x.variant_id} className="row between small"><span>{x.product_name} <span className="muted">{x.sku}</span></span><b>còn {x.on_hand}</b></div>)}{!i.low_stock.length && <span className="muted small">Không có.</span>}</Card>
        <Card title={`Bán chậm (${i.slow_moving.length})`}>{i.slow_moving.map((x) => <div key={x.variant_id} className="row between small"><span>{x.product_name} <span className="muted">{x.sku}</span></span><span>tồn {x.on_hand} · {vnd(x.stock_value)}</span></div>)}{!i.slow_moving.length && <span className="muted small">Không có.</span>}</Card>
      </>
    );
  }
  if (tab === 'cash') {
    return (
      <>
        <div className="grid cols-3"><Kpi label="Đã thu" value={vnd(d.data.cash_in)} /><Kpi label="Đã chi" value={vnd(d.data.cash_out)} /><Kpi label="Ròng" value={vnd(d.data.net_cash)} /></div>
        <div className="grid cols-3"><Kpi label="Khách còn nợ" value={vnd(d.data.customer_receivable)} hint={`${d.data.customer_receivable_orders} đơn`} /><Kpi label="Sàn đang treo" value={vnd(d.data.marketplace_pending)} hint={`${d.data.marketplace_pending_orders} đơn`} /><Kpi label="Nợ nhà cung cấp" value={vnd(d.data.supplier_payable)} hint={`${d.data.supplier_payable_purchases} phiếu`} /></div>
      </>
    );
  }
  if (tab === 'custom') return !d.data.length ? <Empty>Chưa có chỉ số tuỳ chỉnh. Tạo trong Cài đặt → Chỉ số tuỳ chỉnh.</Empty> : (
    <div className="grid cols-3">{d.data.map((m) => <Kpi key={m.id} label={m.name} value={m.error ? 'Lỗi công thức' : m.value === null ? '—' : m.format === 'money' ? vnd(m.value) : m.format === 'percent' ? pct(m.value) : num(Math.round(m.value * 100) / 100)} hint={m.error} />)}</div>
  );
  return (
    <Card title="Sức khoẻ kinh doanh">
      {d.data.map((h) => (
        <div key={h.key} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
          <span>{h.label}<div className="small muted">Vàng {h.threshold.direction === 'higher_better' ? '<' : '>'} {h.threshold.warn} · Đỏ {h.threshold.direction === 'higher_better' ? '<' : '>'} {h.threshold.bad}</div></span>
          <b className={h.status ? `h-${h.status}` : 'muted'}>{h.value === null ? 'chưa có dữ liệu' : String(h.value).replace('.', ',')} {h.status === 'red' ? '● Đỏ' : h.status === 'yellow' ? '● Vàng' : h.status === 'green' ? '● Xanh' : ''}</b>
        </div>
      ))}
    </Card>
  );
}
