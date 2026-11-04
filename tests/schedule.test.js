import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampedDate, addMonths, periodKey, dueDates, listDue, depreciationSchedule, postedPeriods, assetStatus, mondayOf } from '../server/lib/schedule.js';

test('Ngày cuối tháng: 31/2 lấy ngày cuối tháng, năm nhuận', () => {
  assert.equal(clampedDate(2027, 2, 31), '2027-02-28');
  assert.equal(clampedDate(2028, 2, 31), '2028-02-29');
  assert.equal(clampedDate(2027, 4, 31), '2027-04-30');
  assert.equal(clampedDate(2027, 1, 31), '2027-01-31');
  assert.deepEqual(addMonths(2027, 11, 3), [2028, 2]);
  assert.deepEqual(addMonths(2027, 1, -1), [2026, 12]);
});

test('Chi phí hằng tháng ngày 31: mỗi tháng đúng một kỳ, tháng ngắn lấy ngày cuối', () => {
  const rec = { frequency: 'monthly', day_of_period: 31, start_date: '2027-01-15', end_date: null };
  assert.deepEqual(listDue(rec, { limit: 5 }), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  assert.deepEqual(listDue({ ...rec, start_date: '2027-02-01', day_of_period: 10 }, { upTo: '2027-04-09' }), ['2027-02-10', '2027-03-10']);
  assert.deepEqual(listDue({ ...rec, end_date: '2027-03-15' }), ['2027-01-31', '2027-02-28']);
  assert.deepEqual(listDue(rec, { limit: 2, notBefore: '2027-03-01' }), ['2027-03-31', '2027-04-30']);
});

test('Chi phí hằng tuần và hằng năm', () => {
  // 2027-01-06 là thứ Tư; thứ Hai (1) của tuần đó là 2027-01-04 < start nên bỏ
  const w = { frequency: 'weekly', day_of_period: 1, start_date: '2027-01-06', end_date: null };
  assert.deepEqual(listDue(w, { limit: 3 }), ['2027-01-11', '2027-01-18', '2027-01-25']);
  assert.equal(mondayOf('2027-01-10'), '2027-01-04');
  assert.equal(periodKey('weekly', '2027-01-10'), 'W2027-01-04');
  const y = { frequency: 'yearly', day_of_period: 29, start_date: '2027-02-01', end_date: null };
  assert.deepEqual(listDue(y, { limit: 3 }), ['2027-02-28', '2028-02-29', '2029-02-28']);
  assert.equal(periodKey('monthly', '2027-03-31'), '2027-03');
  assert.equal(periodKey('yearly', '2027-03-31'), '2027');
  assert.equal([...dueDates({ ...y, end_date: '2027-12-31' })].length, 1, 'có ngày kết thúc thì hữu hạn');
});

test('Lịch khấu hao: tổng các kỳ đúng bằng nguyên giá, kỳ ghi vào ngày cuối tháng', () => {
  for (const [cost, months] of [[1000000, 3], [1200000, 12], [100, 7], [1, 5], [999999, 36]]) {
    const s = depreciationSchedule({ cost, months, start_date: '2027-01-31' });
    assert.equal(s.length, months);
    assert.equal(s.reduce((a, p) => a + p.amount, 0), cost);
    assert.ok(Math.max(...s.map((p) => p.amount)) - Math.min(...s.map((p) => p.amount)) <= 1);
  }
  const s = depreciationSchedule({ cost: 1000000, months: 14, start_date: '2027-12-10' });
  assert.deepEqual([s[0].date, s[1].date, s[2].date, s[13].date], ['2027-12-31', '2028-01-31', '2028-02-29', '2029-01-31']);
});

test('Chỉ hạch toán các tháng đã qua; thanh lý dừng khấu hao', () => {
  const a = { cost: 1200000, months: 12, start_date: '2027-02-01', disposed_at: null };
  assert.equal(postedPeriods(a, '2027-02-27').length, 0);
  assert.equal(postedPeriods(a, '2027-02-28').length, 1);
  assert.equal(postedPeriods(a, '2027-06-15').length, 4);
  assert.deepEqual(assetStatus(a, '2027-06-15'), { accumulated: 400000, remaining: 800000, disposed: false, disposal_loss: 0, posted_count: 4 });
  const d = { ...a, disposed_at: '2027-05-15' };
  assert.equal(postedPeriods(d, '2027-12-31').length, 3, 'tháng 5 chưa trọn tại ngày thanh lý');
  assert.deepEqual(assetStatus(d, '2027-12-31'), { accumulated: 300000, remaining: 0, disposed: true, disposal_loss: 900000, posted_count: 3 });
  assert.equal(assetStatus(d, '2027-05-01').disposed, false, 'chưa tới ngày thanh lý');
  assert.equal(postedPeriods(a, '2030-01-01').length, 12, 'không quá số tháng');
});
