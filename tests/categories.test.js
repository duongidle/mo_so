import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

async function tree(api) {
  const mk = async (name, parent_id) => (await api.post('/categories', { name, parent_id })).body.data;
  const root = await mk('Hương');
  const xe = await mk('Hương xe', root.id);
  const nha = await mk('Hương nhà', root.id);
  const other = await mk('Phụ kiện');
  return { root, xe, nha, other };
}

test('Lọc theo danh mục gồm cả con cháu: sản phẩm, tra cứu biến thể, kho', async () => {
  const { api, nh, wh } = await setup();
  const { root, xe, nha, other } = await tree(api);
  const grand = (await api.post('/categories', { name: 'Hương xe sang', parent_id: xe.id })).body.data;
  const mk = async (name, sku, category_id) => (await api.post('/products', { name, sku, category_id, variants: [{ sku, default_price: 1000, opening_qty: 3, opening_cost: 100, opening_warehouse_id: wh.id }], shop_ids: [nh.id] })).body.data;
  await mk('A', 'A1', xe.id);
  await mk('B', 'B1', grand.id);
  await mk('C', 'C1', nha.id);
  await mk('D', 'D1', other.id);
  await mk('E', 'E1', null);
  const names = async (path) => (await api.get(path)).body.data.map((p) => p.name ?? p.product_name).sort();
  assert.deepEqual(await names(`/products?category_id=${root.id}`), ['A', 'B', 'C']);
  assert.deepEqual(await names(`/products?category_id=${xe.id}`), ['A', 'B']);
  assert.deepEqual(await names(`/products?category_id=${grand.id}`), ['B']);
  assert.deepEqual(await names(`/products?category_id=${other.id}`), ['D']);
  assert.deepEqual(await names(`/products?category_id=cat_khong_co`), []);
  assert.deepEqual(await names(`/variants?shop_id=${nh.id}&category_id=${root.id}`), ['A', 'B', 'C']);
  assert.deepEqual((await api.get(`/stock?category_id=${xe.id}`)).body.data.map((r) => r.sku).sort(), ['A1', 'B1']);
  assert.equal((await api.get('/stock')).body.data.length, 5);
});

test('Đổi cha không tạo vòng lặp (CATEGORY_CYCLE); cha phải tồn tại', async () => {
  const { api } = await setup();
  const { root, xe } = await tree(api);
  const grand = (await api.post('/categories', { name: 'Con cháu', parent_id: xe.id })).body.data;
  const self = await api.patch(`/categories/${root.id}`, { parent_id: root.id });
  assert.equal(self.status, 409);
  assert.equal(self.body.error.code, 'CATEGORY_CYCLE');
  const loop = await api.patch(`/categories/${root.id}`, { parent_id: grand.id });
  assert.equal(loop.status, 409);
  assert.equal(loop.body.error.code, 'CATEGORY_CYCLE');
  assert.equal((await api.patch(`/categories/${xe.id}`, { parent_id: 'cat_khong_co' })).status, 404);
  // Chuyển hợp lệ + đưa lên gốc
  assert.equal((await api.patch(`/categories/${grand.id}`, { parent_id: null })).body.data.parent_id, null);
  assert.equal((await api.patch(`/categories/${xe.id}`, { name: 'Hương ô tô', sort_order: 5 })).body.data.name, 'Hương ô tô');
});

test('Lưu trữ danh mục còn sản phẩm bị chặn (CATEGORY_IN_USE) trừ khi chuyển sản phẩm sang danh mục khác; còn danh mục con cũng bị chặn', async () => {
  const { api, nh } = await setup();
  const { root, xe, other } = await tree(api);
  const p = (await api.post('/products', { name: 'A', category_id: xe.id, variants: [{ sku: 'A1' }], shop_ids: [nh.id] })).body.data;
  const kids = await api.patch(`/categories/${root.id}`, { archived: true });
  assert.equal(kids.status, 409);
  assert.equal(kids.body.error.code, 'CATEGORY_HAS_CHILDREN');
  const used = await api.patch(`/categories/${xe.id}`, { archived: true });
  assert.equal(used.status, 409);
  assert.equal(used.body.error.code, 'CATEGORY_IN_USE');
  assert.equal(used.body.error.details.product_count, 1);
  assert.equal((await api.patch(`/categories/${xe.id}`, { archived: true, move_products_to: xe.id })).status, 400);
  const ok = await api.patch(`/categories/${xe.id}`, { archived: true, move_products_to: other.id });
  assert.equal(ok.status, 200);
  assert.equal((await api.get(`/products/${p.id}`)).body.data.category_id, other.id);
  assert.ok(!(await api.get('/categories')).body.data.some((c) => c.id === xe.id));
  // Danh mục trống thì lưu trữ thẳng; không dùng danh mục đã lưu trữ làm cha/nhãn sản phẩm
  assert.equal((await api.post('/categories', { name: 'Con của lưu trữ', parent_id: xe.id })).status, 400);
  assert.equal((await api.post('/products', { name: 'B', category_id: xe.id, variants: [{ sku: 'B1' }] })).status, 404);
});

test('Cây danh mục kèm số sản phẩm (trực tiếp và gồm con)', async () => {
  const { api, nh } = await setup();
  const { root, xe } = await tree(api);
  await api.post('/products', { name: 'A', category_id: xe.id, variants: [{ sku: 'A1' }], shop_ids: [nh.id] });
  await api.post('/products', { name: 'B', category_id: root.id, variants: [{ sku: 'B1' }], shop_ids: [nh.id] });
  const t = (await api.get('/categories?tree=1')).body.data;
  const by = Object.fromEntries(t.map((c) => [c.name, [c.product_count, c.product_count_total]]));
  assert.deepEqual(by['Hương'], [1, 2]);
  assert.deepEqual(by['Hương xe'], [1, 1]);
  assert.deepEqual(by['Phụ kiện'], [0, 0]);
});
