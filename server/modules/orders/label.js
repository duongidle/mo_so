import { getShop } from '../shops/service.js';
import { code128Svg } from '../../lib/code128.js';

const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function labelHtml(o) {
  const shop = getShop(o.shop_id);
  const ship = o.shipments?.[o.shipments.length - 1] ?? null;
  const code = ship?.tracking_code || o.tracking_code || o.code; // chưa có mã vận đơn thì in mã đơn để quét
  const cod = ship ? ship.cod_amount : o.is_marketplace ? 0 : o.amount_due;
  const items = o.lines.map((l) => `${esc(l.sku)} × ${l.qty}`).join(', ');
  return `<section class="label">
  <header><b>${esc(ship?.carrier_name || o.carrier || 'Giao hàng')}</b><span>${esc(o.code)}</span></header>
  <div class="bar">${code128Svg(code, { module: 2, height: 54 })}<div class="code">${esc(code)}</div></div>
  <div class="box"><div class="cap">Người nhận</div><div class="name">${esc(o.customer_name || 'Khách lẻ')}${o.customer_phone ? ` · ${esc(o.customer_phone)}` : ''}</div><div>${esc(o.shipping_address || '(chưa có địa chỉ giao)')}</div></div>
  <div class="box from"><div class="cap">Người gửi</div><div><b>${esc(shop.name)}</b>${shop.phone ? ` · ${esc(shop.phone)}` : ''}</div>${shop.address ? `<div>${esc(shop.address)}</div>` : ''}</div>
  <div class="cod ${cod > 0 ? '' : 'paid'}">${cod > 0 ? `Thu hộ (COD): <b>${vnd(cod)} ₫</b>` : 'Đã thanh toán, không thu hộ'}</div>
  <div class="items"><span class="cap">Hàng:</span> ${items}</div>
  ${o.note ? `<div class="items"><span class="cap">Ghi chú:</span> ${esc(o.note)}</div>` : ''}
</section>`;
}

/** Nhãn giao hàng khổ 100×150 mm (A6 dọc) cho một hay nhiều đơn: mã vạch mã vận đơn, người nhận, người gửi, tiền thu hộ, hàng trong đơn. */
export function renderLabels(orders) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhãn giao hàng</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page{size:100mm 150mm;margin:0}
  *{box-sizing:border-box} body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#000;margin:0;background:#eee;font-size:12px}
  .label{width:100mm;height:150mm;margin:8px auto;padding:5mm;background:#fff;display:flex;flex-direction:column;gap:3mm;overflow:hidden;page-break-after:always;break-after:page}
  header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:2mm;font-size:15px}
  .bar{text-align:center} .code{font-size:14px;font-weight:700;letter-spacing:.08em;margin-top:1mm}
  .box{border:1px solid #000;padding:2mm 3mm;line-height:1.35} .box .name{font-size:15px;font-weight:700}
  .from{font-size:11px} .cap{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#444}
  .cod{border:2px solid #000;padding:3mm;font-size:15px;text-align:center} .cod b{font-size:22px} .cod.paid{font-size:13px;border-style:dashed}
  .items{font-size:11px;line-height:1.35}
  .actions{text-align:center;margin:12px} button{font-size:15px;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff}
  @media print{body{background:#fff}.label{margin:0}.actions{display:none}}
</style></head><body>
<div class="actions"><button onclick="window.print()">In ${orders.length > 1 ? `${orders.length} nhãn` : 'nhãn'}</button></div>
${orders.map(labelHtml).join('\n')}
</body></html>`;
}
