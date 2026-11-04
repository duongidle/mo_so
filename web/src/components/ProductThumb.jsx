/** Ảnh vuông thu nhỏ của sản phẩm; chưa có ảnh thì ô trơn có chữ cái đầu */
export default function ProductThumb({ src, name = '', size = 40 }) {
  const initial = String(name).trim().charAt(0).toUpperCase() || '·';
  return (
    <span className="thumb" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" width={size} height={size} /> : initial}
    </span>
  );
}
