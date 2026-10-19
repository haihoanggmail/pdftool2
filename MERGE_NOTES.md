# Bản hợp nhất v7 (A + B + v6)

Gốc chung của A và B là v6. Hợp nhất 3 chiều bằng `git merge-file`; chỉ 6 file có xung đột thật.

## Lấy từ A (kiến trúc / hiệu năng)
- `04-lazy-libs.js` (tải trễ fonts-data 1,4 MB + fontkit 0,75 MB), `06-pdf-ops.js` + `pdf-ops.worker.js` (gộp / xuất PDF trong Web Worker, có Hủy)
- `08-a11y.js` + `a11y.css`; `sw.js` mới (cache vendor riêng, mã build); `vite.config.js`, `vercel.json`, `manifest`, `robots.txt`, `sitemap.xml`, `og-image.png`
- Gói dịch i18n tải khi chọn ngôn ngữ (`80-g.js`); thông báo thống kê + ô "Không gửi thống kê"; 6 file test mới (`npm run test:ui`)

## Lấy từ B (tính năng chuyển đổi)
- `PdfConvertAnalysis` (30-b.js): kiểm tra trước từng trang (chữ thật / scan) cho Word và Excel
- `clearEditorTool` (Esc hoặc bấm ra ngoài trang để bỏ công cụ vẽ)

## Giống nhau ở A và B (giữ nguyên)
- 50-d.js (nút Hủy, đồng hồ chạy, OCR tự giải phóng), 97-viewer.js, auth / sign / redact, 05-core-utils.js, 92-94 i18n

## Cách xử lý các xung đột
| File | Xử lý |
|---|---|
| `30-b.js`, `40-c.js` | giữ cảnh báo "file lớn" của A + dùng phân tích trang của B |
| `10-core.js` | lấy phía A (logView + tải trước font); phần zoom giống nhau ở cả hai |
| `index.html` | lấy A: danh sách script (không còn tag fontkit / fonts-data / i18n), thông báo thống kê, dòng hỗ trợ kỹ thuật ghi tên |
| `sw.js` | lấy A, thêm `lib/` vào nhóm cache cố định |
| `main.js` | thêm import `a11y.css` |

## Giữ từ v6 (bộ nén / Excel / xem trước)
- Bộ nén Tự động / Siêu nén (mozjpeg + fflate trong `public/lib/`), Che thông tin trong tab Chỉnh sửa, xem trước nhiều trang, PDF → Excel giữ ảnh
- Bổ sung: giải phóng tài liệu pdf.js cũ và object URL ở sign / form / redact / ribbon / worker Word-Excel
