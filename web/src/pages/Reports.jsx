import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Bars, HBars, Async, Card, Chips, Tabs, DateRange, Empty, Kpi, Loading, useAsync, PageHeader, Toolbar } from '../components/ui.jsx';
import { Element, ELEMENT_ORDER } from '../components/Motif.jsx';
import { vnd, num, pct, monthStart, today, fmtDate, addDays } from '../lib.js';
import { reportTables, explainTable, sheetName } from '../reportTables.js';
import Icon from '../components/Icon.jsx';
import MetricInfo, { MetricFilters, MetricLabel } from '../components/MetricInfo.jsx';
import { METRICS } from '../metrics.js';

const TABS = [['revenue', 'Doanh thu'], ['profit', 'Lợi nhuận'], ['expenses', 'Chi phí'], ['channels', 'Kênh'], ['products', 'Sản phẩm'], ['customers', 'Khách'], ['inventory', 'Kho'], ['cash', 'Tiền & công nợ'], ['custom', 'Chỉ số tuỳ chỉnh'], ['health', 'Sức khoẻ']];
const INTRO = {
  revenue: 'Bán được bao nhiêu tiền hàng, từ bao nhiêu đơn, và giảm giá hay hàng trả đang lấy đi bao nhiêu?',
  profit: 'Sau khi trừ giá vốn, phí sàn và chi phí, shop còn lại bao nhiêu?',
  expenses: 'Tiền chi ra đi vào đâu, và khoản nào đang tăng nhanh?',
  channels: 'Kênh bán nào mang lại tiền và lãi nhiều nhất?',
  products: 'Sản phẩm nào bán chạy và sản phẩm nào lãi?',
  customers: 'Có bao nhiêu khách mua, bao nhiêu là khách mới và khách quay lại?',
  inventory: 'Hàng còn bao nhiêu, bao nhiêu tiền đang nằm trong kho, món nào sắp hết hoặc bán chậm? Số tồn tính đến hôm nay.',
  cash: 'Tiền đang có ở đâu, ai còn nợ mình và mình còn nợ ai?',
  custom: 'Các chỉ số do bạn tự đặt công thức.',
  health: 'Các tỷ lệ chính đang xanh, vàng hay đỏ so với ngưỡng bạn đặt?',
};
const prevRange = ({ from, to }) => {
  const ms = 86400000;
  const len = Math.round((new Date(to) - new Date(from)) / ms) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
};

/** Dải phạm vi luôn hiện: đang xem shop nào, khoảng nào, kênh nào, so với kỳ nào */
export function ScopeStrip({ shopName, range, channelName, category, tab, intro }) {
  const prev = prevRange(range);
  const oneDay = tab === 'inventory';
  return (
    <p className="note" role="status">
      Đang xem: <b>{shopName || 'Tất cả shop'}</b> · {oneDay ? 'tồn kho tính đến hôm nay' : `${fmtDate(range.from)} – ${fmtDate(range.to)}`} · {channelName || 'Tất cả kênh'}
      {!oneDay && <> · so với {fmtDate(prev.from)} – {fmtDate(prev.to)}</>}
      {category && <> · Danh mục: {category}</>}
      {intro && <> — {intro}</>}
    </p>
  );
}

const PRESETS = [['Tháng này', () => [monthStart(), today()]], ['7 ngày', () => [addDays(today(), -6), today()]], ['30 ngày', () => [addDays(today(), -29), today()]]];

