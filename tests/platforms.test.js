import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { PLATFORMS, paymentMethods } from '../server/lib/platforms.js';

async function base() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [nh.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 50, unit_cost: 40000 }] });
  return ctx;
}
const sale = async (api, shop, channel, ext, extra = {}) => {
  const r = await api.post('/orders', { status: 'completed', shop_id: shop.id, channel_id: channel, external_id: ext, lines: [{ sku: 'A1', qty: 1 }], ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
};
const ids = async (api, qs = '') => (await api.get(`/channels${qs}`)).body.data.map((c) => c.id);

test('Mặc định bật Shopee + Facebook; TikTok/Zalo có sẵn nhưng tắt và ẩn khỏi bộ chọn', async () => {
  const { api } = await setup();
  const list = (await api.get('/platforms')).body.data;
  assert.deepEqual(list.map((p) => [p.id, p.enabled]), [['shopee', true], ['tiktok', false], ['facebook', true], ['zalo', false]]);
  assert.equal(list.find((p) => p.id === 'tiktok').payout_method, 'tiktok_payout');
  assert.deepEqual(await ids(api), ['direct', 'facebook', 'shopee', 'other']);
  assert.deepEqual(await ids(api, '?include_archived=1'), ['direct', 'facebook', 'shopee', 'tiktok', 'zalo', 'other']);
  assert.deepEqual((await api.get('/settings')).body.data.enabled_platforms, ['shopee', 'facebook']);
  // Không đổi qua PATCH /settings
  assert.equal((await api.patch('/settings', { enabled_platforms: ['tiktok'] })).status, 400);
  assert.equal((await api.post('/platforms/lazada/enable')).status, 404);
});

test('Bật TikTok: kênh hiện ra, mẫu import có sẵn, payout thuộc quỹ ngân hàng; tắt thì ẩn nhưng giữ dữ liệu', async () => {
  const { api, nh } = await base();
  const on = await api.post('/platforms/tiktok/enable');
  assert.equal(on.status, 200);
  assert.equal(on.body.data.enabled, true);
  assert.ok((await ids(api)).includes('tiktok'));
  assert.ok((await api.get('/imports/profiles')).body.data.some((p) => p.id === 'imp_tiktok' && p.channel_id === 'tiktok'));
  const accounts = (await api.get('/cash/accounts')).body.data ?? (await api.get('/cash/accounts')).body;
  const list = Array.isArray(accounts) ? accounts : accounts.accounts;
  assert.equal(list.filter((a) => a.methods.includes('tiktok_payout')).length, 1);
  assert.ok(list.find((a) => a.id === 'cac_bank').methods.includes('tiktok_payout'));

  // Bật lại không nhân đôi
  await api.post('/platforms/tiktok/enable');
  assert.deepEqual((await api.get('/settings')).body.data.enabled_platforms, ['shopee', 'facebook', 'tiktok']);

  const o = await sale(api, nh, 'tiktok', 'TT1');
  await api.post('/platforms/tiktok/disable');
  assert.ok(!(await ids(api)).includes('tiktok'));
  // Đơn cũ vẫn đọc được, vẫn lọc được theo kênh; tạo đơn mới ở kênh đã tắt thì bị chặn
  assert.equal((await api.get(`/orders/${o.id}`)).status, 200);
  assert.equal((await api.get('/orders?channel_id=tiktok')).body.data.length, 1);
  const blocked = await api.post('/orders', { shop_id: nh.id, channel_id: 'tiktok', external_id: 'TT2', lines: [{ sku: 'A1', qty: 1 }] });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.code, 'CHANNEL_DISABLED');
  // Mẫu import và dữ liệu không mất
  assert.ok((await api.get('/imports/profiles')).body.data.some((p) => p.id === 'imp_tiktok'));
  assert.deepEqual((await api.get('/settings')).body.data.enabled_platforms, ['shopee', 'facebook']);
  await api.post('/platforms/tiktok/enable');
  assert.equal((await api.post('/orders', { shop_id: nh.id, channel_id: 'tiktok', external_id: 'TT2', status: 'completed', lines: [{ sku: 'A1', qty: 1 }] })).status, 201);
});

test('tiktok_payout là phương thức hợp lệ ở thanh toán, chi phí và quỹ', async () => {
  const { api, nh } = await base();
  assert.ok(paymentMethods().includes('tiktok_payout') && paymentMethods().includes('shopee_payout'));
  await api.post('/platforms/tiktok/enable');
  const o = await sale(api, nh, 'direct', 'D1', { status: 'confirmed' });
  assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: 50000, method: 'tiktok_payout' })).status, 200);
  assert.equal((await api.post('/expenses', { category_id: 'ecat_ads', amount: 1000, method: 'tiktok_payout' })).status, 201);
  assert.equal((await api.post('/orders/' + o.id + '/payments', { amount: 1, method: 'lazada_payout' })).status, 400);
});

