# HACHIHI PDF Tool — Tài liệu bàn giao (bản v10 đã kiểm toán)

Ngày kiểm toán: 11/11/2026 · Nền: `pdftool2-main-v10.zip` · Phạm vi: toàn bộ thay đổi của v10 + các bản sửa từ các phiên làm việc trước.

> **Tóm tắt một dòng:** ứng dụng chạy hoàn toàn trên trình duyệt (Vite, không có máy chủ xử lý PDF). Bản này sửa lỗi "lưu PDF ra file cũ", làm OCR giấy tờ nền vân đọc tốt hơn, và vá **3 lỗi mới phát hiện** trong tính năng "gỡ chữ/ảnh gốc" của v10 (mất ảnh ở trang khác, chữ gốc còn sót trong file, vùng gỡ rộng hơn ô che).

---

## 1. Tổng quan kiến trúc

| Thành phần | Vai trò |
|---|---|
| `index.html` | Giao diện, nạp lần lượt các script `public/legacy/*.js` (thứ tự quan trọng). |
| `src/main.js` | Điểm vào Vite: nạp `sign`, `form`, `redact`, `editorWordRibbon`, `auth`, `stripOriginals` và các file CSS. |
| `src/features/*.js` | Module ES: ribbon kiểu Word, chữ ký, điền biểu mẫu, che thông tin (redact), đăng nhập, **gỡ chữ/ảnh gốc**. |
| `public/legacy/*.js` | Phần lõi viết dạng script thường: `10-core.js` (trình sửa PDF, xuất PDF), `20-a`…`60-e` (các công cụ: gộp, tách, nén, OCR, PDF→Word/Excel…), `95-multipage`, `96-editor-sig`, `97-viewer`, `9x-i18n`. |
| `public/vendor`, `public/lib` | Thư viện đã sao chép sẵn: pdf-lib, pdf.js, tesseract.js, exceljs, jszip, fontkit; `lib/` có fflate và bộ mã hóa JPEG (mozjpeg/jsquash) cho nén. |
| `public/sw.js` | Service worker (PWA/offline). Mã phiên bản `__BUILD__` **tự đổi mỗi lần `npm run build`**; không sửa tay. |
| `api/`, `apps-script/` | Thống kê lượt dùng (tùy chọn, qua Vercel + Apps Script). Không liên quan xử lý PDF. |

Dữ liệu PDF của người dùng **không rời trình duyệt**. OCR tải mô hình ngôn ngữ từ CDN lần đầu (cần mạng lần đầu).

## 2. Chạy, build, triển khai

```bash
npm install        # postinstall: scripts/copy-vendor.mjs chép thư viện vào public/vendor
npm run dev        # http://localhost:3000
npm run build      # copy-vendor + vite build  -> dist/
npm test           # pdf-suite + toàn bộ test:ui
```

- Sau mỗi lần sửa `public/legacy/*.js` hoặc `src/**`: **build và triển khai lại**. Người dùng cũ sẽ nhận bản mới nhờ `sw.js` tự đổi phiên bản (các file `legacy/*.js` được tải theo kiểu ưu tiên mạng).
- Nếu người dùng báo "vẫn như cũ" sau khi triển khai: Ctrl+Shift+R hoặc xóa dữ liệu trang một lần.
- Vercel/Render/GitHub Pages: xem `README.md` (giữ nguyên).

## 3. Những gì đã sửa / cải tiến

### 3.1 Từ các phiên trước (đã có trong gói)

| # | Vấn đề | Nguyên nhân gốc | Cách sửa | File |
|---|---|---|---|---|
| 1 | Sửa chữ xong bấm **Lưu** ra file như cũ | Khi đang gõ dở rồi bấm nút Lưu trên ribbon, ô nhập bị coi là "đang ở thanh công cụ" nên **không được chốt** vào danh sách sửa; hàm xuất đọc danh sách cũ | Thêm `commitPendingTextEdits()`; cả hai trình sửa chữ gán `input._commit`; `editorExportPDF` gọi chốt trước khi dựng PDF | `10-core.js` |
| 2 | Một hình vẽ lỗi làm hỏng cả lần xuất | Vòng lặp vẽ hình không có `try/catch` từng hình | Bọc từng hình, lỗi tính vào số mục lỗi | `10-core.js` |
| 3 | Nút xuất mất biểu tượng/nhãn sau khi lưu | Gán lại `textContent` thành chữ trơn | Lưu `innerHTML` gốc và khôi phục | `10-core.js` |
| 4 | OCR 300 DPI trên giấy tờ nền vân đọc rất kém | Chế độ phân tích bố cục tự động (PSM 3) bị rối bởi nền hoa văn + đường chấm | Lượt 2 bằng PSM 11 khi lượt 1 đọc < 150 từ tin cậy; chỉ nhận khi tốt hơn ≥1,3 lần và +10 từ | `50-d.js` |

