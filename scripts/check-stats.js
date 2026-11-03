// Kiểm tra bảng tổng hợp báo cáo (daily_stats) có khớp bảng đơn không: npm run check-stats [-- --fix]
// --fix: dựng lại toàn bộ từ bảng đơn nếu phát hiện lệch. Bảng này chỉ là bộ nhớ đệm nên dựng lại không mất dữ liệu.
import { bootstrapTenancy, forEachAccount } from '../server/db/tenancy.js';
import { verifyStats, rebuildStats } from '../server/modules/reports/stats.js';

const fix = process.argv.includes('--fix');
bootstrapTenancy();
let bad = 0;
await forEachAccount(async (a) => {
  const diff = verifyStats();
  if (!diff.length) return console.log(`[${a.username}] khớp`);
  bad++;
  console.log(`[${a.username}] LỆCH ${diff.length} ô:`);
  for (const d of diff.slice(0, 10)) console.log('  ', d.key, JSON.stringify({ cần: d.expected, đang_có: d.cached }));
  if (fix) console.log(`  đã dựng lại ${rebuildStats()} ô`);
});
if (bad && !fix) {
  console.log('Chạy lại với --fix để dựng lại bảng.');
  process.exitCode = 1;
}
