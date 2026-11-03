// Client gọi API. Mọi lỗi đều thành ApiError có message tiếng Việt từ server.
export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || `Lỗi ${status}`);
    this.status = status;
    this.code = error?.code;
    this.details = error?.details;
  }
}

async function request(method, path, body, headers = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('moso:unauthorized'));
    throw new ApiError(res.status, data?.error);
  }
  return data;
}

export const qs = (o = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (p, params) => request('GET', p + qs(params)),
  post: (p, b = {}, h) => request('POST', p, b, h),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};
