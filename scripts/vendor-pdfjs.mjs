// Tạo lại pdf.js đã đóng gói trong public/vendor từ gói npm `pdfjs-dist` (xem lý do trong scripts/copy-vendor.mjs).
//   npm install pdfjs-dist@<phiên bản> --save-exact && npm run vendor:pdfjs
// Dùng bản "legacy" của pdf.js (chạy được trên trình duyệt cũ hơn). Cần mạng ở lần đầu để npx tải esbuild.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';

const base = 'node_modules/pdfjs-dist';
const version = JSON.parse(readFileSync(`${base}/package.json`, 'utf8')).version;
if (Number(version.split('.')[0]) < 5) { console.error(`pdfjs-dist ${version}: script này dành cho bản ESM (>= 5). Với bản cũ dùng build/pdf.min.js.`); process.exit(1); }
console.log('pdfjs-dist', version);

const esbuild = process.env.ESBUILD_BIN;   // dùng cho kiểm thử offline; bình thường để trống -> npx
const args = [`${base}/legacy/build/pdf.min.mjs`, '--bundle', '--format=iife', '--global-name=pdfjsLib', '--target=es2020', '--legal-comments=none', '--outfile=public/vendor/pdf.min.js', '--log-level=error'];
if (esbuild) execFileSync(esbuild, args, { stdio: 'inherit' });
else execFileSync('npx', ['--yes', 'esbuild@0.28.2', ...args], { stdio: 'inherit', shell: true });

// esbuild ghi đường dẫn tương đối theo thư mục chạy vào một dòng chú thích -> chuẩn hóa để kết quả giống hệt trên mọi máy (tái lập được)
const out = readFileSync('public/vendor/pdf.min.js', 'utf8');
writeFileSync('public/vendor/pdf.min.js', out.replace(/^(\s*)\/\/ .*pdf\.min\.mjs$/m, `$1// pdfjs-dist ${version} legacy/build/pdf.min.mjs`));

const wasmDir = `public/vendor/pdfjs/${version}/wasm`;   // phiên bản nằm trong đường dẫn (vercel.json cache /vendor/* kiểu immutable 1 năm)
for (const d of existsSync('public/vendor/pdfjs') ? readdirSync('public/vendor/pdfjs') : []) if (d !== version) rmSync(`public/vendor/pdfjs/${d}`, { recursive: true, force: true });
mkdirSync(wasmDir, { recursive: true });
cpSync(`${base}/legacy/build/pdf.worker.min.mjs`, 'public/vendor/pdf.worker.min.js');
for (const f of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_QCMS', 'LICENSE_QCMS']) cpSync(`${base}/wasm/${f}`, `${wasmDir}/${f}`);
cpSync(`${base}/LICENSE`, 'public/vendor/LICENSE-pdfjs.txt');

// đồng bộ phiên bản ở MỌI nơi tham chiếu (chốt chặn trong copy-vendor.mjs + URL có ?v= / thư mục wasm theo phiên bản)
const cv = readFileSync('scripts/copy-vendor.mjs', 'utf8');
const old = (cv.match(/const PDFJS_VERSION = '([^']*)';/) || [])[1];
writeFileSync('scripts/copy-vendor.mjs', cv.replace(/const PDFJS_VERSION = '[^']*';/, `const PDFJS_VERSION = '${version}';`));
if (old && old !== version) for (const f of ['index.html', 'src/main.js', 'public/legacy/10-core.js', 'public/sw.js']) if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').split(old).join(version));
console.log('Xong. Hãy chạy lại bộ kiểm thử (npm test) và thử tay các luồng dùng pdf.js (xem HANDOVER.md).');
