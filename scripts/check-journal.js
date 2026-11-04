// Kiểm tra sổ cái kế toán (bút toán tự động) có khớp chứng từ gốc không và mọi bút toán có cân không: npm run check-journal [-- --fix]
// --fix: dựng lại toàn bộ bút toán tự động từ chứng từ nếu phát hiện lệch. Bút toán tay không bị đụng.
import { bootstrapTenancy, forEachAccount } from '../server/db/tenancy.js';
import { verifyJournal, rebuildJournal } from '../server/modules/accounting/journal.js';

const fix = process.argv.includes('--fix');
bootstrapTenancy();
let bad = 0;
await forEachAccount(async (a) => {
  const diff = verifyJournal();
  if (!diff.length) return console.log(`[${a.username}] khớp`);
  bad++;
  console.log(`[${a.username}] LỆCH ${diff.length} chứng từ:`);
  for (const d of diff.slice(0, 10)) console.log('  ', d.key, d.problem, d.detail || '');
  if (fix) console.log(`  đã dựng lại ${rebuildJournal()} chứng từ`);
});
if (bad && !fix) {
  console.log('Chạy lại với --fix để dựng lại sổ.');
  process.exitCode = 1;
}
