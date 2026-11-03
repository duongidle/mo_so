import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Bars, HBars, Async, Card, Chips, Tabs, DateRange, Empty, Kpi, Loading, useAsync } from '../components/ui.jsx';
import { Element, ELEMENT_ORDER } from '../components/Motif.jsx';
import { vnd, num, pct, monthStart, today, fmtDate, addDays } from '../lib.js';
import { reportTables, sheetName } from '../reportTables.js';
import Icon from '../components/Icon.jsx';

const TABS = [['revenue', 'Doanh thu'], ['profit', 'Lợi nhuận'], ['expenses', 'Chi phí'], ['channels', 'Kênh'], ['products', 'Sản phẩm'], ['customers', 'Khách'], ['inventory', 'Kho'], ['cash', 'Tiền & công nợ'], ['custom', 'Chỉ số tuỳ chỉnh'], ['health', 'Sức khoẻ']];
const PRESETS = [['Tháng này', () => [monthStart(), today()]], ['7 ngày', () => [addDays(today(), -6), today()]], ['30 ngày', () => [addDays(today(), -29), today()]]];

export default function Reports() {
  const { shopId, isAll, has, shop } = useSession();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'revenue');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [cat, setCat] = useState(''); // lọc danh mục sản phẩm (chỉ ở tab Sản phẩm)
  const cats = useAsync(() => (tab === 'products' ? api.get('/categories') : Promise.resolve(null)), [tab]);
  const p = { from: range.from, to: range.to, shop_id: isAll ? undefined : shopId };
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
      <div className="page-head"><h1>Báo cáo</h1><div className="row"><Link className="btn" to="/guide">Cách đọc các chỉ số</Link><ExportButton tab={tab} data={ready} range={range} shopName={isAll ? null : shop?.name} /></div></div>
      <Tabs options={TABS} value={tab} onChange={setTab} />
      <div className="row wrap"><DateRange {...range} onChange={setRange} />{PRESETS.map(([l, f]) => <button key={l} className="btn sm" onClick={() => { const [from, to] = f(); setRange({ from, to }); }}>{l}</button>)}
        {tab === 'products' && <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Danh mục sản phẩm" style={{ width: 200 }}><option value="">Mọi danh mục</option>{(cats.data?.data || []).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</select>}</div>
      <Async state={state}>{() => (ready ? <Body tab={tab} d={ready} elements={has('feng_shui')} /> : <Loading />)}</Async>
    </div>
  );
}