export default function Reports() {
  const { shopId, isAll, has, shop } = useSession();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'revenue');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [cat, setCat] = useState(''); // lọc danh mục sản phẩm (chỉ ở tab Sản phẩm)
  const cats = useAsync(() => (tab === 'products' ? api.get('/categories') : Promise.resolve(null)), [tab]);
  const p = { from: range.from, to: range.to, shop_id: isAll ? undefined : shopId };
  const filters = { from: range.from, to: range.to, channel: undefined, today: today() };
  const deps = [shopId, range.from, range.to, tab, cat];
  const state = useAsync(() => {
    const load = () => {
    switch (tab) {
      case 'revenue': return Promise.all([api.get('/reports/overview', p), api.get('/reports/revenue', p)]);
      case 'profit': return Promise.all([api.get('/reports/overview', p), api.get('/reports/shops', p)]);
      case 'channels': return api.get('/reports/channels', p);
      case 'expenses': return api.get('/reports/expenses', p);
      case 'products': return Promise.all([api.get('/reports/products', { ...p, category_id: cat || undefined }), has('feng_shui') ? api.get('/reports/elements', { ...p, category_id: cat || undefined }) : Promise.resolve({ data: [] })]);
      case 'customers': return api.get('/reports/customers', p);
      case 'inventory': return api.get('/reports/inventory', { shop_id: p.shop_id });
      case 'cash': return Promise.all([api.get('/reports/cashflow', p), api.get('/reports/aging', { shop_id: p.shop_id }), api.get('/cash/accounts')]);
      case 'custom': return api.get('/reports/custom-metrics', p);
      default: return api.get('/reports/health', p);
    }
    };
    // Dữ liệu luôn đi kèm tab đã tải nó: đổi tab trong lúc đang tải thì không được vẽ tab mới bằng dữ liệu của tab cũ
    return Promise.resolve(load()).then((data) => ({ tab, data }));
  }, deps);
  const ready = state.data?.tab === tab ? state.data.data : null;

  return (
    <div className="page stack">
      <PageHeader title="Báo cáo" actions={<><Link className="btn" to="/guide/suc-khoe-kinh-doanh">Cách đọc các chỉ số</Link><ExportButton tab={tab} data={ready} range={range} shopName={isAll ? null : shop?.name} /></>} />
      <Toolbar><Tabs options={TABS} value={tab} onChange={setTab} /></Toolbar>
      <Toolbar><DateRange {...range} onChange={setRange} />{PRESETS.map(([l, f]) => <button key={l} className="btn sm" onClick={() => { const [from, to] = f(); setRange({ from, to }); }}>{l}</button>)}
        {tab === 'products' && <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Danh mục sản phẩm"><option value="">Mọi danh mục</option>{(cats.data?.data || []).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</select>}</Toolbar>
      <ScopeStrip shopName={isAll ? null : shop?.name} range={range} category={tab === 'products' && cat ? (cats.data?.data || []).find((c) => c.id === cat)?.name : null} tab={tab} intro={INTRO[tab]} />
      <MetricFilters.Provider value={filters}><Async state={state}>{() => (ready ? <Body tab={tab} d={ready} elements={has('feng_shui')} /> : <Loading />)}</Async></MetricFilters.Provider>
    </div>
  );
}

