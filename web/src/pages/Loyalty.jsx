import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, ErrorBox, Field, Modal, Tabs, useAction, useAsync } from '../components/ui.jsx';
import { Element } from '../components/Motif.jsx';
import { fmtDate, vnd } from '../lib.js';

const KIND = { reorder: 'Nhắc mua lại', birthday: 'Sinh nhật', general: 'Chung' };

/** Hộp soạn tin: điền sẵn biến, sửa được trước khi sao chép */
function ComposeModal({ msg, onClose }) {
  const [text, setText] = useState(msg.message);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Tin nhắn" onClose={onClose} footer={<button className="btn primary" onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? 'Đã sao chép' : 'Sao chép'}</button>}>
      {msg.unresolved.length > 0 && <div className="alert warn small">Còn biến chưa điền: {msg.unresolved.map((u) => `{${u}}`).join(', ')}</div>}
      <Field label="Nội dung (sửa được trước khi gửi)"><textarea value={text} rows={5} onChange={(e) => { setText(e.target.value); setCopied(false); }} /></Field>
    </Modal>
  );
}

function useCompose() {
  const tpl = useAsync(() => api.get('/loyalty/templates'), []);
  const [msg, setMsg] = useState(null);
  const { busy, error, run } = useAction();
  const compose = (kind, { customerId, productId, shopId }) => run(async () => {
    const list = tpl.data?.data || [];
    const t = list.find((x) => x.kind === kind) || list.find((x) => x.kind === 'general') || list[0];
    if (!t) throw new Error('Chưa có mẫu tin nhắn nào. Tạo ở tab “Mẫu tin nhắn”.');
    const res = await api.post('/loyalty/render', { template_id: t.id, customer_id: customerId, product_id: productId, shop_id: shopId });
    setMsg(res.data);
  });
  return { compose, busy, error, modal: msg && <ComposeModal msg={msg} onClose={() => setMsg(null)} /> };
}

