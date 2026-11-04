import { PageHeader, SaveBar } from './ui.jsx';

/**
 * Khung form dạng trang đầy đủ (sản phẩm, combo, phiếu nhập): tiêu đề, hai cột 8:4 (chính / phụ) trên máy tính,
 * một cột trên điện thoại, thanh lưu dính đáy. Không phụ thuộc router để dễ test: nút quay lại gọi `onBack`.
 */
export default function FormPage({ title, sub, onBack, children, side, footer, error, note }) {
  return (
    <div className="page stack form-page">
      <PageHeader title={title} sub={sub} actions={onBack && <button type="button" className="btn sm" onClick={onBack}>← Quay lại</button>} />
      <div className="form-grid">
        <div className="stack">{children}</div>
        {side && <div className="stack">{side}</div>}
      </div>
      <SaveBar note={note}>{error && <div className="grow">{error}</div>}{footer}</SaveBar>
    </div>
  );
}
