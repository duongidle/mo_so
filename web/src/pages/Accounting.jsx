import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Tabs, DateRange, Empty, ErrorBox, Field, Fold, Kpi, Modal, Note, PageHeader, Section, Toolbar, useAction, useAsync } from '../components/ui.jsx';
import { MetricFilters, MetricLabel } from '../components/MetricInfo.jsx';
import Icon from '../components/Icon.jsx';
import { vnd, fmtDate, monthStart, today } from '../lib.js';
import { accountingTables, explainTable, sheetName } from '../reportTables.js';
import { Vouchers, Assets, LockTab, CategoryMapping } from './accounting/Extras.jsx';

const TABS = [['overview', 'Tổng quan'], ['vouchers', 'Chứng từ'], ['assets', 'Tài sản & phân bổ'], ['journal', 'Sổ nhật ký'], ['ledger', 'Sổ cái'], ['trial', 'Cân đối phát sinh'], ['income', 'Kết quả kinh doanh'], ['balance', 'Cân đối kế toán'], ['cashflow', 'Lưu chuyển tiền'], ['accounts', 'Hệ thống tài khoản'], ['lock', 'Khoá sổ']];
/** Ba nhóm tab: mỗi nhóm ngắn đủ hiện hết trên điện thoại, không bị cắt ngang */
export const GROUPS = [
  ['ops', 'Nghiệp vụ', ['overview', 'vouchers', 'assets', 'lock']],
  ['books', 'Sổ', ['journal', 'ledger', 'accounts']],
  ['reports', 'Báo cáo', ['trial', 'income', 'balance', 'cashflow']],
];
const groupOf = (tab) => (GROUPS.find(([, , tabs]) => tabs.includes(tab)) || GROUPS[0])[0];

const INTRO = {
  vouchers: 'Chứng từ lập tay cho những việc không đi qua đơn, nhập hàng hay chi phí: góp vốn, rút vốn, tiền phạt, thu nhập khác. Bút toán tổng hợp để ghi tự do nhiều dòng. Huỷ không xoá hẳn.',
  assets: 'Tài sản cố định và chi phí trả trước: ghi vào tài sản khi mua, rồi chia đều theo tháng thành chi phí (khấu hao hoặc phân bổ).',
  lock: 'Khoá sổ để chốt số kỳ cũ: không ai sửa nhầm chi phí, thanh toán, chứng từ tay của kỳ đã chốt.',
  overview: 'Tiền, công nợ, hàng tồn và lãi của tháng này theo sổ kế toán. Có thể xem số gắn với shop; các khoản chung xem ở Tất cả shop.',
  journal: 'Mọi bút toán theo thời gian, mỗi bút toán có Nợ bằng Có. Nhấn mã chứng từ để mở đơn hay phiếu gốc.',
  ledger: 'Một tài khoản: số dư đầu, từng dòng phát sinh, số dư cuối. Nhấn diễn giải để mở chứng từ gốc.',
  trial: 'Số dư đầu, phát sinh và số dư cuối của mọi tài khoản; có thể lọc các bút toán theo shop.',
  income: 'Doanh thu, giá vốn, chi phí và lãi trong kỳ. Lọc theo shop được (chi phí chung chia về shop như ở Báo cáo).',
  balance: 'Tài sản bằng nợ phải trả cộng vốn cộng lợi nhuận. Luôn tính cho cả tài khoản, không lọc theo shop.',
  cashflow: 'Tiền vào và ra các quỹ trong kỳ, chia theo nguồn.',
  accounts: 'Danh sách tài khoản. Tài khoản hệ thống không đổi được; bạn thêm được tài khoản con.',
};
const signed = (n) => (n < 0 ? `− ${vnd(-n)}` : vnd(n));
const SRC = { order: 'Đơn bán', return: 'Trả hàng', payment: 'Thanh toán', purchase: 'Nhập hàng', purchase_return: 'Trả hàng nhập', purchase_allowance: 'NCC giảm giá sau nhận', expense: 'Chi phí', stock: 'Kho', cash_open: 'Số dư đầu quỹ', cash_entry: 'Quỹ', manual: 'Chứng từ tay', asset: 'Tài sản' };

