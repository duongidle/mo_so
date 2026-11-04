import { setDb } from '../server/db/index.js';
import { resetTenancy, getAccountDb } from '../server/db/tenancy.js';
import { resetRateLimits } from '../server/lib/ratelimit.js';
import { createApp } from '../server/app.js';

/** Client gọi API cho một người dùng (giữ cookie đăng nhập riêng) */
export function makeClient(app) {
  let cookie = '';
  const call = async (method, path, data, headers = {}) => {
    const res = await app.fetch(
      new Request(`http://test/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, ...headers },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, d, h) => call('POST', p, d ?? {}, h),
    patch: (p, d) => call('PATCH', p, d),
    put: (p, d) => call('PUT', p, d),
    delete: (p, d) => call('DELETE', p, d),
    cookie: () => cookie,
  };
}

/**
 * Tạo app mới, sổ tài khoản trống (mọi cơ sở dữ liệu trong bộ nhớ), đăng ký một tài khoản chủ shop,
 * tạo một kho và hai shop (NH, PT, đều ngành "Bán lẻ chung").
 * `getDb()` ngoài yêu cầu trỏ vào dữ liệu của tài khoản này, để test đọc thẳng DB được.
 */
export async function setup() {
  resetTenancy();
  resetRateLimits();
  const app = createApp();
  const api = makeClient(app);
  const reg = await api.post('/auth/register', { username: 'duong', display_name: 'Dương', password: 'matkhau123' });
  if (reg.status !== 201) throw new Error('register failed ' + JSON.stringify(reg.body));
  const me = (await api.get('/auth/me')).body.data;
  setDb(getAccountDb(me.accountId));
  const wh = (await api.post('/warehouses', { code: 'K1', name: 'Kho chính' })).body.data;
  for (const [name, code] of [['Nước hoa ô tô', 'NH'], ['Phong thuỷ', 'PT']]) {
    const r = await api.post('/shops', { name, code, default_warehouse_id: wh.id });
    if (r.status !== 201) throw new Error('shop failed ' + JSON.stringify(r.body));
  }
  const shops = (await api.get('/shops')).body.data;
  const warehouses = (await api.get('/warehouses')).body.data;
  return { app, api, shops, nh: shops[0], pt: shops[1], wh: warehouses[0], accountId: me.accountId };
}
