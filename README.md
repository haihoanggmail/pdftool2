# HACHIHI PDF Tool (bản Vite)

Công cụ PDF chạy hoàn toàn trên trình duyệt. Bản này tách từ file `index.html` đơn lẻ thành project có build.

## Chạy thử
```bash
npm install      # tự sao chép thư viện vào public/vendor
npm run dev      # http://localhost:5173
npm run build    # xuất ra thư mục dist
```

## Deploy
- **Vercel**: Import repo, các thiết lập đã có trong `vercel.json` (build `npm run build`, output `dist`).
- **Render**: New → Blueprint, chọn repo (đọc `render.yaml`, dạng Static Site). Hoặc tạo Static Site thủ công: Build `npm ci && npm run build`, Publish `dist`.
- **GitHub Pages**: build rồi đẩy nội dung `dist` lên nhánh gh-pages (đã dùng `base: './'` nên chạy được ở thư mục con).

## Thống kê lượt dùng (giấu link Apps Script ở biến Vercel)
Trình duyệt chỉ gọi `/api/track` (hàm `api/track.js` chạy trên Vercel). Hàm này đọc **biến môi trường** và chuyển tiếp, nên link Apps Script không xuất hiện trong mã nguồn hay trình duyệt.
Dữ liệu gửi đi: tên thao tác (`pdf_to_word`, `save_pdf`, `sign_pdf`...) — sang Apps Script chỉ có `action` như bản cũ.

Cài đặt trên Vercel → Project → **Settings → Environment Variables**:
| Biến | Ý nghĩa |
|---|---|
| `APPS_SCRIPT_URL` | Link Web app Google Apps Script (mã nguồn mẫu: `apps-script/Code.gs`) |
| `APPS_SCRIPT_KEY` | (Khuyên dùng) Mật khẩu chung, trùng với Script property `SECRET` trong Apps Script |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | (Tùy chọn) Upstash Redis, tự có khi thêm từ Storage — để xem thống kê ở `/stats.html` |
| `STATS_KEY` | (Tùy chọn) Khóa xem `/stats.html` |

Sau khi thêm/sửa biến phải **Redeploy** thì mới có hiệu lực. Chưa đặt biến nào thì app vẫn chạy bình thường. Người dùng có thể tắt bằng Do Not Track hoặc `localStorage['pdftool-no-log']='1'`. Trên Render/GitHub Pages không có `/api` nên thống kê bị bỏ qua êm.

> Link Apps Script cũ từng nằm trong mã nguồn công khai → nên **tạo bản triển khai (deployment) mới** trong Apps Script để có link mới, bỏ link cũ.

## Cấu trúc
- `index.html` – khung giao diện (HTML thuần).
- `src/features/sign.js`, `src/styles/sign.css` – tab **✍️ Ký tên** (vẽ / ảnh chữ ký, kéo-thả-đổi cỡ, nhân bản mọi trang, xuất PDF).
- `src/features/form.js` (📝 Điền form), `src/features/redact.js` (⬛ Che thông tin), `src/features/ui.js` (tiện ích dùng chung).
- `api/` – hàm serverless Vercel (track, stats).
- `src/main.js`, `src/styles/ux.css` – lớp UX mới: toast (`window.toast`), tiến trình (`window.Progress`), kéo thả toàn trang, phím tắt (bấm `?`).
- `public/legacy/*.js` – logic cũ được tách theo khối, nạp theo thứ tự. `fonts-data.js` (1,4 MB font nhúng) nạp nền, không chặn trang.
- `public/vendor/` – pdf-lib, pdf.js, jszip, exceljs, tesseract.js tự host (sinh bởi `scripts/copy-vendor.mjs`, không commit).
- `public/lib/` – thư viện tự host đã build sẵn, CÓ commit: `fflate.min.js` (zlib mức 9), `jsq-jpeg.mjs` + `mozjpeg_enc.wasm` (mã hóa JPEG mozjpeg, nguồn `@jsquash/jpeg`, Apache-2.0). Dùng cho bộ nén PDF.
- `public/legacy/97-viewer.js` – bộ xem trước PDF nhiều trang dùng chung (Ctrl + cuộn để zoom, vừa ngang / nhiều trang vừa khung) cho các tab Gộp, PDF Tools, Word, Excel.
- `public/sw.js` – service worker (đổi `VERSION` khi cần xóa cache cũ).

## Việc tiếp theo
Chuyển dần `public/legacy/*` sang module trong `src/` (từng tab một), thêm tính năng mới: ký tên, điền form, che thông tin, so sánh nâng cao.

## Lịch sử thay đổi
- **v7:** hợp nhất hai nhánh A (tải trễ, Web Worker, a11y, SEO, service worker mới) và B (phân tích trang scan, bỏ chọn công cụ bằng Esc) với v6. Chi tiết xem `MERGE_NOTES.md`.

### v6 = gộp v4 + v5
- **Nén PDF:** chế độ 🧠 Tự động, 🚀 Siêu nén (giữ lớp chữ tìm kiếm), Cực mạnh; giảm dpi theo kích thước ảnh thật trên trang; mozjpeg + tự nhận ảnh xám; thu nhỏ mặt nạ trong suốt; gộp đối tượng trùng; zlib mức 9; báo cáo "dung lượng còn nằm ở đâu".
- **Tab Chỉnh sửa:** nhóm "Công cụ nhanh" (Trang chủ), Che thông tin nhạy cảm (tự động / thủ công), bước Che và bước Nén trong Chuỗi liên hoàn, nút Nén PDF dùng chung bộ nén mới.
- **Xem trước:** bộ xem trước nhiều trang dùng chung (Ctrl + cuộn, vừa ngang, nhiều trang vừa khung) cho Gộp, PDF Tools, Word, Excel; Ctrl + cuộn cho Đối chiếu và Che thông tin.
- **PDF → Excel:** giữ hình ảnh (ảnh nhúng, logo vector, chữ ký, con dấu) đặt đúng vị trí; chế độ "Giống PDF gốc" (mỗi trang một ảnh).
