// Thu nhỏ ảnh ngay trên trình duyệt trước khi tải lên (nhẹ mạng, nhẹ ổ đĩa): cạnh dài tối đa 1200px, WebP chất lượng 0.82.
export const MAX_SIDE = 1200;
export const QUALITY = 0.82;

/** Kích thước sau khi thu nhỏ, giữ tỷ lệ, không phóng to ảnh nhỏ */
export function fitSize(width, height, max = MAX_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

export async function resizeImage(file, { max = MAX_SIDE, quality = QUALITY } = {}) {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitSize(bmp.width, bmp.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
  bmp.close?.();
  const toBlob = (type) => new Promise((res) => canvas.toBlob(res, type, quality));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg'); // trình duyệt cũ không mã hoá được WebP
  if (!blob) throw new Error('Không đọc được ảnh này');
  return { blob, width, height };
}

/** Thu nhỏ rồi tải lên. Trả { id, url }. */
export async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" không phải ảnh`);
  const { blob, width, height } = await resizeImage(file);
  const res = await fetch(`/api/v1/uploads/images?width=${width}&height=${height}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Tải ảnh lỗi (${res.status})`);
  return data.data;
}
