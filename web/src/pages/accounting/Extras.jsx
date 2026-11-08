import { Fragment, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, useAction, useAsync } from '../../components/ui.jsx';
import FormPage from '../../components/FormPage.jsx';
import { MetricLabel } from '../../components/MetricInfo.jsx';
import { vnd, fmtDate, today } from '../../lib.js';
import { balanceOfLines, lineProblems, searchAccounts, RECEIPT_ACCOUNTS, PAYMENT_ACCOUNTS } from '../../lib/voucher.js';
import MoneyInput from '../../components/MoneyInput.jsx';

const signed = (n) => (n < 0 ? `− ${vnd(-n)}` : vnd(n));
const VTYPE = { receipt: 'Phiếu thu khác', payment: 'Phiếu chi khác', journal: 'Bút toán tổng hợp' };
const FREQ = { monthly: 'Hằng tháng', weekly: 'Hằng tuần', yearly: 'Hằng năm' };
const WEEKDAYS = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

/** Ô chọn tài khoản có tìm kiếm theo mã hoặc tên */
export function AccountPicker({ accounts, value, onChange, label = 'Tài khoản', filter, postableOnly = true }) {
  const [text, setText] = useState('');
  const list = useMemo(() => searchAccounts(accounts, text, { postableOnly }).filter(filter || (() => true)).slice(0, 80), [accounts, text, filter, postableOnly]);
  const selected = accounts.find((a) => a.code === value);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={selected ? `${selected.code} – ${selected.name}` : 'Gõ mã hoặc tên tài khoản'} aria-label={`Tìm ${label.toLowerCase()}`} />
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Chọn {label.toLowerCase()}…</option>
        {selected && !list.some((a) => a.code === value) && <option value={value}>{selected.code} – {selected.name}</option>}
        {list.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
      </select>
    </div>
  );
}

const useAccounts = () => useAsync(() => api.get('/accounting/accounts', { balances: 0 }), []);

// ---------- Chứng từ ----------
export function Vouchers({ range, shopParam, report }) {
  const { shops } = useSession();
  const [type, setType] = useState('');
  const [form, setForm] = useState(null);
  const [showVoided, setShowVoided] = useState(false);
  const state = useAsync(async () => {
    const r = await api.get('/accounting/vouchers', { from: range.from, to: range.to, shop_id: shopParam, type: type || undefined, include_voided: showVoided ? 1 : undefined, limit: 200 });
    report(r.data);
    return r;
  }, [range.from, range.to, shopParam, type, showVoided]);
  const { busy, error, run } = useAction();
  const lockInfo = useAsync(() => api.get('/accounting/lock'), []);
  const lock = lockInfo.data?.data?.lock_date;
  const void_ = (v) => confirm(`Huỷ ${v.code}? Chứng từ không bị xoá hẳn, chỉ không còn vào sổ.`) && run(async () => { await api.del(`/accounting/vouchers/${v.id}`); state.reload(); });
  if (form) return <VoucherForm initial={form} shops={shops} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />;
  return (
    <>
      <div className="row wrap between">
        <div className="row wrap">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại chứng từ" style={{ width: 200 }}><option value="">Mọi loại</option>{Object.entries(VTYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="row small"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Hiện cả chứng từ đã huỷ</label>
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => setForm({ type: 'receipt' })}>+ Phiếu thu khác</button>
          <button className="btn" onClick={() => setForm({ type: 'payment' })}>+ Phiếu chi khác</button>
          <button className="btn" onClick={() => setForm({ type: 'journal' })}>+ Bút toán tổng hợp</button>
        </div>
      </div>
      <ErrorBox error={error} />
      <Async state={state}>
        {({ data }) => (!data.length ? <Empty>Chưa có chứng từ trong kỳ này. Phiếu thu/chi khác dùng cho góp vốn, rút vốn, tiền phạt, thu nhập khác; đơn, chi phí, nhập hàng thì không cần lập lại ở đây.</Empty> : (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Mã</th><th>Ngày</th><th>Diễn giải</th><th>Định khoản</th><th className="num">Số tiền</th><th /></tr></thead>
            <tbody>{data.map((v) => (
              <tr key={v.id} style={v.voided_at ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                <td>{v.code}<div className="muted small">{VTYPE[v.type]}</div></td><td>{fmtDate(v.voucher_date)}</td>
                <td className="small">{v.description}{v.shop_name && <div className="muted">{v.shop_name}</div>}{v.voided_at && <div className="muted">Đã huỷ</div>}</td>
                <td className="small">{v.lines.map((l, i) => <div key={i} style={{ paddingLeft: l.credit ? 16 : 0 }}>{l.account_code} {l.account_name} <span className="muted">{vnd(l.debit || l.credit)}</span></div>)}</td>
                <td className="num">{vnd(v.total_amount)}</td>
                <td className="row">{!v.voided_at && <><button className="btn sm" disabled={lock && v.voucher_date <= lock} onClick={() => setForm({ ...v, edit: true })}>Sửa</button><button className="btn sm danger" disabled={busy || (lock && v.voucher_date <= lock)} onClick={() => void_(v)} title={lock && v.voucher_date <= lock ? 'Kỳ đã khoá sổ' : undefined}>Huỷ</button></>}</td>
              </tr>
            ))}</tbody>
          </table></div></Card>
        ))}
      </Async>
    </>
  );
}

