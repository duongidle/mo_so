import { Field } from './ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Ngày sinh + (ô phụ) năm sinh khi chưa biết ngày. Là thông tin CHUNG của hồ sơ khách, mọi shop đều dùng
 * (tính tuổi, nhắc sinh nhật, và mệnh ở shop phong thuỷ). Có ngày sinh thì năm sinh không cần nữa.
 * f = { birth_date, birth_year }; set(patch) cập nhật.
 */
export default function BirthFields({ f, set }) {
  return (
    <div className="grid cols-2 collapse">
      <Field label="Ngày sinh (dương lịch)"><input type="date" max={today()} value={f.birth_date || ''} onChange={(e) => set({ birth_date: e.target.value || null })} /></Field>
      <Field label="Năm sinh (nếu không rõ ngày)" hint={f.birth_date ? 'Đã có ngày sinh nên không cần năm.' : undefined}>
        <input type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} disabled={!!f.birth_date} value={f.birth_date ? '' : f.birth_year ?? ''} onChange={(e) => set({ birth_year: e.target.value === '' ? null : Number(e.target.value) })} />
      </Field>
    </div>
  );
}
