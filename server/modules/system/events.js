// Danh sách này phải khớp mọi emit() trong code — có test kiểm tra
export const EVENT_TYPES = [
  'order.created', 'order.updated', 'order.status_changed', 'order.cancelled', 'order.returned', 'order.allowance_created', 'order.deposit_forfeited', 'order.payment_recorded', 'order.return_goods_received', 'order.exchanged',
  'purchase.received', 'purchase.cancelled', 'purchase.returned', 'purchase.return_voided', 'purchase.allowance_created', 'purchase.allowance_voided', 'stock.changed', 'conversion.created', 'conversion.voided', 'stock.closed', 'stock.reopened',
  'customer.created', 'customer.updated', 'customer.merged', 'customer.removed', 'custom_field.deleted',
  'product.created', 'product.updated', 'product.removed', 'product.restored', 'listing.synced',
  'expense.created', 'notification.created', 'voucher.created', 'voucher.updated', 'voucher.voided', 'asset.created', 'asset.disposed', 'shop.created', 'shop.updated', 'warehouse.created', 'warehouse.removed',
];