test('Đối soát TikTok tách riêng Shopee: lọc theo kênh, phương thức mặc định theo sàn, không ghi nhầm đơn kênh khác', async () => {
  const { api, nh } = await base();
  await api.post('/platforms/tiktok/enable');
  const sp = await sale(api, nh, 'shopee', 'SP1', { platform_fee_amount: 10000 });
  const tt = await sale(api, nh, 'tiktok', 'TT1', { platform_fee_amount: 20000 });
  const all = (await api.get('/reconciliation/pending')).body;
  assert.equal(all.count, 2);
  const tiktok = (await api.get('/reconciliation/pending?channel_id=tiktok')).body;
  assert.deepEqual(tiktok.data.map((r) => r.id), [tt.id]);
  assert.equal(tiktok.total_pending, 80000);
  assert.equal((await api.get('/reconciliation/pending?channel_id=shopee')).body.total_pending, 90000);

  // Dashboard tách theo sàn, cộng lại bằng tổng
  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.deepEqual(cf.marketplace_by_channel.map((c) => [c.channel_id, c.pending, c.orders]).sort(), [['shopee', 90000, 1], ['tiktok', 80000, 1]]);
  assert.equal(cf.marketplace_by_channel.reduce((a, c) => a + c.pending, 0), cf.marketplace_pending);

  // Ghi nhận đơn Shopee trong lượt đối soát TikTok bị từ chối
  const wrong = (await api.post('/reconciliation/payouts', { channel_id: 'tiktok', items: [{ order_id: sp.id }] })).body.data;
  assert.equal(wrong.recorded, 0);
  assert.equal(wrong.results[0].ok, false);

  const ok = (await api.post('/reconciliation/payouts', { channel_id: 'tiktok', items: [{ order_id: tt.id }] })).body.data;
  assert.equal(ok.recorded, 1);
  const pays = (await api.get('/payments?ref_type=order')).body.data;
  assert.equal(pays.find((p) => p.ref_id === tt.id).method, 'tiktok_payout');
  assert.equal((await api.get('/reconciliation/pending')).body.count, 1);
  assert.equal((await api.get('/reconciliation/pending?channel_id=shopee')).body.count, 1);
  // Không chỉ định sàn: phương thức theo kênh của đơn (tương thích cũ)
  await api.post('/reconciliation/payouts', { items: [{ order_id: sp.id }] });
  assert.equal((await api.get('/payments?ref_type=order')).body.data.find((p) => p.ref_id === sp.id).method, 'shopee_payout');
});

test('Kênh tuỳ chỉnh: tạo, đổi tên, lưu trữ; kênh dựng sẵn không sửa được; đã có đơn thì không đổi loại', async () => {
  const { api, nh } = await base();
  const c = await api.post('/channels', { name: 'Chợ Lazada', is_marketplace: true });
  assert.equal(c.status, 201);
  assert.match(c.body.data.id, /^ch_/);
  assert.equal(c.body.data.is_marketplace, 1);
  assert.equal((await api.post('/channels', { name: 'chợ lazada' })).status, 409);
  assert.equal((await api.patch(`/channels/${c.body.data.id}`, { name: 'Lazada' })).body.data.is_marketplace, 1); // PATCH không đặt lại loại kênh
  assert.ok((await ids(api)).includes(c.body.data.id));

  await sale(api, nh, c.body.data.id, 'LZ1');
  const lock = await api.patch(`/channels/${c.body.data.id}`, { is_marketplace: false });
  assert.equal(lock.status, 409);
  // Đối soát kênh tuỳ chỉnh dùng chuyển khoản
  const rec = (await api.post('/reconciliation/payouts', { channel_id: c.body.data.id, items: [{ external_id: 'LZ1' }] })).body.data;
  assert.equal(rec.recorded, 1);
  assert.equal((await api.get('/payments?ref_type=order')).body.data[0].method, 'bank');

  const arch = await api.patch(`/channels/${c.body.data.id}`, { archived: true });
  assert.equal(arch.status, 200);
  assert.ok(!(await ids(api)).includes(c.body.data.id));
  assert.ok((await ids(api, '?include_archived=1')).includes(c.body.data.id));
  assert.equal((await api.patch(`/channels/${c.body.data.id}`, { archived: false })).body.data.archived_at, null);

  assert.equal((await api.patch('/channels/shopee', { name: 'X' })).status, 400);
  assert.equal((await api.patch('/channels/direct', { archived: true })).status, 400);
});

test('Mẫu import TikTok trong migration khớp danh mục nền tảng', async () => {
  const { api } = await setup();
  const p = (await api.get('/imports/profiles')).body.data.find((x) => x.id === 'imp_tiktok');
  const def = PLATFORMS.tiktok.import_profile;
  assert.deepEqual(p.column_map, def.column_map);
  assert.deepEqual(p.status_map, def.status_map);
  assert.match(p.options.note, /chưa kiểm/i);
});
