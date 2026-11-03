import { getShop } from '../shops/service.js';

const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

/** Phiếu bán hàng (chứng từ nội bộ, KHÔNG phải hoá đơn GTGT). size: a5 | 80mm */
export function renderReceipt(o, size = 'a5') {
  const shop = getShop(o.shop_id);
  const width = size === '80mm' ? '72mm' : '138mm';
  const rows = o.lines
    .map(
      (l) => `<tr><td>${esc(l.name)}<div class="sku">${esc(l.sku)}</div></td><td class="r">${l.qty}</td><td class="r">${vnd(l.unit_price)}</td><td class="r">${vnd(l.line_total)}</td></tr>${
        l.discount_amount ? `<tr class="muted"><td colspan="3">Giảm giá dòng</td><td class="r">-${vnd(l.discount_amount)}</td></tr>` : ''
      }`,
    )
    .join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu ${esc(o.code)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:0;padding:12px;background:#f4f4f5}
  .paper{width:${width};max-width:100%;margin:0 auto;background:#fff;padding:14px 16px;font-size:${size === '80mm' ? '11px' : '12.5px'}}
  h1{font-size:1.35em;margin:0 0 2px;text-align:center} .c{text-align:center} .muted{color:#666} .r{text-align:right}
  .meta{margin:10px 0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px}
  table{width:100%;border-collapse:collapse;margin-top:6px} th,td{padding:4px 0;vertical-align:top} th{border-bottom:1px solid #111;text-align:left;font-weight:600}
  .sku{font-size:.85em;color:#777} tbody tr:not(.muted) td{border-bottom:1px dashed #ddd}
  .tot{margin-top:8px} .tot div{display:flex;justify-content:space-between;padding:2px 0} .big{font-weight:700;font-size:1.15em;border-top:1px solid #111;margin-top:4px;padding-top:6px!important}
  .foot{margin-top:14px;text-align:center;font-style:italic} .note{font-size:.85em;color:#888;text-align:center;margin-top:8px}
  .actions{text-align:center;margin:12px} button{font-size:15px;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff}
  @media print{body{background:#fff;padding:0}.actions{display:none}.paper{width:auto;padding:0}}
</style></head><body>
<div class="paper">
  <h1>${esc(shop.name)}</h1>
  ${shop.address ? `<div class="c muted">${esc(shop.address)}</div>` : ''}
  ${shop.phone ? `<div class="c muted">ĐT: ${esc(shop.phone)}</div>` : ''}
  <h2 class="c" style="font-size:1.1em;margin:12px 0 0">PHIẾU BÁN HÀNG</h2>
  <div class="meta">
    <span class="muted">Số phiếu</span><span>${esc(o.code)}</span>
    <span class="muted">Ngày</span><span>${fmtDate(o.ordered_at)}</span>
    ${o.customer_name ? `<span class="muted">Khách</span><span>${esc(o.customer_name)}${o.customer_phone ? ' · ' + esc(o.customer_phone) : ''}</span>` : ''}
    ${o.shipping_address ? `<span class="muted">Địa chỉ</span><span>${esc(o.shipping_address)}</span>` : ''}
  </div>
  <table><thead><tr><th>Sản phẩm</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">T.tiền</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="tot">
    <div><span>Tiền hàng</span><span>${vnd(o.subtotal - o.line_discount_amount)}</span></div>
    ${o.discount_amount ? `<div><span>Giảm giá</span><span>-${vnd(o.discount_amount)}</span></div>` : ''}
    ${o.shipping_fee ? `<div><span>Phí vận chuyển</span><span>${vnd(o.shipping_fee)}</span></div>` : ''}
    <div class="big"><span>Tổng cộng</span><span>${vnd(o.total_amount)} ₫</span></div>
    ${o.returned_amount ? `<div><span>Hàng trả lại</span><span>-${vnd(o.returned_amount)}</span></div>` : ''}
    <div><span>Đã thanh toán</span><span>${vnd(o.paid_amount)}</span></div>
    ${o.amount_due ? `<div><span><b>Còn phải trả</b></span><span><b>${vnd(o.amount_due)}</b></span></div>` : ''}
  </div>
  ${o.note ? `<div style="margin-top:8px">Ghi chú: ${esc(o.note)}</div>` : ''}
  <div class="foot">${esc(shop.receipt_footer || 'Cảm ơn quý khách!')}</div>
  <div class="note">Phiếu bán hàng nội bộ — không thay thế hoá đơn GTGT.</div>
</div>
<div class="actions"><button onclick="window.print()">In phiếu</button></div>
</body></html>`;
}
