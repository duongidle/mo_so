// Đổi dương lịch → âm lịch Việt Nam (múi giờ +7) và tính mệnh ngũ hành nạp âm.
// Thuật toán thiên văn của Hồ Ngọc Đức (công bố công khai), dùng rộng rãi trong các lịch Việt.

const INT = Math.floor;
const PI = Math.PI;
const TZ = 7;

function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}

function newMoon(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return Jd1 + C1 - deltat;
}

function sunLongitudeRad(jdn) {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - PI * 2 * INT(L / (PI * 2));
  return L;
}

const getSunLongitude = (dayNumber) => INT((sunLongitudeRad(dayNumber - 0.5 - TZ / 24) / PI) * 6);
const getNewMoonDay = (k) => INT(newMoon(k) + 0.5 + TZ / 24);

function getLunarMonth11(yy) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k);
  if (getSunLongitude(nm) >= 9) nm = getNewMoonDay(k - 1);
  return nm;
}

function getLeapMonthOffset(a11) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i));
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

/** @returns {{day:number, month:number, year:number, leap:boolean}} */
export function solarToLunar(dd, mm, yy) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k);
  let a11 = getLunarMonth11(yy);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let leap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) leap = true;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap };
}

// ---------- Can chi & nạp âm ----------
const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
const NAP_AM = [
  'Hải Trung Kim', 'Lư Trung Hoả', 'Đại Lâm Mộc', 'Lộ Bàng Thổ', 'Kiếm Phong Kim', 'Sơn Đầu Hoả',
  'Giản Hạ Thuỷ', 'Thành Đầu Thổ', 'Bạch Lạp Kim', 'Dương Liễu Mộc', 'Tuyền Trung Thuỷ', 'Ốc Thượng Thổ',
  'Tích Lịch Hoả', 'Tùng Bách Mộc', 'Trường Lưu Thuỷ', 'Sa Trung Kim', 'Sơn Hạ Hoả', 'Bình Địa Mộc',
  'Bích Thượng Thổ', 'Kim Bạch Kim', 'Phú Đăng Hoả', 'Thiên Hà Thuỷ', 'Đại Trạch Thổ', 'Thoa Xuyến Kim',
  'Tang Đố Mộc', 'Đại Khê Thuỷ', 'Sa Trung Thổ', 'Thiên Thượng Hoả', 'Thạch Lựu Mộc', 'Đại Hải Thuỷ',
];
export const ELEMENTS = ['Kim', 'Thuỷ', 'Mộc', 'Hoả', 'Thổ']; // theo vòng tương sinh

/** Mệnh theo năm âm lịch */
export function elementOfLunarYear(lunarYear) {
  const idx60 = (((lunarYear - 4) % 60) + 60) % 60;
  const can = CAN[idx60 % 10];
  const chi = CHI[idx60 % 12];
  const napAm = NAP_AM[INT(idx60 / 2)];
  const element = ELEMENTS.find((e) => napAm.endsWith(e));
  return { lunar_year: lunarYear, can_chi: `${can} ${chi}`, nap_am: napAm, element };
}

/** Mệnh theo ngày sinh dương lịch (YYYY-MM-DD) hoặc chỉ năm sinh */
export function elementOfBirth({ birthDate, birthYear }) {
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const [y, m, d] = birthDate.split('-').map(Number);
    const lunar = solarToLunar(d, m, y);
    return { ...elementOfLunarYear(lunar.year), lunar, approximate: false };
  }
  if (birthYear) {
    // Chỉ có năm: giả định sinh sau Tết. Người sinh tháng 1–2 dương lịch có thể thuộc năm âm trước.
    return { ...elementOfLunarYear(birthYear), approximate: true };
  }
  return null;
}

/** Hành sinh ra hành này (mẹ) — vd Thổ sinh Kim */
export function generatingElement(el) {
  const i = ELEMENTS.indexOf(el);
  return i < 0 ? null : ELEMENTS[(i + 4) % 5];
}

/** Các hành hợp để chọn vật phẩm: cùng hành (bình hoà) và hành sinh ra mệnh (tương sinh) */
export function compatibleElements(el) {
  if (!el) return [];
  return [el, generatingElement(el)];
}