### 3.2 Phát hiện và sửa trong đợt kiểm toán v10 này

| # | Mức | Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|---|---|
| A | **Cao** — mất dữ liệu | Xóa/di chuyển ảnh ở trang 1 làm **trang 2 mất ảnh** | `stripOriginals` xóa tên ảnh trực tiếp khỏi từ điển `XObject`; từ điển này thường **dùng chung** giữa nhiều trang (kế thừa từ nút `Pages` hoặc cùng một đối tượng gián tiếp) | Sao chép-rồi-sửa: mỗi trang chỉ sửa trên **bản sao riêng** của `Resources`/`XObject` |
| B | **Cao** — mục đích tính năng | Sau khi "gỡ chữ gốc", **chữ gốc vẫn nằm trong file** | Content stream cũ chỉ bị bỏ tham chiếu; `pdf-lib` vẫn ghi mọi đối tượng trong bộ nhớ khi lưu. Chỉ dọn khi có ảnh bị gỡ | Luôn gọi `pruneUnreferenced` khi có trang bị đổi |
| C | Thấp | Vùng gỡ chữ rộng hơn ô trắng che (lệch 1 pt bên trái, ~0,07×cỡ chữ phía dưới) → có thể gỡ chữ mà mắt không thấy bị che | Hằng số khác với `drawRectangle` | Vùng gỡ lấy đúng công thức của ô che (nằm gọn bên trong) |

Kiểm tra bổ sung không phát hiện lỗi:
- Các file v10 xóa (`70-f.js`, `Code.gs`, `copy-vendor.mjs` ở thư mục gốc, `download/`, `env.example`, bản sao `fflate`/`mozjpeg` trong `vendor/`) đều là **bản trùng** — đường dẫn đang dùng thật (`lib/…`, `scripts/copy-vendor.mjs`, `apps-script/Code.gs`) vẫn còn đủ.
- Nút "chọn vùng" cũ không còn trong ribbon nên việc bỏ nhánh xử lý riêng là an toàn.
- Đoạn Python mới (dựng lưới bảng từ đường kẻ) chỉ dùng `bbox`, `row_count`, `col_count`, `cells` — `_GridTable` có đủ; đã chạy thử bằng dữ liệu giả.
- Nén PDF giữ lớp chữ tìm kiếm bằng chế độ chữ ẩn (Tr 3) thay vì `opacity: 0` — đúng chuẩn hơn.

## 4. Tính năng "gỡ chữ/ảnh gốc" (`src/features/stripOriginals.js`)

**Mục đích:** khi sửa/xóa chữ hoặc di chuyển ảnh ở tab Chỉnh sửa PDF, loại bỏ hẳn chữ/ảnh gốc khỏi nội dung trang thay vì chỉ phủ ô trắng (trước đây chữ gốc vẫn copy/tìm kiếm được).

**Cách làm:** đọc content stream của trang, theo dõi ma trận (`cm`, `Tm`, `Td`…) để biết điểm bắt đầu của từng lệnh `Tj/TJ/'/"` và `Do`; lệnh nằm trong vùng cần bỏ thì thay bằng lệnh rỗng; ghi stream mới; dọn đối tượng mồ côi. **Ô trắng che vẫn được vẽ** như cũ → nếu việc gỡ không áp dụng được thì kết quả nhìn thấy vẫn đúng.

