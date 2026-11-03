import { ELEMENTS } from './lunar.js';

/**
 * Danh mục ngành bán. Mỗi ngành quyết định:
 *  - theme: giao diện web (phongthuy | nuochoa | general)
 *  - features: tính năng bật theo ngành (vd 'feng_shui' = mệnh, ngũ hành, âm lịch)
 *  - customer_fields: trường thông tin khách tạo sẵn cho shop khi chọn ngành này
 * Thêm ngành mới = thêm một mục ở đây (và một theme CSS nếu muốn giao diện riêng).
 * `role` cho app biết ý nghĩa của trường: birth_date, birth_year, element.
 */
export const INDUSTRIES = {
  general: {
    id: 'general',
    name: 'Bán lẻ chung',
    description: 'Không gắn ngành cụ thể. Giao diện trung tính, không có trường thông tin khách tạo sẵn.',
    theme: 'general',
    features: [],
    customer_fields: [],
  },
  phong_thuy: {
    id: 'phong_thuy',
    name: 'Phong thuỷ',
    description: 'Vật phẩm phong thuỷ. Ghi mệnh và ngày sinh của khách, gợi ý vật phẩm theo ngũ hành, hiện âm lịch.',
    theme: 'phongthuy',
    features: ['feng_shui'],
    customer_fields: [
      { key: 'ngay_sinh', label: 'Ngày sinh (dương lịch)', type: 'date', role: 'birth_date' },
      { key: 'nam_sinh', label: 'Năm sinh (khi chưa biết ngày)', type: 'number', role: 'birth_year' },
      { key: 'gioi_tinh', label: 'Giới tính', type: 'select', options: ['Nam', 'Nữ', 'Khác'] },
      { key: 'menh', label: 'Mệnh (để trống = tự tính)', type: 'select', options: ELEMENTS, role: 'element' },
    ],
  },
  nuoc_hoa: {
    id: 'nuoc_hoa',
    name: 'Nước hoa',
    description: 'Nước hoa (kể cả nước hoa ô tô). Ghi nhóm hương yêu thích, dòng xe, dịp mua; giao diện riêng.',
    theme: 'nuochoa',
    features: [],
    customer_fields: [
      { key: 'nhom_huong', label: 'Nhóm hương yêu thích', type: 'multiselect', options: ['Gỗ', 'Hoa cỏ', 'Cam chanh', 'Biển', 'Phương Đông', 'Ngọt'] },
      { key: 'dong_xe', label: 'Dòng xe', type: 'text' },
      { key: 'dip_dung', label: 'Mua cho', type: 'select', options: ['Xe cá nhân', 'Quà tặng', 'Xe dịch vụ'] },
      { key: 'sinh_nhat', label: 'Sinh nhật', type: 'date', role: 'birth_date' },
    ],
  },
};

export const INDUSTRY_IDS = Object.keys(INDUSTRIES);
export const ROLES = ['birth_date', 'birth_year', 'element'];

export const getIndustry = (id) => INDUSTRIES[id] || INDUSTRIES.general;
export const hasFeature = (industryId, feature) => getIndustry(industryId).features.includes(feature);
