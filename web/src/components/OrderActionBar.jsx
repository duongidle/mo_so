import { Link } from 'react-router-dom';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover.jsx';
import { emptyReturnForm } from '../pages/ReturnModal.jsx';
import { codRefusedForm } from '../lib/returnForm.js';
import { vnd } from '../lib.js';

/** Việc cần làm tiếp theo của đơn: một nút chính, tối đa một lựa chọn thay thế, rồi tiền, rồi menu "Khác".
 *  Nút chính luôn khớp bước đang sáng ở thanh tiến trình. */
export function nextStep(o, { onStatus, onModal, onReturn }) {
  if (o.status === 'draft') return { main: { label: 'Xác nhận đơn', run: () => onStatus('confirmed') }, hint: 'Xác nhận sẽ trừ kho và chụp giá vốn.' };
  if (o.status === 'confirmed') {
    const ship = o.is_marketplace
      ? { label: 'Chuyển sang đang giao', run: () => onStatus('shipping') }
      : { label: 'Giao cho hãng vận chuyển', run: () => onModal('ship') };
    if (!o.packaged_at) {
      return {
        main: { label: 'Xác nhận đóng gói', run: () => onModal('packaging') },
        alt: { label: 'Bỏ qua đóng gói, giao luôn', run: ship.run },
        hint: 'Ghi vật tư đã dùng để trừ kho vật tư. Đơn không dùng vật tư thì bỏ qua.',
      };
    }
    return { main: ship, hint: o.is_marketplace ? 'Sàn lo vận chuyển, chỉ cần đánh dấu đang giao.' : 'Chọn hãng, nhập mã vận đơn và tiền COD.' };
  }
  if (o.status === 'shipping') {
    return {
      main: { label: 'Hoàn thành đơn', run: () => onStatus('completed') },
      alt: { label: 'Giao không thành', danger: true, run: () => onReturn(codRefusedForm(o, emptyReturnForm(o.is_marketplace))) },
      hint: 'Bấm khi khách đã nhận hàng. Khách không nhận thì dùng “Giao không thành”.',
    };
  }
  return {};
}

export default function OrderActionBar({ o, busy, refundMax, onStatus, onModal, onReturn, onAllowance, onPay, onRefund, onCancel }) {
  const { main, alt, hint } = nextStep(o, { onStatus, onModal, onReturn });
  const live = ['confirmed', 'shipping', 'completed'].includes(o.status);
  const menu = [
    ['draft', 'confirmed'].includes(o.status) && { label: 'Sửa đơn', to: `/orders/${o.id}/edit` },
    o.status === 'draft' && { label: o.reserve_stock ? 'Đang giữ hàng' : 'Giữ hàng', run: () => onModal('reserve') },
    ['draft', 'confirmed'].includes(o.status) && (o.lines.length > 1 || o.lines[0]?.qty > 1) && { label: 'Tách đơn (giao từng phần)', run: () => onModal('split') },
    o.status === 'confirmed' && !o.packaged_at && main?.label !== 'Xác nhận đóng gói' && { label: 'Xác nhận đóng gói', run: () => onModal('packaging') },
    o.status === 'confirmed' && { label: 'Giao tại chỗ, hoàn thành ngay', run: () => onStatus('completed') },
    live && { label: 'Trả hàng', run: () => onReturn(emptyReturnForm(o.is_marketplace)) },
    live && onAllowance && { label: 'Giảm giá sau bán / bồi thường', run: onAllowance },
    live && !o.is_marketplace && o.customer_id && { label: 'Đổi hàng', run: () => onModal('exchange') },
    live && o.packaged_at && { label: 'Vật tư đóng gói đã ghi', run: () => onModal('packaging') },
    { label: 'In phiếu bán hàng', href: `/api/v1/orders/${o.id}/receipt` },
    live && !o.is_marketplace && { label: 'In nhãn giao hàng', href: `/api/v1/orders/${o.id}/label` },
    ['draft', 'confirmed'].includes(o.status) && { label: 'Huỷ đơn', danger: true, run: onCancel },
  ].filter(Boolean);
  const canPay = o.amount_due > 0 && !['cancelled', 'draft'].includes(o.status);
  return (
    <div className="stack order-actions no-print" style={{ gap: 8 }}>
      <div className="row wrap">
        {main && <button className="btn primary" disabled={busy} onClick={main.run}>{main.label}</button>}
        {alt && <button className={`btn${alt.danger ? ' danger' : ''}`} disabled={busy} onClick={alt.run}>{alt.label}</button>}
        {canPay && <button className="btn" onClick={onPay}>Thu tiền ({vnd(o.amount_due)})</button>}
        {refundMax > 0 && <button className="btn" onClick={onRefund}>Hoàn tiền ({vnd(refundMax)})</button>}
        <Popover>
          <PopoverTrigger asChild><button type="button" className="btn order-more" aria-label="Thao tác khác">Khác ▾</button></PopoverTrigger>
          <PopoverContent className="order-menu" align="end" role="menu">
            {menu.map((m) => {
              const cls = `order-menu-item${m.danger ? ' danger' : ''}`;
              if (m.to) return <PopoverClose asChild key={m.label}><Link className={cls} role="menuitem" to={m.to}>{m.label}</Link></PopoverClose>;
              if (m.href) return <PopoverClose asChild key={m.label}><a className={cls} role="menuitem" href={m.href} target="_blank" rel="noreferrer">{m.label}</a></PopoverClose>;
              return <PopoverClose asChild key={m.label}><button type="button" className={cls} role="menuitem" onClick={m.run}>{m.label}</button></PopoverClose>;
            })}
          </PopoverContent>
        </Popover>
      </div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}