function VoucherForm({ initial, shops, onClose, onSaved }) {
  const accounts = useAccounts();
  const cash = useAsync(() => api.get('/cash/accounts'), []);
  const edit = Boolean(initial.edit);
  const type = initial.type;
  const [f, setF] = useState(() => ({
    voucher_date: initial.voucher_date || today(), description: initial.description || '', shop_id: initial.shop_id || '',
    cash_account_id: initial.cash_account_id || '', account_code: initial.counter_account || (type === 'receipt' ? '411' : type === 'payment' ? '811' : ''),
    amount: initial.total_amount ? String(initial.total_amount) : '',
    lines: edit && type === 'journal' ? initial.lines.map((l) => ({ account_code: l.account_code, debit: l.debit || '', credit: l.credit || '', memo: l.memo || '' })) : [{ account_code: '', debit: '', credit: '' }, { account_code: '', debit: '', credit: '' }],
  }));
  const { busy, error, run } = useAction();
  const accs = accounts.data?.data || [];
  const cashAccs = (cash.data?.data || []).filter((a) => !a.archived_at);
  const bal = balanceOfLines(f.lines);
  const problems = type === 'journal' ? lineProblems(f.lines) : [];
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i, patch) => set('lines', f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ready = f.description.trim() && f.voucher_date && (type === 'journal' ? bal.balanced && !problems.length : f.cash_account_id && f.account_code && Number(f.amount) > 0);
  const save = () => run(async () => {
    const common = { voucher_date: f.voucher_date, description: f.description.trim(), shop_id: f.shop_id || null };
    const payload = type === 'journal'
      ? { ...common, type, lines: f.lines.map((l) => ({ account_code: l.account_code, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || null })) }
      : { ...common, type, cash_account_id: f.cash_account_id, account_code: f.account_code, amount: Number(f.amount) };
    if (edit) { const { type: _t, ...rest } = payload; await api.patch(`/accounting/vouchers/${initial.id}`, rest); } else await api.post('/accounting/vouchers', payload);
    onSaved();
  });
  const picks = type === 'receipt' ? RECEIPT_ACCOUNTS : PAYMENT_ACCOUNTS;
  return (
    <Modal wide={type === 'journal'} title={`${edit ? 'Sửa' : 'Lập'} ${VTYPE[type].toLowerCase()}${edit ? ` ${initial.code}` : ''}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Đóng</button><button className="btn primary" disabled={busy || !ready} onClick={save}>Lưu</button></>}>
      <ErrorBox error={error} />
      <div className="grid cols-2">
        <Field label="Ngày"><input type="date" value={f.voucher_date} onChange={(e) => set('voucher_date', e.target.value)} /></Field>
        <Field label="Shop (tuỳ chọn)"><select value={f.shop_id} onChange={(e) => set('shop_id', e.target.value)}><option value="">Chung</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      <Field label="Diễn giải"><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={type === 'receipt' ? 'Vd: Chủ shop góp vốn' : type === 'payment' ? 'Vd: Phạt giao hàng trễ' : 'Vd: Ghi nhận tiền thuê chưa trả'} /></Field>
      {type !== 'journal' ? (
        <>
          <div className="grid cols-2">
            <Field label={type === 'receipt' ? 'Thu vào quỹ' : 'Chi từ quỹ'}><select value={f.cash_account_id} onChange={(e) => set('cash_account_id', e.target.value)}><option value="">Chọn quỹ…</option>{cashAccs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Số tiền"><MoneyInput value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
          </div>
          <Field label={type === 'receipt' ? 'Ghi có tài khoản' : 'Ghi nợ tài khoản'} hint={type === 'receipt' ? 'Góp vốn: 411. Thu khác (được thưởng, bán đồ cũ…): 711. Vốn không phải thu nhập nên không vào lợi nhuận.' : 'Tiền phạt, chi khác: 811. Rút vốn: 411. Trả nợ người bán: 331.'}>
            <div className="row wrap" style={{ marginBottom: 4 }}>{picks.map(([code, l]) => <button key={code} type="button" className={`chip${f.account_code === code ? ' on' : ''}`} onClick={() => set('account_code', code)}>{code} {l}</button>)}</div>
            <AccountPicker accounts={accs} value={f.account_code} onChange={(v) => set('account_code', v)} filter={(a) => !/^11[12]\d+$/.test(a.code)} />
          </Field>
        </>
      ) : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Tài khoản</th><th className="num">Nợ</th><th className="num">Có</th><th>Ghi chú</th><th /></tr></thead>
            <tbody>{f.lines.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 220 }}><AccountPicker accounts={accs} value={l.account_code} onChange={(v) => setLine(i, { account_code: v })} /></td>
                <td><MoneyInput aria-label={`Nợ dòng ${i + 1}`} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} style={{ width: 120 }} /></td>
                <td><MoneyInput aria-label={`Có dòng ${i + 1}`} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} style={{ width: 120 }} /></td>
                <td><input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} /></td>
                <td>{f.lines.length > 2 && <button className="btn sm" onClick={() => set('lines', f.lines.filter((_, j) => j !== i))} aria-label="Xoá dòng">×</button>}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: '1px solid var(--champagne)' }}><td>Tổng</td><td className="num">{vnd(bal.debit)}</td><td className="num">{vnd(bal.credit)}</td><td colSpan={2} /></tr></tbody>
          </table></div>
          <div className="row between"><button className="btn sm" onClick={() => set('lines', [...f.lines, { account_code: '', debit: '', credit: '' }])}>+ Thêm dòng</button></div>
          <div className={`alert ${bal.balanced ? 'ok' : bal.debit || bal.credit ? 'err' : 'warn'}`} role="status">
            {bal.balanced ? 'Cân: tổng Nợ bằng tổng Có.' : bal.debit || bal.credit ? `Chưa cân: Nợ ${bal.diff > 0 ? 'lớn hơn' : 'nhỏ hơn'} Có ${vnd(Math.abs(bal.diff))}.` : 'Nhập số tiền ở Nợ và Có cho từng dòng.'}
            {problems.map((p) => <div key={p}>{p}</div>)}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Chi phí định kỳ ----------
export function Recurring({ report }) {
  const { shops, methodLabels } = useSession();
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null); // id đang xem trước
  const state = useAsync(async () => { const r = await api.get('/recurring-expenses'); report(r.data); return r; }, []);
  const { busy, error, run } = useAction();
  const act = (fn, msg) => (!msg || confirm(msg)) && run(async () => { await fn(); state.reload(); });
  if (form) return <RecurringForm initial={form} shops={shops} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />;
  return (
    <>
      <div className="row between wrap"><span className="muted small">Hệ thống tự tạo chi phí khi đến hạn, kể cả các kỳ bị bỏ lỡ. Không bao giờ tạo trùng một kỳ.</span><button className="btn primary" onClick={() => setForm({})}>+ Chi phí định kỳ</button></div>
      <ErrorBox error={error} />
      <Async state={state}>
        {({ data }) => (!data.length ? <Empty>Chưa có chi phí định kỳ. Thêm tiền thuê, internet, lương… để hệ thống tự ghi mỗi kỳ.</Empty> : (
          <div className="stack">{data.map((r) => (
            <Card key={r.id}>
              <div className="row between wrap">
                <div><b>{r.name}</b> {r.paused_at && <span className="badge plain">Tạm dừng</span>}
                  <div className="muted small">{r.category_name} · {r.shop_name || 'Chung'} · {FREQ[r.frequency]}, {r.frequency === 'weekly' ? WEEKDAYS[r.day_of_period] : `ngày ${r.day_of_period}`} · {methodLabels[r.method] || r.method}</div>
                  <div className="muted small">Từ {fmtDate(r.start_date)}{r.end_date ? ` đến ${fmtDate(r.end_date)}` : ''} · đã tạo {r.created_count} khoản · kỳ kế tiếp {r.next_run_date ? fmtDate(r.next_run_date) : 'đã hết'}</div></div>
                <div className="row wrap"><b className="num">{vnd(r.amount)}</b>
                  <button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>Kỳ sắp tới</button>
                  <button className="btn sm" disabled={busy || r.paused_at} onClick={() => act(() => api.post(`/recurring-expenses/${r.id}/run`), 'Tạo ngay chi phí của kỳ này?')}>Tạo ngay kỳ này</button>
                  <button className="btn sm" disabled={busy} onClick={() => act(() => api.post(`/recurring-expenses/${r.id}/${r.paused_at ? 'resume' : 'pause'}`))}>{r.paused_at ? 'Tiếp tục' : 'Tạm dừng'}</button>
                  <button className="btn sm" onClick={() => setForm(r)}>Sửa</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => act(() => api.del(`/recurring-expenses/${r.id}`), `Lưu trữ “${r.name}”? Các chi phí đã tạo giữ nguyên.`)}>Lưu trữ</button></div>
              </div>
              {open === r.id && <Preview id={r.id} />}
            </Card>
          ))}</div>
        ))}
      </Async>
    </>
  );
}

function Preview({ id }) {
  const state = useAsync(() => api.get(`/recurring-expenses/${id}/preview`, { count: 6 }), [id]);
  return <Async state={state}>{({ data }) => (!data.length ? <p className="muted small">Không còn kỳ nào sắp tới.</p> : <div className="row wrap" style={{ marginTop: 8 }}>{data.map((p) => <span key={p.date} className="badge plain">{fmtDate(p.date)} · {vnd(p.amount)}{p.overdue ? ' · đến hạn' : ''}</span>)}</div>)}</Async>;
}

function RecurringForm({ initial, shops, onClose, onSaved }) {
  const { methodList } = useSession();
  const cats = useAsync(() => api.get('/expense-categories'), []);
  const edit = Boolean(initial.id);
  const [f, setF] = useState({ name: initial.name || '', category_id: initial.category_id || 'ecat_rent', shop_id: initial.shop_id || '', amount: initial.amount ? String(initial.amount) : '', method: initial.method || 'bank', frequency: initial.frequency || 'monthly', day_of_period: initial.day_of_period || 1, start_date: initial.start_date || today(), end_date: initial.end_date || '' });
  const { busy, error, run } = useAction();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    const payload = { name: f.name.trim(), category_id: f.category_id, shop_id: f.shop_id || null, amount: Number(f.amount), method: f.method, frequency: f.frequency, day_of_period: Number(f.day_of_period), start_date: f.start_date, end_date: f.end_date || null };
    if (edit) await api.patch(`/recurring-expenses/${initial.id}`, payload); else await api.post('/recurring-expenses', payload);
    onSaved();
  });
  const past = !edit && f.start_date < today();
  return (
    <FormPage embedded title={edit ? 'Sửa chi phí định kỳ' : 'Thêm chi phí định kỳ'} sub="Thiết lập khoản chi và lịch tạo tự động." onBack={onClose} error={error && <ErrorBox error={error} />} footer={<><button type="button" className="btn" onClick={onClose}>Huỷ</button><button type="button" className="btn primary" disabled={busy || !f.name.trim() || !(Number(f.amount) > 0)} onClick={save}>Lưu</button></>}>
      <Card title="Thông tin khoản chi"><div className="stack">
      <Field label="Tên"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ví dụ: Thuê kho" /></Field>
      <div className="grid cols-2">
        <Field label="Danh mục"><select value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>{cats.data?.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Shop"><select value={f.shop_id} onChange={(e) => set('shop_id', e.target.value)}><option value="">Chung</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Số tiền mỗi kỳ"><MoneyInput value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Trả bằng"><select value={f.method} onChange={(e) => set('method', e.target.value)}>{methodList(f.method).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Chu kỳ"><select value={f.frequency} onChange={(e) => { set('frequency', e.target.value); set('day_of_period', 1); }}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label={f.frequency === 'weekly' ? 'Thứ' : 'Ngày'} hint={f.frequency === 'weekly' ? undefined : 'Tháng ngắn hơn thì lấy ngày cuối tháng (31 → 28/29 tháng 2).'}>
          {f.frequency === 'weekly' ? <select value={f.day_of_period} onChange={(e) => set('day_of_period', e.target.value)}>{WEEKDAYS.slice(1).map((l, i) => <option key={l} value={i + 1}>{l}</option>)}</select> : <input type="number" min="1" max="31" value={f.day_of_period} onChange={(e) => set('day_of_period', e.target.value)} />}
        </Field>
        <Field label="Từ ngày"><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="Đến ngày (tuỳ chọn)"><input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
      </div>
      {past && <div className="alert warn" role="status">Ngày bắt đầu đã qua: hệ thống sẽ tạo bù mọi kỳ từ ngày đó đến hôm nay. Muốn bỏ qua các kỳ cũ, chọn ngày bắt đầu là hôm nay.</div>}
      </div></Card>
    </FormPage>
  );
}

// ---------- Tài sản & phân bổ ----------
const ASSET_STATUS = { active: 'Đang khấu hao', done: 'Đã hết', disposed: 'Đã thanh lý', voided: 'Đã huỷ' };
export function Assets({ report }) {
  const { shops, methodList } = useSession();
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null);
  const state = useAsync(async () => { const r = await api.get('/accounting/assets'); report(r.data); return r; }, []);
  const { busy, error, run } = useAction();
  const dispose = (a) => confirm(`Thanh lý “${a.name}”? Giá trị còn lại ${vnd(a.remaining)} ghi vào chi phí khác (811), không khấu hao thêm. Tiền bán tài sản (nếu có) ghi bằng phiếu thu khác.`) && run(async () => { await api.post(`/accounting/assets/${a.id}/dispose`, {}); state.reload(); });
  if (form) return <AssetForm shops={shops} methodList={methodList} onClose={() => setForm(null)} onSaved={() => { setForm(null); state.reload(); }} />;
  return (
    <>
      <div className="row between wrap"><span className="muted small">Mua tài sản không vào chi phí ngay: ghi nhận vào tài sản rồi chia đều theo tháng (ghi ngày cuối tháng). Khấu hao chỉ có ở Sổ kế toán, không có ở Báo cáo.</span><button className="btn primary" onClick={() => setForm({})}>+ Tài sản / chi phí trả trước</button></div>
      <ErrorBox error={error} />
      <Async state={state}>
        {({ data }) => (!data.length ? <Empty>Chưa có tài sản. Ví dụ: kệ trưng bày, máy in (tài sản cố định) hay tiền thuê trả trước 12 tháng (chi phí trả trước).</Empty> : (
          <Card flat><div className="table-wrap"><table>
            <thead><tr><th>Tên</th><th>Loại</th><th>Ngày mua</th><th className="num">Nguyên giá</th><th className="num"><MetricLabel metric="acc_depreciation">Đã khấu hao</MetricLabel></th><th className="num">Còn lại</th><th>Tình trạng</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <Fragment key={a.id}>
                <tr style={a.voided_at ? { opacity: 0.55 } : undefined}>
                  <td>{a.name}<div className="muted small">{a.months} tháng · {a.shop_name || 'Chung'}{a.paid_via === 'unpaid' ? ' · chưa trả (331)' : ''}</div></td>
                  <td className="small">{a.kind === 'fixed_asset' ? 'Tài sản cố định' : 'Chi phí trả trước'}</td><td>{fmtDate(a.start_date)}</td>
                  <td className="num">{vnd(a.cost)}</td><td className="num">{vnd(a.accumulated)}</td><td className="num">{vnd(a.remaining)}</td><td className="small">{ASSET_STATUS[a.status]}{a.disposed_at && <div className="muted">{fmtDate(a.disposed_at)}</div>}</td>
                  <td className="row"><button className="btn sm" onClick={() => setOpen(open === a.id ? null : a.id)}>Lịch</button>
                    {a.status === 'active' || a.status === 'done' ? <><button className="btn sm" disabled={busy} onClick={() => dispose(a)}>Thanh lý</button><button className="btn sm danger" disabled={busy} onClick={() => confirm('Huỷ bản ghi nhập nhầm này? Mọi bút toán của nó biến mất.') && run(async () => { await api.del(`/accounting/assets/${a.id}`); state.reload(); })}>Huỷ</button></> : null}</td>
                </tr>
                {open === a.id && <tr><td colSpan={8}><Schedule id={a.id} /></td></tr>}
              </Fragment>
            ))}</tbody>
          </table></div></Card>
        ))}
      </Async>
    </>
  );
}

function Schedule({ id }) {
  const state = useAsync(() => api.get(`/accounting/assets/${id}`), [id]);
  return (
    <Async state={state}>
      {({ data }) => (
        <div className="table-wrap"><table>
          <thead><tr><th>Kỳ</th><th>Ngày ghi</th><th className="num">Số tiền</th><th className="num">Luỹ kế</th><th>Đã hạch toán</th></tr></thead>
          <tbody>{data.schedule.map((p) => <tr key={p.period} style={p.posted ? undefined : { opacity: 0.55 }}><td>{p.period}</td><td>{fmtDate(p.date)}</td><td className="num">{vnd(p.amount)}</td><td className="num">{p.posted ? vnd(p.accumulated) : ''}</td><td>{p.posted ? 'Rồi' : 'Chưa tới'}</td></tr>)}
            <tr style={{ fontWeight: 700, borderTop: '1px solid var(--champagne)' }}><td colSpan={2}>Tổng (= nguyên giá)</td><td className="num">{vnd(data.schedule.reduce((a, p) => a + p.amount, 0))}</td><td colSpan={2} /></tr></tbody>
        </table></div>
      )}
    </Async>
  );
}

function AssetForm({ shops, methodList, onClose, onSaved }) {
  const accounts = useAccounts();
  const [f, setF] = useState({ name: '', kind: 'fixed_asset', cost: '', months: '12', start_date: today(), paid_via: 'cash', expense_account_code: '6428', shop_id: '' });
  const { busy, error, run } = useAction();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const exp = (accounts.data?.data || []).filter((a) => /^64[12]/.test(a.code) && !a.archived_at);
  const per = Number(f.cost) > 0 && Number(f.months) > 0 ? Math.round(Number(f.cost) / Number(f.months)) : 0;
  const save = () => run(async () => { await api.post('/accounting/assets', { name: f.name.trim(), kind: f.kind, cost: Number(f.cost), months: Number(f.months), start_date: f.start_date, paid_via: f.paid_via, expense_account_code: f.expense_account_code, shop_id: f.shop_id || null }); onSaved(); });
  return (
    <FormPage embedded title="Thêm tài sản / chi phí trả trước" sub="Ghi nhận nguyên giá, sau đó phân bổ đều theo tháng." onBack={onClose} error={error && <ErrorBox error={error} />} footer={<><button type="button" className="btn" onClick={onClose}>Huỷ</button><button type="button" className="btn primary" disabled={busy || !f.name.trim() || !(Number(f.cost) > 0) || !(Number(f.months) > 0)} onClick={save}>Lưu</button></>}>
      <Card title="Thông tin tài sản"><div className="stack">
      <Field label="Tên"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ví dụ: Kệ trưng bày, Thuê mặt bằng 12 tháng" /></Field>
      <div className="grid cols-2">
        <Field label="Loại"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="fixed_asset">Tài sản cố định (khấu hao)</option><option value="prepaid">Chi phí trả trước (phân bổ)</option></select></Field>
        <Field label="Ngày mua"><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="Nguyên giá"><MoneyInput value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Số tháng" hint={per ? `Khoảng ${vnd(per)} mỗi tháng` : undefined}><input type="number" min="1" max="600" value={f.months} onChange={(e) => set('months', e.target.value)} /></Field>
        <Field label="Đã trả bằng"><select value={f.paid_via} onChange={(e) => set('paid_via', e.target.value)}>{methodList(f.paid_via).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="unpaid">Chưa trả (ghi phải trả người bán)</option></select></Field>
        <Field label="Ghi chi phí vào"><select value={f.expense_account_code} onChange={(e) => set('expense_account_code', e.target.value)}>{exp.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></Field>
        <Field label="Shop"><select value={f.shop_id} onChange={(e) => set('shop_id', e.target.value)}><option value="">Chung</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      </div></Card>
    </FormPage>
  );
}

// ---------- Khoá sổ ----------
export function LockTab() {
  const state = useAsync(() => api.get('/accounting/lock'), []);
  const [date, setDate] = useState('');
  const { busy, error, run } = useAction();
  const set = (d, msg) => confirm(msg) && run(async () => { await api.post('/accounting/lock', { date: d }); state.reload(); });
  return (
    <Async state={state}>
      {({ data: d }) => (
        <>
          <Card title="Ngày khoá sổ">
            <div className="stack">
              <p>{d.lock_date ? <>Đã khoá đến hết ngày <b>{fmtDate(d.lock_date)}</b>. Chứng từ tay, chi phí, thanh toán, chuyển quỹ và tài sản ngày đó trở về trước không tạo, sửa, huỷ được.</> : 'Chưa khoá sổ.'} <MetricLabel metric="acc_lock">Khoá sổ là gì?</MetricLabel></p>
              <div className="row wrap">
                <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Ngày khoá" style={{ width: 170 }} />
                <button className="btn primary" disabled={busy || !date} onClick={() => set(date, `Khoá sổ đến hết ngày ${fmtDate(date)}? Sau đó không sửa được chứng từ ngày này trở về trước (trừ khi mở khoá).`)}>{d.lock_date ? 'Đổi ngày khoá' : 'Khoá sổ'}</button>
                {d.lock_date && <button className="btn" disabled={busy} onClick={() => set(null, 'Mở khoá sổ? Mọi kỳ cũ sửa được trở lại.')}>Mở khoá</button>}
              </div>
              <ErrorBox error={error} />
              <p className="muted small">Đơn bán và phiếu nhập thuộc kỳ đã khoá vẫn sửa được (đơn sàn import muộn là bình thường). Khi đó số của kỳ đã khoá đổi, hệ thống báo ở đây và ở Tổng quan.</p>
            </div>
          </Card>
          {d.lock_date && (d.changed ? (
            <Card title="Kỳ đã khoá có thay đổi sau khoá">
              <div className="alert warn" role="alert">Số dư các tài khoản đến hết {fmtDate(d.lock_date)} khác lúc khoá sổ ({d.changes.length} tài khoản).</div>
              <div className="table-wrap"><table>
                <thead><tr><th>Tài khoản</th><th className="num">Lúc khoá</th><th className="num">Hiện tại</th><th className="num">Chênh</th></tr></thead>
                <tbody>{d.changes.map((c) => <tr key={c.code}><td>{c.code} <span className="muted small">{c.name}</span></td><td className="num">{signed(c.at_lock)}</td><td className="num">{signed(c.now)}</td><td className="num">{signed(c.diff)}</td></tr>)}</tbody>
              </table></div>
              <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={() => set(d.lock_date, 'Chấp nhận các thay đổi và chụp lại số liệu kỳ đã khoá?')}>Chấp nhận và chụp lại số liệu</button></div>
            </Card>
          ) : <div className="alert ok" role="status">Số liệu kỳ đã khoá không đổi so với lúc khoá.</div>)}
        </>
      )}
    </Async>
  );
}

// ---------- Danh mục chi phí → tài khoản ----------
export function CategoryMapping() {
  const cats = useAsync(() => api.get('/expense-categories'), []);
  const accounts = useAccounts();
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const exp = (accounts.data?.data || []).filter((a) => a.type === 'expense' && !a.archived_at && !['632', '5212'].includes(a.code));
  const map = (id, code) => run(async () => { await api.patch(`/accounting/expense-categories/${id}`, { account_code: code }); cats.reload(); });
  const add = () => run(async () => { await api.post('/expense-categories', { name: name.trim() }); setName(''); cats.reload(); });
  return (
    <Card title="Danh mục chi phí → tài khoản">
      <div className="stack">
        <p className="muted small">Mỗi khoản chi phí được hạch toán vào tài khoản của danh mục. Danh mục mới mặc định vào 6428 (chi phí quản lý khác).</p>
        <ErrorBox error={error} />
        <Async state={cats}>
          {({ data }) => <div className="table-wrap"><table><tbody>{data.map((c) => (
            <tr key={c.id}><td>{c.name}</td><td><select aria-label={`Tài khoản của ${c.name}`} disabled={busy} value={c.account_code || '6428'} onChange={(e) => map(c.id, e.target.value)}>{exp.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></td></tr>
          ))}</tbody></table></div>}
        </Async>
        <div className="row wrap"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên danh mục chi phí mới" style={{ maxWidth: 280 }} /><button className="btn" disabled={busy || !name.trim()} onClick={add}>+ Danh mục</button></div>
      </div>
    </Card>
  );
}
