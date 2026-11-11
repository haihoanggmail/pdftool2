// stripOriginals phải báo TRUNG THỰC mục nào chưa gỡ được (không được coi là đã xóa an toàn).
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import { stripOriginals, stripContent } from '../src/features/stripOriginals.js';

const { PDFDocument, StandardFonts, PDFName } = PDFLib;
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([300, 300]);
  p.drawText('DONG-Mot', { x: 50, y: 250, size: 12, font });
  p.drawText('DONG-Hai', { x: 50, y: 200, size: 12, font });
  p.drawImage(await doc.embedPng(png), { x: 50, y: 50, width: 100, height: 100 });
  return PDFDocument.load(await doc.save());
}
const R = (x0, y0, x1, y1, page = 1) => ({ page, x0, y0, x1, y1 });

{ const d = await sample();
  const r = await stripOriginals(d, { text: [R(40, 245, 200, 265), R(40, 100, 200, 120)], images: [R(50, 50, 150, 150), R(200, 200, 280, 280)] }, PDFLib);
  assert.equal(r.unconfirmed.text, 1); assert.equal(r.unconfirmed.images, 1); assert.equal(r.text, 1); assert.equal(r.images, 1);
  ok('vùng trúng lệnh được xác nhận, vùng không trúng bị tính là chưa gỡ được'); }
{ const d = await sample();
  const r = await stripOriginals(d, { text: [R(40, 245, 200, 265), R(40, 195, 200, 215)], images: [R(50, 50, 150, 150)] }, PDFLib);
  assert.deepEqual(r.unconfirmed, { text: 0, images: 0 }); ok('tất cả vùng đều trúng -> không có mục chưa xác nhận'); }
{ const d = await sample();
  d.getPages()[0].node.set(PDFName.of('Contents'), d.context.register(d.context.stream(new Uint8Array([1, 2, 3]), { Filter: ['FlateDecode', 'ASCIIHexDecode'] })));
  const r = await stripOriginals(d, { text: [R(40, 245, 200, 265)], images: [R(50, 50, 150, 150)] }, PDFLib);
  assert.deepEqual(r.unconfirmed, { text: 1, images: 1 }); assert.equal(r.pages, 0); ok('stream nhiều lớp Filter: không gỡ, báo đủ số mục chưa xác nhận'); }
{ const d = await sample();
  const r = await stripOriginals(d, { text: [R(0, 0, 10, 10, 9)], images: [] }, PDFLib);
  assert.equal(r.unconfirmed.text, 1); ok('trang không tồn tại: tính là chưa xác nhận'); }
{ const r = stripContent('BT /F1 12 Tf 50 250 Td (A) Tj ET BT /F1 12 Tf 50 200 Td (B) Tj ET', [R(0, 0, 10, 10), R(40, 245, 200, 265)], [], () => false);
  assert.deepEqual(r.hitText, [1]); ok('stripContent trả chỉ số vùng trúng lệnh'); }
console.log(`\n${n} kiểm thử đạt`);
