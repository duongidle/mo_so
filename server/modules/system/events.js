// Danh sách này phải khớp mọi emit() trong code — có test kiểm tra
export const EVENT_TYPES = [
  'order.created', 'order.updated', 'order.status_changed', 'order.cancelled', 'order.returned', 'order.payment_recorded',
  'purchase.received', 'purchase.cancelled', 'stock.changed',
  'customer.created', 'customer.updated', 'customer.merged', 'customer.removed', 'custom_field.deleted',
  'product.created', 'product.updated', 'listing.synced',
  'expense.created', 'voucher.created', 'voucher.updated', 'voucher.voided', 'asset.created', 'asset.disposed', 'shop.created', 'shop.updated', 'warehouse.created',
];