export default function Accounting() {
  const { shopId, isAll, shop } = useSession();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [exportData, setExportData] = useState(null); // dữ liệu tab đang xem, để xuất Excel
  const shopParam = isAll ? undefined : shopId;
  const changeTab = (t) => { setExportData(null); setTab(t); };
  const group = groupOf(tab);
  const groupTabs = GROUPS.find(([k]) => k === group)[2];
  const changeGroup = (g) => changeTab(GROUPS.find(([k]) => k === g)[2][0]);
  const ctx = { range, shopParam, isAll, report: setExportData, go: changeTab };
  const scopeName = isAll ? 'Tất cả shop' : shop?.name;
  const hasRange = !['overview', 'accounts', 'balance', 'assets', 'lock'].includes(tab);
  const scopeText = ['journal', 'ledger', 'trial', 'income', 'cashflow', 'vouchers'].includes(tab) ? `Shop: ${scopeName || 'một shop'}` : null;
  return (
    <div className="page stack">
      <PageHeader title="Sổ kế toán" actions={<ExportButton tab={tab} data={exportData} range={range} shopName={['income', 'trial'].includes(tab) && !isAll ? shop?.name : null} />} />
      <Toolbar>
        <div className="tabs group-tabs" role="tablist" aria-label="Nhóm">
          {GROUPS.map(([k, label]) => <button key={k} className="tab" role="tab" aria-selected={group === k} onClick={() => changeGroup(k)}>{label}</button>)}
        </div>
        <Tabs options={TABS.filter(([k]) => groupTabs.includes(k))} value={tab} onChange={changeTab} />
        {hasRange && <DateRange {...range} onChange={setRange} />}
      </Toolbar>
      <Note>{[INTRO[tab], scopeText].filter(Boolean).join(' · ')}</Note>
      <MetricFilters.Provider value={{ from: range.from, to: range.to, today: today() }}>
        {tab === 'overview' && <Overview {...ctx} />}
        {tab === 'vouchers' && <Vouchers {...ctx} />}
        {tab === 'assets' && <Assets {...ctx} />}
        {tab === 'journal' && <Journal {...ctx} />}
        {tab === 'ledger' && <Ledger {...ctx} />}
        {tab === 'trial' && <Trial {...ctx} />}
        {tab === 'income' && <Income {...ctx} />}
        {tab === 'balance' && <Balance {...ctx} />}
        {tab === 'cashflow' && <CashFlow {...ctx} />}
        {tab === 'accounts' && <Accounts {...ctx} />}
        {tab === 'lock' && <LockTab />}
      </MetricFilters.Provider>
    </div>
  );
}

