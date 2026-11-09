// "Tất cả shop" chỉ có ở các trang này (CLAUDE.md mục 7). Ở trang khác, giao diện phải làm việc với một shop cụ thể.
const ALL_SHOPS_PAGES = ['/reports', '/customers', '/stock', '/orders', '/loyalty', '/guide', '/accounting', '/documents'];
export const allowsAllShops = (pathname) => pathname === '/' || ALL_SHOPS_PAGES.some((p) => pathname.startsWith(p));

// Trang không phụ thuộc shop (kho và nhà cung cấp dùng chung): bộ chọn shop ở thanh trên không có tác dụng nên ẩn đi.
const NO_SHOP_PAGES = ['/purchases'];
export const hidesShopSwitcher = (pathname) => NO_SHOP_PAGES.some((p) => pathname.startsWith(p));
