import { describe, it, expect } from 'vitest';
import { slug, skuBase, skuFor, combinations, cleanOptions, mergeRows, applyToAll, dedupeSkus, rebaseSkus } from '../lib/matrix.js';
import { fitSize } from '../lib/image.js';
import { flattenTree, descendantIds } from '../lib/categories.js';

describe('slug và mã SKU', () => {
  it('bỏ dấu tiếng Việt, viết hoa, gạch nối', () => {
    expect(slug('Cam bergamot 10ml')).toBe('CAM-BERGAMOT-10ML');
    expect(slug('Đàn hương – Trầm')).toBe('DAN-HUONG-TRAM');
    expect(slug('  ??  ')).toBe('');
  });
  it('mã gốc ngắn gọn từ tên sản phẩm; tên rỗng thì SP', () => {
    expect(skuBase('Tinh dầu thơm xe')).toBe('TINHDAUT');
    expect(skuBase('')).toBe('SP');
  });
  it('SKU = mã gốc + giá trị thuộc tính', () => {
    expect(skuFor('MAGOC', ['Cam', '10ml'])).toBe('MAGOC-CAM-10ML');
  });
  it('làm SKU duy nhất bằng hậu tố, không đụng dòng đầu', () => {
    expect(dedupeSkus(['A-B', 'a-b', 'A-B', 'C'])).toEqual(['A-B', 'a-b-2', 'A-B-3', 'C']);
  });
});

describe('bảng tổ hợp', () => {
  const options = [{ name: 'Mùi', values: ['Cam', 'Chanh'] }, { name: 'Size', values: ['10ml', '30ml'] }];
  it('2×2 sinh 4 tổ hợp theo thứ tự thuộc tính', () => {
    expect(combinations(options)).toEqual([
      { Mùi: 'Cam', Size: '10ml' }, { Mùi: 'Cam', Size: '30ml' }, { Mùi: 'Chanh', Size: '10ml' }, { Mùi: 'Chanh', Size: '30ml' },
    ]);
  });
  it('bỏ thuộc tính thiếu tên hoặc giá trị, giá trị trùng', () => {
    expect(cleanOptions([{ name: ' Mùi ', values: ['Cam', 'cam', ' ', 'Chanh'] }, { name: '', values: ['x'] }, { name: 'Size', values: [] }])).toEqual([{ name: 'Mùi', values: ['Cam', 'Chanh'] }]);
    expect(combinations([])).toEqual([]);
    expect(combinations([{ name: 'Mùi', values: [] }])).toEqual([]);
  });
  it('một thuộc tính ba giá trị = ba dòng; ba thuộc tính nhân lên', () => {
    expect(combinations([{ name: 'A', values: ['1', '2', '3'] }])).toHaveLength(3);
    expect(combinations([{ name: 'A', values: ['1', '2'] }, { name: 'B', values: ['x', 'y', 'z'] }, { name: 'C', values: ['p', 'q'] }])).toHaveLength(12);
  });
  it('ghép lại: dòng cũ giữ dữ liệu đã nhập, giá trị mới sinh dòng mới, giá trị bỏ đi vào removed', () => {
    const first = mergeRows([], options, { base: 'TD', defaults: { default_price: 100 } });
    expect(first.rows.map((r) => r.sku)).toEqual(['TD-CAM-10ML', 'TD-CAM-30ML', 'TD-CHANH-10ML', 'TD-CHANH-30ML']);
    const saved = first.rows.map((r, i) => ({ ...r, id: `v${i}`, default_price: 500 + i, autoSku: false }));
    const next = mergeRows(saved, [{ name: 'Mùi', values: ['Cam', 'Bưởi'] }, options[1]], { base: 'TD' });
    expect(next.rows.map((r) => r.sku)).toEqual(['TD-CAM-10ML', 'TD-CAM-30ML', 'TD-BUOI-10ML', 'TD-BUOI-30ML']);
    expect(next.rows[0].id).toBe('v0');
    expect(next.rows[1].default_price).toBe(501);
    expect(next.rows[2].id).toBeUndefined();
    expect(next.removed.map((r) => r.id)).toEqual(['v2', 'v3']);
  });
  it('SKU sinh tự động không trùng nhau kể cả khi hai giá trị cùng slug', () => {
    const { rows } = mergeRows([], [{ name: 'Mùi', values: ['Cam!', 'Cam?'] }], { base: 'X' });
    expect(new Set(rows.map((r) => r.sku.toLowerCase())).size).toBe(2);
  });
  it('áp dụng cho tất cả chỉ ghi các ô có nhập', () => {
    const rows = [{ default_price: 1, opening_qty: 5 }, { default_price: 2, opening_qty: 6 }];
    expect(applyToAll(rows, { default_price: '99', opening_qty: '' })).toEqual([{ default_price: '99', opening_qty: 5 }, { default_price: '99', opening_qty: 6 }]);
  });
  it('đổi tên sản phẩm sinh lại SKU tự sinh, giữ SKU sửa tay và dòng đã lưu', () => {
    const { rows } = mergeRows([], [{ name: 'Mùi', values: ['Cam', 'Chanh'] }], { base: 'A' });
    rows[1] = { ...rows[1], sku: 'TUY-CHINH', autoSku: false };
    const out = rebaseSkus(rows, [{ name: 'Mùi', values: ['Cam', 'Chanh'] }], 'B');
    expect(out.map((r) => r.sku)).toEqual(['B-CAM', 'TUY-CHINH']);
    const saved = [{ ...rows[0], id: 'v1' }];
    expect(rebaseSkus(saved, [{ name: 'Mùi', values: ['Cam'] }], 'B')[0].sku).toBe('A-CAM');
  });
});

describe('thu nhỏ ảnh', () => {
  it('cạnh dài về 1200, giữ tỷ lệ; ảnh nhỏ giữ nguyên', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1200, height: 900 });
    expect(fitSize(3000, 4000)).toEqual({ width: 900, height: 1200 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('cây danh mục', () => {
  const cats = [
    { id: 'b', name: 'B', parent_id: null }, { id: 'a', name: 'A', parent_id: null },
    { id: 'a1', name: 'A1', parent_id: 'a' }, { id: 'a11', name: 'A11', parent_id: 'a1' }, { id: 'b1', name: 'B1', parent_id: 'b' },
  ];
  it('phẳng hoá theo thứ tự cha trước con, kèm độ sâu', () => {
    expect(flattenTree(cats).map((c) => [c.id, c.depth])).toEqual([['b', 0], ['b1', 1], ['a', 0], ['a1', 1], ['a11', 2]]);
  });
  it('loại danh mục và con cháu khỏi ô chọn cha', () => {
    expect([...descendantIds(cats, 'a')].sort()).toEqual(['a', 'a1', 'a11']);
    expect(flattenTree(cats, { exclude: descendantIds(cats, 'a') }).map((c) => c.id)).toEqual(['b', 'b1']);
  });
});
