import { useRef, useState } from 'react';
import { uploadImage } from '../lib/image.js';
import { ErrorBox } from './ui.jsx';

/**
 * Ảnh sản phẩm: chọn nhiều ảnh hoặc kéo thả vào khung. Ảnh được thu nhỏ rồi tải lên ngay;
 * `images` = [{ id, url }], thứ tự là thứ tự hiển thị (ảnh đầu là ảnh đại diện).
 */
export default function ImageGallery({ images, onChange, max = 10 }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);

  const add = async (files) => {
    const list = [...files].slice(0, Math.max(0, max - images.length));
    if (!list.length) return;
    setBusy(true);
    setError(null);
    const added = [];
    try {
      for (const f of list) added.push(await uploadImage(f));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (added.length) onChange([...images, ...added.map((a) => ({ id: a.id, url: a.url }))]);
    }
  };
  const move = (i, d) => {
    const next = [...images];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="gallery">
        {images.map((im, i) => (
          <div key={im.id} className="gallery-item">
            <img src={im.url} alt={`Ảnh ${i + 1}`} />
            {i === 0 && <span className="badge plain gallery-main">Ảnh đại diện</span>}
            <div className="gallery-tools">
              <button type="button" className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Đưa ảnh ${i + 1} lên trước`}>←</button>
              <button type="button" className="btn sm" disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label={`Đưa ảnh ${i + 1} ra sau`}>→</button>
              <button type="button" className="btn sm" onClick={() => onChange(images.filter((x) => x.id !== im.id))} aria-label={`Bỏ ảnh ${i + 1}`}>✕</button>
            </div>
          </div>
        ))}
        {images.length < max && (
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            role="button" tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          >
            {busy ? 'Đang tải…' : <>+ Thêm ảnh<span className="small muted">chọn hoặc kéo thả</span></>}
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple={max > 1} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} aria-label="Chọn ảnh" />
      <ErrorBox error={error} />
    </div>
  );
}
