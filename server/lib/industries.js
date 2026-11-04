import { ELEMENTS } from './lunar.js';

/**
 * Danh mục ngành bán. Mỗi ngành quyết định:
 *  - theme: giao diện web (phongthuy | nuochoa | oto | general)
 *  - features: tính năng bật theo ngành (vd 'feng_shui' = mệnh, ngũ hành, âm lịch)
 *  - customer_fields: trường thông tin khách tạo sẵn cho shop khi chọn ngành này
 *  - product_fields: trường thông tin sản phẩm tạo sẵn (riêng của shop đó), vd Ngũ hành hợp của shop phong thuỷ
 * Thêm ngành mới = thêm một mục ở đây (và một theme CSS nếu muốn giao diện riêng).
 * `role` cho app biết ý nghĩa của trường: element (mệnh ghi đè). Ngày sinh và năm sinh là thông tin CHUNG của khách (cột customers.birth_date,
 * birth_year), không còn là trường của shop; hai vai trò birth_date/birth_year chỉ còn trên các trường cũ đã ẩn (migration 028).
 */
export const INDUSTRIES = {
  general: {
    id: 'general',
    name: 'Bán lẻ chung',
    description: 'Không gắn ngành cụ thể. Giao diện trung tính, không có trường thông tin khách tạo sẵn.',
    theme: 'general',
    features: [],
    customer_fields: [],
    product_fields: [],
  },
  phong_thuy: {
    id: 'phong_thuy',
    name: 'Phong thuỷ',
    description: 'Vật phẩm phong thuỷ. Tính mệnh từ ngày sinh của khách (ghi đè tay được), gợi ý vật phẩm theo ngũ hành, hiện âm lịch.',
    theme: 'phongthuy',
    features: ['feng_shui'],
    customer_fields: [
      { key: 'gioi_tinh', label: 'Giới tính', type: 'select', options: ['Nam', 'Nữ', 'Khác'] },
      { key: 'menh', label: 'Mệnh (ghi đè)', type: 'select', options: ELEMENTS, role: 'element' },
    ],
    product_fields: [{ key: 'ngu_hanh', label: 'Ngũ hành hợp', type: 'multiselect', options: ELEMENTS, role: 'element' }],
  },
  nuoc_hoa_o_to: {
    id: 'nuoc_hoa_o_to',
    name: 'Nước hoa ô tô',
    description: 'Nước hoa, tinh dầu, phụ kiện thơm cho xe. Ghi nhóm hương, dòng xe, mua cho xe nào; giao diện riêng.',
    theme: 'oto',
    features: [],
    customer_fields: [
      { key: 'nhom_huong', label: 'Nhóm hương yêu thích', type: 'multiselect', options: ['Gỗ', 'Hoa cỏ', 'Cam chanh', 'Biển', 'Phương Đông', 'Ngọt'] },
      { key: 'dong_xe', label: 'Dòng xe', type: 'text' },
      { key: 'dip_dung', label: 'Mua cho', type: 'select', options: ['Xe cá nhân', 'Quà tặng', 'Xe dịch vụ'] },
    ],
    product_fields: [],
  },
  nuoc_hoa: {
    id: 'nuoc_hoa',
    name: 'Nước hoa',
    description: 'Nước hoa mặc cho người (chính hãng, chiết). Ghi nhóm hương, nồng độ, dung tích, thương hiệu yêu thích, dịp dùng, ngân sách; giao diện riêng.',
    theme: 'nuochoa',
    features: [],
    customer_fields: [
      { key: 'nhom_huong', label: 'Nhóm hương yêu thích', type: 'multiselect', options: ['Gỗ', 'Hoa cỏ', 'Cam chanh', 'Biển', 'Phương Đông', 'Ngọt', 'Xạ hương'] },
      { key: 'nong_do', label: 'Nồng độ hay dùng', type: 'select', options: ['EDC', 'EDT', 'EDP', 'Parfum'] },
      { key: 'thuong_hieu_yeu_thich', label: 'Thương hiệu yêu thích', type: 'text' },
      { key: 'phong_cach', label: 'Phong cách', type: 'select', options: ['Nam tính', 'Nữ tính', 'Unisex'] },
      { key: 'dip_su_dung', label: 'Dịp sử dụng', type: 'select', options: ['Đi làm', 'Hẹn hò', 'Dự tiệc', 'Hằng ngày', 'Quà tặng'] },
      { key: 'ngan_sach', label: 'Ngân sách mỗi lần', type: 'money' },
    ],
    product_fields: [],
  },
};

export const INDUSTRY_IDS = Object.keys(INDUSTRIES);
export const ROLES = ['birth_date', 'birth_year', 'element'];

export const getIndustry = (id) => INDUSTRIES[id] || INDUSTRIES.general;
export const hasFeature = (industryId, feature) => getIndustry(industryId).features.includes(feature);
