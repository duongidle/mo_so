import { openDb, setDb } from '../server/db/index.js';
import { createApp } from '../server/app.js';

/** Tạo app với DB trong bộ nhớ và một client đã đăng nhập */
export async function setup() {
  setDb(openDb(':memory:'));
  const app = createApp();
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
  const api = {
    get: (p) => call('GET', p),
    post: (p, d, h) => call('POST', p, d ?? {}, h),
    patch: (p, d) => call('PATCH', p, d),
    put: (p, d) => call('PUT', p, d),
  };
  const s = await api.post('/auth/setup', {
    username: 'duong',
    display_name: 'Dương',
    password: 'matkhau123',
    shops: [
      { name: 'Nước hoa ô tô', code: 'NH' },
      { name: 'Phong thuỷ', code: 'PT' },
    ],
  });
  if (s.status !== 201) throw new Error('setup failed ' + JSON.stringify(s.body));
  const shops = (await api.get('/shops')).body.data;
  const warehouses = (await api.get('/warehouses')).body.data;
  return { app, api, shops, nh: shops[0], pt: shops[1], wh: warehouses[0] };
}
