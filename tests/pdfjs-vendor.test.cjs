// Chuỗi cung ứng pdf.js: file đóng gói đúng phiên bản, đủ wasm, copy-vendor KHÔNG ghi đè lại bản cũ và chốt chặn hoạt động.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('ok  ', m); };

// 1) file thật trong repo
const ver = rd('scripts/copy-vendor.mjs').match(/const PDFJS_VERSION = '([^']+)'/)[1];
assert.ok(rd('public/vendor/pdf.min.js').includes(ver) && rd('public/vendor/pdf.worker.min.js').includes(ver)); ok(`pdf.min.js và pdf.worker.min.js đều là pdf.js ${ver}`);
assert.ok(Number(ver.split('.')[0]) >= 5 && (Number(ver.split('.')[0]) > 4 || Number(ver.split('.')[1]) >= 2), 'phải >= 4.2.67 (đã vá CVE-2024-4367)'); ok('phiên bản đã bao gồm bản vá CVE-2024-4367 (>= 4.2.67)');
for (const f of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']) { const b = fs.readFileSync(path.join(root, 'public/vendor/pdfjs', ver, 'wasm', f)); assert.deepEqual([...b.slice(0, 4)], [0, 0x61, 0x73, 0x6d], f + ' không phải wasm hợp lệ'); }
ok('3 file wasm (JPEG2000, JBIG2, ICC) có mặt và đúng định dạng');
assert.ok(fs.existsSync(path.join(root, 'public/vendor/LICENSE-pdfjs.txt')) && fs.existsSync(path.join(root, 'public/vendor/pdfjs', ver, 'wasm/LICENSE_OPENJPEG'))); ok('giấy phép pdf.js và openjpeg có đi kèm');
// Phiên bản phải nằm trong URL ở MỌI nơi tham chiếu: vercel.json cache /vendor/* kiểu immutable 1 năm, nên đổi nội dung mà giữ URL = người dùng cũ kẹt bản cũ / lệch pdf.js với worker.
assert.ok(rd('index.html').includes(`<script src="vendor/pdf.min.js?v=${ver}">`)); assert.ok(rd('public/legacy/10-core.js').includes(`workerSrc = 'vendor/pdf.worker.min.js?v=${ver}'`));
assert.ok(rd('index.html').includes(`vendor/pdfjs/${ver}/wasm/`) && rd('src/main.js').includes(`vendor/pdfjs/${ver}/wasm/`));
assert.ok(rd('public/sw.js').includes(`./vendor/pdf.min.js?v=${ver}`) && rd('public/sw.js').includes(`./vendor/pdf.worker.min.js?v=${ver}`)); ok(`phiên bản ${ver} nhất quán trong index.html, main.js, 10-core.js, sw.js (URL có ?v= và thư mục wasm theo phiên bản)`);
for (const f of ['index.html', 'src/main.js', 'public/legacy/10-core.js', 'public/sw.js']) { const stale = (rd(f).match(/vendor\/pdf(?:\.worker)?\.min\.js(?!\?v=)/g) || []); assert.equal(stale.length, 0, f + ': còn URL pdf.js không có phiên bản'); }
assert.ok(!fs.existsSync(path.join(root, 'public/vendor/pdfjs/wasm')), 'không được còn thư mục wasm không có phiên bản'); ok('không còn URL pdf.js hay thư mục wasm thiếu phiên bản');
const sw = rd('public/sw.js'); assert.ok(sw.includes("'pdftool-vendor-v2'") && !sw.includes("'pdftool-vendor-v1'")); ok('service worker đã tăng phiên bản cache vendor (không giữ pdf.js cũ)');
assert.ok(!/pdf\.min\.js|pdf\.worker/.test(rd('scripts/copy-vendor.mjs').split('\n').filter((l) => l.trim().startsWith("['")).join('\n'))); ok('copy-vendor không còn chép pdf.js từ node_modules (không ghi đè về bản cũ)');

// 2) chốt chặn của copy-vendor trong thư mục tạm
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-')); const put = (p, c = '') => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), c); };
['pdf-lib/dist/pdf-lib.min.js', '@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'jszip/dist/jszip.min.js', 'exceljs/dist/exceljs.min.js', 'tesseract.js/dist/tesseract.min.js'].forEach((f) => put('node_modules/' + f, '//x'));
put('scripts/copy-vendor.mjs', rd('scripts/copy-vendor.mjs'));
const setup = () => { for (const f of ['pdf.min.js', 'pdf.worker.min.js']) put('public/vendor/' + f, `/* pdf.js ${ver} */`); for (const f of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']) put(`public/vendor/pdfjs/${ver}/wasm/` + f, 'x'); };
const run = () => spawnSync(process.execPath, ['scripts/copy-vendor.mjs'], { cwd: tmp, encoding: 'utf8' });
setup(); let r = run(); assert.equal(r.status, 0, r.stderr); ok('copy-vendor chạy thành công khi file đóng gói đúng');
put('public/vendor/pdf.min.js', '/* pdf.js 3.11.174 */'); r = run(); assert.equal(r.status, 1); assert.match(r.stderr, /không phải pdf\.js/); ok('chốt chặn: file pdf.min.js sai phiên bản -> dừng build');
setup(); put('public/vendor/pdf.worker.min.js', '/* 3.11.174 */'); r = run(); assert.equal(r.status, 1); ok('chốt chặn: worker lệch phiên bản -> dừng build');
setup(); fs.rmSync(path.join(tmp, `public/vendor/pdfjs/${ver}/wasm/openjpeg.wasm`)); r = run(); assert.equal(r.status, 1); assert.match(r.stderr, /THIẾU/); ok('chốt chặn: thiếu wasm -> dừng build');

// 3) vendor-pdfjs.mjs: từ chối bản cũ; (tùy chọn) chạy tái tạo thật nếu có PDFJS_DIST_DIR + ESBUILD_BIN
put('scripts/vendor-pdfjs.mjs', rd('scripts/vendor-pdfjs.mjs')); put('node_modules/pdfjs-dist/package.json', '{"version":"3.11.174"}');
r = spawnSync(process.execPath, ['scripts/vendor-pdfjs.mjs'], { cwd: tmp, encoding: 'utf8' }); assert.equal(r.status, 1); assert.match(r.stderr, /dành cho bản ESM/); ok('vendor-pdfjs từ chối pdfjs-dist < 5');
if (process.env.PDFJS_DIST_DIR && process.env.ESBUILD_BIN) {
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-')); fs.mkdirSync(path.join(t2, 'node_modules'), { recursive: true }); fs.symlinkSync(process.env.PDFJS_DIST_DIR, path.join(t2, 'node_modules/pdfjs-dist'));
  fs.mkdirSync(path.join(t2, 'scripts')); fs.writeFileSync(path.join(t2, 'scripts/vendor-pdfjs.mjs'), rd('scripts/vendor-pdfjs.mjs')); fs.writeFileSync(path.join(t2, 'scripts/copy-vendor.mjs'), "const PDFJS_VERSION = '0.0.0';\n");
  const rr = spawnSync(process.execPath, ['scripts/vendor-pdfjs.mjs'], { cwd: t2, encoding: 'utf8', env: process.env }); assert.equal(rr.status, 0, rr.stderr + rr.stdout);
  const gen = fs.readFileSync(path.join(t2, 'public/vendor/pdf.min.js'), 'utf8'); const v = JSON.parse(fs.readFileSync(path.join(process.env.PDFJS_DIST_DIR, 'package.json'), 'utf8')).version;
  assert.ok(gen.includes(v) && fs.existsSync(path.join(t2, `public/vendor/pdfjs/${v}/wasm/openjpeg.wasm`)) && fs.readFileSync(path.join(t2, 'scripts/copy-vendor.mjs'), 'utf8').includes(`'${v}'`));
  assert.equal(gen, rd('public/vendor/pdf.min.js'), 'bản tái tạo phải GIỐNG HỆT file đang commit (tái lập được)'); ok(`tái tạo thật từ pdfjs-dist ${v}: giống hệt file đã commit, đồng bộ hằng số phiên bản`);
  // mô phỏng NÂNG CẤP lần sau: repo đang ở bản cũ (6.1.0) -> chạy script -> mọi tham chiếu phiên bản phải đổi theo, thư mục wasm cũ bị dọn
  const t3 = fs.mkdtempSync(path.join(os.tmpdir(), 'up-')); const OLD = '6.1.0';
  for (const f of ['index.html', 'src/main.js', 'public/legacy/10-core.js', 'public/sw.js', 'scripts/copy-vendor.mjs']) { fs.mkdirSync(path.dirname(path.join(t3, f)), { recursive: true }); fs.writeFileSync(path.join(t3, f), rd(f).split(v).join(OLD)); }
  fs.mkdirSync(path.join(t3, `public/vendor/pdfjs/${OLD}/wasm`), { recursive: true }); fs.writeFileSync(path.join(t3, `public/vendor/pdfjs/${OLD}/wasm/openjpeg.wasm`), 'x');
  fs.mkdirSync(path.join(t3, 'node_modules'), { recursive: true }); fs.symlinkSync(process.env.PDFJS_DIST_DIR, path.join(t3, 'node_modules/pdfjs-dist')); fs.mkdirSync(path.join(t3, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(t3, 'scripts/vendor-pdfjs.mjs'), rd('scripts/vendor-pdfjs.mjs'));
  const ru = spawnSync(process.execPath, ['scripts/vendor-pdfjs.mjs'], { cwd: t3, encoding: 'utf8', env: process.env }); assert.equal(ru.status, 0, ru.stderr + ru.stdout);
  for (const f of ['index.html', 'src/main.js', 'public/legacy/10-core.js', 'public/sw.js', 'scripts/copy-vendor.mjs']) { const c = fs.readFileSync(path.join(t3, f), 'utf8'); assert.ok(c.includes(v) && !c.includes(OLD), f + ': phải đổi hết sang ' + v); }
  assert.ok(!fs.existsSync(path.join(t3, `public/vendor/pdfjs/${OLD}`)) && fs.existsSync(path.join(t3, `public/vendor/pdfjs/${v}/wasm/openjpeg.wasm`))); ok(`nâng cấp ${OLD} -> ${v}: mọi tham chiếu (index.html, main.js, 10-core.js, sw.js, copy-vendor) đổi theo, thư mục wasm cũ bị dọn`);
} else console.log('skip tái tạo thật (đặt PDFJS_DIST_DIR và ESBUILD_BIN để chạy)');
console.log(`\n${n} kiểm thử đạt`);
