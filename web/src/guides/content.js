// Nội dung trang Hướng dẫn. Viết cho người dùng cuối, theo đúng tên nút và tab đang có trong hệ thống.
// Khối nội dung: p (đoạn), steps (các bước đánh số, mỗi bước có thể kèm liên kết), tips (mẹo), warn (lưu ý dễ sai), faq (hỏi đáp).
export const GROUPS = ['Cẩm nang', 'Bắt đầu', 'Bán hàng', 'Hàng hoá & kho', 'Tiền & sổ sách', 'Khách hàng', 'Đọc số liệu', 'Hệ thống'];

export const GUIDES = [
  {
    id: 'cam-nang', group: 'Cẩm nang', title: 'Cẩm nang từng bước có hình mô phỏng', time: '20 phút', special: 'handbook',
    summary: 'Xem thao tác thật từ lúc tạo shop đến chốt tháng: nhập hàng, bán hàng, thu tiền nhiều lần, trả hàng, kho, báo cáo.',
    keywords: 'cẩm nang slide mô phỏng thao tác từng bước tình huống thanh toán nhiều đợt',
  },
  {
    id: 'bat-dau', group: 'Bắt đầu', title: 'Bắt đầu nhanh', time: '5 phút', summary: 'Từ tài khoản trống đến đơn hàng đầu tiên.',
    blocks: [
      { t: 'p', text: 'Mở Sổ là một cuốn sổ cái duy nhất cho mọi shop và mọi kênh bán. Mục tiêu: muốn biết doanh thu, tồn kho, lợi nhuận thì mở hệ thống, không phải cộng tay từ nhiều nơi.' },
      { t: 'steps', items: [
        { title: 'Tạo shop', text: 'Mỗi shop là một mảng kinh doanh. Chọn ngành bán để hệ thống tạo sẵn các trường thông tin khách và sản phẩm phù hợp (ví dụ mệnh và ngũ hành cho ngành phong thuỷ).' },
        { title: 'Tạo kho đầu tiên', text: 'Kho là nơi để hàng thật. Một kho có thể phục vụ nhiều shop.' },
        { title: 'Thêm sản phẩm', text: 'Chỉ cần tên, SKU, giá bán. Giá vốn và tồn đầu kỳ nhập luôn hoặc để sau.', to: '/products/new', cta: 'Thêm sản phẩm' },
        { title: 'Nhập hàng hoặc khai tồn đầu kỳ', text: 'Có tồn thì mới bán được. Hàng mới mua thì làm phiếu nhập; hàng đang có sẵn thì khai tồn đầu kỳ khi tạo sản phẩm.', to: '/purchases/new', cta: 'Tạo phiếu nhập' },
        { title: 'Bán đơn đầu tiên', text: 'Nhấn “Bán nhanh” ở thanh trên, chọn sản phẩm, nhấn “Bán xong”.', to: '/orders/new', cta: 'Tạo đơn' },
        { title: 'Xem kết quả', text: 'Tổng quan hiện doanh thu, lợi nhuận gộp, hàng sắp hết. Báo cáo cho số chi tiết hơn.', to: '/', cta: 'Mở Tổng quan' },
      ] },
      { t: 'tips', items: ['Điện thoại: dùng thanh tab dưới cùng và nút nổi “+ Đơn”. Bán trực tiếp nhanh trong dưới 30 giây.', 'Đổi shop ở nút trên cùng bên trái. Chế độ “Tất cả shop” chỉ có ở Báo cáo, Khách hàng, Kho.', 'Mọi thao tác có thể làm lại hoặc huỷ: hệ thống không xoá cứng dữ liệu nghiệp vụ.'] },
    ],
  },
  {
    id: 'tao-don', group: 'Bán hàng', title: 'Tạo đơn và theo dõi đơn', time: '6 phút', summary: 'Nháp, xác nhận, giao, hoàn thành, thu tiền, huỷ.',
    blocks: [
      { t: 'p', text: 'Mỗi đơn thuộc một shop và một kênh (bán trực tiếp, Shopee, Facebook…). Kho chỉ bị trừ khi đơn được xác nhận.' },
      { t: 'steps', items: [
        { title: 'Bán trực tiếp', text: 'Kênh mặc định là Bán trực tiếp. Gõ SKU hoặc tên để thêm hàng, chọn khách (hoặc bỏ trống khách lẻ), nhấn “Bán xong”: đơn hoàn thành và ghi nhận đã thu đủ trong một bước.', to: '/orders/new', cta: 'Tạo đơn' },
        { title: 'Đơn Facebook hoặc đơn cần giao', text: 'Nhấn “Lưu nháp” khi còn chờ khách chốt, “Xác nhận đơn” khi đã chắc. Xác nhận thì kho bị trừ và giá vốn được chụp lại.' },
        { title: 'Đổi trạng thái', text: 'Trong chi tiết đơn: xác nhận → đang giao → hoàn thành. Đơn đã xác nhận (hàng còn ở shop) sửa được cả sản phẩm: nhấn Sửa, kho tự cộng lại rồi trừ theo nội dung mới. Cần giao làm hai đợt thì nhấn “Tách đơn”; muốn giữ hàng cho khách chưa chốt thì nhấn “Giữ hàng” ở đơn nháp. Huỷ được khi đơn còn nháp hoặc đã xác nhận, kho được cộng lại đúng giá vốn lúc bán. Hàng đã giao đi thì không huỷ: dùng “Giao không thành” hoặc “Trả hàng”.' },
        { title: 'Ghi thanh toán', text: 'Thu một lần hoặc nhiều lần: tiền mặt, chuyển khoản, COD, ví. Đơn trạng thái chưa thu, thu một phần hay đã thu đủ tự cập nhật.' },
        { title: 'In phiếu bán hàng', text: 'Từ chi tiết đơn. Đây là chứng từ nội bộ, không phải hoá đơn thuế.' },
      ] },
      { t: 'p', text: 'Một đơn có thể lấy hàng từ nhiều kho theo thứ tự ưu tiên của shop. Trong form đơn có phần xem trước và chia kho tay nếu cần.' },
      { t: 'warn', text: 'Đơn hết tồn không xác nhận được (báo “Không đủ tồn kho”). Nhập hàng hoặc điều chỉnh tồn trước. Đơn import từ sàn thì khác: đơn đã xảy ra thật nên vẫn ghi nhận, kèm cờ cảnh báo để bạn kiểm kho.' },
      { t: 'faq', items: [
        ['Sửa đơn đã xác nhận được không?', 'Đơn nháp sửa tự do. Đơn đã xác nhận chỉ sửa ghi chú, mã vận đơn, phí, ngày… Muốn đổi hàng thì huỷ rồi tạo lại, hoặc dùng trả hàng và đổi hàng.'],
        ['Khách trả hàng thì làm sao?', 'Xem hướng dẫn “Trả hàng và đổi hàng”.'],
      ] },
    ],
    links: [['/orders', 'Mở danh sách đơn']],
  },
  {
    id: 'tra-hang', group: 'Bán hàng', title: 'Trả hàng và đổi hàng', time: '4 phút', summary: 'Hoàn kho, hoàn ship, phí trả hàng, tiền trả khách.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Mở đơn và nhấn “Trả hàng” (đơn đang giao thì nhấn “Giao không thành”)', text: 'Chọn lý do trả hàng trong danh sách (khách không nhận, giao sai, hàng lỗi…). Chọn sản phẩm và số lượng khách trả. Hàng chưa về shop thì tick “Hàng chưa về shop”: kho chưa tăng cho tới khi bạn nhấn “Đã nhận hàng”. Giá trị hàng trả lấy theo số tiền thực của dòng (đã trừ giảm giá).' },
        { title: 'Điền các khoản đi kèm', text: 'Hoàn ship cho khách, phí trả hàng shop giữ lại (nếu thu), ship chiều về shop chịu. Nếu shop giữ toàn bộ tiền thì đặt phí bằng giá trị trả.' },
        { title: 'Chọn có nhập lại kho không', text: 'Hàng còn bán được thì nhập lại kho đúng giá vốn đã chụp. Hàng hỏng thì không nhập lại; giá vốn vẫn tính.' },
        { title: 'Hoàn tiền', text: '“Cần trả khách” = hàng + ship hoàn − phí trả hàng. Trả ngay bao nhiêu thì điền ở ô tiền trả; phần còn lại là shop còn nợ khách, hoàn sau bằng nút “Hoàn tiền”.' },
      ] },
      { t: 'p', text: 'Hàng về bị hỏng: bỏ tick “Nhập lại kho” khi lập phiếu, hoặc nhấn “Hàng về bị hỏng” khi nhận hàng. Hệ thống tự lập phiếu hàng huỷ (mã HH-…). Hàng không vào kho, giá vốn của nó không được hoàn nên chịu như một khoản lỗ trong lãi gộp. Xem lại ở Chứng từ và ở Báo cáo → Doanh thu → Trả hàng theo lý do.' },
      { t: 'warn', text: 'Đơn kênh sàn (Shopee, TikTok Shop): sàn tự hoàn tiền cho người mua nên không có hoàn ship, phí trả hàng hay tiền trả khách. Hàng trả về có thể chờ “nhận hàng về kho” rồi mới cộng tồn.' },
      { t: 'tips', items: ['Trả một phần thì đơn vẫn là “hoàn thành” và có thêm phiếu trả. Trả hết thì đơn chuyển “đã trả hàng”.', 'Đổi hàng: dùng nút “Đổi hàng” trong chi tiết đơn; hệ thống xử lý hàng trả và hàng mới cùng lúc.'] },
    ],
  },
  {
    id: 'import-san', group: 'Bán hàng', title: 'Nhập đơn từ Shopee, TikTok Shop', time: '5 phút', summary: 'Xuất file từ sàn, chạy thử, xác nhận, đối soát tiền về.',
    blocks: [
      { t: 'p', text: 'Hệ thống chưa kéo đơn tự động từ sàn. Bạn xuất file đơn từ trang người bán rồi nhập vào hệ thống. File được đọc ngay trên trình duyệt, không gửi file thô lên máy chủ.' },
      { t: 'steps', items: [
        { title: 'Bật nền tảng', text: 'Cài đặt → Nền tảng: bật Shopee hoặc TikTok Shop để có kênh, mẫu import và quỹ nhận tiền.', to: '/settings', cta: 'Mở Cài đặt' },
        { title: 'Xuất file đơn từ sàn', text: 'Từ trang quản lý đơn của sàn (Excel hoặc CSV).' },
        { title: 'Nhập từ file', text: 'Ở trang Đơn hàng nhấn “Nhập từ file”, chọn shop, kênh và mẫu map cột. Mẫu Shopee có sẵn; mẫu TikTok là mẫu khởi đầu, sửa được nếu tên cột khác.', to: '/orders?import=1', cta: 'Nhập từ file' },
        { title: 'Xem trước rồi mới ghi', text: 'Bảng xem trước báo đơn nào sẽ tạo, đơn nào cập nhật, dòng nào lỗi. Dòng lỗi thường do SKU trong file không khớp SKU trong hệ thống.' },
        { title: 'Xác nhận', text: 'Đơn đã import lần trước nếu có trong file lần sau thì được cập nhật (trạng thái, tiền, phí sàn), không tạo trùng.' },
      ] },
      { t: 'p', text: 'Khi sàn chuyển tiền về, vào Chi phí & quỹ → Đối soát sàn: đơn hoàn thành chưa nhận tiền hiện là “tiền đang treo”. Chọn các đơn sàn đã trả và ghi nhận tiền về.' },
      { t: 'tips', items: ['Import định kỳ (hằng ngày hoặc mỗi vài ngày) để kho không lệch.', 'Đơn đặt từ lâu vẫn được trừ kho đúng ngày đặt trên sàn. Nếu kho đã chốt kỳ thì ghi vào ngày đầu của kỳ mở.', 'Phí sàn nằm trong đơn nên lợi nhuận đơn sàn đã trừ phí.'] },
    ],
    links: [['/expenses', 'Đối soát sàn']],
  },
  {
    id: 'san-pham', group: 'Hàng hoá & kho', title: 'Sản phẩm, biến thể và combo', time: '6 phút', summary: 'Tạo sản phẩm nhiều mùi/size, combo, bán ở nhiều shop.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Sản phẩm đơn giản', text: 'Một sản phẩm, một SKU, một giá. Bỏ trống các phần còn lại cũng được.', to: '/products/new', cta: 'Thêm sản phẩm' },
        { title: 'Sản phẩm có biến thể', text: 'Tick “Có biến thể”, thêm thuộc tính (mùi, size, màu), mỗi thuộc tính nhiều giá trị. Hệ thống sinh bảng tổ hợp: mỗi dòng có SKU tự sinh (sửa được), giá bán, giá vốn, tồn đầu kỳ, mã vạch, ảnh.' },
        { title: 'Combo', text: 'Nhấn “+ Combo”: chọn các sản phẩm thành phần và số lượng mỗi combo. Combo không có tồn riêng: số bán được lấy theo thành phần ít nhất. Bán combo thì trừ kho từng thành phần.', to: '/products/combo/new', cta: 'Tạo combo' },
        { title: 'Bán ở nhiều shop', text: 'Mục “Bán ở shop” trong form: chọn shop và giá riêng từng shop. Thông tin sản phẩm dùng chung, giá chỉnh riêng.' },
        { title: 'Xoá sản phẩm', text: 'Mở sản phẩm, nhấn “Xoá sản phẩm…” ở chân trang. Hệ thống hiện hậu quả trước khi làm gì cả. Sản phẩm chưa từng có đơn, phiếu nhập hay biến động kho thì xoá hẳn và SKU được giải phóng. Đã có lịch sử thì chỉ “ngừng kinh doanh”: ẩn khỏi bán, nhập, kiểm kê nhưng đơn và báo cáo cũ giữ nguyên.' },
        { title: 'Sản phẩm chưa gắn shop nào', text: 'Hàng mới tạo hoặc vật tư không gắn shop sẽ không hiện khi bạn đang lọc theo một shop. Vào Sản phẩm, chọn chip “Chưa gắn shop” để tìm, sửa hoặc xoá chúng. Ở trang Kho, nhấn vào một dòng rồi “Mở trang sản phẩm” cũng tới được.' },
        { title: 'Khôi phục sản phẩm đã ngừng', text: 'Sản phẩm → tab “Đã ngừng kinh doanh” → “Khôi phục”: sản phẩm và các biến thể bị ẩn cùng lúc được bán lại, niêm yết bật lại.' },
        { title: 'Ảnh và danh mục', text: 'Ảnh được thu nhỏ trên trình duyệt trước khi tải lên. Danh mục là cây; lọc theo danh mục cha gồm cả danh mục con.' },
      ] },
      { t: 'warn', text: 'Không gỡ được sản phẩm khi nó còn là thành phần của combo đang bán, nằm trong đơn nháp, phiếu nhập nháp hoặc phiếu kiểm kê chưa xong, hoặc đang âm kho. Còn hàng trong kho thì bạn phải xác nhận xuất huỷ: hệ thống lập phiếu hàng hỏng và tính giá vốn vào chi phí. Muốn giữ hàng thì bán hoặc chuyển hết trước.' },
      { t: 'warn', text: 'Bỏ một biến thể đã có lịch sử kho hoặc đơn thì hệ thống chỉ lưu trữ (ẩn), không xoá, và hỏi bạn xác nhận. Chưa từng dùng thì mới xoá hẳn.' },
      { t: 'tips', items: ['Đồng bộ sản phẩm sang shop khác: nút “Đồng bộ” ở danh sách sản phẩm.', 'Sản phẩm một biến thể muốn bán thêm mùi/size về sau: mở lại và tick “Có biến thể”, lịch sử kho và đơn được giữ nguyên.', 'Vật tư đóng gói và vật tư vận hành cũng là sản phẩm nhưng loại riêng, không niêm yết bán.'] },
    ],
    links: [['/products', 'Mở danh sách sản phẩm']],
  },
  {
    id: 'nhap-hang', group: 'Hàng hoá & kho', title: 'Nhập hàng và công nợ nhà cung cấp', time: '5 phút', summary: 'Phiếu nhập, phân bổ phí vào giá vốn, ship trả bên vận chuyển.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Tạo phiếu nhập', text: 'Chọn nhà cung cấp, kho nhập, thêm hàng với số lượng và giá nhập.', to: '/purchases/new', cta: 'Tạo phiếu nhập' },
        { title: 'Điền phí và chiết khấu', text: 'Phí ship nhập, phí khác, chiết khấu được chia vào giá vốn từng dòng theo giá trị. Giá vốn thực hiện ở chi tiết phiếu.' },
        { title: 'Nhận hàng', text: '“Nhận hàng & lưu” cộng kho ngay; “Lưu nháp” thì chưa ảnh hưởng gì cho tới khi nhấn “Nhận hàng”.' },
        { title: 'Ghi trả tiền', text: 'Trả một lần hoặc nhiều lần ở chi tiết phiếu. Số còn lại là công nợ nhà cung cấp.' },
      ] },
      { t: 'p', text: 'Ship nhập do bên vận chuyển thu (không phải nhà cung cấp)? Ở ô “Ship trả cho” chọn “Bên vận chuyển”. Ship vẫn tính vào giá vốn nhưng không cộng vào nợ nhà cung cấp. Trả bên vận chuyển bằng nút “Ghi trả ship” ở chi tiết phiếu.' },
      { t: 'warn', text: 'Ship không đi vào chi phí ngay lúc nhập. Nó nằm trong giá vốn và chỉ thành chi phí khi hàng bán ra. Đây là cách ghi đúng chuẩn kế toán.' },
      { t: 'faq', items: [
        ['Huỷ phiếu đã nhận được không?', 'Được, nếu hàng chưa bị bán bớt. Đã trả tiền nhà cung cấp thì phải ghi nhận nhà cung cấp hoàn tiền (chọn phương thức hoàn).'],
        ['Giá vốn tính thế nào?', 'Bình quân gia quyền di động theo kho. Mỗi lần nhập, giá vốn mới = (tồn cũ × giá cũ + số nhập × giá nhập đã phân bổ phí) / tổng tồn.'],
      ] },
    ],
    links: [['/purchases', 'Mở danh sách phiếu nhập']],
  },
  {
    id: 'quan-ly-kho', group: 'Hàng hoá & kho', title: 'Quản lý kho', time: '6 phút', summary: 'Tồn kho, lịch sử, kiểm kê, chuyển kho, điều chỉnh, nhiều kho.',
    blocks: [
      { t: 'p', text: 'Mọi thay đổi tồn kho đều đi qua sổ biến động kho nên truy ngược được: tồn này từ đâu ra, vì sao giảm.' },
      { t: 'steps', items: [
        { title: 'Xem tồn', text: 'Tab “Tồn kho”: lọc theo kho, danh mục, hoặc trạng thái (Còn hàng, Sắp hết, Bán chậm, Âm kho). “Còn đủ” cho biết hàng bán được bao nhiêu ngày nữa theo tốc độ bán gần đây.', to: '/stock', cta: 'Mở Kho' },
        { title: 'Lịch sử biến động', text: 'Tab “Lịch sử biến động” liệt kê từng lần vào/ra kho kèm chứng từ gốc.' },
        { title: 'Kiểm kê', text: 'Tab “Kiểm kê”: tạo phiếu (hệ thống chụp tồn hệ thống), nhập số đếm dần và lưu giữa chừng, hoàn tất thì hệ thống sinh điều chỉnh theo chênh lệch. Hàng bán trong lúc đếm không làm sai kết quả.' },
        { title: 'Điều chỉnh nhanh, hàng hỏng, tồn đầu kỳ', text: 'Nút “Điều chỉnh nhanh” ở đầu trang. Hàng đưa vào kho lần đầu cần nhập giá vốn.' },
        { title: 'Chuyển kho', text: 'Nút “Chuyển kho” (có khi bạn có từ hai kho). Giá vốn chuyển theo hàng.' },
        { title: 'Xuất vật tư', text: 'Vật tư dùng cho vận hành được xuất kho và ghi vào chi phí tương ứng.' },
      ] },
      { t: 'p', text: 'Nhiều kho cho một shop: Cài đặt → Shop & kho, đặt danh sách kho theo thứ tự ưu tiên. Đơn lấy kho đầu trước, thiếu thì lấy tiếp kho sau.' },
      { t: 'tips', items: ['Số tồn lệch với thực tế? Nên kiểm kê thay vì sửa tay: kiểm kê để lại dấu vết, sửa tay thì không.', 'Hàng âm kho thường do đơn trừ kho trước khi nhập hàng. Nhập phiếu nhập còn thiếu là hết.', 'Gỡ một kho: xem hướng dẫn “Chốt kho cuối kỳ và đóng kho”. Kho còn hàng phải chuyển sang kho khác trước.'] },
    ],
  },
  {
    id: 'gia-von', group: 'Hàng hoá & kho', title: 'Chọn cách tính giá vốn', time: '4 phút', summary: 'Bình quân gia quyền hay nhập trước xuất trước (FIFO), và đổi như thế nào.',
    blocks: [
      { t: 'p', text: 'Giá vốn là số tiền hệ thống tính cho mỗi món hàng khi bán, từ đó ra lãi gộp. Mở Sổ có hai cách tính. Mặc định là bình quân gia quyền.' },
      { t: 'steps', items: [
        { title: 'Bình quân gia quyền', text: 'Mỗi lần nhập, hệ thống tính lại giá bình quân của hàng đang có trong kho. Nhập 10 cái giá 40.000 và 10 cái giá 60.000 thì bán cái nào cũng tính 50.000. Giá vốn ổn định, dễ hiểu.' },
        { title: 'Nhập trước xuất trước (FIFO)', text: 'Hàng nhập trước được coi là bán trước. Cùng ví dụ trên, bán 15 cái thì 10 cái đầu tính 40.000 và 5 cái sau tính 60.000, tổng 700.000. Hợp khi giá nhập lên xuống nhiều và bạn muốn lãi bám sát từng đợt hàng.' },
        { title: 'Đổi cách tính', text: 'Cài đặt → Ngưỡng & kho → “Phương pháp tính giá vốn”. Hệ thống cho xem điều gì sẽ xảy ra trước khi đổi.', to: '/settings', cta: 'Mở Cài đặt' },
      ] },
      { t: 'p', text: 'Đổi cách tính không làm đổi giá trị tồn kho hiện tại, và đơn đã bán giữ nguyên giá vốn đã chụp. Phương pháp mới chỉ áp cho những lần xuất kho từ lúc đổi. Khi sang FIFO, hàng đang có trong kho được coi là một lô duy nhất ở giá bình quân hiện tại.' },
      { t: 'tips', items: ['Nên đổi đầu kỳ, sau khi chốt kho, để một kỳ không lẫn hai cách tính.', 'Mỗi kho tính riêng. Chuyển kho giữ nguyên giá từng lô và tuổi lô.', 'Hệ thống không có LIFO (nhập sau xuất trước): kế toán Việt Nam không dùng cách này.'] },
    ],
  },
  {
    id: 'van-chuyen', group: 'Bán hàng', title: 'Giao cho hãng vận chuyển và đối soát COD', time: '6 phút', summary: 'Vận đơn, tiền hãng giữ hộ, nhập bảng đối soát, hãng báo hoàn.',
    blocks: [
      { t: 'p', text: 'Khách trả tiền mặt khi nhận (COD) thì hãng vận chuyển giữ tiền vài ngày rồi mới chuyển, sau khi trừ phí. Mở Sổ theo dõi từng vận đơn để bạn biết hãng đang giữ bao nhiêu tiền của bạn.' },
      { t: 'steps', items: [
        { title: 'Giao đơn cho hãng', text: 'Mở đơn đã xác nhận, nhấn “Giao cho hãng vận chuyển”, chọn hãng (thêm mới nếu chưa có), nhập mã vận đơn. Tiền COD mặc định bằng số khách còn nợ; đặt 0 nếu khách đã trả đủ.' },
        { title: 'Theo dõi', text: 'Chi phí & quỹ → tab “Vận chuyển”: đang giao, đã giao nhưng hãng chưa chuyển tiền, hãng báo hoàn.', to: '/expenses', cta: 'Mở Chi phí & quỹ' },
        { title: 'Nhập bảng đối soát', text: 'Hãng gửi file đối soát (Excel/CSV). Nhấn “Nhập bảng đối soát của hãng”, chọn file, kiểm tra các cột hệ thống đã đoán, nhấn Xem trước rồi Chốt. Đơn giao thành công được ghi thu tiền COD và trừ phí; vận đơn hoàn thì lập phiếu trả chờ hàng về.' },
      ] },
      { t: 'tips', items: ['Phí giao của hãng được trừ vào khoản “ship shop tự trả” của đơn trước; phần còn lại cùng phí COD, phí hoàn thành chi phí vận chuyển.', 'Tiền hãng chuyển về = COD − các khoản phí. Con số này hiện ở phiếu đối soát.', 'In nhãn giao hàng: ở chi tiết đơn nhấn “In nhãn giao hàng”, hoặc ở tab Vận chuyển chọn nhiều vận đơn rồi nhấn “In nhãn”. Nhãn khổ 100×150 mm có mã vạch mã vận đơn, người nhận và tiền thu hộ.', 'Dòng không có mã trong hệ thống hoặc đã đối soát trước đó sẽ được liệt kê lý do và không ghi tiền.'] },
      { t: 'warn', text: 'Hệ thống chưa kết nối trực tiếp vào hệ thống của hãng nên chưa tự tạo vận đơn hay tự cập nhật trạng thái. Cột trong file mỗi hãng một khác: chỉnh lại ở bước chọn cột nếu hệ thống đoán sai.' },
    ],
  },
  {
    id: 'khuyen-mai', group: 'Khách hàng', title: 'Khuyến mãi và mã giảm giá', time: '5 phút', summary: 'Giảm theo đơn, theo sản phẩm, mua X tặng Y, theo hạng khách, voucher.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Tạo khuyến mãi', text: 'Loyalty & Campaign → tab “Khuyến mãi” → “+ Khuyến mãi”. Chọn loại, mức giảm, thời gian, shop/kênh áp dụng, giới hạn lượt.', to: '/loyalty', cta: 'Mở Loyalty' },
        { title: 'Tự áp hoặc theo mã', text: 'Không đặt mã thì khuyến mãi tự áp khi đơn đủ điều kiện. Có mã (ví dụ GIAM50) thì chỉ áp khi khách đọc đúng mã, nhập ở ô “Mã giảm giá” trong form đơn.' },
        { title: 'Xem kết quả', text: 'Danh sách khuyến mãi cho biết lượt dùng, tiền đã giảm và doanh thu của các đơn dùng nó.' },
      ] },
      { t: 'tips', items: ['Khuyến mãi không tick “cộng dồn” thì hệ thống chỉ chọn cái giảm nhiều nhất cho khách.', 'Mua 2 tặng 1: cứ 3 cái cùng sản phẩm thì 1 cái miễn phí.', 'Tặng quà kèm: chọn một sản phẩm khác làm quà, đặt điều kiện (đơn từ bao nhiêu hoặc mua sản phẩm nào). Quà ghi trên đơn giá 0, vẫn trừ kho và tính vào giá vốn.', 'Số giảm do máy chủ tính lại lúc tạo đơn, nên luôn khớp với số trong sổ.'] },
    ],
  },
  {
    id: 'lo-han-dung', group: 'Hàng hoá & kho', title: 'Lô hàng và hạn dùng', time: '3 phút', summary: 'Ghi lô khi nhập, bán lô hết hạn trước, cảnh báo sắp hết hạn.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Ghi lô khi nhập', text: 'Ở phiếu nhập, mỗi dòng hàng có ô “Lô” và “Hạn dùng” (tuỳ chọn). Khi nhận hàng, hệ thống tạo lô.' },
        { title: 'Xem lô', text: 'Kho → tab “Lô & hạn dùng”: lô đã hết hạn, sắp hết hạn, còn bao nhiêu và giá trị.', to: '/stock', cta: 'Mở Kho' },
      ] },
      { t: 'tips', items: ['Khi bán, chuyển kho hay ghi hao hụt, hệ thống lấy lô hết hạn sớm nhất trước.', 'Hàng không ghi lô vẫn bán bình thường; sổ lô chỉ là sổ phụ của kho.', 'Đổi số ngày cảnh báo ở Cài đặt → Ngưỡng & kho.'] },
    ],
  },
  {
    id: 'nhap-hang-loat', group: 'Hàng hoá & kho', title: 'Nhập sản phẩm hàng loạt từ Excel', time: '4 phút', summary: 'Đưa cả danh mục hàng vào hệ thống một lần.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Chuẩn bị file', text: 'Sản phẩm → “Nhập từ Excel” → “Tải file mẫu”. Mỗi dòng là một SKU. Các dòng cùng tên sản phẩm sẽ thành các biến thể của một sản phẩm.', to: '/products', cta: 'Mở Sản phẩm' },
        { title: 'Chọn file và kiểm tra cột', text: 'Hệ thống tự đoán cột nào là gì. Kiểm tra lại, nhất là Giá bán, Giá vốn và Tồn đầu kỳ.' },
        { title: 'Xem trước rồi nhập', text: 'Hệ thống báo sẽ tạo bao nhiêu sản phẩm, danh mục mới nào và dòng nào lỗi (thiếu giá vốn khi có tồn, SKU trùng…). Dòng lỗi được bỏ qua, các dòng đúng vẫn được nhập.' },
      ] },
      { t: 'tips', items: ['Có tồn đầu kỳ thì cần giá vốn và kho. Điền cột Kho hoặc chọn kho nhận chung trong hộp nhập.', 'Hàng đóng gói và vật tư vận hành ghi ở cột Loại (Đóng gói, Vận hành), không bán được trên đơn.', 'Nhập lại cùng file không tạo trùng vì SKU đã có sẽ bị bỏ qua.'] },
    ],
  },
  {
    id: 'nhac-no', group: 'Khách hàng', title: 'Hạn thanh toán và nhắc nợ', time: '4 phút', summary: 'Đặt hạn cho khách nợ, nhận nhắc, soạn tin nhắc nợ.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Đặt hạn', text: 'Ở form đơn, mục Thanh toán có ô “Hạn thanh toán phần còn nợ”. Muốn mọi đơn có hạn mặc định, đặt “Khách được nợ (ngày)” ở Cài đặt → Ngưỡng & kho.' },
        { title: 'Xem ai cần nhắc', text: 'Loyalty & Campaign → Hôm nay → “Nhắc nợ khách”: khoản quá hạn, sắp đến hạn và chưa đặt hạn.', to: '/loyalty', cta: 'Mở Loyalty' },
        { title: 'Soạn tin và ghi nhận', text: 'Nhấn “Soạn tin nhắc nợ”, sửa nếu cần rồi sao chép gửi cho khách. Nhấn “Đã nhắc, hẹn 3 ngày sau” để ẩn khoản đó tới lúc cần nhắc lại.' },
      ] },
      { t: 'tips', items: ['Nợ nhà cung cấp: đặt “Hạn trả nhà cung cấp” ở phiếu nhập, khoản sắp đến hạn cũng hiện ở Hôm nay.', 'Khách thanh toán đủ thì khoản nợ tự biến mất khỏi danh sách.'] },
    ],
  },
  {
    id: 'thong-bao', group: 'Hệ thống', title: 'Thông báo cho chủ shop và nhật ký thay đổi', time: '5 phút', summary: 'Nhận báo qua chuông, Telegram, webhook; xem ai đã sửa gì.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Chọn loại thông báo', text: 'Cài đặt → Thông báo. Bật các loại bạn cần: hàng sắp hết, hàng sắp hết hạn, đơn chờ giao lâu, khách nợ, nợ nhà cung cấp, đơn sàn chưa nhận tiền, tóm tắt ngày. Mỗi loại tối đa một lần mỗi ngày.', to: '/settings', cta: 'Mở Cài đặt' },
        { title: 'Chọn kênh nhận', text: 'Trong hệ thống: xem ở biểu tượng chuông. Telegram: tạo bot với @BotFather, nhập token và chat id, nhấn “Lưu và gửi thử”. Webhook: nối sang Zalo hoặc email qua Zapier, Make, n8n.' },
        { title: 'Xem nhật ký', text: 'Cài đặt → Nhật ký cho biết ai đã làm gì, lúc nào và trường nào đổi từ gì sang gì. Lọc theo đối tượng, hành động, ngày.' },
      ] },
      { t: 'warn', text: 'Token Telegram được lưu riêng và không hiện lại sau khi lưu. Nếu nghi lộ, tạo token mới ở @BotFather rồi nhập lại.' },
    ],
  },
  {
    id: 'chot-kho', group: 'Hàng hoá & kho', title: 'Chốt kho cuối kỳ và đóng kho', time: '6 phút', summary: 'Giữ nguyên số tồn của một kỳ, chặn sửa lùi ngày, mở lại có lý do.',
    blocks: [
      { t: 'p', text: 'Chốt kho là chọn một ngày (ví dụ cuối tháng) và nói với hệ thống: “Tồn đến hết ngày này là đã đúng, không cho sửa lùi nữa”. Hệ thống chụp lại tồn từng kho × sản phẩm và từ đó khoá mọi biến động kho có ngày đến hết ngày chốt.' },
      { t: 'steps', items: [
        { title: 'Kiểm kê xong trước', text: 'Hoàn tất hoặc huỷ mọi phiếu kiểm kê đang mở. Phiếu dở dang chặn việc chốt.', to: '/stock', cta: 'Mở Kho' },
        { title: 'Vào Kho → tab “Chốt kho”', text: 'Chọn ngày chốt (chỉ đến hôm qua trở về trước, vì hôm nay còn đang bán).' },
        { title: 'Đọc bảng kiểm tra', text: 'Mục đỏ là việc phải xong mới chốt được. Mục vàng là cảnh báo: phiếu nhập nháp, đơn nháp cũ, hàng đang âm kho, hàng trả chờ về. Cảnh báo không chặn nhưng nên xử lý.' },
        { title: 'Chốt kho', text: 'Xem tổng số dòng, số lượng, giá trị sẽ chụp rồi nhấn “Chốt kho”. Giá trị tính theo sổ kho: số lượng × giá vốn của các biến động đến hết ngày chốt.' },
      ] },
      { t: 'p', text: 'Sau khi chốt, đơn nhập từ sàn có ngày đặt trong kỳ đã chốt vẫn được trừ kho (vì hàng đã bán thật), nhưng ghi vào ngày đầu tiên của kỳ mở để số tồn đã chốt không đổi. Các thao tác thường ngày (nhập hàng, điều chỉnh, kiểm kê, chuyển kho, huỷ đơn) đều ghi vào hôm nay nên không bị ảnh hưởng.' },
      { t: 'p', text: 'Phát hiện nhập sót? Nhấn “Mở lại kỳ”, chọn lùi ngày chốt hoặc bỏ chốt, bắt buộc ghi lý do. Việc mở lại được ghi nhật ký. Sau khi sửa, chốt lại.' },
      { t: 'warn', text: 'Nếu số tồn của kỳ đã chốt khác ảnh chụp (thường do dữ liệu bị sửa ngoài ứng dụng), trang Chốt kho báo “Số tồn của kỳ đã chốt đang khác ảnh chụp”. Đừng bỏ qua cảnh báo này.' },
      { t: 'p', text: 'Gỡ hẳn một kho (ngừng dùng): Cài đặt → Shop & kho → nhấn vào kho → “Gỡ kho…”. Hệ thống hiện cảnh báo và liệt kê hậu quả trước khi làm gì cả.' },
      { t: 'steps', items: [
        { title: 'Xử lý việc dở dang', text: 'Hoàn tất hoặc huỷ phiếu kiểm kê đang mở; nhận hàng vào kho khác hoặc huỷ phiếu nhập nháp trỏ vào kho này; bù lại hàng đang âm kho. Nếu đây là kho duy nhất của một shop, thêm kho khác cho shop đó trước.' },
        { title: 'Chuyển hàng còn lại', text: 'Kho còn hàng thì phải chọn kho nhận. Hệ thống tạo một phiếu chuyển kho, giữ nguyên giá vốn từng mặt hàng. Không có chuyện bỏ hàng lại trong kho đã gỡ.' },
        { title: 'Gõ tên kho để xác nhận', text: 'Gỡ kho không hoàn tác được nên hệ thống bắt gõ đúng tên kho.' },
        { title: 'Kết quả', text: 'Kho bị gỡ khỏi danh sách kho của mọi shop (kho chính của shop cập nhật theo); đơn nháp đã chia hàng từ kho đó tự chia lại khi xác nhận. Kho chưa từng có biến động thì xoá hẳn. Kho đã có lịch sử thì chỉ đóng (ẩn): sổ kho, đơn và phiếu nhập cũ vẫn đọc được.' },
      ] },
      { t: 'faq', items: [
        ['Chốt kho có liên quan khoá sổ kế toán không?', 'Hai việc riêng. Chốt kho khoá biến động kho; khoá sổ kế toán khoá chứng từ tiền (chi phí, thanh toán, quỹ, chứng từ tay). Nên chốt kho trước rồi khoá sổ, cùng một ngày.'],
        ['Chốt rồi có xem lại được tồn không?', 'Có. “Xem tồn” ở lịch sử chốt kho hiện đủ từng kho, từng sản phẩm, số lượng và giá trị đã chụp.'],
      ] },
    ],
  },
  {
    id: 'chi-phi-quy', group: 'Tiền & sổ sách', title: 'Chi phí, quỹ tiền và đối soát', time: '5 phút', summary: 'Ghi chi phí, theo dõi két và ngân hàng, tiền sàn đang treo.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Ghi chi phí', text: 'Chi phí & quỹ → Chi phí: chọn danh mục, số tiền, ngày, shop (hoặc chung), phương thức trả. Phương thức trả quyết định tiền ra khỏi quỹ nào.', to: '/expenses', cta: 'Mở Chi phí & quỹ' },
        { title: 'Chi phí chung', text: 'Chi phí không gắn shop được chia về các shop khi xem báo cáo, theo quy tắc ở Cài đặt (theo doanh thu, chia đều hoặc tỷ lệ cố định).' },
        { title: 'Chi phí định kỳ', text: 'Tiền thuê, phần mềm… đặt một lần, hệ thống tạo từng kỳ (tuần, tháng, năm). Máy tắt thì tạo bù khi bật lại.' },
        { title: 'Quỹ tiền', text: 'Két tiền mặt, ngân hàng, ví. Số dư luôn tính từ sổ, không lưu. Chuyển quỹ và kiểm đếm (phần chênh ghi thành dòng điều chỉnh, không sửa thu chi cũ).' },
      ] },
      { t: 'tips', items: ['Mỗi phương thức thanh toán thuộc đúng một quỹ. Phương thức chưa gán quỹ được cảnh báo ở Tổng quan.', 'Mỗi tuần nên đếm két và so với số dư ngân hàng.', 'Quỹ âm thường là thu chi chưa ghi hoặc thiếu số dư đầu kỳ.'] },
    ],
  },
  {
    id: 'so-ke-toan', group: 'Tiền & sổ sách', title: 'Sổ kế toán', time: '7 phút', summary: 'Sổ cái kép tự sinh, chứng từ tay, tài sản, khoá sổ.',
    blocks: [
      { t: 'p', text: 'Sổ kế toán được dựng tự động từ đơn, phiếu nhập, thanh toán, chi phí, kho và quỹ. Bạn không phải ghi bút toán. Sửa hay huỷ chứng từ gốc thì sổ tự sinh lại.' },
      { t: 'steps', items: [
        { title: 'Đọc báo cáo', text: 'Tổng quan, Kết quả kinh doanh (lọc kỳ và shop), Cân đối kế toán, Lưu chuyển tiền, Cân đối phát sinh. Nhấn vào số ở sổ cái để mở chứng từ gốc.', to: '/accounting', cta: 'Mở Sổ kế toán' },
        { title: 'Chứng từ tay', text: 'Việc hệ thống không tự biết: góp vốn, rút vốn, thu/chi khác, tiền phạt. Lập phiếu thu, phiếu chi hoặc bút toán tổng hợp (phải cân Nợ = Có).' },
        { title: 'Tài sản và chi phí trả trước', text: 'Mua máy móc, trả trước tiền thuê: hệ thống khấu hao/phân bổ mỗi tháng. Thanh lý thì giá trị còn lại vào chi phí khác.' },
        { title: 'Khoá sổ', text: 'Đặt ngày khoá: chứng từ tay, chi phí, thanh toán, quỹ, tài sản có ngày đến hết hôm đó không sửa được. Đơn và phiếu nhập vẫn nhập được (đơn sàn import muộn là bình thường) nhưng nếu số kỳ đã khoá đổi, trang Tổng quan báo.' },
      ] },
      { t: 'warn', text: 'Đây là sổ nội bộ để quản trị, chưa phải sổ theo mẫu Thông tư và không dùng để nộp thuế. Lợi nhuận kế toán có thể lệch lợi nhuận ở Báo cáo vì khấu hao, thu chi khác và chênh lệch kho/quỹ; Báo cáo giải thích từng khoản.' },
      { t: 'faq', items: [
        ['Có phải kết chuyển cuối kỳ không?', 'Không cần. Kết quả kinh doanh tính thẳng từ tài khoản doanh thu và chi phí của kỳ; Cân đối kế toán hiện lợi nhuận chưa kết chuyển ở dòng “421 – lợi nhuận kỳ này”.'],
        ['Phí ship nhập ghi chi phí khi nào?', 'Khi hàng bán ra, thông qua giá vốn. Lúc nhập, nó nằm trong giá trị hàng tồn kho.'],
      ] },
    ],
  },
  {
    id: 'khach-hang', group: 'Khách hàng', title: 'Khách hàng và chăm khách', time: '6 phút', summary: 'Hồ sơ, nhãn, hạng, nhắc mua lại, sinh nhật, mệnh.',
    blocks: [
      { t: 'p', text: 'Hồ sơ khách (tên, số điện thoại, địa chỉ, ngày sinh) là một cho cả tài khoản, nhận diện bằng số điện thoại. Danh sách và thông tin riêng (nhãn, ghi chú, trường tuỳ chỉnh) là của từng shop.' },
      { t: 'steps', items: [
        { title: 'Thêm khách', text: 'Khi tạo đơn hoặc ở trang Khách hàng. Trùng số điện thoại thì dùng lại hồ sơ cũ.', to: '/customers', cta: 'Mở Khách hàng' },
        { title: 'Nhãn và thông tin riêng', text: 'Nhãn “VIP” ở shop này không hiện ở shop kia. Thêm trường riêng (mùi yêu thích, dòng xe…) ở “Thông tin khách của shop”.' },
        { title: 'Gộp hồ sơ trùng', text: 'Mở hồ sơ, chọn gộp: đơn, ghi chú, nhãn của hai hồ sơ được hợp lại.' },
        { title: 'Xoá khách', text: 'Chỉ xoá khỏi một shop, không đụng hồ sơ chung và lịch sử đơn. Khách mua lại thì tự quay về danh sách.' },
        { title: 'Loyalty & Campaign', text: 'Tab “Hôm nay”: khách cần nhắc mua lại (theo chu kỳ dùng hết của sản phẩm) và sinh nhật. Soạn tin từ mẫu rồi sao chép gửi. Tab Hạng khách đặt ngưỡng chi tiêu và % giảm giá gợi ý.', to: '/loyalty', cta: 'Mở Loyalty' },
      ] },
      { t: 'tips', items: ['Shop phong thuỷ: mệnh tự tính từ ngày sinh (chính xác theo âm lịch) hoặc năm sinh (ước tính), có thể ghi đè tay. Tab “Gợi ý theo mệnh” gợi ý vật phẩm hợp mệnh.', 'Điền chu kỳ dùng hết (ngày) ở sản phẩm để hệ thống biết khi nào nhắc mua lại.'] },
      { t: 'p', text: 'Gửi tin tự động chưa có. Tab “Tự động hoá” chỉ nói rõ điều đó.' },
    ],
  },
  {
    id: 'bao-cao', group: 'Đọc số liệu', title: 'Đọc báo cáo', time: '5 phút', summary: 'Bộ lọc, các tab báo cáo, biểu tượng ⓘ, xuất Excel.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Chọn phạm vi', text: 'Đầu trang luôn có dải “Đang xem: shop · khoảng ngày · kênh · so với kỳ trước”. Đọc dải này trước khi đọc số.', to: '/reports', cta: 'Mở Báo cáo' },
        { title: 'Chọn tab', text: 'Doanh thu, Lợi nhuận (kèm ước tính thuế), Chi phí, Kênh, Sản phẩm, Khách, Kho, Tiền & công nợ, Chỉ số tuỳ chỉnh, Sức khoẻ.' },
        { title: 'Nhấn ⓘ khi không hiểu số', text: 'Mỗi chỉ số giải thích nghĩa, cách tính, lấy từ đâu, tính cho shop nào và có liên kết tới dữ liệu gốc.' },
        { title: 'Xuất Excel', text: 'Mỗi tab xuất đúng cái đang xem, mỗi bảng một sheet, tiền là số. Có thêm sheet “Giải thích”.' },
      ] },
      { t: 'warn', text: 'Một số số không theo bộ lọc: nợ nhà cung cấp, số dư quỹ, thuế (toàn tài khoản) và tồn kho (đến hôm nay). Chúng có nhãn “Toàn tài khoản” cạnh con số.' },
      { t: 'tips', items: ['Doanh thu thuần đã trừ hàng trả. Hàng trả tính vào ngày của đơn gốc, nên doanh thu của một ngày không đổi ngược khi có hoàn sau đó.', 'Lọc kênh: chi phí không gắn kênh được chia cho các kênh theo doanh thu, cộng các kênh lại vẫn bằng tổng.'] },
    ],
  },
  { id: 'suc-khoe-kinh-doanh', group: 'Đọc số liệu', title: 'Cách đọc sức khoẻ kinh doanh', time: '5 phút mỗi sáng', summary: 'Năm câu hỏi theo thứ tự, mỗi câu có màu và việc nên làm.', special: 'health' },
  {
    id: 'truong-cong-thuc', group: 'Hệ thống', title: 'Trường tuỳ chỉnh và công thức', time: '6 phút', summary: 'Thêm thông tin riêng, tự tính bằng công thức.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Thêm trường', text: 'Cài đặt → Trường tuỳ chỉnh, hoặc “Thông tin khách của shop” ở trang Khách hàng. Chọn đối tượng (đơn, sản phẩm, phiếu nhập, khách), kiểu (chữ, số, tiền, ngày, chọn một/nhiều, có/không, công thức).', to: '/settings', cta: 'Mở Cài đặt' },
        { title: 'Trường công thức', text: 'Gõ { để chọn biến, gõ chữ để chọn hàm, hoặc nhấn biến/hàm ở bảng “Chèn vào công thức”. Khung “Kết quả thử” hiện ngay kết quả trên bản ghi mẫu; sai thì báo đúng chỗ.' },
        { title: 'Chỉ số báo cáo riêng', text: 'Cài đặt → Chỉ số báo cáo: công thức trên các chỉ số tổng hợp, ví dụ lợi nhuận mỗi đơn.' },
      ] },
      { t: 'p', text: 'Ví dụ: tỷ lệ lãi của đơn = IF({total_amount} > 0, ROUND(({total_amount} - {cogs_amount}) * 100 / {total_amount}, 1), 0). Muốn tính tuổi khách dùng AGE({birth_date}).' },
      { t: 'tips', items: ['“Ẩn” trường thì giữ dữ liệu, hiện lại được. “Xoá” là xoá hẳn: hệ thống lưu bản sao vào nhật ký, và chặn nếu công thức khác còn dùng.', 'Giá trị mặc định chỉ điền sẵn trên form, nhấn Lưu mới ghi vào bản ghi.', 'Công thức trống kết quả thì có lý do ngay cạnh (ví dụ “Khách chưa có Ngày sinh”).'] },
    ],
  },
  {
    id: 'cai-dat', group: 'Hệ thống', title: 'Cài đặt, sao lưu và tài khoản', time: '5 phút', summary: 'Shop và kho, ngưỡng sức khoẻ, thuế, API key, webhook, sao lưu.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Shop & kho', text: 'Thêm shop, kho, đổi ngành bán, đặt thứ tự kho ưu tiên của shop.', to: '/settings', cta: 'Mở Cài đặt' },
        { title: 'Màu giao diện của shop', text: 'Nhấn vào một shop, kéo xuống “Màu giao diện của shop”: chọn màu chủ đạo (nút chính, liên kết) và màu nền. Màu quá nhạt hoặc nền quá tối bị chặn để chữ luôn đọc được. “Về màu mặc định” trả shop về màu của chủ đề. Màu chỉ áp dụng khi bạn đang làm việc ở shop đó.' },
        { title: 'Ngưỡng & kho', text: 'Đặt ngưỡng vàng/đỏ của biên lợi nhuận, tỷ lệ huỷ, hoàn trả, số ngày tồn, khách mua lại. Đây là cơ sở của màu trong “Cách đọc sức khoẻ kinh doanh”. Cũng ở đây: cách chia chi phí chung.' },
        { title: 'Thuế ước tính', text: 'Mặc định tắt và hệ thống không tự đặt mức thuế nào vì mức thuế thay đổi. Bạn nhập tỷ lệ, cơ sở tính, ngưỡng miễn thuế. Đây chỉ là ước tính, không phải tờ khai.' },
        { title: 'API key và webhook', text: 'Để nối phần mềm kế toán, Zapier… Xem tài liệu API ở /api/v1/docs.' },
        { title: 'Sao lưu & xuất', text: 'Hệ thống sao lưu hằng ngày vào thư mục data/backups. Nút “Tải bản sao lưu” và “Xuất CSV toàn bộ” ở đây.' },
      ] },
      { t: 'warn', text: 'Dữ liệu nằm trên máy chạy Mở Sổ. Mất máy mà chưa copy sao lưu ra ngoài (iCloud, Google Drive) là mất dữ liệu. Nên đồng bộ thư mục data/backups ra ngoài máy.' },
      { t: 'tips', items: ['Điện thoại truy cập qua cùng wifi: http://<địa chỉ IP của máy>:3000.', 'Chạy lên VPS thì đặt sau HTTPS và bật cookie Secure.', 'Đổi mật khẩu ở tab Tài khoản. Mỗi tài khoản có dữ liệu riêng hoàn toàn.'] },
    ],
  },
];

export const byId = (id) => GUIDES.find((g) => g.id === id);

/** Văn bản tìm kiếm của một hướng dẫn: tiêu đề, tóm tắt và toàn bộ nội dung */
export function searchText(g) {
  const parts = [g.title, g.summary, g.group, g.keywords || ''];
  for (const b of g.blocks || []) {
    if (b.text) parts.push(b.text);
    for (const it of b.items || []) parts.push(typeof it === 'string' ? it : Array.isArray(it) ? it.join(' ') : `${it.title} ${it.text}`);
  }
  return parts.join(' ').toLowerCase();
}
