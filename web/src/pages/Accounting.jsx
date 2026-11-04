import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Tabs, DateRange, Empty, ErrorBox, Field, Kpi, Modal, useAction, useAsync } from '../components/ui.jsx';
import { MetricFilters, MetricLabel } from '../components/MetricInfo.jsx';
import Icon from '../components/Icon.jsx';
import { vnd, fmtDate, monthStart, today } from '../lib.js';
import { accountingTables, explainTable, sheetName } from '../reportTables.js';
import { Vouchers, Recurring, Assets, LockTab, CategoryMapping } from './accounting/Extras.jsx';

const TABS = [['overview', 'Tổng quan'], ['vouchers', 'Chứng từ'], ['recurring', 'Chi phí định kỳ'], ['assets', 'Tài sản & phân bổ'], ['journal', 'Sổ nhật ký'], ['ledger', 'Sổ cái'], ['trial', 'Cân đối phát sinh'], ['income', 'Kết quả kinh doanh'], ['balance', 'Cân đối kế toán'], ['cashflow', 'Lưu chuyển tiền'], ['accounts', 'Hệ thống tài khoản'], ['lock', 'Khoá sổ']];
const INTRO = {
  vouchers: 'Chứng từ lập tay cho những việc không đi qua đơn, nhập hàng hay chi phí: góp vốn, rút vốn, tiền phạt, thu nhập khác. Bút toán tổng hợp để ghi tự do nhiều dòng. Huỷ không xoá hẳn.',
  recurring: 'Khoản chi lặp lại (thuê kho, internet, lương). App tự tạo chi phí mỗi kỳ, tạo bù cả kỳ bỏ lỡ khi máy tắt.',
  assets: 'Tài sản cố định và chi phí trả trước: ghi vào tài sản khi mua, rồi chia đều theo tháng thành chi phí (khấu hao hoặc phân bổ).',
  lock: 'Khoá sổ để chốt số kỳ cũ: không ai sửa nhầm chi phí, thanh toán, chứng từ tay của kỳ đã chốt.',
  overview: 'Tiền, công nợ, hàng tồn và lãi của tháng này theo sổ kế toán. Sổ tự sinh từ đơn, thu chi, nhập hàng, kho và quỹ: không cần nhập tay.',
  journal: 'Mọi bút toán theo thời gian, mỗi bút toán có Nợ bằng Có. Bấm mã chứng từ để mở đơn hay phiếu gốc.',
  ledger: 'Một tài khoản: số dư đầu, từng dòng phát sinh, số dư cuối. Bấm diễn giải để mở chứng từ gốc.',
  trial: 'Số dư đầu, phát sinh và số dư cuối của mọi tài khoản. Tổng Nợ phải bằng tổng Có.',
  income: 'Doanh thu, giá vốn, chi phí và lãi trong kỳ. Lọc theo shop được (chi phí chung chia về shop như ở Báo cáo).',
  balance: 'Tài sản bằng nợ phải trả cộng vốn cộng lợi nhuận. Luôn tính cho cả tài khoản, không lọc theo shop.',
  cashflow: 'Tiền vào và ra các quỹ trong kỳ, chia theo nguồn.',
  accounts: 'Danh sách tài khoản. Tài khoản hệ thống không đổi được; bạn thêm được tài khoản con.',
};
const signed = (n) => (n < 0 ? `− ${vnd(-n)}` : vnd(n));
const SRC = { order: 'Đơn bán', return: 'Trả hàng', payment: 'Thanh toán', purchase: 'Nhập hàng', expense: 'Chi phí', stock: 'Kho', cash_open: 'Số dư đầu quỹ', cash_entry: 'Quỹ', manual: 'Chứng từ tay', asset: 'Tài sản' };