function ExportButton({ tab, data, range, shopName }) {
  const go = () => {
    const tables = [...accountingTables(tab, data, { range, shopName }), explainTable(tab)].filter((t) => t.rows.length || t.name !== 'Giải thích');
    const wb = XLSX.utils.book_new();
    for (const t of tables) {
      const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
      ws['!cols'] = t.headers.map((h, i) => ({ wch: Math.min(40, Math.max(String(h).length + 2, ...t.rows.slice(0, 100).map((r) => String(r[i] ?? '').length + 1))) }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(t.name));
    }
    XLSX.writeFile(wb, `ke-toan-${tab}-${range.from.replaceAll('-', '')}-${range.to.replaceAll('-', '')}.xlsx`);
  };
  if (tab === 'overview' || tab === 'lock') return null;
  return <button className="btn" disabled={!data} onClick={go}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất Excel</button>;
}

/** Tải dữ liệu rồi báo lên trang để nút Xuất Excel dùng */
function useReport(fn, deps, report, pick = (r) => r.data) {
  const state = useAsync(async () => {
    const r = await fn();
    report(pick(r));
    return r;
  }, deps);
  return state;
}

const Th = ({ m, children, className = 'num' }) => <th className={className}>{m ? <MetricLabel metric={m}>{children}</MetricLabel> : children}</th>;
const Src = ({ row, children }) => (row.source_path ? <Link to={row.source_path}>{children}</Link> : <>{children}</>);

function Overview({ go, shopParam }) {
  const state = useAsync(() => api.get('/accounting/overview', { shop_id: shopParam }), [shopParam]);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          {d.scope?.shop_filtered && <Note>Doanh thu, lợi nhuận và phải thu được lọc theo shop; chi phí chung đã phân bổ vào lợi nhuận. Tiền/quỹ, phải trả người bán và hàng tồn vẫn là số toàn tài khoản.</Note>}
          {d.warnings.map((w) => <div key={w.code} className="alert warn" role="alert">{w.message}{w.code === 'LOCKED_PERIOD_CHANGED' && <> <button className="btn sm" onClick={() => go('lock')}>Xem chi tiết</button></>}</div>)}
          {d.lock_date && <Note>Sổ đã khoá đến hết {fmtDate(d.lock_date)}.</Note>}
          <div className="grid cols-3">
            <Kpi label="Tiền" metric="acc_cash" value={signed(d.cash)} tone={d.cash < 0 ? 'red' : undefined} hint={d.cash < 0 ? <>Số dư quỹ âm: kiểm tra thu chi chưa ghi hoặc số dư đầu kỳ. <Link to="/expenses?tab=cash">Mở Quỹ tiền</Link></> : undefined} />
            <Kpi label={shopParam ? 'Phải thu gắn shop' : 'Phải thu khách'} metric="acc_receivable" value={vnd(d.receivable_customers)} hint={`Sàn còn nợ: ${vnd(d.receivable_marketplace)}`} />
            <Kpi label="Phải trả người bán" metric="acc_payable" value={vnd(d.payable_suppliers)} />
            <Kpi label="Hàng tồn" metric="acc_inventory" value={vnd(d.inventory)} />
            <Kpi label="Doanh thu thuần tháng này" metric="acc_net_revenue" value={vnd(d.month_net_revenue)} />
            <Kpi label="Lợi nhuận tháng này" metric="acc_profit" value={signed(d.month_profit)} tone={d.month_profit < 0 ? 'red' : undefined} hint={`Từ ${fmtDate(d.month_from)} · ${shopParam ? 'shop đang chọn' : 'tất cả shop'}`} />
          </div>
        </>
      )}
    </Async>
  );
}

function Journal({ range, shopParam, report }) {
  const [src, setSrc] = useState('');
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const base = { from: range.from, to: range.to, shop_id: shopParam, source_type: src || undefined, limit: 50 };
  const state = useAsync(async () => {
    const r = await api.get('/accounting/journal', base);
    setRows(r.data); setNext(r.next_cursor); report({ data: r.data });
    return r;
  }, [range.from, range.to, shopParam, src]);
  const more = async () => { const r = await api.get('/accounting/journal', { ...base, cursor: next }); setRows((x) => { const all = [...x, ...r.data]; report({ data: all }); return all; }); setNext(r.next_cursor); };
  return (
    <>
      <Toolbar><select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Loại chứng từ"><option value="">Mọi chứng từ</option>{Object.entries(SRC).filter(([k]) => k !== 'manual').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Toolbar>
      <Async state={state}>
        {() => (!rows.length ? <Empty>Chưa có bút toán trong kỳ này.</Empty> : (
          <Card flat className="list-card"><div className="table-wrap"><table>
            <thead><tr><th>Mã</th><th>Ngày</th><th>Diễn giải</th><th>Tài khoản</th><th className="num">Nợ</th><th className="num">Có</th></tr></thead>
            <tbody>{rows.map((e) => e.lines.map((l, i) => (
              <tr key={l.id} className={i === 0 ? 'je-first' : ''}>
                <td>{i === 0 ? e.code : ''}</td><td>{i === 0 ? fmtDate(e.entry_date) : ''}</td>
                <td className="small">{i === 0 ? <><Src row={e}>{e.description}</Src><div className="muted">{SRC[e.source_type] || e.source_type}</div></> : ''}</td>
                <td style={{ paddingLeft: l.credit ? 28 : undefined }}>{l.account_code} <span className="muted small">{l.account_name}</span></td>
                <td className="num">{l.debit ? vnd(l.debit) : ''}</td><td className="num">{l.credit ? vnd(l.credit) : ''}</td>
              </tr>
            )))}</tbody>
          </table></div>{next && <div className="row" style={{ justifyContent: 'center', padding: 12 }}><button className="btn" onClick={more}>Xem thêm</button></div>}</Card>
        ))}
      </Async>
    </>
  );
}

