// Mã vạch Code 128 (bộ B: chữ, số, ký tự ASCII 32–126) dựng thành SVG, không cần thư viện hay font.
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
];
const START_B = 104;
const STOP = 106;

/** Giá trị các ký hiệu của chuỗi (bắt đầu, dữ liệu, kiểm tra, kết thúc). Ký tự ngoài ASCII 32–126 bị bỏ. */
export function code128Symbols(text) {
  const chars = [...String(text)].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  const values = chars.map((c) => c.charCodeAt(0) - 32);
  const sum = START_B + values.reduce((a, v, i) => a + v * (i + 1), 0);
  return [START_B, ...values, sum % 103, STOP];
}

/** SVG mã vạch cao `height` px, mỗi module rộng `module` px, có vùng yên tĩnh hai bên */
export function code128Svg(text, { module = 2, height = 56 } = {}) {
  const symbols = code128Symbols(text);
  let x = 10 * module; // vùng yên tĩnh
  const bars = [];
  for (const s of symbols) {
    const p = PATTERNS[s];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]) * module;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    }
  }
  const width = x + 10 * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Mã vạch ${String(text).replace(/[<>&"]/g, '')}" fill="#000">${bars.join('')}</svg>`;
}
