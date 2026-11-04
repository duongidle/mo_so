import { describe, it, expect } from 'vitest';
import { reconcile, assignCombo, hasDuplicateCombos, noteAttrRename, noteValueRename, effectiveRenames, comboChoices } from '../lib/matrix.js';

const old = (id, sku, ov) => ({ id, sku, option_values: ov, default_price: 100, active: true });

describe('ánh xạ biến thể đã có vào tổ hợp (reconcile)', () => {
  it('chưa nhập giá trị nào thì không đổi gì', () => {
    const rows = [old('v1', 'A')];
    expect(reconcile(rows, [{ name: 'Mùi', values: [] }], { base: 'X' })).toEqual({ rows, removed: [] });
  });
  it('sản phẩm một biến thể: biến thể cũ vào tổ hợp đầu tiên, giữ id/SKU/giá; tổ hợp còn lại thành dòng mới', () => {
    const r = reconcile([old('v1', 'A')], [{ name: 'Mùi', values: ['Cam', 'Chanh'] }], { base: 'X' });
    expect(r.removed).toEqual([]);
    expect(r.rows.map((x) => [x.id, x.sku, x.option_values])).toEqual([['v1', 'A', { Mùi: 'Cam' }], [undefined, 'X-CHANH', { Mùi: 'Chanh' }]]);
    expect(r.rows[0].default_price).toBe(100);
  });
  it('thêm thuộc tính mới: biến thể cũ nhận giá trị đầu của thuộc tính mới, giữ giá trị cũ', () => {
    const rows = [old('v1', 'A', { Mùi: 'Cam' }), old('v2', 'B', { Mùi: 'Chanh' })];
    const r = reconcile(rows, [{ name: 'Mùi', values: ['Cam', 'Chanh'] }, { name: 'Size', values: ['10ml', '30ml'] }], { base: 'X' });
    expect(r.rows.map((x) => [x.id, x.option_values])).toEqual([
      ['v1', { Mùi: 'Cam', Size: '10ml' }], [undefined, { Mùi: 'Cam', Size: '30ml' }],
      ['v2', { Mùi: 'Chanh', Size: '10ml' }], [undefined, { Mùi: 'Chanh', Size: '30ml' }],
    ]);
  });
  it('sản phẩm cũ nhiều biến thể: mỗi biến thể vào một tổ hợp khác nhau; thừa thì vào removed', () => {
    const rows = [old('v1', 'A'), old('v2', 'B'), old('v3', 'C')];
    const r = reconcile(rows, [{ name: 'Loại', values: ['1', '2'] }], { base: 'X' });
    expect(r.rows.map((x) => x.id)).toEqual(['v1', 'v2']);
    expect(r.removed.map((x) => x.id)).toEqual(['v3']);
  });
  it('bỏ giá trị: biến thể mang giá trị đó vào removed; xoá thuộc tính: khoá thừa bị bỏ', () => {
    const rows = [old('v1', 'A', { Mùi: 'Cam' }), old('v2', 'B', { Mùi: 'Chanh' })];
    const r = reconcile(rows, [{ name: 'Mùi', values: ['Cam'] }], { base: 'X' });
    expect(r.removed.map((x) => x.id)).toEqual(['v2']);
    const rows2 = [old('v1', 'A', { Mùi: 'Cam', Size: '10ml' })];
    expect(reconcile(rows2, [{ name: 'Mùi', values: ['Cam'] }], { base: 'X' }).rows[0].option_values).toEqual({ Mùi: 'Cam' });
  });
});

describe('chọn tổ hợp cho biến thể đã có', () => {
  const options = [{ name: 'Mùi', values: ['Cam', 'Chanh'] }];
  it('chuyển sang tổ hợp đang có dòng mới thì dòng mới bị bỏ, tổ hợp cũ sinh dòng mới', () => {
    const start = reconcile([old('v1', 'A')], options, { base: 'X' }).rows; // v1=Cam, mới=Chanh
    const r = assignCombo(start, options, 0, { Mùi: 'Chanh' }, { base: 'X' });
    expect(r.rows.map((x) => [x.id, x.option_values.Mùi])).toEqual([[undefined, 'Cam'], ['v1', 'Chanh']]);
  });
  it('hai biến thể đã có chọn trùng tổ hợp thì được báo trùng', () => {
    const rows = [old('v1', 'A', { Mùi: 'Cam' }), old('v2', 'B', { Mùi: 'Chanh' })];
    const r = assignCombo(rows, options, 1, { Mùi: 'Cam' }, { base: 'X' });
    expect(hasDuplicateCombos(r.rows, options)).toBe(true);
    expect(hasDuplicateCombos(rows, options)).toBe(false);
    expect(comboChoices(options).map((c) => c.label)).toEqual(['Cam', 'Chanh']);
  });
});

describe('ghi lại việc đổi nhãn', () => {
  it('đổi tên thuộc tính nhiều lần thành một bước từ tên gốc', () => {
    let r = noteAttrRename([], 'Mùi', 'Hương');
    r = noteAttrRename(r, 'Hương', 'Hương thơm');
    expect(r).toEqual([{ from: 'Mùi', to: 'Hương thơm', values: {} }]);
  });
  it('đổi tên giá trị theo tên hiện tại của thuộc tính, nối tiếp được', () => {
    let r = noteAttrRename([], 'Mùi', 'Hương');
    r = noteValueRename(r, 'Hương', 'Cam', 'Cam ngọt');
    r = noteValueRename(r, 'Hương', 'Cam ngọt', 'Cam vàng');
    expect(r).toEqual([{ from: 'Mùi', to: 'Hương', values: { Cam: 'Cam vàng' } }]);
    expect(effectiveRenames(r)).toEqual([{ from: 'Mùi', to: 'Hương', values: { Cam: 'Cam vàng' } }]);
  });
  it('đổi rồi đổi lại như cũ thì không gửi gì', () => {
    let r = noteValueRename([], 'Mùi', 'Cam', 'X');
    r = noteValueRename(r, 'Mùi', 'X', 'Cam');
    expect(effectiveRenames(r)).toEqual([]);
  });
});
