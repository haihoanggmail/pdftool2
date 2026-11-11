// Gỡ ảnh gốc trên 1 trang không được làm mất ảnh của trang khác dùng chung bảng Resources / XObject.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as PDFLib from 'pdf-lib';
import { stripOriginals } from '../src/features/stripOriginals.js';

const { PDFDocument, PDFName, PDFDict } = PDFLib;
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const xoNames = pg => { const x = pg.node.Resources()?.lookup(PDFName.of('XObject')); return x instanceof PDFDict ? x.keys().map(k => k.decodeText()) : []; };
const SPEC = { images: [{ page: 1, x0: 50, y0: 50, x1: 150, y1: 150 }] };

async function build(mode) {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const p1 = doc.addPage([300, 300]);
  p1.drawImage(img, { x: 50, y: 50, width: 100, height: 100 });
  const name = p1.node.Resources().lookup(PDFName.of('XObject')).keys()[0].decodeText();
  const p2 = doc.addPage([300, 300]);
  p2.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`q 100 0 0 100 50 50 cm /${name} Do Q`)));
  if (mode === 'shared-ref') {                       // cùng 1 đối tượng gián tiếp
    const ref = doc.context.register(p1.node.Resources());
    p1.node.set(PDFName.of('Resources'), ref); p2.node.set(PDFName.of('Resources'), ref);
  } else if (mode === 'inherited') {                 // kế thừa từ nút Pages
    const res = p1.node.Resources();
    doc.catalog.Pages().set(PDFName.of('Resources'), doc.context.register(res));
    p1.node.delete(PDFName.of('Resources')); p2.node.delete(PDFName.of('Resources'));
  } else {                                           // mỗi trang tự có bảng riêng
    p2.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { [name]: p1.node.Resources().lookup(PDFName.of('XObject')).get(PDFName.of(name)) } }));
  }
  return PDFDocument.load(await doc.save());
}

for (const mode of ['shared-ref', 'inherited']) {
  const d = await build(mode);
  assert.equal(xoNames(d.getPages()[0]).length, 1); assert.equal(xoNames(d.getPages()[1]).length, 1);
  const r = await stripOriginals(d, SPEC, PDFLib);
  assert.equal(r.images, 1, mode + ': gỡ đúng 1 lệnh vẽ ảnh ở trang 1');
  const out = await PDFDocument.load(await d.save());
  assert.equal(xoNames(out.getPages()[0]).length, 0, mode + ': trang 1 không còn ảnh');
  assert.equal(xoNames(out.getPages()[1]).length, 1, mode + ': trang 2 PHẢI còn ảnh (tài nguyên dùng chung)');
  console.log('ok  ' + mode + ': trang khác dùng chung tài nguyên vẫn giữ ảnh');
}
{ // không dùng chung: ảnh bị gỡ ở trang 1 vẫn còn ở trang 2 (trang 2 trỏ cùng đối tượng ảnh) -> file không được mất ảnh
  const d = await build('own');
  await stripOriginals(d, SPEC, PDFLib);
  const out = await PDFDocument.load(await d.save());
  assert.equal(xoNames(out.getPages()[1]).length, 1);
  console.log('ok  bảng riêng từng trang: trang 2 giữ ảnh');
}
{ // một trang duy nhất: ảnh gốc phải thật sự biến khỏi file (dọn đối tượng mồ côi)
  const doc = await PDFDocument.create();
  const big = await doc.embedPng(png);
  const p = doc.addPage([300, 300]); p.drawImage(big, { x: 50, y: 50, width: 100, height: 100 });
  const d = await PDFDocument.load(await doc.save());
  const before = (await d.save()).length;
  const r = await stripOriginals(d, SPEC, PDFLib);
  const out = await d.save();
  assert.equal(r.images, 1); assert.ok(out.length < before, 'file nhỏ đi sau khi gỡ ảnh mồ côi');
  assert.equal(xoNames((await PDFDocument.load(out)).getPages()[0]).length, 0);
  console.log('ok  trang đơn: ảnh gốc bị gỡ hẳn và file nhỏ đi (' + before + ' -> ' + out.length + ' byte)');
}
{ // vùng gỡ chữ nằm TRONG ô trắng che (cùng công thức trong editorExportPDF)
  const core = fs.readFileSync(new URL('../public/legacy/10-core.js', import.meta.url), 'utf8');
  assert.ok(core.includes('x0: c.origX - pad, x1: c.origX + (c.origWidth || 0) + pad, y0: c.origY - h * 0.28'), 'spec gỡ chữ khớp ô che');
  assert.ok(core.includes('x: change.origX - pad,') && core.includes('y: change.origY - h * 0.28,'), 'ô che còn nguyên công thức');
  console.log('ok  vùng gỡ chữ nằm gọn trong ô trắng che');
}
console.log('Strip shared-resources tests passed.');
