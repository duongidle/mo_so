import { useState } from 'react';
import { api } from '../api.js';
import { Async, Card, Empty, ErrorBox, Field, Kpi, Modal, useAction, useAsync } from '../components/ui.jsx';
import { vnd, fmtDate, today, METHODS } from '../lib.js';

const KINDS = { cash: 'Tiền mặt', bank: 'Ngân hàng', ewallet: 'Ví điện tử', other: 'Khác' };
const SOURCE = { payment: 'Thu/chi', expense: 'Chi phí', transfer: 'Chuyển quỹ', adjust: 'Điều chỉnh kiểm đếm' };

/** Quỹ tiền: két, tài khoản ngân hàng, ví. Số dư luôn tính từ sổ thu chi, không nhập tay. */
export default function CashAccounts() {
  const state = useAsync(() => api.get('/cash/accounts'), []);
  const [edit, setEdit] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [count, setCount] = useState(null);
  const [transfer, setTransfer] = useState(false);
  return (
    <Async state={state}>
      {(r) => (
        <>
          <div className="row wrap between">
            <Kpi label="Tổng tiền trong các quỹ" value={vnd(r.total_balance)} hint={`Tính đến hôm nay ${fmtDate(r.as_of)}`} />
            <div className="row"><button className="btn" disabled={r.data.length < 2} onClick={() => setTransfer(true)}>Chuyển quỹ</button><button className="btn primary" onClick={() => setEdit({ name: '', kind: 'bank', methods: [], opening_balance: 0, opening_date: '' })}>+ Quỹ</button></div>
          </div>
          {r.unassigned.has_activity && <div className="alert warn small">Có {vnd(r.unassigned.net)} ở các phương thức chưa gán quỹ nào ({r.unassigned.methods.map((m) => METHODS[m]).join(', ')}). Tiền đó đã ghi sổ nhưng không nằm trong quỹ nào. Sửa một quỹ để gán phương thức.</div>}
          {!r.data.length ? <Empty>Chưa có quỹ nào.</Empty> : r.data.map((a) => (
            <Card key={a.id} title={a.name} actions={<><span className="badge plain">{KINDS[a.kind]}</span><button className="btn sm" onClick={() => setLedger(a)}>Sổ quỹ</button><button className="btn sm" onClick={() => setCount(a)}>Kiểm đếm</button><button className="btn sm" onClick={() => setEdit({ ...a, opening_date: a.opening_date || '' })}>Sửa</button></>}>
              <div className="row between"><b className={`num ${a.balance < 0 ? 'h-red' : ''}`} style={{ fontSize: 22 }}>{vnd(a.balance)}</b>
                <span className="small muted">Nhận: {a.methods.length ? a.methods.map((m) => METHODS[m]).join(', ') : 'chưa gán phương thức nào'}</span></div>
              <div className="small muted" style={{ marginTop: 6 }}>Số dư đầu {vnd(a.opening_balance)}{a.opening_date ? ` (từ ${fmtDate(a.opening_date)})` : ' (tính từ toàn bộ lịch sử)'} + thu {vnd(a.cash_in)} − chi {vnd(a.cash_out)} − chi phí {vnd(a.expenses_out)}{a.entries ? ` ${a.entries > 0 ? '+' : '−'} chuyển quỹ/điều chỉnh ${vnd(Math.abs(a.entries))}` : ''}</div>
            </Card>
          ))}
          <p className="small muted">Mỗi phương thức thanh toán chỉ thuộc một quỹ. Thu tiền đơn, trả nhà cung cấp, hoàn tiền và chi phí tự đổ vào quỹ theo phương thức. Số dư không nhập tay: muốn khớp với tiền thật thì <b>nhập số dư đầu</b> hoặc bấm <b>Kiểm đếm</b> (app ghi phần chênh thành một dòng điều chỉnh, thu chi cũ giữ nguyên).</p>
          {edit && <AccountForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} />}
          {ledger && <Ledger account={ledger} onClose={() => setLedger(null)} onChanged={() => state.reload()} />}
          {count && <CountForm account={count} onClose={() => setCount(null)} onDone={() => { setCount(null); state.reload(); }} />}
          {transfer && <TransferForm accounts={r.data} onClose={() => setTransfer(false)} onDone={() => { setTransfer(false); state.reload(); }} />}
        </>
      )}
    </Async>
  );
}

function AccountForm({ init, onClose, onSaved }) {
  const [f, setF] = useState(init);
  const { busy, error, run } = useAction();
  const toggle = (m) => setF({ ...f, methods: f.methods.includes(m) ? f.methods.filter((x) => x !== m) : [...f.methods, m] });
  const save = () => run(async () => {
    const payload = { name: f.name, kind: f.kind, methods: f.methods, opening_balance: Number(f.opening_balance) || 0, opening_date: f.opening_date || null };
    if (f.id) await api.patch(`/cash/accounts/${f.id}`, payload); else await api.post('/cash/accounts', payload);
    onSaved();
  });
  return (
    <Modal title={f.id ? 'Sửa quỹ' : 'Thêm quỹ'} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" disabled={busy} onClick={() => confirm(`Lưu trữ quỹ “${f.name}”? (cần bỏ hết phương thức nhận tiền trước)`) && run(async () => { await api.patch(`/cash/accounts/${f.id}`, { archived: true }); onSaved(); })}>Lưu trữ</button>}
      <button className="btn primary" disabled={busy || !f.name} onClick={save}>Lưu</button></>}>
      <div className="grid cols-2">
        <Field label="Tên quỹ"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Loại"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Nhận các phương thức thanh toán</div>
        <div className="row wrap">{Object.entries(METHODS).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={f.methods.includes(k)} onChange={() => toggle(k)} />{v}</label>)}</div>
        <span className="small muted">Phương thức đã thuộc quỹ khác sẽ bị từ chối: bỏ khỏi quỹ kia trước.</span>
      </div>
      <div className="grid cols-2">
        <Field label="Số dư đầu (₫)" hint="Số tiền thật đang có tại đầu ngày mở sổ"><input type="number" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} /></Field>
        <Field label="Ngày mở sổ" hint="Để trống = tính từ toàn bộ lịch sử. Thu chi trước ngày này bị bỏ qua"><input type="date" value={f.opening_date} onChange={(e) => setF({ ...f, opening_date: e.target.value })} /></Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

