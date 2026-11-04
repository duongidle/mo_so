// Báo kết quả gom ngày/năm sinh về hồ sơ khách (migration 028): npm run check-birthdates
//  - ca lệch: các shop ghi ngày/năm sinh khác nhau cho cùng một khách (hoặc khác giá trị cũ trên hồ sơ) → giá trị nào đã được chọn;
//  - công thức đã được viết lại;
//  - công thức còn nhắc tới trường ngày/năm sinh cũ đã ẩn (cần sửa tay; thoát với mã 1).
// Chỉ BÁO, không sửa gì.
import { bootstrapTenancy, forEachAccount } from '../server/db/tenancy.js';
import { getDb } from '../server/db/index.js';
import { parse, refsOf } from '../server/lib/formula.js';

bootstrapTenancy();
let bad = 0;
await forEachAccount(async (a) => {
  const db = getDb();
  const shopName = new Map(db.prepare('SELECT id, name FROM shops').all().map((s) => [s.id, s.name]));
  const custName = (id) => db.prepare('SELECT code, name FROM customers WHERE id = ?').get(id);
  console.log(`[${a.username}]`);

  const conflicts = db.prepare("SELECT action, entity_id, before, after FROM audit_log WHERE action IN ('customer.birth_date_conflict','customer.birth_year_conflict') ORDER BY created_at, entity_id").all();
  if (!conflicts.length) console.log('  Không có ca lệch ngày/năm sinh giữa các shop.');
  else {
    console.log(`  ${conflicts.length} ca lệch (đã chọn giá trị của shop phong thuỷ trước, rồi shop lập trước; giá trị khác vẫn nằm trong trường đã ẩn):`);
    for (const c of conflicts) {
      const b = JSON.parse(c.before), af = JSON.parse(c.after);
      const kind = c.action.includes('year') ? 'năm sinh' : 'ngày sinh';
      const k = custName(c.entity_id);
      const picked = af.birth_date ?? af.birth_year;
      const list = [...(b.profile != null ? [`hồ sơ cũ: ${b.profile}`] : []), ...b.shops.map((s) => `${shopName.get(s.shop_id) ?? s.shop_id}: ${s.value}`)].join(' | ');
      console.log(`  - ${k?.code ?? c.entity_id} ${k?.name ?? ''} (${kind}) chọn ${picked} từ ${shopName.get(af.from_shop) ?? af.from_shop}; ${list}`);
    }
  }

  const rewritten = db.prepare("SELECT entity_id, before, after FROM audit_log WHERE action = 'custom_field.formula_rewritten' ORDER BY created_at").all();
  if (!rewritten.length) console.log('  Không có công thức nào bị viết lại.');
  else {
    console.log(`  ${rewritten.length} công thức đã viết lại:`);
    for (const r of rewritten) {
      const b = JSON.parse(r.before);
      console.log(`  - “${b.label}”: ${b.formula}  =>  ${JSON.parse(r.after).formula}`);
    }
  }

  const old = db.prepare("SELECT shop_id, key, label FROM custom_fields WHERE entity_type = 'customer' AND role IN ('birth_date','birth_year') AND archived_at IS NOT NULL").all();
  const stale = [];
  for (const f of db.prepare("SELECT id, shop_id, label, formula FROM custom_fields WHERE entity_type = 'customer' AND type = 'formula' AND formula IS NOT NULL").all()) {
    let refs;
    try { refs = refsOf(parse(f.formula)); } catch { continue; }
    for (const o of old) if (o.shop_id === f.shop_id && refs.has(`custom.${o.key}`)) stale.push({ f, o });
  }
  if (stale.length) {
    bad++;
    console.log('  Công thức còn dùng trường ngày/năm sinh cũ đã ẩn (hãy đổi sang {birth_date} / {birth_year}):');
    for (const { f, o } of stale) console.log(`  - ${shopName.get(f.shop_id) ?? f.shop_id}: “${f.label}” = ${f.formula} (trường cũ “${o.label}”)`);
  } else console.log('  Không còn công thức nào dùng trường ngày/năm sinh cũ.');
});
if (bad) process.exitCode = 1;
