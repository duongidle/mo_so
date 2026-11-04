import { businessDate } from './time.js';

/** Ngày hôm nay theo giờ VN. Test đặt được ngày giả bằng setToday() để kiểm khấu hao/chi phí định kỳ qua nhiều tháng mà không phải chờ. */
let override = null;
export const today = () => override || businessDate();
export const setToday = (d) => {
  override = d || null;
};
