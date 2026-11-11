// Kiểm thử: gỡ hẳn chữ / ảnh gốc khỏi file khi sửa trong tab Chỉnh sửa PDF
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import { stripOriginals, stripContent, tokenize } from '../src/features/stripOriginals.js';
const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

async function textOf(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map(t => t.str).join(' '));
  return out;
}
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

// 1) tokenizer + stripContent trên nội dung tự viết (Td / TJ / chuỗi hex / cm + Do)
{
  const src = 'q 1 0 0 1 0 0 cm BT /F1 12 Tf 50 700 Td (Giu lai dong 1) Tj 0 -20 Td [(Xoa)-120(dong 2)] TJ 0 -20 Td <00480049> Tj ET Q';
  assert.ok(tokenize(src).length > 10);
  const r = stripContent(src, [{ x0: 40, x1: 200, y0: 670, y1: 690 }], [], () => false);
  assert.equal(r.removedText, 1, 'chỉ dòng 2 nằm trong vùng');
  assert.match(r.content, /\(Giu lai dong 1\) Tj/);
  assert.match(r.content, /\[\] TJ/);
  assert.match(r.content, /<00480049> Tj/);
  assert.ok(!r.content.includes('Xoa'));
}

// 2) chuỗi có ngoặc lồng / escape, ảnh nhúng trong dòng (BI..EI) không làm lệch token
{
  const src = 'BT 1 0 0 1 10 10 Tm (a \\) b (c) d) Tj ET BI /W 1 /H 1 /BPC 8 /CS /G ID \x00\x01 EI BT 1 0 0 1 10 100 Tm (sau anh) Tj ET';
  const r = stripContent(src, [{ x0: 0, x1: 50, y0: 90, y1: 110 }], [], () => false);
  assert.equal(r.removedText, 1);
  assert.match(r.content, /\(a \\\) b \(c\) d\) Tj/, 'chuỗi có ngoặc lồng giữ nguyên');
}

// 3) PDF thật bằng pdf-lib: xóa 1 dòng, các dòng còn lại và ảnh khác giữ nguyên
{
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  page.drawText('Dong giu lai A', { x: 50, y: 350, size: 14, font });
  page.drawText('Thong tin nhay cam 0912345678', { x: 50, y: 320, size: 14, font });
  page.drawText('Dong giu lai B', { x: 50, y: 290, size: 14, font });
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 50, y: 150, width: 80, height: 60 });
  page.drawImage(img, { x: 200, y: 150, width: 80, height: 60 });
  const before = await doc.save();
  assert.equal((await textOf(before))[0].includes('nhay cam'), true);

  const doc2 = await PDFLib.PDFDocument.load(before);
  const sr = await stripOriginals(doc2, {
    text: [{ page: 1, x0: 45, x1: 330, y0: 315, y1: 335 }],
    images: [{ page: 1, x0: 50, y0: 150, x1: 130, y1: 210 }]
  }, PDFLib);
  assert.equal(sr.text, 1); assert.equal(sr.images, 1); assert.equal(sr.pages, 1);
  const after = await doc2.save();
  const t = (await textOf(after))[0];
  assert.ok(!t.includes('nhay cam') && !t.includes('0912345678'), 'chữ nhạy cảm phải biến mất khỏi file');
  assert.ok(t.includes('Dong giu lai A') && t.includes('Dong giu lai B'), 'các dòng khác giữ nguyên');
  const s = Buffer.from(after).toString('latin1');
  assert.ok(!s.includes('0912345678'), 'không còn chuỗi này ở bất kỳ đâu trong file');
  // ảnh thứ hai vẫn còn: chỉ còn đúng 1 lệnh Do
  const reload = await PDFLib.PDFDocument.load(after);
  assert.equal(reload.getPageCount(), 1);
}

// 4) trang không có gì cần gỡ thì không bị đụng tới
{
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([200, 200]).drawText('Khong doi', { x: 20, y: 100, size: 12 });
  const bytes = await doc.save();
  const d2 = await PDFLib.PDFDocument.load(bytes);
  const sr = await stripOriginals(d2, { text: [{ page: 1, x0: 0, x1: 10, y0: 0, y1: 10 }] }, PDFLib);
  assert.equal(sr.pages, 0);
}
console.log('Strip originals tests passed.');
