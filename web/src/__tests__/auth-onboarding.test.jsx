import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
let session;
vi.mock('../session.jsx', () => ({ useSession: () => session }));
import { api } from '../api.js';
import Auth from '../pages/Auth.jsx';
import Onboarding, { suggestCode, useSetupProgress } from '../pages/Onboarding.jsx';

const INDUSTRIES = [
  { id: 'general', name: 'Bán lẻ chung', description: 'Không gắn ngành', customer_field_labels: [] },
  { id: 'nuoc_hoa', name: 'Nước hoa', description: 'Nước hoa mặc cho người', customer_field_labels: ['Nhóm hương yêu thích', 'Nồng độ hay dùng'] },
  { id: 'nuoc_hoa_o_to', name: 'Nước hoa ô tô', description: 'Cho xe', customer_field_labels: ['Dòng xe'] },
];

describe('Đăng ký / đăng nhập', () => {
  beforeEach(() => { api.post.mockReset(); api.post.mockResolvedValue({ ok: true }); });
  const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('chưa có tài khoản nào: mở thẳng form đăng ký', () => {
    render(<Auth hasAccounts={false} registrationOpen onDone={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Đăng ký' })).toBeTruthy();
  });

  it('mật khẩu ngắn hoặc nhập lại không khớp: báo lỗi, không gọi API', () => {
    render(<Auth hasAccounts={false} registrationOpen onDone={() => {}} />);
    fill(/^Tên đăng nhập/, 'chu_moi'); fill('Tên hiển thị', 'Chủ Mới');
    fill(/Mật khẩu \(tối thiểu/, 'ngan'); fill('Nhập lại mật khẩu', 'ngan');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(screen.getByRole('alert').textContent).toMatch(/tối thiểu 8 ký tự/);
    fill(/Mật khẩu \(tối thiểu/, 'matkhau-du-dai'); fill('Nhập lại mật khẩu', 'matkhau-khac-het');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(screen.getByRole('alert').textContent).toMatch(/chưa giống nhau/);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('đăng ký hợp lệ gọi đúng API rồi báo xong', async () => {
    const onDone = vi.fn();
    render(<Auth hasAccounts={false} registrationOpen onDone={onDone} />);
    fill(/^Tên đăng nhập/, 'chu_moi'); fill('Tên hiển thị', 'Chủ Mới');
    fill(/Mật khẩu \(tối thiểu/, 'matkhau-du-dai'); fill('Nhập lại mật khẩu', 'matkhau-du-dai');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/register', { username: 'chu_moi', display_name: 'Chủ Mới', password: 'matkhau-du-dai' });
  });

  it('có tài khoản: mặc định đăng nhập, chuyển qua lại được; đóng đăng ký thì ẩn liên kết', async () => {
    const { unmount } = render(<Auth hasAccounts registrationOpen onDone={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
    expect(screen.queryByLabelText('Tên hiển thị')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Đăng ký' }));
    expect(screen.getByRole('heading', { name: 'Đăng ký' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Đăng nhập' }));
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
    unmount();
    render(<Auth hasAccounts registrationOpen={false} onDone={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Đăng ký' })).toBeNull();
  });

  it('lỗi từ máy chủ (tên đã có người dùng) hiện ra cho người dùng', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('Tên đăng nhập đã có người dùng'), { code: 'USERNAME_TAKEN' }));
    render(<Auth hasAccounts={false} registrationOpen onDone={() => {}} />);
    fill(/^Tên đăng nhập/, 'da_co'); fill('Tên hiển thị', 'X');
    fill(/Mật khẩu \(tối thiểu/, 'matkhau-du-dai'); fill('Nhập lại mật khẩu', 'matkhau-du-dai');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(await screen.findByText('Tên đăng nhập đã có người dùng')).toBeTruthy();
  });
});

describe('Tạo shop đầu tiên', () => {
  const reload = vi.fn();
  beforeEach(() => { reload.mockReset(); api.post.mockReset(); api.post.mockResolvedValue({ data: {} }); session = { industries: INDUSTRIES, reload, user: { displayName: 'Chủ Mới' }, onLogout: () => {} }; });

  it('gợi ý mã shop từ tên (chữ cái đầu mỗi từ, không dấu)', () => {
    expect(suggestCode('Nước hoa ô tô')).toBe('NHOT');
    expect(suggestCode('Phong thuỷ Á Đông')).toBe('PTAD');
    expect(suggestCode('  Đồ   gỗ ')).toBe('DG');
    expect(suggestCode('Cửa hàng tạp hoá thân thiện nhất')).toBe('CHTHTT'); // tối đa 6 ký tự
    expect(suggestCode('')).toBe('');
  });

  it('điền tên thì mã tự gợi ý; chọn ngành thì thấy các trường khách sẽ có; gửi đúng dữ liệu', async () => {
    render(<Onboarding />);
    fireEvent.change(screen.getByLabelText('Tên shop'), { target: { value: 'Nước hoa ô tô' } });
    expect(screen.getByLabelText(/Mã shop/).value).toBe('NHOT');
    fireEvent.click(screen.getByLabelText(/Nước hoa ô tô.*Cho xe/s));
    expect(screen.getByText(/Thông tin khách tạo sẵn: Dòng xe/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Nước hoa mặc cho người/));
    expect(screen.getByText(/Nhóm hương yêu thích, Nồng độ hay dùng/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Điện thoại/), { target: { value: '0909000111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo shop và tiếp tục' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/shops', { name: 'Nước hoa ô tô', code: 'NHOT', industry: 'nuoc_hoa', phone: '0909000111', address: null });
  });

  it('sửa tay mã shop rồi đổi tên: không ghi đè mã đã sửa', () => {
    render(<Onboarding />);
    fireEvent.change(screen.getByLabelText('Tên shop'), { target: { value: 'Shop A' } });
    fireEvent.change(screen.getByLabelText(/Mã shop/), { target: { value: 'riêng' } });
    fireEvent.change(screen.getByLabelText('Tên shop'), { target: { value: 'Shop Bảo Anh' } });
    expect(screen.getByLabelText(/Mã shop/).value).toBe('RIÊNG');
  });

  it('chưa nhập tên thì nút tạo bị khoá', () => {
    render(<Onboarding />);
    expect(screen.getByRole('button', { name: 'Tạo shop và tiếp tục' }).disabled).toBe(true);
  });
});

describe('Tiến độ thiết lập (hướng dẫn kho → sản phẩm)', () => {
  function Probe() {
    const p = useSetupProgress();
    return <span data-testid="step">{p.loading ? 'loading' : p.step ?? 'xong'}</span>;
  }
  const setProducts = (byShop) => api.get.mockImplementation(async (path, params) => ({ data: byShop[params.shop_id] ? [{ id: 'p' }] : [] }));
  const step = async () => { render(<Probe />); await waitFor(() => expect(screen.getByTestId('step').textContent).not.toBe('loading')); return screen.getByTestId('step').textContent; };

  it('shop đầu tiên chưa có kho → bước kho', async () => {
    session = { shops: [{ id: 's1', default_warehouse_id: null }], warehouses: [] };
    setProducts({});
    expect(await step()).toBe('warehouse');
  });
  it('có kho mặc định, chưa có sản phẩm → bước sản phẩm; có sản phẩm → xong', async () => {
    session = { shops: [{ id: 's1', default_warehouse_id: 'w1' }], warehouses: [{ id: 'w1' }] };
    setProducts({});
    expect(await step()).toBe('product');
    document.body.innerHTML = '';
    setProducts({ s1: true });
    expect(await step()).toBe('xong');
  });
  it('shop thứ hai chưa có sản phẩm KHÔNG kéo hướng dẫn quay lại (lỗi đã gặp: cửa sổ che màn hình)', async () => {
    session = { shops: [{ id: 's1', default_warehouse_id: 'w1' }, { id: 's2', default_warehouse_id: null }], warehouses: [{ id: 'w1' }] };
    setProducts({ s1: true });
    expect(await step()).toBe('xong');
    expect(api.get).toHaveBeenCalledWith('/products', { shop_id: 's1', limit: 1 });
    expect(api.get).not.toHaveBeenCalledWith('/products', { shop_id: 's2', limit: 1 });
  });
});
