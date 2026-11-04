import { describe, it, expect } from 'vitest';
import { balanceOfLines, lineProblems, searchAccounts } from '../lib/voucher.js';

describe('Kiểm tra cân của bút toán đang nhập', () => {
  it('cân khi tổng Nợ bằng tổng Có', () => {
    expect(balanceOfLines([{ debit: '700000' }, { credit: 700000 }])).toEqual({ debit: 700000, credit: 700000, diff: 0, balanced: true });
  });
  it('báo độ lệch và không cân', () => {
    const b = balanceOfLines([{ debit: 100 }, { credit: 60 }, { credit: '30' }]);
    expect(b.balanced).toBe(false);
    expect(b.diff).toBe(10);
  });
  it('bút toán rỗng hoặc toàn 0 không coi là cân', () => {
    expect(balanceOfLines([]).balanced).toBe(false);
    expect(balanceOfLines([{ debit: 0 }, { credit: 0 }]).balanced).toBe(false);
  });
  it('mỗi dòng phải có tài khoản và chỉ một bên', () => {
    expect(lineProblems([{ account_code: '6422', debit: 5 }, { account_code: '3388', credit: 5 }])).toEqual([]);
    expect(lineProblems([{ account_code: '', debit: 5 }, { account_code: '3388', debit: 5, credit: 5 }, { account_code: '411' }]).length).toBe(3);
  });
});

describe('Tìm tài khoản', () => {
  const accs = [{ code: '111', name: 'Tiền mặt' }, { code: '1111', name: 'Quỹ: Tiền mặt' }, { code: '811', name: 'Chi phí khác (tiền phạt, hao hụt)' }, { code: '6428', name: 'Chi phí quản lý khác', archived_at: 'x' }];
  it('tìm theo mã hoặc tên không dấu, bỏ tài khoản tổng và đã lưu trữ', () => {
    expect(searchAccounts(accs, 'tien phat').map((a) => a.code)).toEqual(['811']);
    expect(searchAccounts(accs, '111').map((a) => a.code)).toEqual(['1111']);
    expect(searchAccounts(accs, '').length).toBe(2);
    expect(searchAccounts(accs, '111', { postableOnly: false }).length).toBe(2);
  });
});
