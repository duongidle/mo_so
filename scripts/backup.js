// Sao lưu tay DB đang chạy (an toàn khi server đang mở): node scripts/backup.js
import { runBackup } from '../server/jobs/backup.js';

const r = await runBackup();
console.log(`Đã sao lưu: ${r.file}`);
if (r.pruned.length) console.log(`Đã dọn ${r.pruned.length} bản cũ.`);
console.log('Nên copy thư mục data/backups lên Google Drive/iCloud để phòng mất máy.');