function Ledger({ range, shopParam, report }) {
  const accounts = useAsync(() => api.get('/accounting/accounts', { balances: 0 }), []);
  const [code, setCode] = useState('111');
  const state = useReport(() => api.get(`/accounting/ledger/${code}`, { from: range.from, to: range.to, shop_id: shopParam }), [code, range.from, range.to, shopParam], report);
  return (
    <>
      <Toolbar><select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Tài khoản" style={{ maxWidth: 360 }}>{(accounts.data?.data || []).map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></Toolbar>
      <Async state={state}>
        {({ data: d }) => (
          <Card flat className="list-card"><div className="table-wrap"><table>
            <thead><tr><th>Ngày</th><th>Mã</th><th>Diễn giải</th><th className="num">Nợ</th><th className="num">Có</th><th className="num">Số dư</th></tr></thead>
            <tbody>
              <tr><td colSpan={5}><b>Số dư đầu</b></td><td className="num"><b>{signed(d.opening_balance)}</b></td></tr>
              {d.data.map((r, i) => (
                <tr key={i}><td>{fmtDate(r.entry_date)}</td><td>{r.entry_code}</td><td className="small"><Src row={r}>{r.description}</Src>{r.memo && <div className="muted">{r.memo}</div>}</td><td className="num">{r.debit ? vnd(r.debit) : ''}</td><td className="num">{r.credit ? vnd(r.credit) : ''}</td><td className="num">{signed(r.balance)}</td></tr>
              ))}
              <tr><td colSpan={3}><b>Số dư cuối</b>{d.truncated && <span className="muted small"> (chỉ hiện dòng cuối, đã cắt bớt)</span>}</td><td className="num"><b>{vnd(d.debit)}</b></td><td className="num"><b>{vnd(d.credit)}</b></td><td className="num"><b>{signed(d.closing_balance)}</b></td></tr>
            </tbody>
          </table></div></Card>
        )}
      </Async>
    </>
  );
}

function Trial({ range, shopParam, report }) {
  const state = useReport(() => api.get('/accounting/trial-balance', { from: range.from, to: range.to, shop_id: shopParam }), [range.from, range.to, shopParam], report);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          {d.scope?.shop_filtered && <Note>Đang xem các bút toán gắn với shop; bút toán chung không thuộc shop được loại khỏi góc nhìn này. Chọn “Tất cả shop” để xem cân đối của toàn tài khoản.</Note>}
          <div className={`alert ${d.balanced ? 'ok' : 'err'}`} role="status">{d.balanced ? 'Cân: tổng Nợ bằng tổng Có ở cả ba cặp cột.' : 'KHÔNG CÂN: tổng Nợ khác tổng Có. Báo để kiểm tra sổ.'} {d.scope?.shop_filtered ? 'Phạm vi: shop đang chọn.' : 'Phạm vi: toàn tài khoản.'}</div>
          <Card flat className="list-card"><div className="table-wrap"><table>
            <thead><tr><th>Tài khoản</th><Th m="acc_trial">Đầu kỳ Nợ</Th><th className="num">Đầu kỳ Có</th><th className="num">Phát sinh Nợ</th><th className="num">Phát sinh Có</th><th className="num">Cuối kỳ Nợ</th><th className="num">Cuối kỳ Có</th></tr></thead>
            <tbody>{d.data.map((r) => <tr key={r.code}><td>{r.code} <span className="muted small">{r.name}</span></td>{['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'].map((k) => <td key={k} className="num">{r[k] ? vnd(r[k]) : ''}</td>)}</tr>)}
              <tr className="fin-total-row"><td>Tổng</td>{['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'].map((k) => <td key={k} className="num">{vnd(d.totals[k])}</td>)}</tr></tbody>
          </table></div></Card>
        </>
      )}
    </Async>
  );
}

/** Một dòng báo cáo tài chính: cùng đệm trái/phải ở mọi dòng; dòng nhóm thụt vào, dòng tổng in đậm có kẻ trên */
const Line = ({ l, v, bold, m, indent }) => (
  <div className={`fin-row${bold ? ' total' : ''}${indent ? ' indent' : ''}`}><MetricLabel metric={m}>{l}</MetricLabel><span className="num">{signed(v)}</span></div>
);

