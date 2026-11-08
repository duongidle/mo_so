import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { errorHandler } from './lib/errors.js';
import { requireAuth } from './lib/auth.js';

import authRoutes from './modules/auth/routes.js';
import shopRoutes from './modules/shops/routes.js';
import warehouseRoutes from './modules/warehouses/routes.js';
import settingsRoutes, { industryRoutes } from './modules/settings/routes.js';
import platformRoutes, { channelRoutes } from './modules/platforms/routes.js';
import catalogRoutes from './modules/catalog/routes.js';
import inventoryRoutes from './modules/inventory/routes.js';
import purchaseRoutes from './modules/purchases/routes.js';
import customerRoutes from './modules/customers/routes.js';
import orderRoutes from './modules/orders/routes.js';
import importRoutes from './modules/imports/routes.js';
import expenseRoutes from './modules/expenses/routes.js';
import reportRoutes from './modules/reports/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import shippingRoutes from './modules/shipping/routes.js';
import documentRoutes from './modules/documents/routes.js';
import cashRoutes from './modules/cash/routes.js';
import accountingRoutes from './modules/accounting/routes.js';
import loyaltyRoutes from './modules/loyalty/routes.js';
import customRoutes from './modules/custom/routes.js';
import { uploadRoutes, fileRoutes } from './modules/uploads/routes.js';
import systemRoutes from './modules/system/routes.js';
import { docsRoutes } from './modules/system/docs.js';

export function createApp() {
  const app = new Hono();
  app.onError(errorHandler);

  const api = new Hono();
  api.route('/auth', authRoutes);
  api.route('/docs', docsRoutes(() => app)); // công khai: chỉ liệt kê đường dẫn, không lộ dữ liệu

  // Mọi route bên dưới cần đăng nhập
  const secured = new Hono();
  secured.use('*', requireAuth());
  secured.route('/shops', shopRoutes);
  secured.route('/warehouses', warehouseRoutes);
  secured.route('/channels', channelRoutes);
  secured.route('/platforms', platformRoutes);
  secured.route('/settings', settingsRoutes);
  secured.route('/industries', industryRoutes);
  secured.route('/', catalogRoutes); // /categories, /products, /variants, /listings
  secured.route('/', inventoryRoutes); // /stock, /stock-movements, /stock-adjustments, /transfers
  secured.route('/', purchaseRoutes); // /suppliers, /purchases
  secured.route('/customers', customerRoutes);
  secured.route('/orders', orderRoutes);
  secured.route('/imports', importRoutes);
  secured.route('/', expenseRoutes); // /expenses, /expense-categories, /payments, /reconciliation
  secured.route('/notifications', notificationRoutes);
  secured.route('/', shippingRoutes); // /carriers, /shipments, /carrier-statements
  secured.route('/', documentRoutes); // /documents
  secured.route('/reports', reportRoutes);
  secured.route('/cash', cashRoutes);
  secured.route('/accounting', accountingRoutes);
  secured.route('/loyalty', loyaltyRoutes);
  secured.route('/custom', customRoutes);
  secured.route('/uploads', uploadRoutes); // POST /uploads/images
  secured.route('/files', fileRoutes); // GET /files/images/:id (cần đăng nhập)
  secured.route('/system', systemRoutes); // /system/api-keys, /webhooks, /backups, /export, /events
  api.route('/', secured);

  app.route('/api/v1', api);
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Giao diện web (SPA) đã build
  const dist = path.resolve('web/dist');
  if (fs.existsSync(dist)) {
    app.use('/assets/*', serveStatic({ root: './web/dist' }));
    app.use('/*', serveStatic({ root: './web/dist' }));
    app.get('*', (c) => c.html(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
  } else {
    app.get('/', (c) => c.text('Giao diện chưa được build. Chạy: npm run build'));
  }
  return app;
}