/** Xuất đúng những gì đang xem trên tab hiện tại ra Excel (mỗi bảng một sheet) */
function ExportButton({ tab, data, range, shopName }) {
  const go = () => {
    const tables = reportTables(tab, data, { range, shopName });
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

const Row = ({ l, v, bold, neg }) => <div className="row between" style={bold ? { fontWeight: 700, borderTop: '1px solid var(--champagne)', paddingTop: 6 } : undefined}><span>{l}</span><span className="num">{neg ? '− ' : ''}{vnd(v)}</span></div>;

function Body({ tab, d, elements }) {
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
        {ov.tax?.applicable && (
          <Card title="Ước tính thuế" actions={<Link className="btn sm" to="/settings">Đổi quy tắc</Link>}><div className="stack small">
            {ov.tax.items.map((t) => <div key={t.name} className="row between"><span>{t.name} <span className="muted">({String(t.rate_pct).replace('.', ',')}% trên {t.base_label.toLowerCase()}{t.exempt_threshold_year ? `, miễn ${vnd(t.exempt_threshold_year)}/năm` : ''})</span></span><span className="num">{vnd(t.tax)}</span></div>)}
            <Row l="Thuế ước tính" v={ov.tax.total} bold /><Row l="Lợi nhuận sau thuế ước tính" v={c.profit_after_tax_estimate} bold />
          </div><p className="small muted" style={{ marginBottom: 0 }}>Chỉ là ước tính theo quy tắc bạn tự đặt, không phải tờ khai thuế. Thuế tính cho cả hộ kinh doanh, nên không chia theo shop.</p></Card>
        )}
        {ov.tax && !ov.tax.applicable && <div className="alert warn small">{ov.tax.reason}</div>}
        <Card title="Theo shop" flat><div className="table-wrap"><table>
          <thead><tr><th>Shop</th><th className="num">Doanh thu</th><th className="num">LN gộp</th><th className="num">Chi phí</th><th className="num">LN ròng</th></tr></thead>
          <tbody>{shops.data.map((s) => <tr key={s.shop_id}><td><b>{s.shop_name}</b></td><td className="num">{vnd(s.net_revenue)}</td><td className="num">{vnd(s.gross_profit)}</td><td className="num">{vnd(s.expenses_amount)}</td><td className="num"><b>{vnd(s.net_profit_estimate)}</b></td></tr>)}</tbody>
        </table></div></Card>
      </>
    );
  }
  if (tab === 'expenses') return <ExpenseReport e={d.data} />;
  if (tab === 'channels') return !d.data.length ? <Empty>Chưa có đơn trong kỳ.</Empty> : (
    <Card flat><div className="table-wrap"><table>
      <thead><tr><th>Kênh</th><th className="num">Đơn</th><th className="num">Doanh thu thuần</th><th className="num">Phí sàn</th><th className="num">LN gộp</th><th className="num">Biên</th><th className="num">Huỷ</th></tr></thead>
      <tbody>{d.data.map((c) => <tr key={c.channel_id}><td><b>{c.channel_name}</b></td><td className="num">{c.order_count}</td><td className="num">{vnd(c.net_revenue)}</td><td className="num">{vnd(c.platform_fee)}</td><td className="num">{vnd(c.gross_profit)}</td><td className="num">{pct(c.gross_margin_pct)}</td><td className="num">{pct(c.cancel_rate_pct)}</td></tr>)}</tbody>
    </table></div></Card>
  );
  if (tab === 'products') return !d[0].data.length ? <Empty>Chưa bán sản phẩm nào trong kỳ.</Empty> : (
    <>
    {elements && <Card title="Theo ngũ hành"><HBars items={ELEMENT_ORDER.map((e) => ({ label: e, value: d[1].data.find((x) => x.element === e)?.revenue || 0 }))} /><p className="small muted" style={{ marginBottom: 0 }}>Sản phẩm hợp nhiều hành được chia đều doanh thu cho các hành đó.</p></Card>}
    {d[0].combos.count > 0 && (
      <div className="grid cols-4">
        <Kpi label="Combo đã bán" value={num(d[0].combos.qty)} hint={`${d[0].combos.count} loại combo`} />
        <Kpi label="Doanh thu combo" value={vnd(d[0].combos.revenue)} />
        <Kpi label="Giá vốn combo" value={vnd(d[0].combos.cogs)} hint="Tổng giá vốn thành phần lúc bán" />
        <Kpi label="LN gộp combo" value={vnd(d[0].combos.gross_profit)} />
      </div>
    )}
    <Card flat><div className="table-wrap"><table>
      <thead><tr><th>Sản phẩm</th><th className="num">Đã bán</th>{d[0].combos.count > 0 && <th className="num" title="Số đơn vị bán nằm trong combo, không cộng vào cột Đã bán">Qua combo</th>}<th className="num">Doanh thu</th><th className="num">Giá vốn</th><th className="num">LN gộp</th><th className="num">Biên</th></tr></thead>
      <tbody>{d[0].data.map((p) => <tr key={p.variant_id}><td>{p.product_name}{p.variant_name ? ` — ${p.variant_name}` : ''}{p.is_bundle && <span className="badge plain" style={{ marginLeft: 8 }}>Combo</span>}<div className="small muted">{p.sku}</div></td><td className="num">{num(p.qty_sold)}</td>{d[0].combos.count > 0 && <td className="num muted">{p.is_bundle ? '—' : num(p.qty_in_combos)}</td>}<td className="num">{vnd(p.revenue)}</td><td className="num">{vnd(p.cogs)}</td><td className="num">{vnd(p.gross_profit)}</td><td className="num">{pct(p.margin_pct)}</td></tr>)}</tbody>
    </table></div></Card>
    </>
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
  if (tab === 'cash') return <CashTab cf={d[0].data} aging={d[1].data} accounts={d[2]} />;
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

function ExpenseReport({ e }) {
  if (!e.total && !e.previous_total) return <Empty>Chưa có chi phí trong kỳ. Thêm ở trang Chi phí & đối soát.</Empty>;
  return (
    <>
      <div className="grid cols-4">
        <Kpi label="Tổng chi phí" value={vnd(e.total)} delta={e.change_pct === null ? undefined : -e.change_pct} hint={`Kỳ trước ${vnd(e.previous_total)}`} />
        <Kpi label="Chi phí / doanh thu thuần" value={pct(e.expense_ratio_pct)} hint={`Doanh thu thuần ${vnd(e.net_revenue)}`} />
        <Kpi label="Của riêng shop" value={vnd(e.direct)} />
        <Kpi label="Chi phí chung đã chia" value={vnd(e.shared)} hint="Chia về các shop theo Cài đặt" />
      </div>
      <Card title="Theo danh mục"><HBars items={e.by_category.map((c) => ({ label: c.name, value: c.amount }))} /></Card>
      <Card flat><div className="table-wrap"><table>
        <thead><tr><th>Danh mục</th><th className="num">Số tiền</th><th className="num">Tỷ trọng</th><th className="num hide-sm">Của shop</th><th className="num hide-sm">Chung (chia)</th><th className="num">Kỳ trước</th><th className="num">Thay đổi</th></tr></thead>
        <tbody>{e.by_category.map((c) => <tr key={c.category_id}><td><b>{c.name}</b></td><td className="num">{vnd(c.amount)}</td><td className="num">{pct(c.share_pct)}</td><td className="num hide-sm">{vnd(c.direct)}</td><td className="num hide-sm">{vnd(c.shared)}</td><td className="num">{vnd(c.previous_amount)}</td><td className={`num ${c.change_pct > 20 ? 'h-red' : ''}`}>{c.change_pct === null ? '—' : `${c.change_pct > 0 ? '+' : ''}${String(c.change_pct).replace('.', ',')}%`}</td></tr>)}</tbody>
      </table></div></Card>
      {e.by_shop.length > 1 && <Card title="Theo shop"><HBars items={e.by_shop.map((s) => ({ label: s.shop_name, value: s.amount }))} /></Card>}
      {e.largest.length > 0 && (
        <Card title="Khoản chi lớn nhất" flat><div className="table-wrap"><table><tbody>{e.largest.map((x) => <tr key={x.id}><td>{fmtDate(x.expense_date)}</td><td><b>{x.category_name}</b><div className="small muted">{x.shop_name || 'Chung'}{x.payee ? ` · ${x.payee}` : ''}</div></td><td className="num">{vnd(x.amount)}</td></tr>)}</tbody></table></div></Card>
      )}
    </>
  );
}

const AGING_TITLES = { customer: ['Khách còn nợ', 'Tính từ ngày đặt đơn. Đơn bán trực tiếp/Facebook chưa thu đủ.'], marketplace: ['Tiền sàn chưa về', 'Tính từ ngày đặt đơn. Đơn Shopee đã hoàn thành nhưng chưa ghi nhận tiền về (xử lý ở Chi phí & đối soát).'], supplier: ['Nợ nhà cung cấp', 'Tính từ ngày nhận hàng.'] };

function AgingCard({ kind, g }) {
  const [title, hint] = AGING_TITLES[kind];
  const worst = [...g.buckets].reverse().find((b) => b.count > 0);
  return (
    <Card title={`${title} · ${vnd(g.total)}`}>
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

function CashTab({ cf, aging, accounts }) {
  return (
    <>
      <Card title={`Số dư các quỹ · ${vnd(accounts.total_balance)}`} actions={<Link className="btn sm" to="/expenses?tab=cash">Quản lý quỹ</Link>}>
        {accounts.data.map((a) => <div key={a.id} className="row between" style={{ padding: '6px 0' }}><span>{a.name}</span><b className={`num ${a.balance < 0 ? 'h-red' : ''}`}>{vnd(a.balance)}</b></div>)}
        {accounts.unassigned.has_activity && <div className="alert warn small" style={{ marginTop: 8 }}>Có {vnd(accounts.unassigned.net)} ở phương thức chưa gán quỹ nào ({accounts.unassigned.methods.join(', ')}). Gán ở Chi phí & đối soát → Quỹ tiền để số dư đủ.</div>}
        <p className="small muted" style={{ marginBottom: 0 }}>Số dư tính đến hôm nay, không phụ thuộc khoảng ngày đang chọn. Hãy nhập số dư đầu và đếm tiền thật ở trang quản lý quỹ để số này khớp với két và tài khoản.</p>
      </Card>
      <div className="grid cols-3"><Kpi label="Đã thu trong kỳ" value={vnd(cf.cash_in)} /><Kpi label="Đã chi trong kỳ" value={vnd(cf.cash_out)} hint={`Gồm chi phí ${vnd(cf.cash_out_expenses)}`} /><Kpi label="Ròng trong kỳ" value={vnd(cf.net_cash)} /></div>
      {cf.shared_expenses_not_included > 0 && <div className="alert warn small">Đang lọc theo shop: chi phí chung {vnd(cf.shared_expenses_not_included)} không thuộc shop nào nên chưa tính vào số “Đã chi”.</div>}
      <div className="grid cols-3"><AgingCard kind="customer" g={aging.customer} /><AgingCard kind="marketplace" g={aging.marketplace} /><AgingCard kind="supplier" g={aging.supplier} /></div>
    </>
  );
}
