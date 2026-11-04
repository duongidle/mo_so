// Đối chiếu tồn kho + giá vốn đơn hàng với sổ kho: npm run check-stock
// Báo lệch giữa stock_levels và stock_movements, giữa cogs_amount của dòng/đơn và các phân bổ xuất kho.
import { bootstrapTenancy, forEachAccount } from '../server/db/tenancy.js';
import { verifyStock } from '../server/modules/inventory/verify.js';

bootstrapTenancy();
let bad = 0;
await forEachAccount(async (a) => {
  const diff = verifyStock();
  if (!diff.length) return console.log(`[${a.username}] khớp`);
  bad++;
  console.log(`[${a.username}] LỆCH ${diff.length} chỗ:`);
  for (const d of diff.slice(0, 20)) console.log('  ', JSON.stringify(d));
});
if (bad) process.exitCode = 1;
