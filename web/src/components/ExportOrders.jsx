import { useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { ErrorBox, Modal, useAction, useAsync } from './ui.jsx';
import { exportQuery, num, STATUS, today } from '../lib.js';
import Icon from './Icon.jsx';

const LAYOUTS = [
  ['orders', 'Mỗi đơn một dòng', 'Tổng tiền, phí sàn, lợi nhuận của từng đơn. Hợp để xem sổ sách, đối soát tiền.'],
  ['lines', 'Mỗi sản phẩm một dòng', 'Từng sản phẩm trong đơn kèm SL, giá, giá vốn. Hợp để đối chiếu hàng hoá, kế toán.'],
];

const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');

/** Mô tả bộ lọc đang áp dụng, để người dùng biết file sẽ gồm những đơn nào */
function describe(filters, { shops, channels }) {
  const out = [];
  out.push(filters.shop_id ? `Shop: ${shops.find((s) => s.id === filters.shop_id)?.name || '—'}` : 'Tất cả shop');
  if (filters.status) out.push(`Trạng thái: ${filters.status.split(',').map((s) => STATUS[s] || s).join(', ')}`);
  if (filters.channel) out.push(`Kênh: ${channels.find((c) => c.id === filters.channel)?.name || filters.channel}`);
  if (filters.from || filters.to) out.push(`Ngày: ${filters.from ? dmy(filters.from) : '…'} → ${filters.to ? dmy(filters.to) : '…'}`);
  if (filters.q) out.push(`Tìm: “${filters.q}”`);
  return out;
}

/**
 * Xuất đơn hàng theo đúng bộ lọc đang xem. CSV tải thẳng từ server; Excel dựng ngay trên trình duyệt từ cùng dữ liệu.
 */
export default function ExportOrders({ filters, onClose }) {
  const { shops, allChannels: channels } = useSession();
  const [layout, setLayout] = useState('orders');
  const [format, setFormat] = useState('xlsx');
  const { busy, error, run } = useAction();
  const count = useAsync(() => api.get('/orders/export', { ...filters, format: 'count' }), [JSON.stringify(filters)]);
  const n = count.data?.data;
  const rows = n ? (layout === 'lines' ? n.lines : n.orders) : null;
  const tooMany = n && rows > n.max_rows;

  const go = () => run(async () => {
    const stamp = `${filters.from ? filters.from.replaceAll('-', '') : 'tat-ca'}${filters.to ? `-${filters.to.replaceAll('-', '')}` : ''}`; // khớp tên file CSV của server
    const base = `don-hang${layout === 'lines' ? '-chi-tiet' : ''}-${stamp}`;
    if (format === 'csv') {
      // Tải thẳng: trình duyệt gửi kèm cookie đăng nhập
      const a = Object.assign(document.createElement('a'), { href: `/api/v1/orders/export?${exportQuery(filters, { layout, format: 'csv' })}`, download: `${base}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      onClose();
      return;
    }
    const res = await api.get('/orders/export', { ...filters, layout, format: 'json' });
    const { headers, rows: data } = res.data;
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(40, Math.max(h.length + 2, ...data.slice(0, 200).map((r) => String(r[i] ?? '').length + 1))) }));
    ws['!freeze'] = { xSplit: 1, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, layout === 'lines' ? 'Chi tiết hàng' : 'Đơn hàng');
    XLSX.writeFile(wb, `${base}.xlsx`);
    onClose();
  });

  return (
    <Modal title="Xuất đơn hàng" onClose={onClose} footer={<button className="btn primary" disabled={busy || !rows || tooMany} onClick={go}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất {rows !== null ? `${num(rows)} dòng` : ''}</button>}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Gồm các đơn đang lọc</div>
        <div className="row wrap">{describe(filters, { shops, channels }).map((t) => <span key={t} className="badge plain">{t}</span>)}</div>
        <p className="small muted" style={{ margin: 0 }}>Đổi bộ lọc ở trang Đơn hàng rồi mở lại để xuất phần khác. {n && `Khớp ${num(n.orders)} đơn, ${num(n.lines)} dòng hàng.`}</p>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Kiểu file</div>
        {LAYOUTS.map(([v, label, hint]) => (
          <label key={v} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="radio" name="layout" checked={layout === v} onChange={() => setLayout(v)} />
            <span><b>{label}</b><div className="small muted">{hint}</div></span>
          </label>
        ))}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Định dạng</div>
        <div className="row wrap">
          {[['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)']].map(([v, l]) => <label key={v} className="check"><input type="radio" name="format" checked={format === v} onChange={() => setFormat(v)} />{l}</label>)}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Tiền là số nguyên đồng (cộng trực tiếp được). Ngày giờ theo giờ Việt Nam. CSV mở được bằng Excel, có đủ tiếng Việt.</p>
      </div>
      {tooMany && <div className="alert err small">Quá {num(n.max_rows)} dòng. Vui lòng thu hẹp khoảng ngày hoặc bộ lọc.</div>}
      {n && rows === 0 && <div className="alert warn small">Không có đơn nào khớp bộ lọc.</div>}
      <ErrorBox error={error} />
    </Modal>
  );
}
