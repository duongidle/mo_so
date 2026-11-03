import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { forEachAccount } from '../db/tenancy.js';
import { nowIso } from '../lib/time.js';

// Lần thử 1 gửi ngay; thất bại thì chờ 1p, 5p, 30p, 2h, 12h cho các lần sau → tối đa 6 lần
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export const sign = (secret, body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

export function buildPayload(event) {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    created_at: event.created_at,
    shop_id: event.shop_id,
    entity: { type: event.entity_type, id: event.entity_id },
    data: JSON.parse(event.payload),
  });
}

/** Gửi một lượt. `fetchImpl` cho phép test mà không cần mạng. */
export async function deliver(delivery, fetchImpl = fetch) {
  const db = getDb();
  const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(delivery.webhook_id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(delivery.event_id);
  const attempts = delivery.attempts + 1;
  let status = 'success';
  let code = null;
  let error = null;
  let nextAt = delivery.next_attempt_at;

  if (!hook || !hook.active) {
    status = 'dead';
    error = 'Webhook đã tắt hoặc bị xoá';
  } else {
    const body = buildPayload(event);
    try {
      const res = await fetchImpl(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'MoSo-Webhook/1',
          'x-moso-event': event.type,
          'x-moso-delivery': delivery.id,
          'x-moso-signature': sign(hook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      code = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      error = String(e.message || e).slice(0, 300);
      if (attempts >= MAX_ATTEMPTS) status = 'dead';
      else {
        status = 'failed';
        nextAt = new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString();
      }
    }
  }
  db.prepare(
    'UPDATE webhook_deliveries SET status=?, attempts=?, last_status_code=?, last_error=?, next_attempt_at=?, updated_at=? WHERE id=?',
  ).run(status, attempts, code, error, nextAt, nowIso(), delivery.id);
  return { id: delivery.id, status, attempts, code, error };
}

/** Xử lý các lượt gửi đã đến hạn */
export async function processDue({ fetchImpl = fetch, limit = 20 } = {}) {
  const due = getDb()
    .prepare(`SELECT * FROM webhook_deliveries WHERE status IN ('pending','failed') AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`)
    .all(nowIso(), limit);
  const out = [];
  for (const d of due) out.push(await deliver(d, fetchImpl));
  return out;
}

export function startWebhookWorker({ intervalMs = 5000 } = {}) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await forEachAccount(() => processDue()); // mỗi tài khoản có hàng đợi webhook riêng
    } catch (e) {
      console.error('Webhook worker lỗi:', e);
    } finally {
      busy = false;
    }
  }, intervalMs);
  t.unref();
  return t;
}
