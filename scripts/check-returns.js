// Báo các dòng đơn đã trả hết nhưng tổng giá trị ghi trên các phiếu trả lệch với tiền thực của dòng
// (phiếu cũ làm tròn riêng từng lần). Chỉ BÁO, không sửa số đã chụp: npm run check-returns
import { bootstrapTenancy, forEachAccount } from '../server/db/tenancy.js';
import { getDb } from '../server/db/index.js';

bootstrapTenancy();
let bad = 0;
await forEachAccount(async (a) => {
  const db = getDb();
  const lines = db.prepare('SELECT l.id, l.sku, l.qty, l.line_total - l.allocated_order_discount AS net, o.code FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.returned_qty = l.qty AND l.qty > 0').all();
  const sums = new Map();
  for (const r of db.prepare('SELECT lines FROM order_returns').all()) {
    for (const x of JSON.parse(r.lines)) sums.set(x.order_line_id, (sums.get(x.order_line_id) || 0) + x.value);
  }
  const off = lines.filter((l) => (sums.get(l.id) || 0) !== l.net);
  if (!off.length) return console.log(`[${a.username}] các dòng trả hết đều khớp`);
  bad++;
  console.log(`[${a.username}] ${off.length} dòng trả hết nhưng tổng lệch tiền thực:`);
  for (const l of off) console.log(`  ${l.code} ${l.sku}: tiền thực ${l.net}, đã ghi ${sums.get(l.id) || 0} (lệch ${(sums.get(l.id) || 0) - l.net})`);
});
if (bad) process.exitCode = 1;
