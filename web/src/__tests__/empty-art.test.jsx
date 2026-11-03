import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

let theme = 'general';
vi.mock('../session.jsx', () => ({ useSession: () => (theme === 'none' ? null : { theme }) }));
import { Empty } from '../components/ui.jsx';

const kinds = (container) => ({
  art: container.querySelector('svg.empty-art') !== null,
  rings: container.querySelectorAll('svg.empty-art circle').length,
});

describe('Empty: hình minh hoạ theo giao diện của shop', () => {
  it('phong thuỷ dùng trống đồng (nhiều vòng + vành răng cưa)', () => {
    theme = 'phongthuy';
    const { container, getByText } = render(<Empty>Chưa có đơn</Empty>);
    expect(getByText('Chưa có đơn')).toBeTruthy();
    expect(kinds(container).art).toBe(true);
    expect(container.querySelectorAll('svg.empty-art line').length).toBeGreaterThan(40); // vành răng cưa
  });
  it('nước hoa dùng vòng lan toả (chỉ vòng tròn, không có vạch)', () => {
    theme = 'nuochoa';
    const { container } = render(<Empty>x</Empty>);
    expect(kinds(container).art).toBe(true);
    expect(container.querySelectorAll('svg.empty-art line').length).toBe(0);
    expect(kinds(container).rings).toBeGreaterThanOrEqual(6);
  });
  it('chung và khi chưa có phiên làm việc dùng cuốn sổ mở', () => {
    for (const t of ['general', 'none']) {
      theme = t;
      const { container } = render(<Empty>x</Empty>);
      expect(kinds(container).art).toBe(false);
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });
  it('có thể kèm nút hành động', () => {
    theme = 'general';
    const { getByRole } = render(<Empty action={<button>Tạo đơn</button>}>x</Empty>);
    expect(getByRole('button', { name: 'Tạo đơn' })).toBeTruthy();
  });
});