/** Khách sắp hết hàng cần mua lại + sinh nhật sắp tới */
function Today({ shopId }) {
  const state = useAsync(() => api.get('/loyalty/today', { shop_id: shopId }), [shopId]);
  const c = useCompose();
  const { busy, error, run } = useAction();
  const act = (r, action) => run(async () => { await api.post('/loyalty/reminders/action', { customer_id: r.customer_id, product_id: r.product_id, base_date: r.last_purchase_date, action }); state.reload(); });
  return (
    <>
      <ErrorBox error={error || c.error} />
      <Async state={state}>
        {({ data }) => (
          <>
            <Card title={`Sắp hết hàng (${data.reminders.length})`}>
              {!data.reminders.length ? <Empty>Chưa có khách nào đến hạn mua lại. Nhắc nhở dựa trên “chu kỳ dùng hết” của sản phẩm — nhớ điền ở trang Sản phẩm.</Empty> : data.reminders.map((r) => (
                <div key={`${r.customer_id}${r.product_id}`} className="stack" style={{ gap: 6, padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
                  <div className="row between"><Link to={`/customers/${r.customer_id}`}><b>{r.customer.name}</b></Link><span className={r.overdue_days > 0 ? 'h-yellow small' : 'small muted'}>{r.overdue_days > 0 ? `quá hạn ${r.overdue_days} ngày` : r.overdue_days === 0 ? 'đến hạn hôm nay' : `còn ${-r.overdue_days} ngày`}</span></div>
                  <div className="small muted">{r.product_name} × {r.qty} · mua {fmtDate(r.last_purchase_date)} · {r.customer.phone || r.customer.facebook_url || 'chưa có liên hệ'}</div>
                  <div className="row wrap">
                    <button className="btn sm primary" disabled={busy || c.busy} onClick={() => c.compose('reorder', { customerId: r.customer.id, productId: r.product_id, shopId: r.shop_id })}>Soạn tin</button>
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
                  <button className="btn sm" disabled={c.busy} onClick={() => c.compose('birthday', { customerId: b.id, shopId: b.shop_id })}>Soạn lời chúc</button>
                </div>
              ))}
            </Card>
          </>
        )}
      </Async>
      {c.modal}
    </>
  );
}

/** Mỗi khách biết mệnh của shop phong thuỷ + vật phẩm hợp mệnh chưa mua */
function ElementCampaign({ shopId, shopName }) {
  const state = useAsync(() => api.get('/loyalty/element-campaign', { shop_id: shopId }), [shopId]);
  const c = useCompose();
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>Khách của {shopName} đã biết mệnh, kèm vật phẩm đang bán hợp mệnh mà khách chưa mua. Mệnh lấy từ thông tin riêng của khách ở shop này.</p>
      <ErrorBox error={c.error} />
      <Async state={state}>
        {(r) => !r.data.length ? <Empty>{r.reason || 'Chưa có khách nào vừa biết mệnh vừa còn vật phẩm hợp để gợi ý. Điền ngày/năm sinh trong thông tin riêng của khách, và đánh dấu ngũ hành cho sản phẩm.'}</Empty> : (
          <Card flat><div className="table-wrap"><table className="stackable">
            <thead><tr><th>Khách</th><th>Mệnh</th><th>Gợi ý</th><th /></tr></thead>
            <tbody>{r.data.map((x) => (
              <tr key={x.customer.id}>
                <td><Link to={`/customers/${x.customer.id}`}><b>{x.customer.name}</b></Link><div className="small muted">{x.customer.phone || x.customer.facebook_url || 'chưa có liên hệ'}</div></td>
                <td><Element name={x.element} />{x.approximate && <span className="small muted"> (ước)</span>}</td>
                <td>{x.suggestions.map((p) => <div key={p.product_id} className="small">{p.name} <span className="muted">{vnd(p.price)}</span></div>)}</td>
                <td><button className="btn sm" disabled={c.busy} onClick={() => c.compose('general', { customerId: x.customer.id, productId: x.suggestions[0].product_id, shopId })}>Soạn tin</button></td>
              </tr>))}</tbody>
          </table></div>{r.total > r.data.length && <div className="small muted" style={{ marginTop: 8 }}>Hiện {r.data.length} / {r.total} khách (xếp theo chi tiêu).</div>}</Card>
        )}
      </Async>
      {c.modal}
    </>
  );
}

/** Hạng khách theo chi tiêu 12 tháng (dùng chung mọi shop) */
function Tiers() {
  const state = useAsync(() => api.get('/loyalty/tiers'), []);
  return <Async state={state}>{({ data }) => <TierEditor init={data} />}</Async>;
}
function TierEditor({ init }) {
  const [t, setT] = useState(init);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const set = (i, k, v) => { setT(t.map((x, j) => (j === i ? { ...x, [k]: v } : x))); setSaved(false); };
  return (
    <Card title="Hạng khách theo chi tiêu 12 tháng (mọi shop)">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Hạng tính trên tổng chi tiêu của khách ở tất cả shop. Hạng thấp nhất phải bắt đầu từ 0 ₫. Khi bán, hạng cho ra mức giảm giá gợi ý.</p>
        {t.map((x, i) => (
          <div key={i} className="grid cols-3">
            <Field label="Tên hạng"><input value={x.name} onChange={(e) => set(i, 'name', e.target.value)} /></Field>
            <Field label="Chi tiêu từ (₫)"><input type="number" min="0" value={x.min_spent} onChange={(e) => set(i, 'min_spent', Number(e.target.value))} /></Field>
            <Field label="Giảm giá gợi ý (%)"><input type="number" min="0" max="100" value={x.discount_pct} onChange={(e) => set(i, 'discount_pct', Number(e.target.value))} /></Field>
          </div>
        ))}
        <div className="row"><button className="btn sm" onClick={() => setT([...t, { name: '', min_spent: 0, discount_pct: 0 }])}>+ Hạng</button></div>
        <ErrorBox error={error} />{saved && <div className="alert ok">Đã lưu.</div>}
        <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.put('/loyalty/tiers', t.map(({ id, ...r }) => ({ ...r, ...(id ? { id } : {}) }))); setSaved(true); })}>Lưu</button></div>
      </div>
    </Card>
  );
}

