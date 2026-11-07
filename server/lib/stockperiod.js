import { getSetting } from '../modules/settings/service.js';

/** Ngày chốt kho (null = chưa chốt). Biến động kho có ngày ≤ ngày này không ghi được. */
export const stockLockDate = () => getSetting('stock_lock_date') || null;