function Income({ range, shopParam, report }) {
  const state = useReport(() => api.get('/accounting/income-statement', { from: range.from, to: range.to, shop_id: shopParam }), [range.from, range.to, shopParam], report);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          <Fold title="Vì sao số này có thể khác tab Lợi nhuận của Báo cáo?"><p className="note">Lợi nhuận ở đây gồm khấu hao/phân bổ tài sản và thu/chi khác (711, 811) mà Báo cáo không có. Dòng “Lãi thuần trước khấu hao” so sánh được với Báo cáo (chi phí định kỳ có ở cả hai vì là chi phí thật).{shopParam ? ' Lọc theo shop: chi phí chung đã chia về shop như ở Báo cáo; chênh lệch kho và kiểm đếm quỹ không thuộc shop nào nên không có ở đây.' : ''}</p></Fold>
          <Section flush className="fin"><div>
            <Line l="Doanh thu bán hàng (5111)" v={d.revenue_goods} indent />
            <Line l="Doanh thu phí vận chuyển (5113)" v={d.revenue_shipping} indent />
            <Line l="Hàng bán bị trả lại (5212)" v={-d.returns} indent />
            {d.revenue_return_fee !== 0 && <Line l="Doanh thu khác: phí trả hàng (5118)" v={d.revenue_return_fee} indent />}
            {d.revenue_forfeit !== 0 && d.revenue_forfeit !== undefined && <Line l="Doanh thu khác: cọc giữ lại (5119)" v={d.revenue_forfeit} indent />}
            <Line l="Doanh thu thuần" v={d.net_revenue} bold m="acc_net_revenue" />
            <Line l="Giá vốn hàng bán (632)" v={-d.cogs} m="acc_cogs" />
            <Line l="Lãi gộp" v={d.gross_profit} bold m="acc_gross_profit" />
            {[...d.selling_expenses, ...d.admin_expenses].map((r) => <Line key={r.code} l={`${r.name} (${r.code})`} v={-r.amount} indent />)}
            <Line l="Chi phí bán hàng và quản lý" v={-[...d.selling_expenses, ...d.admin_expenses].reduce((a, r) => a + r.amount, 0)} m="acc_expenses" />
            {d.depreciation_total !== 0 && <>
              <Line l="Lãi thuần trước khấu hao" v={d.operating_profit_before_depreciation} bold />
              {d.depreciation.map((r) => <Line key={r.code} l={`Khấu hao/phân bổ → ${r.name} (${r.code})`} v={-r.amount} indent />)}
              <Line l="Khấu hao và phân bổ tài sản" v={-d.depreciation_total} m="acc_depreciation" />
            </>}
            <Line l="Lãi thuần từ kinh doanh" v={d.operating_profit} bold />
            <Line l="Thu nhập khác (711)" v={d.other_income} indent m="acc_other" />
            <Line l="Chi phí khác (811)" v={-d.other_expense} indent />
            <Line l="Lợi nhuận trước thuế" v={d.profit_before_tax} bold m="acc_profit" />
          </div></Section>
        </>
      )}
    </Async>
  );
}

function Balance({ report }) {
  const [asOf, setAsOf] = useState(today());
  const state = useReport(() => api.get('/accounting/balance-sheet', { as_of: asOf }), [asOf], report);
  const Block = ({ title, rows, total, m, extra }) => (
    <Section title={title} flush className="fin"><div>
      {rows.map((r) => <Line key={r.code} l={`${r.name} (${r.code})`} v={r.balance} indent />)}{extra}
      <Line l={`Tổng ${title.toLowerCase()}`} v={total} bold m={m} />
    </div></Section>
  );
  return (
    <>
      <Toolbar><Field label="Tính đến ngày"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 160 }} /></Field></Toolbar>
      <Async state={state}>
        {({ data: d }) => (
          <>
            <div className={`alert ${d.balanced ? 'ok' : 'err'}`} role="status">{d.balanced ? 'Cân: tài sản = nợ phải trả + vốn + lợi nhuận.' : `KHÔNG CÂN, lệch ${vnd(d.difference)}. Báo để kiểm tra sổ.`} Luôn tính cho cả tài khoản, không lọc shop.</div>
            <div className="grid cols-2 collapse">
              <Block title="Tài sản" rows={d.assets} total={d.total_assets} m="acc_assets" />
              <div className="stack">
                <Block title="Nợ phải trả" rows={d.liabilities} total={d.total_liabilities} />
                <Block title="Vốn chủ sở hữu" rows={d.equity} total={d.total_equity} m="acc_equity" extra={<Line l="421 – Lợi nhuận kỳ này (chưa kết chuyển)" v={d.current_profit} indent />} />
              </div>
            </div>
          </>
        )}
      </Async>
    </>
  );
}

