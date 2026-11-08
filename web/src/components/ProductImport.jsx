import { useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { ErrorBox, Field, Modal, useAction } from './ui.jsx';
import { FIELDS, guessMapping, rowsFromSheet, TEMPLATE_HEADERS, TEMPLATE_ROWS } from '../lib/productImport.js';

/** Nhập sản phẩm hàng loạt: chọn file → kiểm tra cột → xem trước → nhập. Các dòng cùng tên sản phẩm là các biến thể của một sản phẩm. */
export default function ProductImport({ onClose, onDone }) {
  const { shopId, isAll, warehouses } = useSession();
  const { busy, error, run } = useAction();
  const [parsed, setParsed] = useState(null);
  const [map, setMap] = useState({});
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '');
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const rows = parsed && map.name && map.sku ? rowsFromSheet(parsed.rows, map) : [];
  const body = { rows, warehouse_id: warehouseId || null, shop_ids: isAll ? [] : [shopId] };

  const onFile = (f) => run(async () => {
    setPlan(null); setResult(null);
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' });
    if (!data.length) throw new Error('File không có dòng dữ liệu nào.');
    const columns = Object.keys(data[0]);
    setParsed({ rows: data, columns });
    setMap(guessMapping(columns));
  });
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'San pham');
    XLSX.writeFile(wb, 'mau-nhap-san-pham.xlsx');
  };

  return (
    <Modal title="Nhập sản phẩm từ Excel" onClose={onClose} footer={result
      ? <button className="btn primary" onClick={onDone}>Xong</button>
      : plan?.summary.products
        ? <button className="btn primary" disabled={busy} onClick={() => run(async () => setResult((await api.post('/products/import', body)).data))}>Nhập {plan.summary.products} sản phẩm</button>
        : <button className="btn primary" disabled={busy || !rows.length} onClick={() => run(async () => setPlan((await api.post('/products/import/preview', body)).data))}>Xem trước</button>}>
      {!result && <>
        <p className="muted small">Mỗi dòng là một SKU. Các dòng cùng tên sản phẩm được gộp thành các biến thể của một sản phẩm. Danh mục chưa có sẽ được tạo. File được đọc ngay trên máy này.</p>
        <div className="row between"><button type="button" className="btn sm" onClick={downloadTemplate}>Tải file mẫu</button></div>
        <Field label="File Excel / CSV"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} /></Field>
        {parsed && (
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Cột nào là gì? ({parsed.rows.length} dòng)</b>
            {FIELDS.map(([k, label, required]) => (
              <div key={k} className="row between"><span className="small">{label}{required && ' *'}</span>
                <select value={map[k] || ''} onChange={(e) => { setMap({ ...map, [k]: e.target.value || undefined }); setPlan(null); }} aria-label={label}><option value="">{required ? 'Chọn cột…' : 'Không có'}</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            ))}
            <Field label="Kho nhận tồn đầu kỳ (dùng khi dòng không ghi kho)"><select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPlan(null); }} aria-label="Kho nhận tồn đầu kỳ"><option value="">Không chọn</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            {!isAll && <p className="muted small">Hàng bán sẽ được niêm yết ở shop đang chọn.</p>}
          </div>
        )}
        {plan && (
          <div className="stack small">
            <div className={`alert ${plan.summary.errors ? 'warn' : 'ok'}`}>Sẽ tạo {plan.summary.products} sản phẩm ({plan.summary.variants} SKU){plan.new_categories.length ? ` và ${plan.new_categories.length} danh mục mới (${plan.new_categories.join(', ')})` : ''}.{plan.summary.errors ? ` ${plan.summary.errors} dòng có lỗi sẽ được bỏ qua.` : ''}</div>
            {plan.errors.length > 0 && <div className="table-wrap" style={{ maxHeight: 180 }}><table><tbody>{plan.errors.slice(0, 50).map((e, i) => <tr key={i}><td>Dòng {e.line}</td><td className="h-red">{e.message}</td></tr>)}</tbody></table></div>}
          </div>
        )}
      </>}
      {result && (
        <div className="stack small">
          <div className="alert ok">Đã tạo {result.summary.created} sản phẩm ({result.summary.variants} SKU).</div>
          {(result.skipped.length > 0 || result.failed.length > 0) && <div className="table-wrap" style={{ maxHeight: 200 }}><table><tbody>
            {result.skipped.map((e, i) => <tr key={`s${i}`}><td>Dòng {e.line}</td><td>{e.message}</td></tr>)}
            {result.failed.map((e, i) => <tr key={`f${i}`}><td>Dòng {e.line}</td><td className="h-red">{e.name}: {e.message}</td></tr>)}
          </tbody></table></div>}
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
