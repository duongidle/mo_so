import { PageHeader, SaveBar } from './ui.jsx';

/**
 * Khung form dạng trang đầy đủ (sản phẩm, combo, phiếu nhập): tiêu đề, hai cột 8:4 (chính / phụ). `embedded`: dùng khi form nằm trong một trang đã có khung `.page` (tab của Sổ kế toán, Chi phí) để không thụt vào hai lần trên máy tính,
 * một cột trên điện thoại, thanh lưu dính đáy. Không phụ thuộc router để dễ test: nút quay lại gọi `onBack`.
 */
export default function FormPage({ title, sub, onBack, children, side, footer, error, note, embedded }) {
  return (
    <div className={`${embedded ? 'stack' : 'page stack'} form-page${embedded ? ' embedded' : ''}`}>
      <PageHeader title={title} sub={sub} actions={onBack && <button type="button" className="btn sm" onClick={onBack}>← Quay lại</button>} />
      <div className={`form-grid${side ? '' : ' single'}`}>
        <div className="stack">{children}</div>
        {side && <div className="stack">{side}</div>}
      </div>
      <SaveBar note={note}>{error && <div className="grow">{error}</div>}{footer}</SaveBar>
    </div>
  );
}
