import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { lastSlot, nextSlot, backupDue } from '../server/jobs/backup.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const cfg = (o = {}) => ({ enabled: true, time: '02:00', frequency: 'daily', weekday: 1, keep_days: 14, keep_weeks: 8, include_images: true, ...o });
const vn = (s) => new Date(`${s}+07:00`);

test('lịch sao lưu mỗi ngày: mốc gần nhất và mốc tiếp theo theo giờ Việt Nam', () => {
  const now = vn('2026-11-08T10:00:00');
  assert.equal(lastSlot(now, cfg()).toISOString(), vn('2026-11-08T02:00:00').toISOString());
  assert.equal(nextSlot(now, cfg()).toISOString(), vn('2026-11-09T02:00:00').toISOString());
  // trước giờ hẹn thì mốc gần nhất là của hôm qua
  const early = vn('2026-11-08T01:00:00');
  assert.equal(lastSlot(early, cfg()).toISOString(), vn('2026-11-07T02:00:00').toISOString());
});

test('lịch mỗi tuần: chỉ vào đúng thứ đã chọn', () => {
  // 2026-11-08 là Chủ nhật; chọn thứ Hai (1)
  const now = vn('2026-11-08T10:00:00');
  assert.equal(lastSlot(now, cfg({ frequency: 'weekly', weekday: 1 })).toISOString(), vn('2026-11-02T02:00:00').toISOString());
  assert.equal(nextSlot(now, cfg({ frequency: 'weekly', weekday: 1 })).toISOString(), vn('2026-11-09T02:00:00').toISOString());
});

test('đến hạn khi qua mốc mà chưa có bản mới; tắt thì không bao giờ đến hạn', () => {
  const now = vn('2026-11-08T10:00:00');
  const old = [{ name: 'a', created_at: vn('2026-11-07T02:00:10').toISOString() }];
  const fresh = [{ name: 'b', created_at: vn('2026-11-08T02:00:10').toISOString() }];
  assert.equal(backupDue(now, cfg(), old), true);
  assert.equal(backupDue(now, cfg(), fresh), false);
  assert.equal(backupDue(now, cfg(), []), true);
  assert.equal(backupDue(now, cfg({ enabled: false }), old), false);
  // đổi giờ hẹn sang sau hiện tại thì chưa đến hạn
  assert.equal(backupDue(vn('2026-11-08T10:00:00'), cfg({ time: '23:00' }), [{ created_at: vn('2026-11-07T23:00:30').toISOString() }]), false);
});

test('cài đặt sao lưu: kiểm tra giá trị, trả lịch và lần tới, giữ số bản theo cài đặt', async () => {
  const { api } = await setup();
  for (const bad of [{ backup_time: '25:00' }, { backup_time: '2:00' }, { backup_frequency: 'hourly' }, { backup_weekday: 8 }, { backup_keep_days: 0 }, { backup_enabled: 'yes' }]) {
    assert.equal((await api.patch('/settings', bad)).status, 400, JSON.stringify(bad));
  }
  ok(await api.patch('/settings', { backup_time: '03:30', backup_frequency: 'weekly', backup_weekday: 3, backup_keep_days: 3, backup_include_images: false }));
  const st = ok(await api.get('/system/backup/status'));
  assert.equal(st.config.time, '03:30');
  assert.equal(st.config.frequency, 'weekly');
  assert.equal(st.config.include_images, false);
  assert.ok(st.next_at);
  assert.equal(new Date(st.next_at).getTime() > Date.now(), true);
  // sao lưu ngay vẫn chạy và hiện trong lịch
  ok(await api.post('/system/backups'));
  assert.ok(ok(await api.get('/system/backup/status')).last_backup_at);
  ok(await api.patch('/settings', { backup_enabled: false }));
  assert.equal(ok(await api.get('/system/backup/status')).next_at, null);
});
