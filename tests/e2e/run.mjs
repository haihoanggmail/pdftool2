// Kiểm thử đầu-cuối trên TRÌNH DUYỆT THẬT (Playwright). Chạy sau khi build:
//   npm run build && node tests/e2e/run.mjs dist
// Cần: playwright (npm i -D playwright, hoặc có sẵn toàn cục). Chọn trình duyệt: E2E_CHANNEL=chrome | msedge (mặc định: Chromium của Playwright).
// Tùy chọn: PLAYWRIGHT_MODULE=/đường/dẫn/playwright/index.mjs  PDFLIB_MODULE=/đường/dẫn/pdf-lib  E2E_KEEP=1 (giữ file xuất để xem)
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib'; import { createRequire } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../..');
const dist = path.resolve(process.argv[2] || 'dist'); if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('Không thấy index.html trong', dist, '- hãy chạy npm run build trước.'); process.exit(2); }
const req = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const PL = req(process.env.PDFLIB_MODULE || 'pdf-lib'); const { PDFDocument, StandardFonts, PDFRawStream, PDFName, PDFArray, rgb, degrees } = PL;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')); const results = []; const rec = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };

// ---------- PDF mẫu ----------
globalThis.self = globalThis;
function loadFontkit() { const m = { exports: {} }; new Function('exports', 'module', 'self', fs.readFileSync(path.join(repo, 'public/vendor/fontkit.umd.min.js'), 'utf8'))(m.exports, m, globalThis); return m.exports.default || m.exports; }
async function makeSamples() {
  const win = {}; new Function('window', fs.readFileSync(path.join(repo, 'public/legacy/fonts-data.js'), 'utf8'))(win); const roboto = Buffer.from(win.EMBEDDED_ROBOTO.regular, 'base64');
  const sample = await PDFDocument.create(); const hf = await sample.embedFont(StandardFonts.Helvetica); const sp = sample.addPage([595, 842]);
  sp.drawText('Hello Original Line', { x: 72, y: 700, size: 18, font: hf }); sp.drawText('Second line stays here', { x: 72, y: 650, size: 18, font: hf });
  fs.writeFileSync(path.join(tmp, 'sample.pdf'), await sample.save());
  const d = await PDFDocument.create(); d.registerFontkit(loadFontkit()); const f = await d.embedFont(roboto, { subset: true });
  const p1 = d.addPage([595, 842]); p1.drawText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { x: 60, y: 780, size: 16, font: f }); p1.drawText('Họ và tên: Hoàng Kiến Dương', { x: 60, y: 740, size: 13, font: f }); p1.drawText('Số hiệu: BH00362/2025', { x: 60, y: 715, size: 13, font: f });
  const p2 = d.addPage([400, 600]); p2.setRotation(degrees(90)); p2.drawText('Trang hai xoay 90 độ', { x: 40, y: 500, size: 14, font: f });
  fs.writeFileSync(path.join(tmp, 'vn.pdf'), await d.save());
  const j = await PDFDocument.create(); const jp = j.addPage([400, 300]); const jref = j.context.register(j.context.stream(fs.readFileSync(path.join(here, 'fixtures/test.jp2')), { Type: 'XObject', Subtype: 'Image', Width: 300, Height: 200, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'JPXDecode' }));
  jp.node.Resources().set(PDFName.of('XObject'), j.context.obj({ Im1: jref })); jp.node.set(PDFName.of('Contents'), j.context.register(j.context.stream('q 300 0 0 200 50 50 cm /Im1 Do Q')));
  fs.writeFileSync(path.join(tmp, 'jpx.pdf'), await j.save());
}
// ---------- máy chủ tĩnh ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dist, p); if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('nf'); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(0);
const base = `http://localhost:${srv.address().port}/index.html`;
const launch = { headless: true }; if (process.env.E2E_CHANNEL) launch.channel = process.env.E2E_CHANNEL;
const browser = await chromium.launch(launch);
async function fresh() { const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true }); const page = await ctx.newPage(); const errs = [], dialogs = []; page.on('pageerror', (e) => errs.push(e.message.split('\n')[0])); page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 140)); d.accept(); }); await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(600); return { ctx, page, errs, dialogs }; }
const b64 = (n) => fs.readFileSync(path.join(tmp, n)).toString('base64');
const SIG = { dark: (r, g, b) => r < 80 && g < 80 && b < 80 };
async function analyse(page, bytesB64) { return page.evaluate(async (b) => { const d = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }).promise; const o = { n: d.numPages, text: [], dark: [] }; for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); o.text.push((await p.getTextContent()).items.map((x) => x.str).join(' ').trim()); const vp = p.getViewport({ scale: 1 }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; const x = cv.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); await p.render({ canvasContext: x, viewport: vp }).promise; const id = x.getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let j = 0; j < id.length; j += 4) if (id[j] < 80 && id[j + 1] < 80 && id[j + 2] < 80) k++; o.dark.push(k); } return o; }, bytesB64); }
function rawScan(bytes, needle) { return PDFDocument.load(bytes).then((pdf) => { const reach = new Set(); pdf.getPages().forEach((p) => { const c = p.node.get(PDFName.of('Contents')); (c instanceof PDFArray ? Array.from({ length: c.size() }, (_, k) => c.get(k)) : [c]).forEach((r) => r && r.tag && reach.add(r.tag)); }); let hits = 0, orphan = 0; const hex = Buffer.from(needle, 'latin1').toString('hex').toUpperCase(); for (const [ref, o] of pdf.context.enumerateIndirectObjects()) { if (!(o instanceof PDFRawStream) || String(o.dict.lookup(PDFName.of('Subtype'))) === '/Image') continue; let raw = o.getContents(); const fl = o.dict.lookup(PDFName.of('Filter')); try { if (fl && String(fl) === '/FlateDecode') raw = zlib.inflateSync(Buffer.from(raw)); } catch (e) { /* không phải flate */ } const t = Buffer.from(raw).toString('latin1'); if (t.includes(needle) || t.toUpperCase().includes(hex)) hits++; if (/\bT[jJ]\b/.test(t) && !reach.has(ref.tag)) orphan++; } return { hits, orphan }; }); }
const keep = (n, buf) => { if (process.env.E2E_KEEP) { fs.writeFileSync(path.join(tmp, n), buf); } };

