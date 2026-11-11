// Sau khi gỡ chữ gốc: (1) chữ gốc không còn trong BẤT KỲ đối tượng nào của file (kể cả stream mồ côi),
// (2) việc dọn đối tượng mồ côi không làm mất phần khác: trang không sửa, chú thích, siêu dữ liệu.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import * as PDFLib from 'pdf-lib';
import { stripOriginals } from '../src/features/stripOriginals.js';

const { PDFDocument, StandardFonts, PDFRawStream, PDFName, PDFArray } = PDFLib;
const SECRET = 'MATKHAU-BI-MAT-12345', KEEP = 'giu lai dong nay', OTHER = 'trang hai khong dong toi';

function countStreamsWith(pdf, needle) {
  const hex = Buffer.from(needle, 'latin1').toString('hex').toUpperCase();
  let hits = 0;
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let raw = obj.getContents(); const f = obj.dict.lookup(PDFName.of('Filter'));
    try { if (f && String(f) === '/FlateDecode') raw = zlib.inflateSync(Buffer.from(raw)); } catch (e) { /* không phải flate */ }
    const t = Buffer.from(raw).toString('latin1');
    if (t.includes(needle) || t.toUpperCase().includes(hex)) hits++;
  }
  return hits;
}

const doc = await PDFDocument.create();
doc.setTitle('Tieu de giu nguyen'); doc.setAuthor('Tac gia');
const font = await doc.embedFont(StandardFonts.Helvetica);
const p1 = doc.addPage([300, 300]);
p1.drawText(SECRET, { x: 50, y: 200, size: 12, font });
p1.drawText(KEEP, { x: 50, y: 150, size: 12, font });
const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0] }));
p1.node.set(PDFName.of('Annots'), doc.context.obj([link]));
const p2 = doc.addPage([300, 300]);
p2.drawText(OTHER, { x: 50, y: 100, size: 12, font });

const d = await PDFDocument.load(await doc.save());
assert.equal(countStreamsWith(d, SECRET), 1, 'điều kiện đầu: chữ gốc có trong file');
const r = await stripOriginals(d, { text: [{ page: 1, x0: 40, x1: 260, y0: 195, y1: 215 }] }, PDFLib);
assert.equal(r.text, 1); assert.equal(r.pages, 1);

const out = await PDFDocument.load(await d.save());
assert.equal(countStreamsWith(out, SECRET), 0, 'chữ gốc KHÔNG còn trong file (kể cả stream mồ côi)');
assert.equal(countStreamsWith(out, KEEP), 1, 'dòng giữ lại chỉ còn 1 bản (không nhân đôi do stream cũ)');
assert.equal(countStreamsWith(out, OTHER), 1, 'trang 2 không bị đụng tới');
assert.equal(out.getTitle(), 'Tieu de giu nguyen'); assert.equal(out.getAuthor(), 'Tac gia');
assert.equal(out.getPageCount(), 2);
const annots = out.getPages()[0].node.lookup(PDFName.of('Annots'));
assert.ok(annots instanceof PDFArray && annots.size() === 1, 'chú thích liên kết còn nguyên');
console.log('ok  chữ gốc không còn trong file; dòng giữ lại, trang 2, tiêu đề, tác giả, chú thích đều còn nguyên');
console.log('Strip no-leak tests passed.');
