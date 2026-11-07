import { Hono } from 'hono';
import { openapi, renderDocs } from './apidocs/render.js';

/**
 * Tài liệu API. Danh sách route lấy từ chính app đang chạy (luôn đủ), mô tả tiếng Việt, tham số và ví dụ nằm ở apidocs/catalog.js;
 * test bắt buộc mọi route đều có mô tả để tài liệu không bị bỏ sót khi thêm route mới.
 */
export function docsRoutes(getApp) {
  const r = new Hono();
  const origin = (c) => new URL(c.req.url).origin;
  r.get('/openapi.json', (c) => c.json(openapi(getApp(), origin(c))));
  r.get('/', (c) => c.html(renderDocs(getApp(), origin(c))));
  return r;
}