/** Mẫu tin nhắn dùng khi soạn tin. Biến: {ten} {san_pham} {shop} */
function Templates() {
  const state = useAsync(() => api.get('/loyalty/templates'), []);
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    const payload = { name: f.name, kind: f.kind, body: f.body };
    if (f.id) await api.put(`/loyalty/templates/${f.id}`, payload); else await api.post('/loyalty/templates', payload);
    setF(null); state.reload();
  });
  return (
    <Card title="Mẫu tin nhắn" actions={<button className="btn sm primary" onClick={() => setF({ name: '', kind: 'general', body: '' })}>+ Mẫu</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Dùng được các biến <code>{'{ten}'}</code> (tên gọi của khách), <code>{'{san_pham}'}</code>, <code>{'{shop}'}</code>. Khi soạn tin, app chọn mẫu đầu tiên đúng loại.</p>
      <ErrorBox error={error} />
      <Async state={state}>{({ data }) => !data.length ? <Empty>Chưa có mẫu nào.</Empty> : data.map((t) => (
        <div key={t.id} className="stack" style={{ gap: 4, padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
          <div className="row between"><span><b>{t.name}</b> <span className="badge plain">{KIND[t.kind] || t.kind}</span></span>
            <span className="row"><button className="btn sm" onClick={() => setF({ ...t })}>Sửa</button><button className="btn sm danger" disabled={busy} onClick={() => confirm(`Xoá mẫu “${t.name}”?`) && run(async () => { await api.del(`/loyalty/templates/${t.id}`); state.reload(); })}>Xoá</button></span></div>
          <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{t.body}</div>
        </div>
      ))}</Async>
      {f && (
        <Modal title={f.id ? 'Sửa mẫu' : 'Thêm mẫu'} onClose={() => setF(null)} footer={<button className="btn primary" disabled={busy || !f.name || !f.body} onClick={save}>Lưu</button>}>
          <Field label="Tên mẫu"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Loại"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Nội dung"><textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={1000} /></Field>
          <ErrorBox error={error} />
        </Modal>
      )}
    </Card>
  );
}

/** Chỗ dành cho tự động hoá. Chưa có gì chạy: nói thẳng để không ai tưởng đã bật. */
function Automation() {
  return (
    <Card title="Tự động hoá">
      <div className="alert warn small">Chưa có gì chạy tự động. Hiện mọi việc ở đây đều do bạn bấm tay.</div>
      <p style={{ marginBottom: 6 }}>Dự kiến làm ở module này:</p>
      <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li><b>Tự động nhắn tin</b>: gửi nhắc mua lại, lời chúc sinh nhật theo mẫu, khi đến hạn.</li>
        <li><b>Tự động nâng hạng</b>: khi chi tiêu 12 tháng vượt ngưỡng, đổi hạng và áp mức giảm giá tương ứng.</li>
      </ul>
      <p className="small muted" style={{ marginBottom: 0 }}>Gửi tin tự động cần kết nối một kênh gửi (Zalo OA, SMS…) và tuân theo quy định về tin nhắn quảng cáo, nên sẽ làm sau khi chốt kênh gửi.</p>
    </Card>
  );
}

export default function Loyalty() {
  const { shop, isAll, has } = useSession();
  const shopId = isAll ? undefined : shop?.id;
  const options = [['today', 'Hôm nay'], ...(isAll || has('feng_shui') ? [['menh', 'Gợi ý theo mệnh']] : []), ['tiers', 'Hạng khách'], ['templates', 'Mẫu tin nhắn'], ['auto', 'Tự động hoá']];
  const [tab, setTab] = useState('today');
  const current = options.some(([v]) => v === tab) ? tab : 'today';
  return (
    <div className="page stack">
      <div className="page-head"><div><h1>Loyalty & Campaign</h1><div className="muted small sub">Chăm sóc khách, hạng khách và chiến dịch. {isAll ? 'Đang xem tất cả shop.' : `Đang xem ${shop?.name}.`}</div></div></div>
      <Tabs options={options} value={current} onChange={setTab} />
      {current === 'today' && <Today shopId={shopId} />}
      {current === 'menh' && (isAll ? <Empty>Gợi ý theo mệnh là của từng shop phong thuỷ. Chọn một shop ở góc trên.</Empty> : <ElementCampaign shopId={shopId} shopName={shop?.name} />)}
      {current === 'tiers' && <Tiers />}
      {current === 'templates' && <Templates />}
      {current === 'auto' && <Automation />}
    </div>
  );
}