/** Xuất đúng những gì đang xem trên tab hiện tại ra Excel (mỗi bảng một sheet) */
function ExportButton({ tab, data, range, shopName }) {
  const go = () => {
    const tables = [...reportTables(tab, data, { range, shopName }), explainTable(tab)];
    const wb = XLSX.utils.book_new();
    for (const t of tables) {
      const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
      ws['!cols'] = t.headers.map((h, i) => ({ wch: Math.min(40, Math.max(String(h).length + 2, ...t.rows.slice(0, 100).map((r) => String(r[i] ?? '').length + 1))) }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(t.name));
    }
    XLSX.writeFile(wb, `bao-cao-${tab}-${range.from.replaceAll('-', '')}-${range.to.replaceAll('-', '')}.xlsx`);
  };
  return <button className="btn" disabled={!data} onClick={go}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất Excel</button>;
}

const Row = ({ l, v, bold, neg, m }) => <div className="row between" style={bold ? { fontWeight: 700, borderTop: '1px solid var(--champagne)', paddingTop: 8 } : undefined}><MetricLabel metric={m}>{l}</MetricLabel>{v !== null && <span className="num">{neg ? '− ' : ''}{vnd(v)}</span>}</div>;

const Th = ({ m, children, className = 'num', ...rest }) => <th className={className} {...rest}><MetricLabel metric={m}>{children}</MetricLabel></th>;

function Body({ tab, d, elements }) {
  if (tab === 'revenue') {
    const [{ data: ov }, series] = d;
    const c = ov.current;
    return (
      <>
        <div className="grid cols-4">
          <Kpi metric="net_revenue" label="Doanh thu thuần" value={vnd(c.net_revenue)} delta={ov.change_pct.net_revenue} />
          <Kpi metric="order_count" label="Số đơn" value={num(c.order_count)} delta={ov.change_pct.order_count} />
          <Kpi metric="aov" label="Giá trị đơn TB" value={vnd(c.aov)} delta={ov.change_pct.aov} />
          <Kpi metric="cancel_rate_pct" label="Tỷ lệ huỷ / hoàn" value={`${pct(c.cancel_rate_pct)} / ${pct(c.return_rate_pct)}`} hint={<>Hoàn: {pct(c.return_rate_pct)} <MetricInfo metric="return_rate_pct" /></>} />
        </div>
        <Card title={<MetricLabel metric="revenue_by_day">Doanh thu theo ngày</MetricLabel>}><Bars data={series.data} value="net_revenue" /></Card>
        <Card title="Từ tiền hàng đến doanh thu thuần"><div className="stack small">
          <Row m="gross_revenue" l="Doanh thu gộp (tiền hàng)" v={c.gross_revenue} /><Row m="discount_amount" l="Giảm giá" v={c.discount_amount} neg /><Row m="returned_amount" l="Hàng trả" v={c.returned_amount} neg /><Row m="net_revenue" l="Doanh thu thuần" v={c.net_revenue} bold />
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
          <Row m="net_revenue" l="Doanh thu thuần" v={c.net_revenue} /><Row m="shipping_fee" l="Phí ship khách trả (sau hoàn ship)" v={c.shipping_fee} />{c.return_fee > 0 && <Row m="return_fee" l="Phí trả hàng thu được" v={c.return_fee} />}<Row m="platform_fee" l="Phí sàn" v={c.platform_fee} neg /><Row m="seller_shipping" l="Ship shop chịu" v={c.seller_shipping} neg />{c.return_shipping_cost > 0 && <Row m="return_shipping_cost" l="Phí ship chiều về (trả hàng)" v={c.return_shipping_cost} neg />}<Row m="cogs" l="Giá vốn" v={c.cogs} neg />
          <Row m="gross_profit" l="Lợi nhuận gộp" v={c.gross_profit} bold /><Row m="gross_margin_pct" l={`Biên lợi nhuận gộp: ${pct(c.gross_margin_pct)}`} v={null} /><Row m="expenses_amount" l="Chi phí (gồm phần chia từ chi phí chung)" v={c.expenses_amount} neg />{c.other_profit_adjustment !== 0 && <Row m="report_other_adjustment" l="Điều chỉnh kho và kiểm đếm quỹ" v={c.other_profit_adjustment} />}<Row m="net_profit_estimate" l="Lợi nhuận ròng ước tính" v={c.net_profit_estimate} bold />
        </div><p className="small muted" style={{ marginTop: 8 }}>“Ước tính” vì chưa tính thuế, khấu hao và các chứng từ thu/chi khác lập tay.</p></Card>
        {ov.tax?.applicable && (
          <Card title={<MetricLabel metric="tax_estimate">Ước tính thuế</MetricLabel>} actions={<Link className="btn sm" to="/settings">Đổi quy tắc</Link>}><div className="stack small">
            {ov.tax.items.map((t) => <div key={t.name} className="row between"><span>{t.name} <span className="muted">({String(t.rate_pct).replace('.', ',')}% trên {t.base_label.toLowerCase()}{t.exempt_threshold_year ? `, miễn ${vnd(t.exempt_threshold_year)}/năm` : ''})</span></span><span className="num">{vnd(t.tax)}</span></div>)}
            <Row m="tax_estimate" l="Thuế ước tính" v={ov.tax.total} bold /><Row m="profit_after_tax_estimate" l="Lợi nhuận sau thuế ước tính" v={c.profit_after_tax_estimate} bold />
          </div><p className="small muted" style={{ marginBottom: 0 }}>Chỉ là ước tính theo quy tắc bạn tự đặt, không phải tờ khai thuế. Thuế tính cho cả hộ kinh doanh, nên không chia theo shop.</p></Card>
        )}
        {ov.tax && !ov.tax.applicable && <div className="alert warn small">{ov.tax.reason}</div>}
        <Card title="Theo shop" flat><p className="small muted" style={{ margin: 0, padding: '0 0 8px' }}>Mỗi dòng là một shop (không đổi theo shop đang chọn ở đầu trang). Chi phí đã gồm phần chi phí chung chia về shop đó.</p><div className="table-wrap"><table>
          <thead><tr><th>Shop</th><Th m="net_revenue">Doanh thu</Th><Th m="gross_profit">LN gộp</Th><Th m="expenses_amount">Chi phí</Th><Th m="net_profit_estimate">LN ròng</Th></tr></thead>
          <tbody>{shops.data.map((s) => <tr key={s.shop_id}><td><b>{s.shop_name}</b></td><td className="num">{vnd(s.net_revenue)}</td><td className="num">{vnd(s.gross_profit)}</td><td className="num">{vnd(s.expenses_amount)}</td><td className="num"><b>{vnd(s.net_profit_estimate)}</b></td></tr>)}</tbody>
        </table></div></Card>
      </>
    );
  }
  if (tab === 'expenses') return <ExpenseReport e={d.data} />;
  if (tab === 'channels') return !d.data.length ? <Empty>Chưa có đơn trong kỳ.</Empty> : (
    <Card flat><div className="table-wrap"><table>
      <thead><tr><th><MetricLabel metric="channel_table">Kênh</MetricLabel></th><Th m="order_count">Đơn</Th><Th m="net_revenue">Doanh thu thuần</Th><Th m="platform_fee">Phí sàn</Th><Th m="gross_profit">LN gộp</Th><Th m="gross_margin_pct">Biên</Th><Th m="cancel_rate_pct">Huỷ</Th></tr></thead>
      <tbody>{d.data.map((c) => <tr key={c.channel_id}><td><b>{c.channel_name}</b></td><td className="num">{c.order_count}</td><td className="num">{vnd(c.net_revenue)}</td><td className="num">{vnd(c.platform_fee)}</td><td className="num">{vnd(c.gross_profit)}</td><td className="num">{pct(c.gross_margin_pct)}</td><td className="num">{pct(c.cancel_rate_pct)}</td></tr>)}</tbody>
    </table></div></Card>
  );
  if (tab === 'products') return !d[0].data.length ? <Empty>Chưa bán sản phẩm nào trong kỳ.</Empty> : (
    <>
    {elements && <Card title={<MetricLabel metric="element_revenue">Theo ngũ hành</MetricLabel>}><HBars items={ELEMENT_ORDER.map((e) => ({ label: e, value: d[1].data.find((x) => x.element === e)?.revenue || 0 }))} /><p className="small muted" style={{ marginBottom: 0 }}>Sản phẩm hợp nhiều hành được chia đều doanh thu cho các hành đó.</p></Card>}
    {d[0].combos.count > 0 && (
      <div className="grid cols-4">
        <Kpi metric="combo_qty" label="Combo đã bán" value={num(d[0].combos.qty)} hint={`${d[0].combos.count} loại combo`} />
        <Kpi metric="combo_revenue" label="Doanh thu combo" value={vnd(d[0].combos.revenue)} />
        <Kpi metric="combo_cogs" label="Giá vốn combo" value={vnd(d[0].combos.cogs)} hint="Tổng giá vốn thành phần lúc bán" />
        <Kpi metric="combo_gross_profit" label="LN gộp combo" value={vnd(d[0].combos.gross_profit)} />
      </div>
    )}
    <Card flat><div className="table-wrap"><table>
      <thead><tr><th>Sản phẩm</th><Th m="qty_sold">Đã bán</Th>{d[0].combos.count > 0 && <Th m="qty_in_combos">Qua combo</Th>}<Th m="product_revenue">Doanh thu</Th><Th m="product_cogs">Giá vốn</Th><Th m="product_gross_profit">LN gộp</Th><Th m="product_margin_pct">Biên</Th></tr></thead>
      <tbody>{d[0].data.map((p) => <tr key={p.variant_id}><td>{p.product_name}{p.variant_name ? ` — ${p.variant_name}` : ''}{p.is_bundle && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}<div className="small muted">{p.sku}</div></td><td className="num">{num(p.qty_sold)}</td>{d[0].combos.count > 0 && <td className="num muted">{p.is_bundle ? '—' : num(p.qty_in_combos)}</td>}<td className="num">{vnd(p.revenue)}</td><td className="num">{vnd(p.cogs)}</td><td className="num">{vnd(p.gross_profit)}</td><td className="num">{pct(p.margin_pct)}</td></tr>)}</tbody>
    </table></div></Card>
    </>
  );
  if (tab === 'customers') {
    const c = d.data;
    return (
      <>
        <div className="grid cols-4"><Kpi metric="buyers" label="Khách mua trong kỳ" value={c.buyers} /><Kpi metric="new_customers" label="Khách mới" value={c.new_customers} /><Kpi metric="returning_customers" label="Khách quay lại" value={c.returning_customers} /><Kpi metric="repeat_rate_pct" label="Tỷ lệ mua lại" value={pct(c.repeat_rate_pct)} /></div>
        <Card title={<MetricLabel metric="top_customers">Khách chi nhiều nhất</MetricLabel>} flat><div className="table-wrap"><table><tbody>{c.top_customers.map((t) => <tr key={t.customer_id}><td><b>{t.name}</b><div className="small muted">{t.code} · {t.phone}</div></td><td className="num">{t.order_count} đơn</td><td className="num">{vnd(t.net_revenue)}</td></tr>)}</tbody></table></div></Card>
      </>
    );
  }
  if (tab === 'inventory') {
    const i = d.data;
    return (
      <>
        <div className="grid cols-3"><Kpi metric="stock_value" label="Giá trị tồn" value={vnd(i.stock_value)} /><Kpi metric="days_of_inventory" label="Số ngày tồn" value={i.days_of_inventory === null ? '—' : `${i.days_of_inventory} ngày`} hint="Tính theo giá vốn bán 30 ngày gần nhất" /><Kpi metric="sku_count" label="Số SKU" value={i.sku_count} /></div>
        <Card title={<MetricLabel metric="low_stock">{`Sắp hết (${i.low_stock.length})`}</MetricLabel>}>{i.low_stock.map((x) => <div key={x.variant_id} className="row between small"><span>{x.product_name} <span className="muted">{x.sku}</span></span><b>còn {x.on_hand}</b></div>)}{!i.low_stock.length && <span className="muted small">Không có.</span>}</Card>
        <Card title={<MetricLabel metric="slow_moving">{`Bán chậm (${i.slow_moving.length})`}</MetricLabel>}>{i.slow_moving.map((x) => <div key={x.variant_id} className="row between small"><span>{x.product_name} <span className="muted">{x.sku}</span></span><span>tồn {x.on_hand} · {vnd(x.stock_value)}</span></div>)}{!i.slow_moving.length && <span className="muted small">Không có.</span>}</Card>
      </>
    );
  }
  if (tab === 'cash') return <CashTab cf={d[0].data} aging={d[1].data} accounts={d[2]} meta={d[0].meta} />;
  if (tab === 'custom') return !d.data.length ? <Empty>Chưa có chỉ số tuỳ chỉnh. Tạo trong Cài đặt → Chỉ số tuỳ chỉnh.</Empty> : (
    <div className="grid cols-3">{d.data.map((m) => <Kpi key={m.id} metric="custom_metric" label={m.name} value={m.error ? 'Lỗi công thức' : m.value === null ? '—' : m.format === 'money' ? vnd(m.value) : m.format === 'percent' ? pct(m.value) : num(Math.round(m.value * 100) / 100)} hint={m.error} />)}</div>
  );
  return (
    <Card title="Sức khoẻ kinh doanh">
      {d.data.map((h) => (
        <div key={h.key} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
          <span><MetricLabel metric={METRICS[h.key] ? h.key : 'health_status'}>{h.label}</MetricLabel><div className="small muted">Vàng {h.threshold.direction === 'higher_better' ? '<' : '>'} {h.threshold.warn} · Đỏ {h.threshold.direction === 'higher_better' ? '<' : '>'} {h.threshold.bad}</div></span>
          <b className={h.status ? `h-${h.status}` : 'muted'}>{h.value === null ? 'chưa có dữ liệu' : String(h.value).replace('.', ',')} {h.status === 'red' ? '● Đỏ' : h.status === 'yellow' ? '● Vàng' : h.status === 'green' ? '● Xanh' : ''}</b>
        </div>
      ))}
    </Card>
  );
}

function ExpenseReport({ e }) {
  if (!e.total && !e.previous_total) return <Empty>Chưa có chi phí trong kỳ. Thêm ở trang Chi phí & đối soát.</Empty>;
  return (
    <>
      <div className="grid cols-4">
        <Kpi metric="expenses_total" label="Tổng chi phí" value={vnd(e.total)} delta={e.change_pct === null ? undefined : -e.change_pct} hint={`Kỳ trước ${vnd(e.previous_total)}`} />
        <Kpi metric="expense_ratio_pct" label="Chi phí / doanh thu thuần" value={pct(e.expense_ratio_pct)} hint={`Doanh thu thuần ${vnd(e.net_revenue)}`} />
        <Kpi metric="expenses_direct" label="Của riêng shop" value={vnd(e.direct)} />
        <Kpi metric="expenses_shared" label="Chi phí chung đã chia" value={vnd(e.shared)} hint="Chia về các shop theo Cài đặt" />
      </div>
      <Card title="Theo danh mục"><HBars items={e.by_category.map((c) => ({ label: c.name, value: c.amount }))} /></Card>
      <Card flat><div className="table-wrap"><table>
        <thead><tr><th>Danh mục</th><Th m="expenses_total">Số tiền</Th><Th m="expense_share_pct">Tỷ trọng</Th><Th m="expenses_direct" className="num hide-sm">Của shop</Th><Th m="expenses_shared" className="num hide-sm">Chung (chia)</Th><Th m="expenses_total">Kỳ trước</Th><Th m="expense_change_pct">Thay đổi</Th></tr></thead>
        <tbody>{e.by_category.map((c) => <tr key={c.category_id}><td><b>{c.name}</b></td><td className="num">{vnd(c.amount)}</td><td className="num">{pct(c.share_pct)}</td><td className="num hide-sm">{vnd(c.direct)}</td><td className="num hide-sm">{vnd(c.shared)}</td><td className="num">{vnd(c.previous_amount)}</td><td className={`num ${c.change_pct > 20 ? 'h-red' : ''}`}>{c.change_pct === null ? '—' : `${c.change_pct > 0 ? '+' : ''}${String(c.change_pct).replace('.', ',')}%`}</td></tr>)}</tbody>
      </table></div></Card>
      {e.by_shop.length > 1 && <Card title="Theo shop"><HBars items={e.by_shop.map((s) => ({ label: s.shop_name, value: s.amount }))} /></Card>}
      {e.largest.length > 0 && (
        <Card title={<MetricLabel metric="expense_largest">Khoản chi lớn nhất</MetricLabel>} flat><div className="table-wrap"><table><tbody>{e.largest.map((x) => <tr key={x.id}><td>{fmtDate(x.expense_date)}</td><td><b>{x.category_name}</b><div className="small muted">{x.shop_name || 'Chung'}{x.payee ? ` · ${x.payee}` : ''}</div></td><td className="num">{vnd(x.amount)}</td></tr>)}</tbody></table></div></Card>
      )}
    </>
  );
}

const AGING_KEY = { customer: 'aging_customer', marketplace: 'aging_marketplace', supplier: 'aging_supplier' };
const AGING_TITLES = { customer: ['Khách còn nợ', 'Tính từ ngày đặt đơn. Đơn bán trực tiếp/Facebook chưa thu đủ.'], marketplace: ['Tiền sàn chưa về', 'Tính từ ngày đặt đơn. Đơn trên sàn (Shopee, TikTok Shop…) đã hoàn thành nhưng chưa ghi nhận tiền về (xử lý ở Chi phí & đối soát).'], supplier: ['Nợ nhà cung cấp', 'Tính từ ngày nhận hàng.'] };

function AgingCard({ kind, g }) {
  const [title, hint] = AGING_TITLES[kind];
  const worst = [...g.buckets].reverse().find((b) => b.count > 0);
  return (
    <Card title={<MetricLabel metric={AGING_KEY[kind]}>{`${title} · ${vnd(g.total)}`}</MetricLabel>}>
      {!g.count ? <span className="muted small">Không có.</span> : (
        <>
          <HBars items={g.buckets.map((b) => ({ label: b.label, value: b.amount }))} />
          <p className="small muted" style={{ margin: '8px 0 0' }}>{hint}{worst && worst.min >= 31 ? <b className="h-yellow"> Có {worst.count} khoản đã quá {worst.min - 1} ngày, nên xử lý trước.</b> : ''}</p>
          <div className="table-wrap" style={{ marginTop: 8 }}><table><tbody>{g.items.slice(0, 5).map((i) => <tr key={i.id}><td><b>{i.code}</b><div className="small muted">{i.party}</div></td><td className="num small">{i.age_days} ngày</td><td className="num">{vnd(i.owed)}</td></tr>)}</tbody></table></div>
        </>
      )}
    </Card>
  );
}

function CashTab({ cf, aging, accounts, meta }) {
  return (
    <>
      <Card title={<MetricLabel metric="fund_balance">{`Số dư các quỹ · ${vnd(accounts.total_balance)}`}</MetricLabel>} actions={<Link className="btn sm" to="/expenses?tab=cash">Quản lý quỹ</Link>}>
        {accounts.data.map((a) => <div key={a.id} className="row between" style={{ padding: '8px 0' }}><span>{a.name}</span><b className={`num ${a.balance < 0 ? 'h-red' : ''}`}>{vnd(a.balance)}</b></div>)}
        {accounts.unassigned.has_activity && <div className="alert warn small" style={{ marginTop: 8 }}>Có {vnd(accounts.unassigned.net)} ở phương thức chưa gán quỹ nào ({accounts.unassigned.methods.join(', ')}). Gán ở Chi phí & đối soát → Quỹ tiền để số dư đủ.</div>}
        <p className="small muted" style={{ marginBottom: 0 }}>Số dư tính đến hôm nay, không phụ thuộc khoảng ngày đang chọn. Hãy nhập số dư đầu và đếm tiền thật ở trang quản lý quỹ để số này khớp với két và tài khoản.</p>
      </Card>
      <div className="grid cols-3"><Kpi metric="cash_in" label="Đã thu trong kỳ" value={vnd(cf.cash_in)} /><Kpi metric="cash_out" label="Đã chi trong kỳ" value={vnd(cf.cash_out)} hint={`Gồm chi phí ${vnd(cf.cash_out_expenses)}`} /><Kpi metric="net_cash" label="Ròng trong kỳ" value={vnd(cf.net_cash)} /></div>
      {cf.shared_expenses_not_included > 0 && <div className="alert warn small">Đang lọc theo shop: chi phí chung {vnd(cf.shared_expenses_not_included)} không thuộc shop nào nên chưa tính vào số “Đã chi”.</div>}
      <div className="grid cols-3"><Kpi metric="customer_receivable" label="Khách còn nợ" value={vnd(cf.customer_receivable)} /><Kpi metric="marketplace_pending" label="Sàn đang treo" value={vnd(cf.marketplace_pending)} /><Kpi metric="supplier_payable" label="Nợ nhà cung cấp" value={vnd(cf.supplier_payable)} /></div>
      {cf.customer_refund_owed > 0 && <div className="grid cols-3"><Kpi metric="customer_refund_owed" label="Nợ phải trả khách (trả hàng)" value={vnd(cf.customer_refund_owed)} hint={`${cf.customer_refund_owed_orders} đơn`} /></div>}
      {meta?.scope?.shop_filtered && <p className="small muted" style={{ margin: 0 }}>Đang lọc theo shop: nợ nhà cung cấp và số dư quỹ vẫn là của cả tài khoản vì phiếu nhập và quỹ tiền không thuộc riêng shop nào.</p>}
      <div className="grid cols-3"><AgingCard kind="customer" g={aging.customer} /><AgingCard kind="marketplace" g={aging.marketplace} /><AgingCard kind="supplier" g={aging.supplier} /></div>
    </>
  );
}
