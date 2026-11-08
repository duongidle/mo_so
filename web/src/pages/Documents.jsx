import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Card, Chips, Tabs, DateRange, Empty, ErrorBox, LoadMore, PageHeader, SearchBox, Toolbar, useDebounced } from '../components/ui.jsx';
import { fmtDate, vnd } from '../lib.js';

const TYPES = [['', 'Tất cả'], ['order', 'Đơn bán'], ['purchase', 'Phiếu nhập'], ['return', 'Trả hàng'], ['write_off', 'Hàng huỷ'], ['transfer', 'Chuyển kho'], ['adjustment', 'Điều chỉnh'], ['count', 'Kiểm kê']];
const TYPE_NAME = Object.fromEntries(TYPES.filter(([k]) => k).map(([k, v]) => [k, v]));
const STATUS = {
  draft: 'Nháp', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Hoàn thành', cancelled: 'Đã huỷ', returned: 'Đã trả hàng', received: 'Đã nhận',
  awaiting: 'Chờ hàng về', done: 'Xong', opening: 'Tồn đầu kỳ', adjust: 'Điều chỉnh', damage: 'Hư hỏng', count: 'Kiểm kê',
};
const PAGE = 50;

/** Nơi mở một chứng từ: đơn và các phiếu của đơn → chi tiết đơn; phiếu nhập → trang phiếu; phiếu kho → trang Kho */
export const documentPath = (d) => (d.type === 'order' ? `/orders/${d.id}` : d.type === 'return' || d.type === 'write_off' ? `/orders/${d.order_id}` : d.type === 'purchase' ? `/purchases/${d.id}` : '/stock');

/** Danh sách gộp mọi chứng từ để tra cứu: một chỗ thay vì đi từng trang */
function Warranty() {
  const { shopId, isAll } = useSession();
  const [text, setText] = useState('');
  const dq = useDebounced(text);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let off = false;
    api.get('/orders/warranty', { q: dq || undefined, shop_id: isAll ? undefined : shopId }).then((r) => { if (!off) { setRows(r.data); setError(null); } }).catch((e) => !off && setError(e));
    return () => { off = true; };
  }, [dq, shopId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <Toolbar><SearchBox value={text} onChange={setText} placeholder="Tra theo SĐT, tên khách, mã đơn, SKU…" /></Toolbar>
      <ErrorBox error={error} />
      {rows && !rows.length ? <Empty>Không có hàng nào đang bảo hành khớp. Đặt số ngày bảo hành ở form sản phẩm.</Empty> : rows && (
        <Card flat className="list-card"><div className="table-wrap"><table className="stackable">
          <thead><tr><th>Sản phẩm</th><th>Khách</th><th>Đơn</th><th>Bảo hành đến</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td>{r.name}<span className="sub">{r.sku} · còn {r.qty}</span></td><td>{r.customer_name || '—'}<span className="sub">{r.customer_phone}</span></td><td>{r.order_code}</td>
              <td>{fmtDate(r.warranty_until)} {r.in_warranty ? <span className="badge st-completed">Còn {r.days_left} ngày</span> : <span className="badge st-cancelled">Hết bảo hành</span>}</td></tr>))}</tbody>
        </table></div></Card>
      )}
    </div>
  );
}

export default function Documents() {
  const [tab, setTab] = useState('docs');
  return tab === 'docs' ? <DocumentList tab={tab} setTab={setTab} /> : (
    <div className="page stack">
      <PageHeader title="Chứng từ" sub="Tra cứu bảo hành theo khách, đơn hoặc sản phẩm." />
      <Toolbar><Tabs options={[['docs', 'Phiếu đã lập'], ['warranty', 'Tra cứu bảo hành']]} value={tab} onChange={setTab} /></Toolbar>
      <Warranty />
    </div>
  );
}

function DocumentList({ tab, setTab }) {
  const { shopId, isAll } = useSession();
  const nav = useNavigate();
  const [type, setType] = useState('');
  const [text, setText] = useState('');
  const dq = useDebounced(text);
  const [range, setRange] = useState({ from: '', to: '' });
  const [rows, setRows] = useState([]);
  const [more, setMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (offset) => {
    try {
      setLoading(true);
      const res = await api.get('/documents', { type: type || undefined, q: dq || undefined, from: range.from || undefined, to: range.to || undefined, shop_id: isAll ? undefined : shopId, limit: PAGE, offset });
      setRows((cur) => (offset ? [...cur, ...res.data] : res.data));
      setMore(res.has_more);
      setTotal(res.total);
      setError(null);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(0); }, [type, dq, range.from, range.to, shopId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page stack">
      <PageHeader title="Chứng từ" sub="Mọi phiếu đã lập, mới nhất trước. Thanh toán và chi phí xem ở Chi phí & quỹ." />
      <Toolbar><Tabs options={[['docs', 'Phiếu đã lập'], ['warranty', 'Tra cứu bảo hành']]} value={tab} onChange={setTab} /></Toolbar>
      <Toolbar>
        <Chips options={TYPES} value={type} onChange={setType} />
        <SearchBox value={text} onChange={setText} placeholder="Tìm theo mã phiếu…" />
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </Toolbar>
      <ErrorBox error={error} />
      {!loading && !rows.length && !error ? <Empty>Không có chứng từ khớp bộ lọc.</Empty> : (
        <Card flat className="list-card sticky-head"><div className="table-wrap"><table className="stackable">
          <thead><tr><th>Mã phiếu</th><th>Loại</th><th>Ngày</th><th className="hide-sm">Shop / kho</th><th className="num">Giá trị</th><th className="hide-sm">Trạng thái</th></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={`${d.type}-${d.id}`} className="click" tabIndex={0} onClick={() => nav(documentPath(d))} onKeyDown={(e) => e.key === 'Enter' && nav(documentPath(d))}>
              <td><b>{d.code}</b></td>
              <td>{TYPE_NAME[d.type]}</td>
              <td>{fmtDate(d.at)}</td>
              <td className="hide-sm">{d.shop_name || d.warehouse_name || '—'}</td>
              <td className="num">{d.amount === null ? <span className="muted">—</span> : vnd(d.amount)}</td>
              <td className="hide-sm"><span className="badge plain">{STATUS[d.status] || d.status}</span></td>
            </tr>))}</tbody>
        </table></div></Card>
      )}
      {rows.length > 0 && <div className="small muted">Hiện {rows.length} / {total} chứng từ</div>}
      <LoadMore next={more ? 1 : null} onMore={() => load(rows.length)} />
    </div>
  );
}
