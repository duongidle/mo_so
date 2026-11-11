import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SL, CH } from '../guides/handbook/data.js';
import Handbook from '../pages/guide/Handbook.jsx';

describe('dữ liệu cẩm nang', () => {
  const scenes = SL.filter((s) => !s.type);
  it('mọi trang có lời hướng dẫn, màn hình và kịch bản; chương hợp lệ', () => {
    expect(scenes.length).toBeGreaterThan(20);
    for (const s of scenes) {
      expect(CH.map((c) => c[0])).toContain(s.ch);
      expect(s.title && s.lead && s.steps.length && s.screen && s.script.length, s.title).toBeTruthy();
    }
  });
  it('kịch bản chỉ trỏ tới phần tử có thật trong màn hình, và bước nào cũng có trong danh sách bước', () => {
    for (const s of scenes) {
      for (const [op, a] of s.script) {
        if (['click', 'type', 'show', 'hide', 'set', 'cls'].includes(op)) expect(s.screen, `${s.title}: ${op} ${a}`).toContain(`id="${a.slice(1)}"`);
        if (op === 's') expect(a, s.title).toBeLessThan(s.steps.length);
        if (op === 'ckx') expect(s.screen, s.title).toContain(`id="x${a}"`);
      }
      // mọi bước bên trái đều được kịch bản nhắc tới theo thứ tự
      const shown = s.script.filter((x) => x[0] === 's').map((x) => x[1]);
      expect(shown, s.title).toEqual(s.steps.map((_, i) => i));
    }
  });
  it('có tình huống nhập hàng trả nhiều đợt và khách trả tiền nhiều lần', () => {
    const titles = scenes.map((s) => s.title);
    expect(titles).toContain('Nhập hàng, trả nhà cung cấp nhiều đợt');
    expect(titles).toContain('Khách trả tiền nhiều lần');
  });
  it('có các tình huống mới: kg sang hộp, trả hàng NCC, cọc, hàng lỗi, Shopee trả hàng, nhập file Shopee', () => {
    const titles = scenes.map((s) => s.title);
    for (const t of [
      'Nhập theo kg, bán theo hộp',
      'Trả hàng cho nhà cung cấp và nhà cung cấp bớt tiền',
      'Khách đặt cọc rồi không lấy: hoàn hay giữ',
      'Khách nhận hàng bị lỗi, hoàn một phần',
      'Đơn Shopee bị trả hàng: phí sàn được hoàn',
      'Nhập file Shopee: cảnh báo, trạng thái và trả hàng',
    ]) expect(titles, t).toContain(t);
  });
  it('số liệu ví dụ của phiếu đóng gói cộng đúng', () => {
    const s = scenes.find((x) => x.title === 'Nhập theo kg, bán theo hộp');
    expect((20.5 * 180000 + 205000) / 20.5).toBe(190000);
    expect(20 * 190000 + 80000 + 20000).toBe(3900000);
    expect(3900000 / 40).toBe(97500);
    expect(JSON.stringify(s.script)).toContain('97.500 ₫');
  });
  it('không còn lối viết thân mật hay từ "app" trong lời hướng dẫn', () => {
    const text = JSON.stringify(scenes.map((s) => [s.title, s.lead, s.steps, s.tip, s.warn]));
    expect(text).not.toMatch(/(?<![\p{L}])(?:[Aa]pp|[Bb]ấm|[Hh]ãy|tớ|cậu)(?![\p{L}])/u);
  });
});

describe('Cẩm nang trong trang Hướng dẫn', () => {
  beforeEach(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }); }); // giảm chuyển động: chạy tức thì
  afterEach(() => { delete window.matchMedia; });

  it('mở ở bìa, chuyển chương và trang bằng nút', async () => {
    render(<Handbook />);
    expect(screen.getByText(/Dùng Mở Sổ từ ngày đầu đến chốt tháng/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Bán hàng' }));
    expect(await screen.findByRole('heading', { name: 'Bán trực tiếp trong 30 giây' })).toBeTruthy();
    expect(screen.queryByText(/Dùng Mở Sổ từ ngày đầu đến chốt tháng/)).toBeNull(); // nội dung bìa phải biến mất khi sang trang khác
    fireEvent.click(screen.getByText('Sau →'));
    expect(await screen.findByRole('heading', { name: /Đơn có giao hàng/ })).toBeTruthy();
    fireEvent.click(screen.getByText('← Trước'));
    expect(screen.getByRole('heading', { name: 'Bán trực tiếp trong 30 giây' })).toBeTruthy();
  });

  it.each([
    ['Nhập theo kg, bán theo hộp', 'C', 's2', '40 (lô L1126, hạn 30/06/2027)'],
    ['Trả hàng cho nhà cung cấp và nhà cung cấp bớt tiền', 'A', 'db', '0 ₫'],
    ['Khách đặt cọc rồi không lấy: hoàn hay giữ', 'B', 'ps', 'Đã huỷ'],
    ['Khách nhận hàng bị lỗi, hoàn một phần', 'B', 'dt', '350.000 ₫'],
    ['Đơn Shopee bị trả hàng: phí sàn được hoàn', 'B', 'tv', '864.000 ₫'],
    ['Nhập file Shopee: cảnh báo, trạng thái và trả hàng', 'B', 't1', 'Đã ghi 11 đơn. Bỏ qua 1 đơn lỗi.'],
  ])('trang mới "%s" phát hết kịch bản không lỗi', async (title, ch, id, expected) => {
    render(<Handbook />);
    fireEvent.click(screen.getByRole('tab', { name: { A: 'Bắt đầu', B: 'Bán hàng', C: 'Kho' }[ch] }));
    for (let i = 0; i < 40 && !screen.queryByRole('heading', { name: title }); i++) fireEvent.click(screen.getByText('Sau →'));
    await screen.findByRole('heading', { name: title });
    const host = document.querySelector('.hb-host');
    await waitFor(() => expect(host.shadowRoot.getElementById(id).textContent).toBe(expected));
    expect(screen.getByText('Đã phát xong. Nhấn “Xem lại” để phát lại.')).toBeTruthy();
  });

  it('chạy kịch bản trong màn hình mô phỏng tới trạng thái cuối', async () => {
    render(<Handbook />);
    fireEvent.click(screen.getByRole('tab', { name: 'Bắt đầu' }));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Sau →')); // tạo shop → sản phẩm → nhập hàng → trả nhà cung cấp → trả nhiều đợt
    await screen.findByRole('heading', { name: 'Nhập hàng, trả nhà cung cấp nhiều đợt' });
    const host = document.querySelector('.hb-host');
    await waitFor(() => expect(host.shadowRoot.getElementById('st').textContent).toBe('Đã trả đủ'));
    expect(host.shadowRoot.getElementById('db').textContent).toBe('0 ₫');
    expect(host.shadowRoot.getElementById('pd').textContent).toBe('20.000.000 ₫');
    expect(screen.getByText('Đã phát xong. Nhấn “Xem lại” để phát lại.')).toBeTruthy();
  });
});