export default function Accounting() {
  const { shopId, isAll, shop } = useSession();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [exportData, setExportData] = useState(null); // dữ liệu tab đang xem, để xuất Excel
  const shopParam = isAll ? undefined : shopId;
  const changeTab = (t) => { setExportData(null); setTab(t); };
  const ctx = { range, shopParam, isAll, report: setExportData, go: changeTab };
  return (
    <div className="page stack">
      <div className="page-head"><h1>Sổ kế toán</h1><ExportButton tab={tab} data={exportData} range={range} shopName={tab === 'income' && !isAll ? shop?.name : null} /></div>
      <Tabs options={TABS} value={tab} onChange={changeTab} />
      <p className="tab-intro">{INTRO[tab]}</p>
      {!['overview', 'accounts', 'balance', 'recurring', 'assets', 'lock'].includes(tab) && <div className="row wrap"><DateRange {...range} onChange={setRange} /></div>}
      <MetricFilters.Provider value={{ from: range.from, to: range.to, today: today() }}>
        {tab === 'overview' && <Overview {...ctx} />}
        {tab === 'vouchers' && <Vouchers {...ctx} />}
        {tab === 'recurring' && <Recurring {...ctx} />}
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

function Overview({ go }) {
  const state = useAsync(() => api.get('/accounting/overview'), []);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          {d.warnings.map((w) => <div key={w.code} className="alert warn" role="alert">{w.message}{w.code === 'LOCKED_PERIOD_CHANGED' && <> <button className="btn sm" onClick={() => go('lock')}>Xem chi tiết</button></>}</div>)}
          {d.lock_date && <p className="muted small">Sổ đã khoá đến hết {fmtDate(d.lock_date)}.</p>}
          <div className="grid cols-3">
            <Kpi label="Tiền (quỹ)" metric="acc_cash" value={vnd(d.cash)} />
            <Kpi label="Phải thu khách" metric="acc_receivable" value={vnd(d.receivable_customers)} hint={`Sàn còn nợ: ${vnd(d.receivable_marketplace)}`} />
            <Kpi label="Phải trả người bán" metric="acc_payable" value={vnd(d.payable_suppliers)} />
            <Kpi label="Hàng tồn" metric="acc_inventory" value={vnd(d.inventory)} />
            <Kpi label="Doanh thu thuần tháng này" metric="acc_net_revenue" value={vnd(d.month_net_revenue)} />
            <Kpi label="Lợi nhuận tháng này" metric="acc_profit" value={signed(d.month_profit)} tone={d.month_profit < 0 ? 'red' : undefined} hint={`Từ ${fmtDate(d.month_from)} · tất cả shop`} />
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
      <div className="row wrap"><select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Loại chứng từ" style={{ width: 200 }}><option value="">Mọi chứng từ</option>{Object.entries(SRC).filter(([k]) => k !== 'manual').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <Async state={state}>
        {() => (!rows.length ? <Empty>Chưa có bút toán trong kỳ này.</Empty> : (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Mã</th><th>Ngày</th><th>Diễn giải</th><th>Tài khoản</th><th className="num">Nợ</th><th className="num">Có</th></tr></thead>
            <tbody>{rows.map((e) => e.lines.map((l, i) => (
              <tr key={l.id} style={i === 0 ? { borderTop: '1px solid var(--champagne)' } : undefined}>
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
      <div className="row wrap"><select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Tài khoản" style={{ maxWidth: 320 }}>{(accounts.data?.data || []).map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></div>
      <Async state={state}>
        {({ data: d }) => (
          <Card flat><div className="table-wrap"><table>
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

function Trial({ range, report }) {
  const state = useReport(() => api.get('/accounting/trial-balance', { from: range.from, to: range.to }), [range.from, range.to], report);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          <div className={`alert ${d.balanced ? 'ok' : 'err'}`} role="status">{d.balanced ? 'Cân: tổng Nợ bằng tổng Có ở cả ba cặp cột.' : 'KHÔNG CÂN: tổng Nợ khác tổng Có. Báo để kiểm tra sổ.'} Tính cho cả tài khoản (không lọc shop).</div>
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Tài khoản</th><Th m="acc_trial">Đầu kỳ Nợ</Th><th className="num">Đầu kỳ Có</th><th className="num">Phát sinh Nợ</th><th className="num">Phát sinh Có</th><th className="num">Cuối kỳ Nợ</th><th className="num">Cuối kỳ Có</th></tr></thead>
            <tbody>{d.data.map((r) => <tr key={r.code}><td>{r.code} <span className="muted small">{r.name}</span></td>{['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'].map((k) => <td key={k} className="num">{r[k] ? vnd(r[k]) : ''}</td>)}</tr>)}
              <tr style={{ fontWeight: 700, borderTop: '1px solid var(--champagne)' }}><td>Tổng</td>{['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'].map((k) => <td key={k} className="num">{vnd(d.totals[k])}</td>)}</tr></tbody>
          </table></div></Card>
        </>
      )}
    </Async>
  );
}

const Line = ({ l, v, bold, m, indent }) => <div className="row between" style={{ ...(bold ? { fontWeight: 700, borderTop: '1px solid var(--champagne)', paddingTop: 6 } : {}), paddingLeft: indent ? 16 : 0 }}><MetricLabel metric={m}>{l}</MetricLabel><span className="num">{signed(v)}</span></div>;

function Income({ range, shopParam, report }) {
  const state = useReport(() => api.get('/accounting/income-statement', { from: range.from, to: range.to, shop_id: shopParam }), [range.from, range.to, shopParam], report);
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          <div className="scope-strip" role="status">Đang xem: <b>{shopParam ? 'một shop' : 'Tất cả shop'}</b> · {fmtDate(range.from)} – {fmtDate(range.to)}{shopParam && <> · chi phí chung đã chia về shop như ở Báo cáo; chênh lệch kho và kiểm đếm quỹ không thuộc shop nào nên không có ở đây</>}</div>
          <div className="scope-strip" role="note">Lợi nhuận ở đây gồm khấu hao/phân bổ tài sản và thu/chi khác (711, 811) mà tab Lợi nhuận của Báo cáo không có, nên có thể thấp hơn hoặc cao hơn Báo cáo. Dòng “Lãi thuần trước khấu hao” là số so sánh được với Báo cáo (chi phí định kỳ có ở cả hai vì là chi phí thật).</div>
          <Card flat><div className="stack" style={{ gap: 6 }}>
            <Line l="Doanh thu bán hàng (5111)" v={d.revenue_goods} indent />
            <Line l="Doanh thu phí vận chuyển (5113)" v={d.revenue_shipping} indent />
            <Line l="Hàng bán bị trả lại (5212)" v={-d.returns} indent />
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
          </div></Card>
        </>
      )}
    </Async>
  );
}

function Balance({ report }) {
  const [asOf, setAsOf] = useState(today());
  const state = useReport(() => api.get('/accounting/balance-sheet', { as_of: asOf }), [asOf], report);
  const Section = ({ title, rows, total, m, extra }) => (
    <Card title={title} flat><div className="stack" style={{ gap: 6 }}>
      {rows.map((r) => <Line key={r.code} l={`${r.name} (${r.code})`} v={r.balance} indent />)}{extra}
      <Line l={`Tổng ${title.toLowerCase()}`} v={total} bold m={m} />
    </div></Card>
  );
  return (
    <>
      <div className="row wrap"><Field label="Tính đến ngày"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 160 }} /></Field></div>
      <Async state={state}>
        {({ data: d }) => (
          <>
            <div className={`alert ${d.balanced ? 'ok' : 'err'}`} role="status">{d.balanced ? 'Cân: tài sản = nợ phải trả + vốn + lợi nhuận.' : `KHÔNG CÂN, lệch ${vnd(d.difference)}. Báo để kiểm tra sổ.`} Luôn tính cho cả tài khoản, không lọc shop.</div>
            <div className="grid cols-2 collapse">
              <Section title="Tài sản" rows={d.assets} total={d.total_assets} m="acc_assets" />
              <div className="stack">
                <Section title="Nợ phải trả" rows={d.liabilities} total={d.total_liabilities} />
                <Section title="Vốn chủ sở hữu" rows={d.equity} total={d.total_equity} m="acc_equity" extra={<Line l="421 – Lợi nhuận kỳ này (chưa kết chuyển)" v={d.current_profit} indent />} />
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
          {d.scope.shop_filtered && <div className="scope-strip" role="status">Lọc theo shop: dòng tiền của shop; số dư đầu và cuối là của cả tài khoản.</div>}
          <Card flat><div className="table-wrap"><table>
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
      <div className="row"><button className="btn primary" onClick={() => setForm({ parent_code: '6418', name: '' })}>+ Tài khoản con</button></div>
      <Async state={state}>
        {({ data }) => (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Bên</th><th className="num">Số dư</th></tr></thead>
            <tbody>{data.map((a) => <tr key={a.code}><td style={{ paddingLeft: a.parent_code ? 24 : undefined }}>{a.code}</td><td>{a.name}{a.is_system ? <span className="badge plain" style={{ marginLeft: 6 }}>Hệ thống</span> : null}</td><td className="small">{TYPES[a.type]}</td><td>{a.normal_side === 'debit' ? 'Nợ' : 'Có'}</td><td className="num">{signed(a.balance)}</td></tr>)}</tbody>
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
