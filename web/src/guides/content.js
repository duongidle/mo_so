// Nội dung trang Hướng dẫn. Viết cho người dùng cuối, theo đúng tên nút và tab đang có trong hệ thống.
// Khối nội dung: p (đoạn), steps (các bước đánh số, mỗi bước có thể kèm liên kết), tips (mẹo), warn (lưu ý dễ sai), faq (hỏi đáp ngắn cuối bài), qa (nhiều nhóm hỏi đáp, dùng cho trang Hỏi đáp tình huống).
export const GROUPS = ['Cẩm nang', 'Bắt đầu', 'Bán hàng', 'Hàng hoá & kho', 'Tiền & sổ sách', 'Khách hàng', 'Đọc số liệu', 'Hệ thống'];

export const GUIDES = [
  {
    id: 'cam-nang', group: 'Cẩm nang', title: 'Cẩm nang từng bước', time: '20 phút', special: 'handbook',
    summary: 'Xem thao tác thật từ lúc tạo shop đến chốt tháng.',
    keywords: 'cẩm nang slide mô phỏng thao tác từng bước tình huống thanh toán nhiều đợt',
  },
  {
    id: 'hoi-dap', group: 'Cẩm nang', title: 'Hỏi đáp tình huống', time: 'Tra khi cần',
    summary: 'Gặp việc thực tế thì xem cách xử lý: nhập sai, trả nhiều lần, khách không nhận hàng, kho lệch…',
    keywords: 'q&a hỏi đáp tình huống thực tế sai số lượng thanh toán nhiều lần cọc ship hoàn tiền huỷ đơn',
    blocks: [
      { t: 'p', text: 'Mỗi câu hỏi là một tình huống shop hay gặp. Nhấn vào câu hỏi để xem cách xử lý, theo đúng tên nút bạn đang thấy trong hệ thống.' },
      { t: 'qa', sections: [
        { title: 'Nhập hàng và nhà cung cấp', items: [
          ['Nhập theo kg, bán theo hộp 500 g thì làm thế nào?', 'Có ba cách, chọn theo cách bạn làm hàng. (1) Nhập thẳng hộp: nếu nhà cung cấp giao sẵn hộp đóng, tạo sản phẩm “hộp 500 g” và nhập bằng phiếu nhập như hàng thường, không cần gì thêm. (2) Đóng hết ngay khi nhập: nhập 20 kg ở phiếu nhập (ghi lô và hạn dùng), rồi vào Kho → Đóng gói → “+ Phiếu đóng gói”, thêm thành phẩm “hộp 500 g” với số hộp đếm được (ví dụ 39), nhấn “Gợi ý hàng nguồn” để có 20 kg và bao bì (hộp rỗng, tem) rồi sửa số thực tế. Giá vốn mỗi hộp = giá trị 20 kg và bao bì chia cho 39 hộp, nên hao hụt khi đóng đã nằm trong giá vốn. (3) Đóng dần: để kg trong kho, mỗi lần đóng lập một phiếu đóng gói nhỏ (ví dụ 5 kg ra 10 hộp). Hệ thống lấy kg theo lô hết hạn sớm nhất, hoặc bạn chọn lô ở dòng nguồn; hộp mới nhận lô và hạn dùng của số kg đã dùng. Phiếu đóng gói không tạo lãi lỗ, chỉ chuyển giá trị tồn từ kg sang hộp. Đóng nhầm thì “Huỷ phiếu” (cần lý do), được khi hộp còn đủ trong kho.'],
          ['Tạo phiếu nhập sai số lượng thì sao?', 'Phiếu chưa nhận hàng (nháp): mở phiếu, nhấn “Sửa phiếu”, đổi số lượng, giá, phí hoặc nhà cung cấp rồi “Lưu thay đổi” (hoặc “Nhận hàng & lưu” nếu đã đủ hàng). Kho chưa bị ảnh hưởng gì. Phiếu đã nhận hàng không sửa trực tiếp: nhấn “Huỷ phiếu” rồi tạo phiếu mới đúng số lượng. Hệ thống rút lại số hàng đã cộng, và nếu phiếu đã trả tiền thì bạn chọn cách nhà cung cấp hoàn lại số đã trả. Nếu hàng đã bán bớt nên không còn đủ để rút, hệ thống từ chối huỷ: giữ phiếu và dùng Kho → Điều chỉnh +/− để sửa phần chênh lệch, ghi rõ lý do.'],
          ['Nhà cung cấp giao thiếu hoặc dư so với phiếu?', 'Cách xử lý giống phiếu nhập sai số lượng. Tốt nhất đếm hàng trước khi nhấn “Nhận hàng & lưu”: lưu nháp thì chưa cộng kho và chưa ghi nợ, nên sửa lại hoặc huỷ đi tạo lại không để lại hậu quả.'],
          ['Ghi nhầm số tiền trả nhà cung cấp hoặc trả ship?', 'Ở chi tiết phiếu, mỗi khoản đã trả có nút “Huỷ khoản này”. Khoản bị huỷ gạch ngang, số đã trả và số còn nợ tính lại ngay, rồi ghi lại khoản đúng. Khoản huỷ vẫn nằm trong nhật ký. Phiếu đã huỷ thì không huỷ lẻ từng khoản được, và ngày đã khoá sổ thì bị chặn.'],
          ['Thanh toán nhiều lần cho một phiếu nhập thì sao?', 'Mở chi tiết phiếu nhập, nhập số tiền vào ô “Trả nợ (còn …)”, chọn phương thức rồi nhấn nút trả. Làm bao nhiêu lần cũng được, mỗi lần là một dòng và có thể dùng phương thức khác nhau (đợt đầu chuyển khoản, đợt sau tiền mặt). Tổng các lần không được vượt tổng phiếu: trả quá sẽ bị từ chối. Phần còn nợ hiện ở Chi phí & quỹ → Công nợ phải trả.'],
          ['Phí giao hàng nhập là trả cho bên vận chuyển, không phải nhà cung cấp?', 'Khi lập phiếu, ở phần phí ship chọn “Hãng vận chuyển”. Ship vẫn được chia vào giá vốn từng món, nhưng không cộng vào số nợ nhà cung cấp. Bạn trả ship riêng ở chi tiết phiếu, ô “Trả ship (còn …)”; trả nhiều lần được, không vượt số ship của phiếu.'],
          ['Quên ghi phí ship sau khi đã nhận hàng?', 'Phiếu đã nhận không sửa được phí. Nếu muốn giá vốn gồm cả ship thì huỷ phiếu và tạo lại. Nếu chỉ cần ghi khoản chi thì thêm ở Chi phí & quỹ → Chi phí; khi đó khoản này là chi phí kỳ này và không nằm trong giá vốn.'],
          ['Làm sao biết shop đang nợ ai, bao nhiêu, bao giờ đến hạn?', 'Chi phí & quỹ → Công nợ phải trả. Trang gom nợ nhà cung cấp, ship còn nợ hãng vận chuyển, tiền còn nợ khách và các chi phí định kỳ sắp đến kỳ, xếp theo quá hạn, sắp đến hạn, chưa đặt hạn. Hạn trả nhà cung cấp đặt ở phiếu nhập. Muốn được báo, bật “Sắp đến hạn trả nhà cung cấp” ở Cài đặt → Thông báo.'],
          ['Mỗi lần nhập giá khác nhau thì giá vốn tính thế nào?', 'Mặc định hệ thống dùng bình quân gia quyền: giá vốn được tính lại sau mỗi lần nhập. Nếu giá nhập lên xuống nhiều và bạn muốn lãi bám sát từng đợt hàng, đổi sang nhập trước xuất trước (FIFO) ở Cài đặt → Ngưỡng & kho. Xem bài “Chọn cách tính giá vốn”.'],
        ] },
        { title: 'Bán hàng và thu tiền', items: [
          ['Khách thanh toán nhiều lần thì sao, tối đa mấy lần?', 'Không giới hạn số lần. Ở chi tiết đơn nhấn “Thu tiền (số còn nợ)”, nhập số tiền và phương thức; mỗi lần thêm một dòng ở mục Thanh toán. Trạng thái đổi từ Chưa thu sang Thu một phần rồi Đã thu đủ. Mỗi lần có thể một phương thức khác nhau. Thu thừa thì hệ thống không chặn mà báo “cần hoàn lại khách”.'],
          ['Khách đặt cọc, mấy hôm sau mới lấy hàng?', 'Tạo đơn rồi xác nhận (xác nhận thì hàng bị trừ kho). Nếu chưa muốn trừ kho, để đơn nháp và nhấn “Giữ hàng” kèm hạn giữ: đơn khác không xác nhận được phần hàng đó. Nhấn “Thu tiền” ghi số cọc, đơn ở trạng thái Thu một phần. Khi khách lấy hàng, thu nốt phần còn lại. Đơn đã giao xong mà khách còn nợ sẽ vào danh sách Nhắc nợ ở Loyalty → Hôm nay.'],
          ['Khách đã cọc rồi không lấy nữa?', 'Nhấn “Huỷ đơn”: hàng được cộng lại kho. Vì đơn còn tiền khách đã thu, hộp thoại bắt chọn một trong hai. “Hoàn lại khách”: shop nợ khách đúng số đã thu, hoàn ngay (chọn phương thức) hoặc hoàn sau; khoản chưa hoàn nằm ở Chi phí & quỹ → Công nợ phải trả và nút “Hoàn tiền” trên đơn. “Giữ cọc”: nhập số giữ (mặc định toàn bộ), số đó thành thu nhập khác của shop, hiện ở Báo cáo là “Cọc giữ lại” (cộng vào lợi nhuận gộp, không tính là doanh thu thuần) và ở sổ kế toán là tài khoản 5119; phần còn lại, nếu có, hoàn cho khách như trên. Đơn sàn không cần chọn.'],
          ['Bán dịch vụ (khai quang, chỉnh size…) thì sao?', 'Tạo sản phẩm với Loại mặt hàng là “Dịch vụ (không tồn kho)”. Dịch vụ niêm yết và bán như hàng nhưng không trừ kho, không có giá vốn và không xuất hiện ở Kho, Nhập hàng, Kiểm kê. Khách trả lại dịch vụ thì dùng Trả hàng để hoàn tiền, không có hàng quay về kho. Sản phẩm đã có đơn không đổi qua lại giữa hàng hoá và dịch vụ được.'],
          ['Bán hàng từ lô đã hết hạn?', 'Xác nhận đơn chạm lô quá hạn sẽ bị chặn. Tốt nhất vào Kho → Lô & hạn dùng, nhấn “Xuất huỷ lô” để bỏ lô đó (lập phiếu hàng hỏng). Nếu vẫn muốn bán, xác nhận khi được hỏi: đơn được đánh dấu cảnh báo. Form đơn báo trước lô hết hạn và sắp hết hạn.'],
          ['Phí ship do shop tự trả thì ghi ở đâu?', 'Trong form đơn, nhập ở ô “Ship shop chịu”. Khoản này không tính vào số tiền khách phải trả mà làm giảm lãi của đơn. Khi trả cho hãng vận chuyển, nhấn “Ghi đã trả ship cho hãng vận chuyển” ở chi tiết đơn; số còn nợ hãng hiện ở Công nợ phải trả. Đơn sàn thì sàn đã trừ ship vào tiền trả shop nên không cần ghi.'],
          ['Tạo đơn nhầm sản phẩm hoặc số lượng?', 'Đơn nháp: nhấn “Sửa”. Đơn đã xác nhận mà chưa giao: cũng nhấn “Sửa”, hệ thống cộng hàng về kho rồi trừ lại theo nội dung mới, tiền đã thu giữ nguyên. Đơn đang giao thì không sửa được dòng hàng. Đơn đã hoàn thành: dùng “Trả hàng” hoặc “Đổi hàng”.'],
          ['Ghi nhầm khoản thu hoặc hoàn tiền của đơn?', 'Ở mục Thanh toán của đơn, mỗi khoản có nút “Huỷ” (cả khoản trả ship cho hãng). Số đã thu và công nợ của đơn tính lại ngay; khoản huỷ gạch ngang và vẫn nằm trong nhật ký. Không huỷ lẻ được khoản do phiếu trả hàng tạo ra, khoản dùng tiền khách gửi, khoản đối soát hãng vận chuyển (huỷ cả phiếu đối soát, xem câu bên dưới), và khoản thu đã có tiền hoàn dựa trên nó (huỷ khoản hoàn trước). Tiền sàn trả ghi nhầm thì huỷ được, đơn hiện lại là tiền đang treo; riêng đơn đã đối soát lệch (có cộng phần lệch vào phí sàn) phải sửa phí sàn trước.'],
          ['Đơn hết hàng thì xác nhận được không?', 'Hệ thống báo thiếu tồn và hỏi có cho phép âm kho không. Nên nhập hàng hoặc điều chỉnh tồn trước. Chỉ cho âm kho khi chắc chắn hàng thật vẫn còn, rồi nhập phiếu bổ sung sau để tồn khớp lại.'],
          ['Khách muốn đổi sang món khác?', 'Nhấn “Đổi hàng” ở chi tiết đơn (đơn phải có hồ sơ khách): chọn hàng khách trả, tìm món mới. Chênh lệch thì thu thêm, hoặc phần dư được giữ thành tiền khách gửi tại shop để lần sau dùng.'],
          ['Khách mua nợ, hẹn trả sau?', 'Đặt “Hạn thanh toán” ở form đơn (hoặc đặt số ngày nợ mặc định ở Cài đặt). Đến hạn, Loyalty → Hôm nay hiện thẻ Nhắc nợ kèm tin nhắn soạn sẵn. Nhắc rồi thì nhấn “Đã nhắc, hẹn 3 ngày sau” để khoản đó tạm ẩn.'],
        ] },
        { title: 'Giao hàng, trả hàng', items: [
          ['Đơn đang giao có huỷ được không?', 'Không. Hàng đang ở hãng vận chuyển nên cộng kho lúc này là sai. Nếu khách không nhận hoặc giao không thành, nhấn “Giao không thành”.'],
          ['Giao tới nơi nhưng khách không nhận?', 'Nhấn “Giao không thành” ở đơn đang giao. Hệ thống lập phiếu trả toàn bộ, chọn lý do (khách không nhận…), hoàn ship khách đã trả nếu có, và để hàng ở trạng thái chờ về. Khi hàng về tới shop, nhấn “Đã nhận hàng, nhập kho” ở phiếu trả thì kho mới cộng lại.'],
          ['Hàng trả về bị hỏng thì sao?', 'Ở form trả hàng, bỏ chọn “Nhập lại kho”. Hệ thống tự lập phiếu hàng huỷ (mã HH-…) ghi số lượng và giá vốn. Hàng không vào kho, giá vốn của nó nằm lại trong đơn nên lãi gộp thể hiện đúng phần thiệt. Xem lại các phiếu ở trang Chứng từ.'],
          ['Khách trả hàng quá thời hạn?', 'Nếu bạn đặt “Nhận trả hàng trong (ngày)” ở Cài đặt → Ngưỡng & kho, đơn quá hạn sẽ được hỏi lại. Nhận ngoại lệ thì xác nhận, không thì thôi. Đặt 0 để không giới hạn.'],
          ['Khách trả hàng nhưng shop chỉ muốn giữ lại một phần tiền?', 'Ở form trả hàng nhập “Phí trả hàng shop giữ lại”. Số tiền cần trả khách = hàng trả + ship hoàn − phí trả hàng; bạn nhập số trả ngay, phần chưa trả hiện là khoản còn nợ khách ở Công nợ phải trả.'],
          ['Khách nhận nông sản bị lỗi, shop hoàn một nửa tiền và khách giữ hàng?', 'Mở đơn → Khác → “Giảm giá sau bán / bồi thường”. Nhập số tiền giảm (tối đa bằng tiền hàng còn lại của đơn), chọn lý do, rồi nhập số hoàn ngay nếu khách đã trả. Kho và giá vốn không đổi, đơn vẫn hoàn thành; doanh thu và lãi giảm đúng số đó. Khách chưa trả đủ thì khoản giảm chỉ bớt công nợ; khách đã trả đủ mà chưa hoàn thì hiện là khoản còn nợ khách, hoàn sau bằng nút “Hoàn tiền”. Đơn sàn cũng ghi được nhưng chỉ giảm số phải thu từ sàn, không có tiền trả khách.'],
          ['Đơn Shopee bị trả hàng, phí sàn tính thế nào?', 'Shopee không thu phí cố định, phí dịch vụ, phí xử lý giao dịch với hàng Trả hàng và Hoàn tiền, nên form trả hàng của đơn sàn có ô “Phí sàn được hoàn”, điền sẵn theo tỷ lệ hàng trả (trả hết thì hoàn đủ phí). Nếu chỉ hoàn tiền cho người mua mà không lấy hàng về, sàn vẫn tính phí: sửa ô này về 0. Khoản được hoàn làm giảm phí sàn và số phải thu từ sàn, nên đơn trả hết không còn lỗ phí sàn và không còn nằm trong tiền treo.'],
          ['Khách bảo hàng lỗi, còn bảo hành không?', 'Chứng từ → Tra cứu bảo hành: gõ số điện thoại, tên khách, mã đơn hoặc SKU. Sản phẩm có số ngày bảo hành thì hệ thống tính hạn từ ngày đơn hoàn thành.'],
        ] },
        { title: 'Kho', items: [
          ['Hàng hao, hỏng, hết hạn thì ghi thế nào để biết hao bao nhiêu?', 'Kho → “Điều chỉnh nhanh” → loại “Điều chỉnh +/−” (số âm) hoặc “Hư hỏng”, rồi chọn “Lý do giảm kho”: hỏng/vỡ, hết hạn, hao hụt cân, mất hoặc khác. Lô đã hết hạn dùng nút “Xuất huỷ lô” (tự mang lý do Hết hạn). Báo cáo → Hao hụt cộng theo sản phẩm và lý do, kèm tỷ lệ trên lượng nhập trong kỳ. Phiếu cũ chưa có lý do được tính là Khác.'],
          ['Tồn trong hệ thống lệch với hàng thật?', 'Kiểm kê chứ đừng sửa tay: Kho → Kiểm kê, đếm hàng và nhập số thực tế, hoàn tất thì hệ thống tự ghi phần chênh. Kiểm kê để lại dấu vết còn sửa tay thì không. Đếm lâu cũng không sao: trong lúc đếm vẫn bán bình thường.'],
          ['Kho bị âm?', 'Thường do đơn đã trừ kho trước khi phiếu nhập được ghi. Nhập phiếu nhập còn thiếu thì tồn tự về đúng. Còn nếu hàng thật sự không có thì kiểm kê rồi điều chỉnh.'],
          ['Hàng vỡ, hỏng, mất?', 'Kho → Điều chỉnh +/−, chọn số lượng giảm và ghi lý do. Phần này được ghi vào sổ kế toán như một khoản chi phí khác.'],
          ['Chuyển hàng từ kho này sang kho khác?', 'Kho → Chuyển kho. Giá vốn đi theo hàng nên tổng giá trị tồn không đổi.'],
          ['Đã chốt kho nhưng sau đó mới nhập đơn của kỳ cũ?', 'Đơn bán vẫn nhập được: hệ thống ghi biến động kho vào ngày đầu của kỳ đang mở và ghi chú ngày gốc. Nhập hàng hoặc điều chỉnh thì luôn ghi vào hiện tại, không đụng kỳ đã chốt.'],
          ['Chiết nước hoa từ chai lớn ra chai 10 ml để bán?', 'Dùng phiếu đóng gói như hàng nhập theo kg. Tạo chai nguồn với đơn vị ml (chai 100 ml nhập là 100 ml) và thành phẩm “chai 10 ml”. Kho → Đóng gói → “+ Phiếu đóng gói”: thêm thành phẩm, ví dụ 9 chai, nhấn “Gợi ý hàng nguồn” rồi sửa số ml thực tế dùng, thêm chai rỗng và nhãn nếu có. Giá vốn mỗi chai = giá trị hàng nguồn đã xuất chia cho số chai, nên phần hao hụt khi chiết nằm sẵn trong giá vốn. Nên để tồn chai nguồn theo ml, đừng nhập theo chai, để giá vốn chia đúng.'],
          ['Hàng có hạn dùng, sắp hết hạn?', 'Ghi lô và hạn dùng khi nhập hàng. Kho → Lô & hạn dùng liệt kê lô sắp hết hạn và đã hết hạn, và hệ thống tự lấy lô hết hạn sớm nhất để bán trước.'],
          ['Sản phẩm không bán nữa, xoá thế nào?', 'Mở sản phẩm → “Xoá sản phẩm…”. Chưa từng phát sinh gì thì xoá hẳn, đã có lịch sử thì chuyển sang “Đã ngừng kinh doanh” và khôi phục được. Còn hàng trong kho thì hệ thống yêu cầu xác nhận xuất huỷ.'],
        ] },
        { title: 'Sàn thương mại điện tử và hãng vận chuyển', items: [
          ['Sàn trả tiền ít hơn số đơn?', 'Chi phí & quỹ → Đối soát sàn: nhập số thực nhận từng đơn. Phần lệch (phí, phạt) tick “cộng vào phí sàn” để đơn hết treo và lãi từng đơn đúng; không tick thì đơn vẫn treo phần thiếu để bạn khiếu nại. Đơn giao xong quá số ngày đã đặt mà sàn chưa trả được đánh dấu riêng.'],
          ['Chốt nhầm phiếu đối soát của hãng (chọn nhầm cột, nhầm file)?', 'Chi phí & quỹ → Vận chuyển, ở danh sách Phiếu đối soát nhấn “Huỷ phiếu”. Hộp thoại cho xem trước sẽ hoàn tác gì: khoản thu COD, phí giao đã bù, chi phí vận chuyển, phiếu trả chờ hàng về, đơn về lại “Đang giao” và vận đơn về trạng thái trước đối soát. Ghi lý do rồi xác nhận, tất cả hoàn tác cùng lúc, lỗi giữa chừng thì không đổi gì. Sau đó chốt lại bảng đúng. Phiếu huỷ vẫn nằm trong danh sách (gạch ngang) và nhật ký. Không huỷ được khi: đơn đã có phiếu trả hoặc đã đổi trạng thái sau đối soát, hàng hoàn của phiếu đã nhập kho, đã có khoản hoàn dựa trên tiền COD, hoặc ngày đối soát thuộc kỳ đã khoá sổ. Phiếu lập trước khi có tính năng này không huỷ tự động được.'],
          ['Hãng vận chuyển chuyển tiền COD thiếu hoặc lệch?', 'Chi phí & quỹ → Vận chuyển, tạo phiếu đối soát từ file của hãng. Hệ thống ghép theo mã vận đơn, ghi thu COD và phí; mã không khớp hoặc đã đối soát được liệt kê kèm lý do và không ghi tiền. Tiền hãng chuyển về = COD − các khoản phí.'],
          ['Import đơn từ sàn bị trùng?', 'Không trùng: mỗi đơn có mã đơn của sàn, hệ thống so sánh rồi cập nhật đơn đã có thay vì tạo mới. Luôn có bước chạy thử trước khi ghi.'],
          ['Đơn import làm kho âm?', 'Đơn đã xảy ra thật trên sàn nên vẫn ghi nhận, kèm cờ cảnh báo để bạn kiểm kho thực tế và nhập hàng bù.'],
        ] },
        { title: 'Tiền và sổ sách', items: [
          ['Có khoản chi lặp lại mỗi tháng (thuê kho, phần mềm, lương)?', 'Chi phí & quỹ → Chi phí định kỳ, thêm một lần, chọn chu kỳ và ngày. Hệ thống tự tạo chi phí mỗi kỳ, kỳ nào bỏ lỡ thì tạo bù, không bao giờ tạo trùng.'],
          ['Ghi chi phí hay thanh toán bị báo kỳ đã khoá sổ?', 'Ngày bạn chọn thuộc kỳ đã khoá. Nếu cần sửa thật, mở khoá ở Sổ kế toán → Khoá sổ, sửa xong khoá lại. Còn không thì dùng ngày sau ngày khoá.'],
          ['Số dư két hoặc ngân hàng không khớp thực tế?', 'Chi phí & quỹ → Quỹ tiền → kiểm đếm quỹ, nhập số thực. Hệ thống ghi phần chênh thành một dòng điều chỉnh, không sửa lại các khoản thu chi cũ. Quỹ âm thường là do thu chi chưa ghi hoặc thiếu số dư đầu kỳ.'],
          ['Lợi nhuận ở Báo cáo khác lợi nhuận ở Sổ kế toán?', 'Sổ kế toán có thêm khấu hao tài sản, thu chi khác và chênh lệch kho/quỹ mà Báo cáo không đếm. Trang Tổng quan của Sổ kế toán giải thích từng khoản lệch.'],
        ] },
        { title: 'Khách hàng và hệ thống', items: [
          ['Một khách có hai hồ sơ?', 'Khách hàng → nhấn “Gộp khách trùng”, chọn hồ sơ giữ lại. Đơn, ghi chú, nhãn của hai hồ sơ được hợp lại và không hoàn tác được.'],
          ['Muốn nhắc khách mua lại?', 'Loyalty → Hôm nay: khách sắp hết hàng đã mua. Hệ thống soạn tin từ mẫu, bạn sửa rồi sao chép gửi qua Zalo hoặc Messenger. Hệ thống chưa tự gửi tin.'],
          ['Muốn sao lưu trước khi làm việc lớn?', 'Cài đặt → Sao lưu → “Sao lưu ngay”. Cũng ở đây bạn chọn giờ, tần suất tự động sao lưu và có sao lưu ảnh sản phẩm hay không.'],
          ['Ai đó sửa dữ liệu, muốn biết ai sửa gì?', 'Cài đặt → Nhật ký: lọc theo đối tượng, hành động, ngày. Mỗi dòng ghi người làm và các trường đã đổi từ gì sang gì.'],
        ] },
      ] },
    ],
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
        { title: 'Đổi trạng thái', text: 'Đầu chi tiết đơn có thanh tiến trình: Tạo đơn → Xác nhận → Đóng gói → Giao hàng → Hoàn thành. Bước đã qua được chốt bằng dấu ✓ kèm giờ, bước đang chờ làm được tô viền, bước bỏ qua (ví dụ không dùng vật tư đóng gói) ghi “Bỏ qua”. Nút đậm bên dưới luôn là việc của bước đang chờ; việc ít dùng (sửa, tách đơn, trả hàng, in phiếu, huỷ…) nằm trong menu “Khác”. Đơn đã xác nhận (hàng còn ở shop) sửa được cả sản phẩm: vào menu Khác, chọn Sửa đơn, kho tự cộng lại rồi trừ theo nội dung mới. Cần giao làm hai đợt thì nhấn “Tách đơn”; muốn giữ hàng cho khách chưa chốt thì nhấn “Giữ hàng” ở đơn nháp. Huỷ được khi đơn còn nháp hoặc đã xác nhận, kho được cộng lại đúng giá vốn lúc bán. Hàng đã giao đi thì không huỷ: dùng “Giao không thành” hoặc “Trả hàng”.' },
        { title: 'Huỷ đơn đã thu tiền', text: 'Khác → “Huỷ đơn”. Nếu khách đã trả tiền hoặc cọc, hộp thoại bắt chọn một trong hai: “Hoàn lại khách” hoặc “Giữ cọc (thành thu nhập của shop)”. Chưa chọn thì nút “Xác nhận huỷ” bị khoá. Giữ cọc thì nhập số giữ lại; phần còn lại hoàn cho khách ngay hoặc để hoàn sau ở Công nợ phải trả. Số giữ hiện ở Báo cáo là “Cọc giữ lại”. Đơn kênh sàn không cần chọn.' },
        { title: 'Ghi thanh toán', text: 'Thu một lần hoặc nhiều lần: tiền mặt, chuyển khoản, COD, ví. Đơn trạng thái chưa thu, thu một phần hay đã thu đủ tự cập nhật.' },
        { title: 'In phiếu bán hàng', text: 'Từ chi tiết đơn. Đây là chứng từ nội bộ, không phải hoá đơn thuế.' },
      ] },
      { t: 'p', text: 'Một đơn có thể lấy hàng từ nhiều kho theo thứ tự ưu tiên của shop. Trong form đơn có phần xem trước và chia kho tay nếu cần.' },
      { t: 'p', text: 'Đơn kênh sàn (Shopee, TikTok Shop) không có ô “Phí ship khách trả”: khoản ship do sàn và hãng vận chuyển xử lý, không phải tiền shop nhận. Chỉ nhập phí sàn và ship shop chịu nếu có. Sản phẩm loại “Dịch vụ” thêm vào đơn như hàng thường nhưng không trừ kho và không có giá vốn.' },
      { t: 'p', text: 'Hàng có lô hết hạn: form đơn hiện cảnh báo khi trong phần xuất có lô đã hết hạn hoặc sắp hết hạn. Xác nhận đơn chạm lô đã hết hạn sẽ bị chặn. Nếu vẫn muốn bán, xác nhận lại khi được hỏi: đơn được đánh dấu cảnh báo. Cách tốt hơn là xuất huỷ lô đó trước ở Kho → Lô & hạn dùng.' },
      { t: 'warn', text: 'Đơn hết tồn không xác nhận được (báo “Không đủ tồn kho”). Nhập hàng hoặc điều chỉnh tồn trước. Đơn import từ sàn thì khác: đơn đã xảy ra thật nên vẫn ghi nhận, kèm cờ cảnh báo để bạn kiểm kho.' },
      { t: 'faq', items: [
        ['Sửa đơn đã xác nhận được không?', 'Đơn nháp sửa tự do. Đơn đã xác nhận mà hàng còn ở shop sửa được cả dòng hàng: Khác → Sửa đơn, kho tự cộng lại rồi trừ theo nội dung mới. Đơn đang giao hoặc đã có phiếu trả thì không sửa dòng hàng; dùng Trả hàng hoặc Đổi hàng.'],
        ['Khách trả hàng thì làm sao?', 'Xem hướng dẫn “Trả hàng và đổi hàng”.'],
      ] },
    ],
    links: [['/orders', 'Mở danh sách đơn']],
  },
  {
    id: 'tra-hang', group: 'Bán hàng', title: 'Trả hàng và đổi hàng', time: '4 phút', summary: 'Hoàn kho, hoàn ship, phí trả hàng, tiền trả khách.',
    blocks: [
      { t: 'steps', items: [
        { title: 'Mở đơn và nhấn “Trả hàng” (đơn đang giao thì nhấn “Giao không thành”)', text: 'Chọn lý do trả hàng trong danh sách (khách không nhận, giao sai, hàng lỗi…). Chọn sản phẩm và số lượng khách trả. Hàng chưa về shop thì tick “Hàng chưa về shop”: kho chưa tăng cho tới khi bạn nhấn “Đã nhận hàng, nhập kho” ở dòng phiếu trả. Giá trị hàng trả lấy theo số tiền thực của dòng (đã trừ giảm giá).' },
        { title: 'Điền các khoản đi kèm', text: 'Hoàn ship cho khách, phí trả hàng shop giữ lại (nếu thu), ship chiều về shop chịu. Nếu shop giữ toàn bộ tiền thì đặt phí bằng giá trị trả.' },
        { title: 'Chọn có nhập lại kho không', text: 'Hàng còn bán được thì nhập lại kho đúng giá vốn đã chụp. Hàng hỏng thì không nhập lại; giá vốn vẫn tính.' },
        { title: 'Hoàn tiền', text: '“Cần trả khách” = hàng + ship hoàn − phí trả hàng. Trả ngay bao nhiêu thì điền ở ô tiền trả; phần còn lại là shop còn nợ khách, hoàn sau bằng nút “Hoàn tiền”.' },
      ] },
      { t: 'p', text: 'Hàng về bị hỏng: bỏ tick “Nhập lại kho” khi lập phiếu, hoặc nhấn “Hàng về bị hỏng” khi nhận hàng. Hệ thống tự lập phiếu hàng huỷ (mã HH-…). Hàng không vào kho, giá vốn của nó không được hoàn nên chịu như một khoản lỗ trong lãi gộp. Xem lại ở Chứng từ và ở Báo cáo → Doanh thu → Trả hàng theo lý do.' },
      { t: 'warn', text: 'Đơn kênh sàn (Shopee, TikTok Shop): sàn tự hoàn tiền cho người mua nên không có hoàn ship, phí trả hàng hay tiền trả khách. Hàng trả về có thể chờ “nhận hàng về kho” rồi mới cộng tồn. Sàn hoàn lại phí sàn theo hàng trả: ô “Phí sàn được hoàn” điền sẵn, sửa về 0 nếu sàn vẫn tính phí.' },
      { t: 'p', text: 'Khách giữ hàng nhưng shop giảm tiền (hàng lỗi một phần, giao thiếu, đền bù): không dùng Trả hàng. Mở Khác → “Giảm giá sau bán / bồi thường”. Nhập số tiền giảm (tối đa bằng tiền hàng còn lại của đơn) và lý do. Khách đã trả đủ thì shop nợ khách khoản đó: hoàn ngay bằng ô “Tiền hoàn khách ngay”, hoặc hoàn sau bằng nút “Hoàn tiền”. Hệ thống không đụng kho và giá vốn, chỉ giảm doanh thu và số phải thu. Hàng khách trả về nhập kho lại đúng lô (và hạn dùng) mà hàng đã được lấy ra.' },
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
        { title: 'Xác nhận', text: 'Đơn đã import lần trước nếu có trong file lần sau thì được cập nhật (trạng thái, tiền, phí sàn), không tạo trùng. Nếu dòng hàng hoặc giảm giá trong file khác đơn đã lưu, đơn nháp hoặc đã xác nhận được sửa theo file; đơn đã giao đi thì không sửa, bảng xem trước hiện cảnh báo nêu rõ khác gì.' },
      ] },
      { t: 'p', text: 'Mẫu Shopee đã kiểm với file xuất đơn thật. Tiền dạng “18000.00” được đọc đúng là 18.000 ₫. Tên cột được chuẩn hoá chữ có dấu, nên khác kiểu gõ dấu không gây báo thiếu cột giả. Nếu Shopee đổi tên cột, hộp vàng báo “Không thấy các cột mà mẫu đang mong đợi”: dữ liệu các trường đó sẽ trống, vui lòng sửa mẫu map cột trong Cài đặt.' },
      { t: 'p', text: 'Phí sàn của đơn = Phí cố định + Phí Dịch Vụ + Phí xử lý giao dịch (“Phí thanh toán” là tên cũ, vẫn nhận). Giảm giá đơn = Mã giảm giá của Shop + Giảm giá từ Combo của Shop. File không có cột phí vận chuyển người mua trả được tính vào đơn: khoản này đi qua Shopee tới hãng vận chuyển.' },
      { t: 'p', text: 'Trạng thái “Người mua xác nhận đã nhận được hàng, tuy nhiên…” (phần đuôi đổi theo ngày) và “Đã nhận được hàng” đều là Hoàn thành. Dòng ghi trả hàng đã chấp thuận tạo phiếu trả ở trạng thái chờ hàng về; import lại không tạo trùng. Hàng về thì nhấn “Đã nhận hàng, nhập kho” ở chi tiết đơn. Xem từng bước trong Cẩm nang, trang “Nhập file Shopee”.' },
      { t: 'p', text: 'Khi sàn chuyển tiền về, vào Chi phí & quỹ → Đối soát sàn: đơn hoàn thành chưa nhận tiền hiện là “tiền đang treo”. Chọn các đơn sàn đã trả và ghi nhận tiền về.' },
      { t: 'tips', items: ['Import định kỳ (hằng ngày hoặc mỗi vài ngày) để kho không lệch.', 'Đơn đặt từ lâu vẫn được trừ kho đúng ngày đặt trên sàn. Nếu kho đã chốt kỳ thì ghi vào ngày đầu của kỳ mở.', 'Phí sàn nằm trong đơn nên lợi nhuận đơn sàn đã trừ phí.', 'Mẫu Shopee không nhập phí vận chuyển người mua trả: khoản này đi qua Shopee tới hãng vận chuyển, không phải tiền shop nhận.', 'Dòng Shopee ghi trả hàng đã chấp thuận sẽ lập phiếu trả ở trạng thái chờ hàng về; hàng chưa cộng vào kho cho tới khi bạn nhận hàng.'] },
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
        { title: 'Dịch vụ không tồn kho', text: 'Ở form sản phẩm, ô “Loại mặt hàng” chọn “Dịch vụ (không tồn kho)” (khai quang, chỉnh size…). Dịch vụ niêm yết và bán như hàng, nhưng không trừ kho, không có giá vốn, không có tồn đầu kỳ và không hiện ở Kho, Nhập hàng, Kiểm kê. Sản phẩm đã có đơn không đổi qua lại giữa hàng và dịch vụ được.' },
        { title: 'Đóng từ hàng nhập theo kg', text: 'Sản phẩm thành phẩm (hộp 500 g) có khối “Đóng từ (nhập theo kg, bán theo hộp)”: chọn hàng nguồn và lượng cho 1 đơn vị. Công thức chỉ để gợi ý khi lập phiếu đóng gói. Xem bài “Đóng gói”.' },
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
      { t: 'p', text: 'Sau khi nhận hàng mới thấy lỗi hoặc thiếu cân: mở chi tiết phiếu, nhấn “Trả hàng NCC” (trả hàng về, kho và nợ cùng giảm) hoặc “NCC giảm giá” (nhà cung cấp bớt tiền, không lấy lại hàng). Nếu phiếu đã trả nhiều hơn số còn phải trả thì nhà cung cấp còn nợ shop: tick “NCC hoàn tiền ngay” hoặc để khoản đó ở Chi phí & quỹ → Công nợ phải trả (loại phải thu) và ghi nhận khi nhận tiền. Cân lại thiếu 3 kg trên 100 kg thì dùng Trả hàng NCC 3 kg, không dùng giảm giá. Xem Cẩm nang, trang “Trả hàng cho nhà cung cấp”.' },
      { t: 'warn', text: 'Ship không đi vào chi phí ngay lúc nhập. Nó nằm trong giá vốn và chỉ thành chi phí khi hàng bán ra. Đây là cách ghi đúng chuẩn kế toán.' },
      { t: 'faq', items: [
        ['Huỷ phiếu đã nhận được không?', 'Được, nếu hàng chưa bị bán bớt. Đã trả tiền nhà cung cấp thì phải ghi nhận nhà cung cấp hoàn tiền (chọn phương thức hoàn).'],
        ['Hàng đã bán bớt, nhà cung cấp nhận lại phần còn lại?', 'Mở phiếu nhập → “Trả hàng NCC”, chọn dòng và số lượng (chỉ trả được số còn trong kho). Hàng xuất kho theo giá nhập, nợ nhà cung cấp giảm bằng giá mua của hàng trả (đã trừ chiết khấu). Phí ship và phí khác không tự hoàn. Phiếu đã trả dư thì nhà cung cấp còn nợ shop: tick “hoàn ngay” hoặc để treo ở Công nợ phải trả rồi ghi nhận khi nhận tiền.'],
        ['Nhà cung cấp bớt tiền, không lấy lại hàng?', 'Mở phiếu nhập → “NCC giảm giá”. Nợ giảm; phần ứng với hàng còn tồn làm giảm giá vốn tồn kho, phần ứng với hàng đã bán ghi thành thu nhập khác (giá vốn đã chụp trên đơn không đổi). Huỷ được nếu ghi nhầm.'],
        ['Nhập 100 kg nhưng cân lại chỉ 97 kg?', 'Dùng “Trả hàng NCC” 3 kg của dòng đó: kho giảm 3 kg, nợ giảm 3 kg × giá mua. Đừng dùng “NCC giảm giá” vì như vậy kho vẫn ghi 100 kg.'],
        ['Có huỷ được phiếu nhập đã có phiếu trả?', 'Không. Huỷ các phiếu trả hàng nhập và giảm giá trước, rồi mới huỷ phiếu nhập.'],
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
        { title: 'Điều chỉnh nhanh, hàng hỏng, tồn đầu kỳ', text: 'Nút “Điều chỉnh nhanh” ở đầu trang. Hàng đưa vào kho lần đầu cần nhập giá vốn. Giảm kho nên chọn lý do (hỏng/vỡ, hết hạn, hao hụt cân, mất) để Báo cáo → Hao hụt thống kê được.' },
        { title: 'Đóng gói', text: 'Hàng nhập theo kg, đóng hộp để bán: tab “Đóng gói” và nút “Đóng gói” ở đầu trang. Xem bài “Đóng gói: nhập theo kg, bán theo hộp”.', to: '/stock?tab=conversions', cta: 'Mở tab Đóng gói' },
        { title: 'Lô hết hạn', text: 'Tab “Lô & hạn dùng” báo lô sắp và đã hết hạn. Lô đã hết hạn nhấn “Xuất huỷ lô”: hệ thống lập phiếu hàng hỏng với lý do Hết hạn, trừ kho và ghi vào hao hụt. Xem bài “Lô hàng và hạn dùng”.', to: '/stock?tab=lots', cta: 'Mở tab Lô' },
        { title: 'Chuyển kho', text: 'Nút “Chuyển kho” (có khi bạn có từ hai kho). Giá vốn chuyển theo hàng.' },
        { title: 'Xuất vật tư', text: 'Vật tư dùng cho vận hành được xuất kho và ghi vào chi phí tương ứng.' },
      ] },
      { t: 'p', text: 'Nhiều kho cho một shop: Cài đặt → Shop & kho, đặt danh sách kho theo thứ tự ưu tiên. Đơn lấy kho đầu trước, thiếu thì lấy tiếp kho sau.' },
      { t: 'tips', items: ['Số tồn lệch với thực tế? Nên kiểm kê thay vì sửa tay: kiểm kê để lại dấu vết, sửa tay thì không.', 'Hàng âm kho thường do đơn trừ kho trước khi nhập hàng. Nhập phiếu nhập còn thiếu là hết.', 'Gỡ một kho: xem hướng dẫn “Chốt kho cuối kỳ và đóng kho”. Kho còn hàng phải chuyển sang kho khác trước.'] },
    ],
  },
  {
    id: 'dong-goi', group: 'Hàng hoá & kho', title: 'Đóng gói: nhập theo kg, bán theo hộp', time: '5 phút', summary: 'Phiếu đóng gói chuyển số lượng và giá vốn từ kg sang hộp, giữ lô và hạn dùng.',
    keywords: 'đóng gói chuyển đổi kg hộp túi nông sản sang chiết giá vốn hao hụt lô hạn dùng bao bì tem',
    blocks: [
      { t: 'p', text: 'Nhập 20 kg, đóng thành hộp 500 g dán tem, bán theo hộp: kg và hộp là hai mặt hàng khác nhau trong kho. Phiếu đóng gói là chỗ duy nhất chuyển số lượng và giá vốn từ mã này sang mã kia trong một lần ghi, không tạo lãi lỗ.' },
      { t: 'steps', items: [
        { title: 'Tạo hai mặt hàng', text: 'Một sản phẩm cho hàng nhập (đơn vị kg) và một cho thành phẩm (hộp 500 g). Hộp rỗng và tem tạo là “Vật liệu đóng gói”.', to: '/products/new', cta: 'Thêm sản phẩm' },
        { title: 'Khai công thức “Đóng từ” (tuỳ chọn)', text: 'Mở sản phẩm thành phẩm, ở khối “Đóng từ” chọn hàng nguồn và lượng cho 1 đơn vị (hộp 500 g = 0,5 kg). Bao bì lấy từ “Định mức đóng gói” của sản phẩm. Công thức chỉ để gợi ý.' },
        { title: 'Nhập hàng kèm lô và hạn dùng', text: 'Ở phiếu nhập, mỗi dòng kg có ô Lô và Hạn dùng. Phí ship nhập được chia vào giá vốn kg như thường.', to: '/purchases/new', cta: 'Tạo phiếu nhập' },
        { title: 'Lập phiếu đóng gói', text: 'Kho → Đóng gói → “+ Phiếu đóng gói”. Thêm thành phẩm và số hộp thực tế (ví dụ 39). Nhấn “Gợi ý hàng nguồn” để có kg và bao bì theo công thức, rồi sửa số thực tế dùng (ví dụ 20 kg). Dòng nguồn có thể chọn lô; không chọn thì lấy lô hết hạn sớm nhất.', to: '/stock/conversions/new', cta: 'Lập phiếu' },
        { title: 'Đọc giá vốn', text: 'Cột phụ cho xem trước: giá trị hàng nguồn xuất và giá vốn mỗi hộp. Hộp nhận lô và hạn dùng của số kg đã dùng; sửa được ở “Lô, hạn dùng và cách chia giá vốn”.' },
        { title: 'Huỷ khi đóng nhầm', text: 'Mở phiếu → “Huỷ phiếu” và ghi lý do. Được khi thành phẩm còn đủ trong kho; hàng nguồn và bao bì trở về đúng giá, đúng lô.' },
      ] },
      { t: 'p', text: 'Giá vốn một hộp = tổng giá trị đã xuất (kg theo bình quân hoặc từng lớp FIFO, cộng bao bì) chia cho số hộp nhận được. 20 kg ra 39 hộp thay vì 40 thì hao hụt nằm sẵn trong giá vốn hộp. Giá vốn luôn là số nguyên đồng: nếu không chia hết, một phần hộp ghi hơn phần còn lại 1 đồng để tổng khớp đúng từng đồng. Đóng nhiều thành phẩm từ cùng nguồn (hộp 500 g và túi 1 kg) thì giá vốn chia theo lượng nguồn quy đổi, hoặc theo giá bán nếu chưa khai công thức, hoặc theo trọng số bạn nhập.' },
      { t: 'p', text: 'Cùng cách này cho nước hoa: chiết từ chai lớn ra chai 10 ml. Để tồn chai nguồn theo ml (chai 100 ml là 100 ml), thành phẩm là “chai 10 ml”, và thêm chai rỗng, nhãn làm bao bì. Giá vốn chai nhỏ = giá trị ml đã dùng cộng bao bì, chia cho số chai nhận được.' },
      { t: 'tips', items: ['Số hộp phải là số nguyên; kg, bao bì nhập được số lẻ.', 'Không dùng được cho dịch vụ và combo.', 'Chốt kho và khoá sổ vẫn có hiệu lực: phiếu ghi vào ngày hôm nay nên không đụng kỳ đã chốt.'] },
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
      { t: 'p', text: 'Lô đã hết hạn: nhấn “Xuất huỷ lô” ở tab Lô & hạn dùng. Hệ thống lập phiếu hàng hỏng với lý do Hết hạn, hàng ra khỏi kho và giá trị vào Báo cáo → Hao hụt. Nếu chưa xuất huỷ mà đơn lại lấy trúng lô quá hạn, xác nhận đơn bị chặn. Bạn chỉ vượt được khi xác nhận lại lúc được hỏi, và đơn được đánh dấu cảnh báo. Form đơn cũng báo trước lô hết hạn và sắp hết hạn.' },
      { t: 'p', text: 'Hàng khách trả về nhập lại đúng lô (và hạn dùng) mà hàng đã được lấy ra. Phiếu đóng gói cho thành phẩm nhận lô và hạn dùng của số hàng nguồn đã dùng. Chiết nước hoa từ chai lớn ra chai nhỏ cũng dùng phiếu đóng gói.' },
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
      { t: 'tips', items: ['Nợ nhà cung cấp không nằm ở đây: đặt “Hạn trả nhà cung cấp” ở phiếu nhập, khoản phải trả xem ở Chi phí & quỹ → Công nợ phải trả.', 'Khách thanh toán đủ thì khoản nợ tự biến mất khỏi danh sách.'] },
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
        { title: 'Công nợ phải trả', text: 'Chi phí & quỹ → Công nợ phải trả gom một chỗ mọi khoản shop còn nợ: phiếu nhập chưa trả đủ nhà cung cấp, tiền ship còn nợ hãng vận chuyển, tiền còn nợ khách sau khi trả hàng, và các chi phí định kỳ sắp đến kỳ. Xếp theo quá hạn, sắp đến hạn, chưa đặt hạn. Nhấn mã chứng từ để ghi thanh toán.', to: '/expenses?tab=payables', cta: 'Mở Công nợ phải trả' },
        { title: 'Chi phí định kỳ', text: 'Chi phí & quỹ → Chi phí định kỳ. Tiền thuê, phần mềm… đặt một lần, hệ thống tạo từng kỳ (tuần, tháng, năm). Kỳ nào bị bỏ lỡ thì hệ thống tạo bù, không bao giờ tạo trùng.' },
        { title: 'Quỹ tiền', text: 'Két tiền mặt, ngân hàng, ví. Số dư luôn tính từ sổ, không lưu. Chuyển quỹ và kiểm đếm (phần chênh ghi thành dòng điều chỉnh, không sửa thu chi cũ).' },
      ] },
      { t: 'tips', items: ['Mỗi phương thức thanh toán thuộc đúng một quỹ. Phương thức chưa gán quỹ được cảnh báo ở Tổng quan.', 'Mỗi tuần nên đếm két và so với số dư ngân hàng.', 'Quỹ âm thường là thu chi chưa ghi hoặc thiếu số dư đầu kỳ.'] },
    ],
  },
  {
    id: 'so-ke-toan', group: 'Tiền & sổ sách', title: 'Sổ kế toán', time: '7 phút', summary: 'Sổ cái kép tự sinh, chứng từ tay, tài sản, khoá sổ.',
    blocks: [
      { t: 'p', text: 'Sổ kế toán được dựng tự động từ đơn, phiếu nhập, thanh toán, chi phí, kho và quỹ. Bạn không phải ghi bút toán. Sửa hay huỷ chứng từ gốc thì sổ tự sinh lại. Các chứng từ mới cũng vào sổ: phiếu trả hàng nhập (Nợ 331 / Có 156), NCC giảm giá sau nhận (Nợ 331 / Có 156 và 711), giảm giá sau bán (giảm doanh thu như phiếu trả hàng không có dòng kho) và cọc giữ lại khi huỷ đơn (tài khoản 5119). Phiếu đóng gói không tạo bút toán vì chỉ chuyển giá trị giữa hai mã hàng.' },
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
        { title: 'Chọn tab', text: 'Doanh thu, Lợi nhuận (kèm ước tính thuế), Chi phí, Kênh, Sản phẩm, Khách, Kho, Hao hụt (theo lý do và tỷ lệ trên lượng nhập), Tiền & công nợ, Chỉ số tuỳ chỉnh, Sức khoẻ.' },
        { title: 'Nhấn ⓘ khi không hiểu số', text: 'Mỗi chỉ số giải thích nghĩa, cách tính, lấy từ đâu, tính cho shop nào và có liên kết tới dữ liệu gốc.' },
        { title: 'Xuất Excel', text: 'Mỗi tab xuất đúng cái đang xem, mỗi bảng một sheet, tiền là số. Có thêm sheet “Giải thích”.' },
      ] },
      { t: 'warn', text: 'Một số số không theo bộ lọc: nợ nhà cung cấp, số dư quỹ, thuế (toàn tài khoản) và tồn kho (đến hôm nay). Chúng có nhãn “Toàn tài khoản” cạnh con số.' },
      { t: 'p', text: 'Vài dòng dễ hiểu nhầm. “Hàng trả” gồm cả khoản giảm giá sau bán / bồi thường, vì cả hai đều làm giảm doanh thu hàng. “Cọc giữ lại” (tab Lợi nhuận) là tiền khách cọc rồi bỏ đơn mà shop giữ: cộng vào lợi nhuận gộp, không nằm trong doanh thu thuần. “Phí sàn” là phí sàn thuần: phí ghi trên đơn trừ phần sàn hoàn khi trả hàng. Tab Hao hụt chia theo lý do: hỏng/vỡ, hết hạn, hao hụt cân, mất, khác, hàng trả hỏng.' },
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
        { title: 'Sao lưu', text: 'Cài đặt → Sao lưu: bật hoặc tắt sao lưu tự động, chọn giờ và tần suất (mỗi ngày hoặc mỗi tuần), số ngày và số tuần giữ bản cũ, và có sao lưu cả ảnh sản phẩm hay không. Nhấn “Sao lưu ngay” khi cần một bản trước khi làm việc lớn. Cơ sở dữ liệu luôn được sao lưu. Cũng ở đây: tải bản sao lưu và xuất CSV.' },
      ] },
      { t: 'tips', items: ['Đổi mật khẩu ở tab Tài khoản. Mỗi tài khoản có dữ liệu riêng hoàn toàn.'] },
    ],
  },
];

export const byId = (id) => GUIDES.find((g) => g.id === id);

/** Văn bản tìm kiếm của một hướng dẫn: tiêu đề, tóm tắt và toàn bộ nội dung */
export function searchText(g) {
  const parts = [g.title, g.summary, g.group, g.keywords || ''];
  for (const b of g.blocks || []) {
    if (b.text) parts.push(b.text);
    for (const sec of b.sections || []) { parts.push(sec.title); for (const it of sec.items) parts.push(it.join(' ')); }
    for (const it of b.items || []) parts.push(typeof it === 'string' ? it : Array.isArray(it) ? it.join(' ') : `${it.title} ${it.text}`);
  }
  return parts.join(' ').toLowerCase();
}