**Giới hạn đã biết (cố ý, an toàn — lúc này chỉ còn ô trắng che):**
- Chữ nằm trong **Form XObject** chưa xử lý.
- Content stream có nhiều lớp mã hóa hoặc có `DecodeParms` (predictor) → giữ nguyên.
- Ảnh chỉ bị gỡ khi khung ảnh trùng vùng cần bỏ ≥ 80% (IoU).
- Chiều rộng chữ khi chỉ có một lệnh `Tj` liên tiếp được ước lượng (0,5×cỡ chữ/ký tự); chỉ ảnh hưởng khi không có lệnh dịch chuyển giữa các chuỗi.
- Dọn đối tượng mồ côi cũng làm mất **lịch sử cập nhật tăng dần** của file (có lợi cho bảo mật, nhưng khác file gốc về cấu trúc).

## 5. OCR — ghi chú đo đạc

Đo trên một bằng tốt nghiệp quét 3507×2481 (300 dpi), nền vân, bằng Tesseract dòng lệnh (tiếng Anh, chấm theo 41 từ khóa không dấu và mã số):

| DPI | PSM 3 (mặc định) | PSM 11 |
|---|---|---|
| 300 | 18/41 | 38/41 |
| 200 | 25/41 | 38/41 |
| 150 | 37/41 | 39/41 |

Đổi kênh màu, CLAHE hay nhị phân hóa **không** cải thiện (còn kém hơn) trên mẫu này. Chỉ số "số từ tin cậy ≥ 70" bám sát độ đúng thật nên được dùng làm tiêu chí thử lại. **Chưa kiểm chứng:** dấu tiếng Việt (môi trường đo không có mô hình `vie`) và chế độ mặc định thật của Tesseract.js 7 (mã worker tải từ CDN) — vì vậy lượt 1 được đặt PSM 3 tường minh.

## 6. Kiểm thử

Chạy tất cả: `npm test`. Chạy lẻ: `node tests/<tên>.test.cjs` hoặc `.mjs`.

| Test | Nội dung | Ghi chú |
|---|---|---|
| `utils`, `lazy`, `i18n`, `sw`, `worker`, `docx-fonts`, `region-selection` | Có sẵn từ trước | Đạt |
| `commit-pending` | Chốt chữ đang gõ trước khi lưu; nối dây trong `editorExportPDF` | Mới, 7 kiểm thử |
| `ocr-fallback` | Quy tắc thử lại PSM 11, số liệu từ mẫu bằng | Mới, 11 kiểm thử |
| `strip-originals` | Bộ tách token, gỡ chữ/ảnh, dọn mồ côi | Có từ v10 |
| `strip-shared-resources` | Ảnh trang khác không bị mất khi dùng chung tài nguyên (gián tiếp, kế thừa, riêng) | **Mới** — thất bại trên mã cũ, đạt trên mã mới |
| `strip-no-leak` | Chữ gốc không còn trong file; trang khác, tiêu đề, chú thích còn nguyên | **Mới** |
| `w2x-grid` (+ `.py`) | Logic dựng lưới bảng PDF→Excel bằng dữ liệu giả | **Mới**; tự bỏ qua nếu không có `python3` |
| `pdf-suite` | Bộ kiểm thử tổng hợp | Đạt |
| `region-behavior`, `edit-fidelity` | Cần `jsdom` | **Chưa chạy được trong đợt kiểm toán** (không có mạng để cài). Chạy `npm install && npm test` để xác nhận |

Ghi chú môi trường kiểm toán: `pdf-lib`, `jszip`, `pdf.js` được dựng tạm từ bản `public/vendor` để chạy test; không nằm trong gói bàn giao.

## 7. Chưa kiểm chứng — cần làm trước khi phát hành

Mọi bản sửa đã qua kiểm tra cú pháp và test tự động, nhưng **chưa chạy trên trình duyệt thật**. Danh sách thử tay (≈15 phút):

