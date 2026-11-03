import { useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { ErrorBox, Modal, useAction, useAsync } from './ui.jsx';
import { exportQuery, num } from '../lib.js';
import Icon from './Icon.jsx';

/** Mô tả bộ lọc đang áp dụng để biết file gồm những khách nào */
function describe(filters, shops) {
  const out = [filters.shop_id ? `Shop: ${shops.find((s) => s.id === filters.shop_id)?.name || '—'}` : 'Tất cả shop'];
  if (filters.tag) out.push(`Nhãn: ${filters.tag}`);
  if (filters.element) out.push(`Mệnh: ${filters.element}`);
  if (filters.q) out.push(`Tìm: “${filters.q}”`);
  return out;
}

/**
 * Xuất danh sách khách theo đúng bộ lọc đang xem. CSV tải thẳng từ server; Excel dựng trên trình duyệt từ cùng dữ liệu.
 * Chọn một shop: file có thông tin riêng, nhãn, mệnh và số liệu của shop đó. Tất cả shop: chỉ thông tin chung.
 */
export default function ExportCustomers({ filters, onClose }) {
  const { shops } = useSession();
  const [format, setFormat] = useState('xlsx');
  const { busy, error, run } = useAction();
  const preview = useAsync(() => api.get('/customers/export', { ...filters, format: 'json' }), [JSON.stringify(filters)]);
  const d = preview.data?.data;
  const shop = shops.find((s) => s.id === filters.shop_id);

  const go = () => run(async () => {
    const base = `khach-hang-${shop ? `${shop.code.toLowerCase()}-` : ''}${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
    if (format === 'csv') {
      const a = Object.assign(document.createElement('a'), { href: `/api/v1/customers/export?${exportQuery(filters, { format: 'csv' })}`, download: `${base}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      onClose();
      return;
    }
    const ws = XLSX.utils.aoa_to_sheet([d.headers, ...d.rows]);
    ws['!cols'] = d.headers.map((h, i) => ({ wch: Math.min(40, Math.max(h.length + 2, ...d.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 1))) }));
    ws['!freeze'] = { xSplit: 2, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Khách hàng');
    XLSX.writeFile(wb, `${base}.xlsx`);
    onClose();
  });

  return (
    <Modal title="Xuất danh sách khách" onClose={onClose} footer={<button className="btn primary" disabled={busy || !d || d.count === 0} onClick={go}><Icon name="upload" style={{ transform: 'rotate(180deg)' }} />Xuất {d ? `${num(d.count)} khách` : ''}</button>}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Gồm các khách đang lọc</div>
        <div className="row wrap">{describe(filters, shops).map((t) => <span key={t} className="badge plain">{t}</span>)}</div>
        <p className="small muted" style={{ margin: 0 }}>Đổi bộ lọc ở trang Khách hàng rồi mở lại để xuất phần khác.</p>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Các cột trong file</div>
        {preview.loading && !d ? <span className="muted small">Đang đếm…</span> : d && <p className="small" style={{ margin: 0 }}>{d.headers.join(' · ')}</p>}
        <p className="small muted" style={{ margin: 0 }}>
          {shop ? `Có thông tin riêng, nhãn và số liệu mua hàng tại ${shop.name}. Dữ liệu riêng của shop khác không có trong file.` : 'Đang chọn tất cả shop nên file chỉ có thông tin chung và số liệu tổng. Chọn một shop để xuất thêm thông tin riêng và nhãn của shop đó.'}
        </p>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Định dạng</div>
        <div className="row wrap">
          {[['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)']].map(([v, l]) => <label key={v} className="check"><input type="radio" name="cformat" checked={format === v} onChange={() => setFormat(v)} />{l}</label>)}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Tiền là số nguyên đồng. Ngày theo giờ Việt Nam. File chứa số điện thoại và địa chỉ khách: giữ cẩn thận.</p>
      </div>
      {d && d.count === 0 && <div className="alert warn small">Không có khách nào khớp bộ lọc.</div>}
      <ErrorBox error={error || preview.error} />
    </Modal>
  );
}