function CashFlow({ range, shopParam, report }) {
  const state = useReport(() => api.get('/accounting/cash-flow', { from: range.from, to: range.to, shop_id: shopParam }), [range.from, range.to, shopParam], report);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          {d.scope.shop_filtered && <Note>Lọc theo shop: dòng tiền của shop; số dư đầu và cuối là của cả tài khoản.</Note>}
          <Card flat className="list-card"><div className="table-wrap"><table>
            <thead><tr><th>Khoản</th><th className="num">Thu</th><th className="num">Chi</th><th className="num"><MetricLabel metric="acc_cashflow">Ròng</MetricLabel></th></tr></thead>
            <tbody>
              <tr><td><b>Số dư đầu kỳ</b></td><td /><td /><td className="num"><b>{signed(d.opening_balance)}</b></td></tr>
              {d.data.map((g) => <tr key={g.key}><td>{g.label}</td><td className="num">{g.inflow ? vnd(g.inflow) : ''}</td><td className="num">{g.outflow ? vnd(g.outflow) : ''}</td><td className="num">{signed(g.net)}</td></tr>)}
              <tr><td><b>Tăng/giảm trong kỳ</b></td><td /><td /><td className="num"><b>{signed(d.net_change)}</b></td></tr>
              <tr><td><b>Số dư cuối kỳ</b></td><td /><td /><td className="num"><b>{signed(d.closing_balance)}</b></td></tr>
            </tbody>
          </table></div></Card>
        </>
      )}
    </Async>
  );
}

function Accounts({ report }) {
  const state = useAsync(async () => { const r = await api.get('/accounting/accounts'); report(r.data); return r; }, []);
  const [form, setForm] = useState(null);
  const { busy, error, run } = useAction();
  const save = () => run(async () => { await api.post('/accounting/accounts', { parent_code: form.parent_code, name: form.name }); setForm(null); state.reload(); });
  return (
    <>
      <Toolbar><button className="btn primary" onClick={() => setForm({ parent_code: '6418', name: '' })}>+ Tài khoản con</button></Toolbar>
      <Async state={state}>
        {({ data }) => (
          <Card flat className="list-card"><div className="table-wrap"><table>
            <thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Bên</th><th className="num">Số dư</th></tr></thead>
            <tbody>{data.map((a) => <tr key={a.code}><td style={{ paddingLeft: a.parent_code ? 24 : undefined }}>{a.code}</td><td>{a.name}{a.is_system ? <span className="badge plain" style={{ marginLeft: 8 }}>Hệ thống</span> : null}</td><td className="small">{TYPES[a.type]}</td><td>{a.normal_side === 'debit' ? 'Nợ' : 'Có'}</td><td className="num">{signed(a.balance)}</td></tr>)}</tbody>
          </table></div></Card>
        )}
      </Async>
      <CategoryMapping />
      {form && (
        <Modal title="Thêm tài khoản con" onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Đóng</button><button className="btn primary" disabled={busy || !form.name.trim()} onClick={save}>Thêm</button></>}>
          <ErrorBox error={error} />
          <Field label="Tài khoản cha"><select value={form.parent_code} onChange={(e) => setForm({ ...form, parent_code: e.target.value })}>{(state.data?.data || []).filter((a) => !a.archived_at).map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></Field>
          <Field label="Tên"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}
const TYPES = { asset: 'Tài sản', liability: 'Nợ phải trả', equity: 'Vốn', revenue: 'Doanh thu', contra_revenue: 'Giảm trừ doanh thu', expense: 'Chi phí' };
