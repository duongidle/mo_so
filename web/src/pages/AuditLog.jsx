import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, DateRange, Empty, ErrorBox, LoadMore, SearchBox, Toolbar, useDebounced } from '../components/ui.jsx';
import { fmtDate } from '../lib.js';

const TYPE_NAME = { order: 'Đơn bán', purchase: 'Phiếu nhập', product: 'Sản phẩm', variant: 'Biến thể', customer: 'Khách hàng', shop: 'Shop', warehouse: 'Kho', expense: 'Chi phí', stock_count: 'Kiểm kê', stock_adjustment: 'Điều chỉnh kho', stock_transfer: 'Chuyển kho', promotion: 'Khuyến mãi', settings: 'Cài đặt', voucher: 'Chứng từ', carrier_statement: 'Đối soát hãng vận chuyển', api_key: 'API key', webhook: 'Webhook', account: 'Tài khoản' };
const FIELD = {
  status: 'Trạng thái', note: 'Ghi chú', internal_note: 'Ghi chú nội bộ', total_amount: 'Tổng tiền', subtotal: 'Tạm tính', discount_amount: 'Giảm giá', shipping_fee: 'Phí ship khách trả', platform_fee_amount: 'Phí sàn',
  seller_shipping_amount: 'Ship shop chịu', paid_amount: 'Đã thu', payment_status: 'Thanh toán', customer_name: 'Tên khách', customer_phone: 'SĐT khách', shipping_address: 'Địa chỉ giao', tracking_code: 'Mã vận đơn',
  carrier: 'Hãng vận chuyển', due_date: 'Hạn thanh toán', name: 'Tên', phone: 'Số điện thoại', address: 'Địa chỉ', unit: 'Đơn vị', brand: 'Thương hiệu', default_price: 'Giá bán mặc định', price: 'Giá', amount: 'Số tiền',
  active: 'Đang chạy', archived_at: 'Lưu trữ lúc', warranty_days: 'Bảo hành (ngày)', consumption_days: 'Chu kỳ dùng (ngày)', description: 'Mô tả', ordered_at: 'Ngày đặt', stock_lock_date: 'Ngày chốt kho', costing_method: 'Phương pháp giá vốn',
  return_window_days: 'Thời hạn trả hàng (ngày)', payment_terms_days: 'Số ngày công nợ mặc định', low_stock_days: 'Cảnh báo sắp hết (ngày bán)', slow_moving_days: 'Hàng bán chậm (ngày)', expense_allocation: 'Cách chia chi phí chung',
};
const show = (v) => (v === null || v === '' ? '(trống)' : typeof v === 'boolean' ? (v ? 'có' : 'không') : String(v));

/** Cài đặt → Nhật ký: ai đã làm gì, lúc nào, thay đổi những gì. Chỉ đọc. */
export default function AuditLog() {
  const [facets, setFacets] = useState({ entity_types: [], actions: [] });
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [text, setText] = useState('');
  const dq = useDebounced(text);
  const [range, setRange] = useState({ from: '', to: '' });
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});

  const load = async (cursor) => {
    try {
      setLoading(true);
      const res = await api.get('/system/audit', { entity_type: entityType || undefined, action: action || undefined, q: dq || undefined, from: range.from || undefined, to: range.to || undefined, cursor: cursor || undefined, limit: 50 });
      setRows((cur) => (cursor ? [...cur, ...res.data] : res.data));
      setNext(res.next_cursor);
      if (res.facets) setFacets(res.facets);
      setError(null);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(null); }, [entityType, action, dq, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <Toolbar>
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Đối tượng"><option value="">Mọi đối tượng</option>{facets.entity_types.map((t) => <option key={t.v} value={t.v}>{TYPE_NAME[t.v] || t.v} ({t.n})</option>)}</select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Hành động"><option value="">Mọi hành động</option>{facets.actions.map((a) => <option key={a.v} value={a.v}>{a.label} ({a.n})</option>)}</select>
        <SearchBox value={text} onChange={setText} placeholder="Tìm trong nhật ký…" />
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </Toolbar>
      <ErrorBox error={error} />
      {!loading && !rows.length && !error ? <Empty>Chưa có thay đổi nào khớp bộ lọc.</Empty> : (
        <Card flat className="list-card sticky-head"><div className="table-wrap"><table className="stackable">
          <thead><tr><th>Thời gian</th><th>Hành động</th><th>Đối tượng</th><th className="hide-sm">Người làm</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <>
              <tr key={r.id}>
                <td className="small">{fmtDate(r.at, true)}</td>
                <td><b>{r.action_label}</b></td>
                <td>{TYPE_NAME[r.entity_type] || r.entity_type}{r.entity_label ? `: ${r.entity_label}` : ''}</td>
                <td className="hide-sm small">{r.actor}</td>
                <td>{r.changes.length > 0 && <button type="button" className="btn sm" onClick={() => setOpen({ ...open, [r.id]: !open[r.id] })} aria-expanded={!!open[r.id]}>{open[r.id] ? 'Ẩn' : `${r.changes.length} thay đổi`}</button>}</td>
              </tr>
              {open[r.id] && <tr key={`${r.id}c`}><td colSpan={5}><div className="stack small" style={{ gap: 4 }}>{r.changes.map((c) => <div key={c.field}><b>{FIELD[c.field] || c.field}</b>: <span className="muted">{show(c.from)}</span> → {show(c.to)}</div>)}</div></td></tr>}
            </>
          ))}</tbody>
        </table></div></Card>
      )}
      <LoadMore next={next} onMore={() => load(next)} />
    </div>
  );
}