function Ledger({ account, onClose, onChanged }) {
  const state = useAsync(() => api.get(`/cash/accounts/${account.id}/ledger`, { limit: 200 }), [account.id]);
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Sổ quỹ · ${account.name}`} wide onClose={onClose}>
      <ErrorBox error={error} />
      <Async state={state}>{({ data }) => (
        <>
          <div className="row between small"><span>Số dư đầu kỳ xem: <b>{vnd(data.opening_balance)}</b></span><span>Số dư cuối: <b>{vnd(data.closing_balance)}</b></span></div>
          {!data.data.length ? <Empty>Chưa có dòng nào.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Ngày</th><th>Nội dung</th><th className="num">Tiền</th><th className="num">Số dư</th><th /></tr></thead>
              <tbody>{[...data.data].reverse().map((r) => (
                <tr key={`${r.source}${r.id}`}><td>{fmtDate(r.date)}</td><td>{SOURCE[r.source] || r.source}{r.method ? ` · ${METHODS[r.method]}` : ''}<div className="small muted">{r.note}</div></td>
                  <td className={`num ${r.amount < 0 ? 'h-red' : 'h-green'}`}>{r.amount > 0 ? '+' : '−'} {vnd(Math.abs(r.amount))}</td><td className="num">{vnd(r.balance)}</td>
                  <td>{(r.source === 'transfer' || r.source === 'adjust') && <button className="btn sm danger" disabled={busy} onClick={() => confirm('Huỷ dòng này?' + (r.source === 'transfer' ? ' (cả hai phía của lần chuyển quỹ)' : '')) && run(async () => { await api.del(`/cash/entries/${r.id}`); state.reload(); onChanged(); })}>Huỷ</button>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="small muted" style={{ margin: 0 }}>Hiện tối đa 200 dòng gần nhất.</p>
        </>
      )}</Async>
    </Modal>
  );
}

function CountForm({ account, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);
  const { busy, error, run } = useAction();
  const diff = amount === '' ? null : Number(amount) - account.balance;
  return (
    <Modal title={`Kiểm đếm · ${account.name}`} onClose={onClose} footer={result ? <button className="btn primary" onClick={onDone}>Xong</button> : <button className="btn primary" disabled={busy || amount === ''} onClick={() => run(async () => { const r = await api.post(`/cash/accounts/${account.id}/count`, { counted_amount: Number(amount) }); setResult(r.data); })}>Ghi nhận</button>}>
      {result ? (
        <div className={`alert ${result.difference ? 'warn' : 'ok'}`}>{result.difference === 0 ? 'Khớp, không cần điều chỉnh.' : `Đã ghi điều chỉnh ${result.difference > 0 ? '+' : '−'}${vnd(Math.abs(result.difference))}. Số dư quỹ giờ là ${vnd(result.balance)}.`}</div>
      ) : (
        <>
          <p style={{ margin: 0 }}>Hệ thống đang tính quỹ có <b>{vnd(account.balance)}</b>. Đếm tiền thật (hoặc xem số dư ngân hàng) rồi nhập vào đây.</p>
          <Field label="Số tiền thực tế (₫)"><input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
          {diff !== null && <div className={`small ${diff === 0 ? 'h-green' : 'h-yellow'}`}>{diff === 0 ? 'Khớp với hệ thống.' : `Chênh ${diff > 0 ? 'dư' : 'thiếu'} ${vnd(Math.abs(diff))}. Hãy nhớ lại có khoản thu chi nào chưa ghi sổ không trước khi chốt.`}</div>}
        </>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}

function TransferForm({ accounts, onClose, onDone }) {
  const [f, setF] = useState({ from: accounts[0].id, to: accounts[1].id, amount: '', date: today(), note: '' });
  const { busy, error, run } = useAction();
  return (
    <Modal title="Chuyển quỹ" onClose={onClose} footer={<button className="btn primary" disabled={busy || !Number(f.amount) || f.from === f.to} onClick={() => run(async () => { await api.post('/cash/transfers', { from_account_id: f.from, to_account_id: f.to, amount: Number(f.amount), date: f.date, note: f.note || null }); onDone(); })}>Chuyển</button>}>
      <div className="grid cols-2">
        <Field label="Từ quỹ"><select value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({vnd(a.balance)})</option>)}</select></Field>
        <Field label="Sang quỹ"><select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      </div>
      <div className="grid cols-2">
        <Field label="Số tiền (₫)"><input type="number" inputMode="numeric" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="Ngày"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <Field label="Ghi chú"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="VD: Rút tiền ngân hàng về két" /></Field>
      <p className="small muted" style={{ margin: 0 }}>Chuyển quỹ không phải thu hay chi: tổng tiền không đổi, chỉ đổi chỗ để.</p>
      <ErrorBox error={error} />
    </Modal>
  );
}
