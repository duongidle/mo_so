import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Modal, useAction, useAsync, Field } from '../components/ui.jsx';
import { fmtDate } from '../lib.js';

export default function Care() {
  const { shopId, isAll } = useSession();
  const state = useAsync(() => api.get('/loyalty/today', { shop_id: isAll ? undefined : shopId }), [shopId]);
  const tpl = useAsync(() => api.get('/loyalty/templates'), []);
  const [msg, setMsg] = useState(null);
  const { busy, error, run } = useAction();

  const compose = (kind, r) => run(async () => {
    const t = (tpl.data?.data || []).find((x) => x.kind === kind) || tpl.data?.data?.[0];
    const res = await api.post('/loyalty/render', { template_id: t.id, customer_id: r.customer?.id || r.id, product_id: r.product_id, shop_id: r.shop_id });
    setMsg({ ...res.data, r });
  });
  const act = (r, action) => run(async () => { await api.post('/loyalty/reminders/action', { customer_id: r.customer_id, product_id: r.product_id, base_date: r.last_purchase_date, action }); state.reload(); });

  return (
    <div className="page stack">
      <div className="page-head"><h1>Hôm nay nên liên hệ</h1></div>
      <ErrorBox error={error} />
      <Async state={state}>
        {({ data }) => (
          <>
            <Card title={`Sắp hết hàng (${data.reminders.length})`}>
              {!data.reminders.length ? <Empty>Chưa có khách nào đến hạn mua lại. Nhắc nhở dựa trên “chu kỳ dùng hết” của sản phẩm — nhớ điền ở trang Sản phẩm.</Empty> : data.reminders.map((r) => (
                <div key={`${r.customer_id}${r.product_id}`} className="stack" style={{ gap: 6, padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
                  <div className="row between"><Link to={`/customers/${r.customer_id}`}><b>{r.customer.name}</b></Link><span className={r.overdue_days > 0 ? 'h-yellow small' : 'small muted'}>{r.overdue_days > 0 ? `quá hạn ${r.overdue_days} ngày` : r.overdue_days === 0 ? 'đến hạn hôm nay' : `còn ${-r.overdue_days} ngày`}</span></div>
                  <div className="small muted">{r.product_name} × {r.qty} · mua {fmtDate(r.last_purchase_date)} · {r.customer.phone || r.customer.facebook_url || 'chưa có liên hệ'}</div>
                  <div className="row wrap">
                    <button className="btn sm primary" disabled={busy} onClick={() => compose('reorder', r)}>Soạn tin</button>
                    <button className="btn sm" disabled={busy} onClick={() => act(r, 'done')}>Đã liên hệ</button>
                    <button className="btn sm" disabled={busy} onClick={() => act(r, 'snooze')}>Hoãn 3 ngày</button>
                    <button className="btn sm" disabled={busy} onClick={() => act(r, 'dismiss')}>Bỏ qua</button>
                  </div>
                </div>
              ))}
            </Card>
            <Card title={`Sinh nhật 7 ngày tới (${data.birthdays.length})`}>
              {!data.birthdays.length ? <span className="muted small">Không có.</span> : data.birthdays.map((b) => (
                <div key={b.id} className="row between" style={{ padding: '8px 0' }}>
                  <span><Link to={`/customers/${b.id}`}><b>{b.name}</b></Link> <span className="small muted">{b.in_days === 0 ? 'hôm nay' : `${b.in_days} ngày nữa`} · tròn {b.turning}</span></span>
                  <button className="btn sm" onClick={() => compose('birthday', b)}>Soạn lời chúc</button>
                </div>
              ))}
            </Card>
          </>
        )}
      </Async>
      {msg && (
        <Modal title="Tin nhắn" onClose={() => setMsg(null)} footer={<button className="btn primary" onClick={() => navigator.clipboard?.writeText(msg.message)}>Sao chép</button>}>
          {msg.unresolved.length > 0 && <div className="alert warn small">Còn biến chưa điền: {msg.unresolved.map((u) => `{${u}}`).join(', ')}</div>}
          <Field label="Nội dung (sửa được trước khi gửi)"><textarea defaultValue={msg.message} rows={5} onChange={(e) => (msg.message = e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
