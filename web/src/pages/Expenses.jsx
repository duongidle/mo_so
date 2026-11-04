import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Chips, Tabs, DateRange, Empty, ErrorBox, Field, Kpi, Modal, useAction, useAsync, PageHeader, Toolbar } from '../components/ui.jsx';
import { vnd, fmtDate, monthStart, today } from '../lib.js';
import CashAccounts from './CashAccounts.jsx';
import MoneyInput from '../components/MoneyInput.jsx';

export default function Expenses() {
  const [params] = useSearchParams();
  const { marketplaces } = useSession();
  const hasMarket = marketplaces.length > 0; // chưa bật sàn nào thì không có gì để đối soát
  const want = params.get('tab');
  const [tab, setTab] = useState(['expenses', 'cash'].includes(want) || (want === 'reconcile' && hasMarket) ? want : 'expenses');
  return (
    <div className="page stack">
      <PageHeader title="Chi phí & quỹ" />
      <Toolbar><Tabs options={[['expenses', 'Chi phí'], ['cash', 'Quỹ tiền'], ...(hasMarket ? [['reconcile', 'Đối soát sàn']] : [])]} value={tab} onChange={setTab} /></Toolbar>
      {tab === 'expenses' && <ExpenseList />}{tab === 'cash' && <CashAccounts />}{tab === 'reconcile' && hasMarket && <Reconcile />}
    </div>
  );
}

