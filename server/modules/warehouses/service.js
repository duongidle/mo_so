import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { conflict, notFound } from '../../lib/errors.js';
import { setShopWarehouses, shopWarehouses } from '../shops/service.js';

export function getWarehouse(id) {
  const w = getDb().prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
  if (!w) throw notFound('Kho');
  return w;
}

export function listWarehouses({ includeArchived = false } = {}) {
  return getDb()
    .prepare(`SELECT * FROM warehouses ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at`)
    .all();
}

export function createWarehouse(input, actor) {
  const id = newId('whs');
  const at = nowIso();
  getDb()
    .prepare(
      'INSERT INTO warehouses (id, code, name, address, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(id, input.code.toUpperCase(), input.name, input.address ?? null, input.note ?? null, at, at);
  const w = getWarehouse(id);
  audit(actor, 'warehouse.created', 'warehouse', id, null, w);
  emit('warehouse.created', { entityType: 'warehouse', entityId: id, data: w });
  return w;
}

export function updateWarehouse(id, input, actor, { force = false } = {}) {
  const before = getWarehouse(id);
  const archiving = !!input.archived_at && !before.archived_at;
  const detached = [];
  if (archiving) {
    const shops = getDb()
      .prepare('SELECT s.id, s.name FROM shop_warehouses sw JOIN shops s ON s.id = sw.shop_id WHERE sw.warehouse_id = ? AND s.archived_at IS NULL ORDER BY s.name')
      .all(id);
    const only = shops.filter((s) => shopWarehouses(s.id).filter((w) => !w.archived_at).length <= 1);
    if (only.length) throw conflict('WAREHOUSE_LAST', `Không lưu trữ được: đây là kho duy nhất của shop ${only.map((s) => s.name).join(', ')}. Thêm kho khác cho shop trước`, { shops: only });
    if (shops.length && !force) throw conflict('WAREHOUSE_IN_USE', `Kho đang nằm trong danh sách kho của shop ${shops.map((s) => s.name).join(', ')}. Lưu trữ sẽ gỡ kho khỏi các shop này`, { shops });
    detached.push(...shops);
  }
  const next = { ...before, ...input, code: (input.code ?? before.code).toUpperCase(), updated_at: nowIso() };
  getDb()
    .prepare('UPDATE warehouses SET code=?, name=?, address=?, note=?, archived_at=?, updated_at=? WHERE id=?')
    .run(next.code, next.name, next.address, next.note, next.archived_at, next.updated_at, id);
  for (const sh of detached) {
    setShopWarehouses(sh.id, shopWarehouses(sh.id).map((w) => w.warehouse_id).filter((w) => w !== id), actor);
  }
  const after = getWarehouse(id);
  if (detached.length) audit(actor, 'warehouse.archived_detached', 'warehouse', id, before, { detached_from_shops: detached.map((x) => x.id) });
  audit(actor, 'warehouse.updated', 'warehouse', id, before, after);
  return after;
}
