import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { notFound } from '../../lib/errors.js';

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

export function updateWarehouse(id, input, actor) {
  const before = getWarehouse(id);
  const next = { ...before, ...input, code: (input.code ?? before.code).toUpperCase(), updated_at: nowIso() };
  getDb()
    .prepare('UPDATE warehouses SET code=?, name=?, address=?, note=?, archived_at=?, updated_at=? WHERE id=?')
    .run(next.code, next.name, next.address, next.note, next.archived_at, next.updated_at, id);
  const after = getWarehouse(id);
  audit(actor, 'warehouse.updated', 'warehouse', id, before, after);
  return after;
}