function ExpenseList() {
  const { shopId, isAll, shops, methodLabels, methodList } = useSession();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [form, setForm] = useState(null);
  const cats = useAsync(() => api.get('/expense-categories'), []);
  const state = useAsync(() => api.get('/expenses', { shop_id: isAll ? undefined : shopId, from: range.from, to: range.to, limit: 200 }), [shopId, range.from, range.to]);
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    await api.post('/expenses', { category_id: form.category_id, shop_id: form.shop_id || null, amount: Number(form.amount), expense_date: form.expense_date, method: form.method || 'cash', payee: form.payee || null, note: form.note || null });
    setForm(null); state.reload();
  });
  return (
    <>
      <div className="row wrap between"><DateRange {...range} onChange={setRange} /><button className="btn primary" onClick={() => setForm({ category_id: 'ecat_ads', shop_id: isAll ? '' : shopId, amount: '', expense_date: today(), method: 'cash' })}>+ Chi phí</button></div>
      <Async state={state}>
        {({ data }) => (
          <>
            <Kpi label="Tổng chi phí trong kỳ" value={vnd(data.reduce((a, e) => a + e.amount, 0))} />
            {!data.length ? <Empty>Chưa có chi phí trong kỳ này.</Empty> : (
              <Card flat><div className="table-wrap"><table>
                <thead><tr><th>Ngày</th><th>Danh mục</th><th>Shop</th><th>Ghi chú</th><th className="num">Số tiền</th><th /></tr></thead>
                <tbody>{data.map((e) => (
                  <tr key={e.id}><td>{fmtDate(e.expense_date)}</td><td>{e.category_name}</td><td>{e.shop_name || <span className="badge plain" title="Chi phí chung: được chia về các shop khi xem báo cáo">Chung</span>}</td><td className="small">{e.payee} {e.note}<div className="muted">{methodLabels[e.method] || e.method}</div></td><td className="num">{vnd(e.amount)}</td>
                    <td><button className="btn sm danger" onClick={() => confirm('Huỷ khoản chi này? (không xoá hẳn, vẫn lưu vết)') && run(async () => { await api.del(`/expenses/${e.id}`); state.reload(); })}>Huỷ</button></td></tr>
                ))}</tbody>
              </table></div></Card>
            )}
          </>
        )}
      </Async>
      <ErrorBox error={error} />
      {form && (
        <Modal title="Thêm chi phí" onClose={() => setForm(null)} footer={<button className="btn primary" disabled={busy || !form.amount} onClick={save}>Lưu</button>}>
          <Field label="Danh mục"><select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>{cats.data?.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Số tiền"><MoneyInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus /></Field>
          <div className="grid cols-2">
            <Field label="Ngày"><input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></Field>
            <Field label="Thuộc shop" hint="“Chung” sẽ được chia về các shop khi xem báo cáo"><select value={form.shop_id} onChange={(e) => setForm({ ...form, shop_id: e.target.value })}><option value="">Chung (phân bổ)</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <Field label="Trả bằng" hint="Quyết định tiền chi ra khỏi quỹ nào"><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{methodList(form.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Ghi chú"><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

function Reconcile() {
  const { shopId, isAll, marketplaces } = useSession();
  const [channelId, setChannelId] = useState(marketplaces[0]?.id);
  const channel = marketplaces.find((c) => c.id === channelId) || marketplaces[0];
  const state = useAsync(() => api.get('/reconciliation/pending', { shop_id: isAll ? undefined : shopId, channel_id: channel.id }), [shopId, channel.id]);
  const [sel, setSel] = useState({});
  const { busy, error, run } = useAction();
  const [result, setResult] = useState(null);
  return (
    <Async state={state}>
      {(r) => {
        const chosen = r.data.filter((o) => sel[o.id]);
        const sum = chosen.reduce((a, o) => a + o.pending_amount, 0);
        return (
          <>
            {marketplaces.length > 1 && <Chips options={marketplaces.map((c) => [c.id, c.name])} value={channel.id} onChange={(v) => { setChannelId(v); setSel({}); setResult(null); }} />}
            <Kpi label={`Tiền ${channel.name} đang treo`} value={vnd(r.total_pending)} hint={`${r.count} đơn hoàn thành chưa ghi nhận tiền về`} tone={r.count ? 'yellow' : undefined} />
            {result && <div className={`alert ${result.failed ? 'warn' : 'ok'}`}>Đã ghi nhận {result.recorded} đơn{result.failed ? `, lỗi ${result.failed}: ${result.results.filter((x) => !x.ok).map((x) => `${x.code || x.external_id}: ${x.error}`).join('; ')}` : ''}</div>}
            {!r.data.length ? <Empty>Không có đơn {channel.name} nào đang treo tiền.</Empty> : (
              <Card flat><div className="table-wrap"><table>
                <thead><tr><th><input type="checkbox" aria-label="Chọn tất cả" style={{ width: 20, minHeight: 20 }} checked={chosen.length === r.data.length} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(r.data.map((o) => [o.id, true])) : {})} /></th><th>Đơn</th><th>Hoàn thành</th><th className="num">Sàn phải trả</th></tr></thead>
                <tbody>{r.data.map((o) => (
                  <tr key={o.id}><td><input type="checkbox" aria-label={`Chọn ${o.code}`} style={{ width: 20, minHeight: 20 }} checked={!!sel[o.id]} onChange={(e) => setSel({ ...sel, [o.id]: e.target.checked })} /></td>
                    <td><b>{o.code}</b><div className="small muted">{o.external_id} · {o.shop_name}</div></td><td>{fmtDate(o.completed_at)}</td><td className="num">{vnd(o.pending_amount)}</td></tr>
                ))}</tbody>
              </table></div></Card>
            )}
            <ErrorBox error={error} />
            <button className="btn primary" disabled={busy || !chosen.length} onClick={() => run(async () => {
              const res = await api.post('/reconciliation/payouts', { items: chosen.map((o) => ({ order_id: o.id })), channel_id: channel.id });
              setResult(res.data); setSel({}); state.reload();
            })}>Đã nhận tiền {chosen.length ? `(${chosen.length} đơn · ${vnd(sum)})` : ''}</button>
            <p className="small muted">Đối chiếu với bảng kê tiền về của {channel.name} (ví/số dư người bán) rồi mới đánh dấu. Số tiền ghi nhận là số còn treo sau trừ phí sàn.</p>
          </>
        );
      }}
    </Async>
  );
}