await makeSamples();
try {
  { // 1) tải trang + lõi
    const { ctx, page, errs } = await fresh(); const info = await page.evaluate(() => ({ v: window.pdfjsLib && pdfjsLib.version, missing: ['editorExportPDF', 'editorLoadBytes', 'commitPendingTextEdits', 'stripOriginals', 'editorIsDirty', 'editorMarkDocDirty'].filter((n) => typeof window[n] !== 'function'), tabs: document.querySelectorAll('.tab-btn,.menu-item').length }));
    rec('Tải trang, không lỗi script, đủ hàm lõi', errs.length === 0 && !info.missing.length && info.tabs > 5, `pdf.js ${info.v}, thiếu: [${info.missing}], lỗi: ${errs.join(';') || 'không'}`); await ctx.close();
  }
  { // 2) tương thích pdf.js qua lớp tương thích của app
    const { ctx, page } = await fresh();
    const r = await page.evaluate(async ([jpx, vn]) => { const out = {}; const load = (b) => pdfjsLib.getDocument({ data: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }); const t = load(jpx); const d = await t.promise; out.destroyFn = typeof d.destroy; const p = await d.getPage(1); const vp = p.getViewport({ scale: 1 }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; const x = cv.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); await p.render({ canvasContext: x, viewport: vp }).promise; out.jpxPixels = [[100, 100], [200, 150], [330, 230]].map(([a, c]) => Array.from(x.getImageData(a, c, 1, 1).data.slice(0, 3))); await d.destroy(); const d2 = await load(vn).promise; const tc = await (await d2.getPage(1)).getTextContent(); out.vnText = tc.items.map((i) => i.str).join(' '); await d2.destroy(); return out; }, [b64('jpx.pdf'), b64('vn.pdf')]);
    const notWhite = r.jpxPixels.every((px) => px.some((v) => v < 250));
    rec('pdf.js: ảnh JPEG2000 hiển thị (không trắng), destroy() có, tiếng Việt trích đúng', notWhite && r.destroyFn === 'function' && r.vnText.includes('Hoàng Kiến Dương'), `JPX ${JSON.stringify(r.jpxPixels)}, destroy: ${r.destroyFn}`); await ctx.close();
  }
  { // 3) sửa chữ + Lưu khi chưa bấm ra ngoài
    const { ctx, page, errs, dialogs } = await fresh(); await page.evaluate(() => { const b = [...document.querySelectorAll('.tab-btn,.menu-item')].find((x) => (x.getAttribute('onclick') || '').includes("'tab-editor'")); window.switchTab('tab-editor', b); });
    await page.setInputFiles('#editor-file-input', path.join(tmp, 'sample.pdf')); await page.waitForFunction(() => document.querySelectorAll('#editor-text-layer span').length >= 2, null, { timeout: 20000 });
    await page.locator('#editor-text-layer span', { hasText: 'Hello Original' }).first().dblclick(); const inp = page.locator('#editor-text-layer .editing-input').first(); await inp.waitFor({ timeout: 5000 }); await inp.fill('Xin chao moi 2026');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#rb-save-btn')]); const out = path.join(tmp, 'edited.pdf'); await dl.saveAs(out); const a = await analyse(page, fs.readFileSync(out).toString('base64')); const t = a.text[0];
    rec('Chỉnh sửa: gõ chữ rồi bấm Lưu ngay (không blur) -> file có chữ mới, mất chữ cũ, giữ dòng khác', t.includes('Xin chao moi 2026') && !t.includes('Hello Original') && t.includes('Second line stays'), `"${t}"`); rec('Chỉnh sửa: không lỗi script/hộp thoại bất thường', errs.length === 0 && dialogs.length === 0, `lỗi: ${errs.join(';') || 'không'}, hộp thoại: ${dialogs.join(';') || 'không'}`); await ctx.close();
  }
  for (const [pdf, secret, expectPages] of [['sample.pdf', 'Second line stays here', 1], ['vn.pdf', 'BH00362/2025;Hoàng Kiến Dương', 2]]) { // 4) Redact
    const { ctx, page, errs } = await fresh(); await page.evaluate(() => window.switchTab('tab-redact', null)); await page.setInputFiles('#rd-pdf', path.join(tmp, pdf));
    await page.waitForFunction(() => !/^0 \/ 0/.test(document.getElementById('rd-pageinfo').textContent), null, { timeout: 20000 }); await page.fill('#rd-custom', secret); await page.click('#rd-find'); await page.waitForFunction(() => document.getElementById('rd-found').textContent.trim().length > 0, null, { timeout: 20000 });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#rd-export')]); const out = path.join(tmp, 'redacted_' + pdf); await dl.saveAs(out); const bytes = fs.readFileSync(out); keep('redacted_' + pdf, bytes);
    const needle = secret.split(';')[0].trim(); const raw = await rawScan(bytes, needle); const a = await analyse(page, bytes.toString('base64'));
    rec(`Redact (${pdf}): không còn dữ liệu gốc trong file (đọc thô, kể cả đối tượng mồ côi)`, raw.hits === 0 && raw.orphan === 0, `đối tượng chứa chuỗi: ${raw.hits}, luồng chữ mồ côi: ${raw.orphan}`);
    rec(`Redact (${pdf}): trang bị che thành ảnh có ô đen; đủ ${expectPages} trang; trang khác còn chữ`, a.n === expectPages && a.text[0] === '' && a.dark[0] > 500 && (expectPages === 1 || a.text[1].includes('Trang hai')), `trang: ${a.n}, chữ trang 1: "${a.text[0]}", điểm đen: ${a.dark}`); rec(`Redact (${pdf}): không lỗi script`, errs.length === 0, errs.join(';')); await ctx.close();
  }
  { // 5) Ký tên: mở PDF TRƯỚC rồi mới vẽ chữ ký (thứ tự thật của người dùng)
    const { ctx, page, errs } = await fresh(); await page.evaluate(() => { window.switchTab('tab-sign', null); window.__t = []; const t = window.toast; window.toast = (...a) => { window.__t.push(a.join('|')); return t && t(...a); }; });
    await page.setInputFiles('#sg-pdf', path.join(tmp, 'vn.pdf')); await page.waitForFunction(() => !/^0 \/ 0/.test(document.getElementById('sg-pageinfo').textContent), null, { timeout: 20000 }); await page.waitForTimeout(1500);
    await page.locator('#sg-canvas').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const cv = await page.locator('#sg-canvas').boundingBox();
    await page.mouse.move(cv.x + 40, cv.y + 100); await page.mouse.down(); for (let i = 0; i <= 20; i++) await page.mouse.move(cv.x + 40 + i * 14, cv.y + 60 + (i % 2) * 60, { steps: 2 }); await page.mouse.up();
    await page.click('#sg-save'); await page.waitForTimeout(300); const saved = await page.evaluate(() => window.__t.some((m) => m.includes('error') && /ký/i.test(m)) ? 'LỖI: ' + window.__t.join(' / ') : 'ok');
    await page.click('#sg-add'); await page.waitForTimeout(400); await page.click('#sg-all'); await page.waitForTimeout(600);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }).catch(() => null), page.click('#sg-export')]);
    if (!dl) rec('Ký tên: xuất file', false, 'không có tải về; thông báo: ' + (await page.evaluate(() => window.__t.slice(-4).join(' / ')))); else {
      const out = path.join(tmp, 'signed.pdf'); await dl.saveAs(out); keep('signed.pdf', fs.readFileSync(out)); const o = await analyse(page, b64('vn.pdf')); const s = await analyse(page, fs.readFileSync(out).toString('base64')); const added = s.dark.map((v, i) => v - o.dark[i]);
      rec('Ký tên: lưu được chữ ký vẽ sau khi đã mở PDF', saved === 'ok', saved); rec('Ký tên: xuất đủ trang, chữ gốc còn chọn được, có nét ký trên mọi trang (kể cả trang xoay)', s.n === 2 && JSON.stringify(s.text) === JSON.stringify(o.text) && added.every((v) => v > 150), `trang: ${s.n}, thêm điểm đen: ${added}`);
    } rec('Ký tên: không lỗi script', errs.length === 0, errs.join(';')); await ctx.close();
  }
} catch (e) { rec('Chạy kiểm thử', false, String(e.message || e).split('\n')[0]); }
await browser.close(); srv.close();
const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} đạt` + (process.env.E2E_CHANNEL ? ` (trình duyệt: ${process.env.E2E_CHANNEL})` : '') + (process.env.E2E_KEEP ? `\nfile xuất lưu ở ${tmp}` : ''));
process.exit(failed.length ? 1 : 0);