1. Tab Chỉnh sửa: gõ chữ mới vào một dòng, **không bấm ra ngoài**, bấm Lưu/Ctrl+S → mở file xuất: chữ mới có mặt.
2. Với file đó: bôi đen/ Ctrl+F tìm **chữ cũ** → không tìm thấy; chữ giữ lại vẫn copy được.
3. File nhiều trang có ảnh lặp lại (ví dụ logo ở mọi trang): xóa/di chuyển ảnh ở trang 1 → các trang khác còn ảnh.
4. Thêm hình (mũi tên, chữ nhật…) và xuất: hình hiển thị đủ; nút xuất giữ biểu tượng.
5. OCR lại bằng tốt nghiệp ở 300 DPI, tiếng Việt: so sánh với kết quả cũ (họ tên, ngày sinh, số hiệu).
6. PDF → Word/Excel với 2–3 file có bảng kẻ ô, bảng không kẻ, bảng nhiều trang.
7. `npm install && npm test` trên máy có mạng: kỳ vọng toàn bộ đạt, gồm `region-behavior` và `edit-fidelity`.

## 8. Việc nên làm tiếp (theo thứ tự rủi ro tăng dần)

1. Cảnh báo khi đóng tab lúc còn chỉnh sửa chưa lưu (`beforeunload`) — cần xác định đúng thời điểm "đã lưu".
2. Chuyển xuất PDF của tab Chỉnh sửa sang Web Worker (hiện chạy trên luồng chính, file lớn có thể làm đơ trang vài giây).
3. Hỗ trợ chữ trong Form XObject cho `stripOriginals`.
4. PDF→Word/Excel: cần **file PDF mẫu thật** để đo và tinh chỉnh; không nên chỉnh khi không có mẫu.
5. Tiền xử lý ảnh trước OCR chỉ nên thêm nếu đo được lợi ích trên mẫu thật (thử trên mẫu hiện tại cho kết quả ngược lại).

## 9. Lưu ý vận hành & pháp lý

- Công cụ sửa PDF **không** nên được dùng để thay đổi nội dung giấy tờ do cơ quan nhà nước cấp (bằng cấp, căn cước, giấy chứng nhận…) cho giống bản gốc. Nếu thông tin trên giấy tờ sai, cần xin cấp lại/đính chính tại nơi cấp.
- Với bản scan (chỉ là ảnh), không thể "sửa chữ" như Word; chỉ có thể OCR để lấy chữ, hoặc che/đè (kém đẹp trên nền vân).

## 10. Bản đồ các file đã thay đổi so với bản gốc ban đầu

| File | Thay đổi |
|---|---|
| `public/legacy/10-core.js` | Mục 3.1 #1–#3; vùng gỡ chữ khớp ô che (3.2 C); tích hợp `stripOriginals` (v10) |
| `public/legacy/50-d.js` | OCR thử lại PSM 11 (3.1 #4); chữ ẩn Tr 3 khi nén (v10) |
| `public/legacy/40-c.js` | Dựng lưới bảng từ đường kẻ cho PDF→Excel (v10) |
| `src/features/stripOriginals.js` | Tính năng gỡ chữ/ảnh gốc (v10) + vá 3.2 A, B |
| `src/features/editorWordRibbon.js`, `src/main.js` | Bỏ nhánh "chọn vùng" cũ; nạp `stripOriginals` (v10) |
| `package.json` | Nối các test mới vào `test:ui` |
| `tests/` | Thêm `commit-pending`, `ocr-fallback`, `strip-originals` (v10), `strip-shared-resources`, `strip-no-leak`, `w2x-grid` |
| `HANDOVER.md` | Tài liệu này |

---

## 11. Đợt kiểm toán thứ hai (v10.1) — xử lý các mục P0 từ báo cáo đánh giá

| Mục | Trạng thái | Chi tiết |
|---|---|---|
| **P0 — Redact rò rỉ nội dung gốc** | **Đã sửa + có test** | Đã tái hiện: sau `removePage`, chữ gốc còn trong file, giá trị ô biểu mẫu AcroForm và XMP cũng còn. Thêm `src/features/redactScrub.js`: gỡ ô biểu mẫu của trang đã che → (tùy chọn) bỏ XMP/Info → vô hiệu hóa trang gốc còn bị dấu trang/liên kết tham chiếu → `pruneUnreferenced`. Sau khi lưu, `verifyRedactedBytes` nạp lại file; **không xác nhận được thì hủy xuất**. Tệp đính kèm, dấu trang, XMP (khi không bật xóa metadata) được cảnh báo, không xóa âm thầm. |
| **P0 — Gỡ chữ gốc chưa đảm bảo mọi loại PDF** | **Đã sửa phần trung thực; giới hạn thuật toán còn** | `stripOriginals` trả `unconfirmed` = số vùng chữ/ảnh không xác nhận được là đã gỡ. Hộp thoại sau khi xuất ở tab Chỉnh sửa nêu rõ các mục này và hướng sang công cụ "Che thông tin". Chưa làm: chữ trong Form XObject, stream nhiều Filter/DecodeParms, ước lượng dịch chuyển chữ chính xác. |
| **P0 — PDF.js cũ** | **Chưa nâng cấp (cần máy có mạng)** | Biện pháp giảm thiểu CVE-2024-4367 (`isEvalSupported:false`) có test canh giữ `pdfjs-eval-guard`. Khi nâng cấp lên ≥ 4.2.67: chạy lại `pdf-suite`, `strip-*`, `redact-scrub`, kiểm tra worker, font chuẩn và OCR. |

Test mới: `redact-scrub`, `strip-confirm`, `pdfjs-eval-guard` (đã nối vào `npm run test:ui`).

Chưa làm: Margin Engine V2, cảnh báo đóng tab khi chưa lưu, XHR đồng bộ trong `04-lazy-libs.js`, Web Worker, OCR/Word/Excel với file thật, Node/CSP.

Khi dùng Redact cho tài liệu nhạy cảm: bật "Xóa siêu dữ liệu", đọc các cảnh báo sau khi xuất, mở file đầu ra và thử Ctrl+F phần đã che trước khi chia sẻ.

---

## 12. Đợt 3 (v10.2): Margin Engine V2, cảnh báo chưa lưu, tải thư viện, thanh danh sách file

| Hạng mục | Thay đổi |
|---|---|
| **Canh lề** | Nguyên nhân: hệ số co bị chặn `min(..., 1)` nên giảm lề (vd 20→2 mm) không phóng to nội dung; trình Chỉnh sửa còn lấy cả trang làm "nội dung" và bỏ qua checkbox "Bỏ lề trắng cũ". Sửa: `applyPageMarginTransform` (50-d.js) cho phép phóng to tối đa 6 lần khi đã nhận diện được vùng nội dung thật (không có vùng nội dung thì vẫn chỉ thu nhỏ để không cắt mất lề trang); engine được xuất ra `window.PDFMarginEngine`; nút Canh lề của trình Chỉnh sửa và chuỗi 1-click đều gọi chung `runMarginEngine` (editorWordRibbon.js). Giữ nguyên tỷ lệ (một hệ số cho cả hai chiều), tự căn giữa, hỗ trợ trang xoay và khổ khác nhau. Chưa có chế độ co giãn độc lập hai chiều (không bắt buộc). |
| **Chưa lưu** | `editorIsDirty()` + `beforeunload` (10-core.js). Chỉ đặt "đã lưu" SAU KHI xuất thành công; thao tác cả tài liệu (canh lề, xóa trang trắng, che thông tin...) cũng tính là chưa lưu. |
| **Tải thư viện** | `04-lazy-libs.js`: tải bất đồng bộ có timeout 30 s, thử lại 2 lần, báo lỗi bằng toast, tải sẵn khi trình duyệt rảnh. Đường XHR đồng bộ vẫn còn như dự phòng cuối cùng (mã cũ đọc biến toàn cục đồng bộ) nhưng hầu như không còn bị dùng. |
| **Thanh danh sách file** | Các công cụ ở tab Chuyển đổi/Công cụ PDF: khung "DANH SÁCH FILE" thu gọn thành một thanh có tiêu đề + trạng thái ("Đang chọn tất cả 5/5 file", "Đang chọn 2/5 file", "✅ n đã xong"); bấm để sổ danh sách. Danh sách trống thì mở sẵn (có hướng dẫn kéo thả), có file đầu tiên thì tự thu gọn, có kết quả mới thì tự mở để thấy nút tải. |

Test mới: `margin-engine` (4 hướng xoay, lề 2/20/50 mm; thử với mã cũ thì thất bại), `unsaved-warning`. Chưa chạy trình duyệt thật cho thanh danh sách file — cần xem bằng mắt.
