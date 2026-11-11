// Redact: sau khi thay trang bằng ảnh đã che, dữ liệu gốc KHÔNG được còn trong bất kỳ đối tượng nào của file.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import * as PDFLib from 'pdf-lib';
import { scrubAfterRedaction, annotRefTags, verifyRedactedBytes } from '../src/features/redactScrub.js';

const { PDFDocument, StandardFonts, PDFRawStream, PDFName, PDFArray, rgb } = PDFLib;
const S_TEXT = 'NOIDUNG-BI-MAT-CCCD', S_FORM = 'SO-CCCD-0123456789', S_XMP = 'XMP-NHAY-CAM', K_TEXT = 'NOI-DUNG-GIU-LAI', K_FORM = 'GHI-CHU-GIU-LAI';

function count(pdf, needle) {
  const hex = Buffer.from(needle, 'latin1').toString('hex').toUpperCase(), u16 = Buffer.from(needle, 'utf16le').toString('hex').toUpperCase();
  let hits = 0;
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    let t;
    if (obj instanceof PDFRawStream) {
      let raw = obj.getContents(); const f = obj.dict.lookup(PDFName.of('Filter'));
      try { if (f && String(f) === '/FlateDecode') raw = zlib.inflateSync(Buffer.from(raw)); } catch (e) { /* không phải flate */ }
      t = Buffer.from(raw).toString('latin1') + ' ' + obj.dict.toString();
    } else t = String(obj.toString());
    const T = t.toUpperCase();
    if (t.includes(needle) || T.includes(hex) || T.includes(u16)) hits++;
  }
  return hits;
}

async function sample({ link = false, outline = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([300, 300]); p1.drawText(S_TEXT, { x: 30, y: 250, size: 12, font });
  const form = doc.getForm();
  const tf = form.createTextField('so_cccd'); tf.setText(S_FORM); tf.addToPage(p1, { x: 30, y: 200, width: 200, height: 20 });
  const p2 = doc.addPage([300, 300]); p2.drawText(K_TEXT, { x: 30, y: 250, size: 12, font });
  const tf2 = form.createTextField('ghi_chu'); tf2.setText(K_FORM); tf2.addToPage(p2, { x: 30, y: 200, width: 200, height: 20 });
  const xmp = `<?xpacket begin="" id="x"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>${S_XMP}</dc:title></x:xmpmeta><?xpacket end="w"?>`;
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
  if (link) {
    const a = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0], Dest: [p1.ref, 'Fit'] }));
    p2.node.lookupMaybe(PDFName.of('Annots'), PDFArray).push(a);
  }
  if (outline) {
    const item = doc.context.register(doc.context.obj({ Title: 'Muc-luc', Dest: [p1.ref, 'Fit'] }));
    const root = doc.context.register(doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
    doc.catalog.set(PDFName.of('Outlines'), root);
  }
  return PDFDocument.load(await doc.save());
}

// đúng thao tác của buildRedactedBytes cho trang 1: chèn trang thay thế rồi xóa trang gốc
function replaceFirst(d) {
  const old = d.getPage(0);
  const info = { removedPages: [old.ref], removedAnnots: annotRefTags(PDFLib, old) };
  d.insertPage(0, [300, 300]).drawRectangle({ x: 0, y: 0, width: 300, height: 300, color: rgb(0, 0, 0) });
  d.removePage(1);
  return info;
}
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

{ // 0) đối chứng: KHÔNG dọn -> phải thấy rò rỉ
  const d = await sample(); replaceFirst(d); const out = await PDFDocument.load(await d.save());
  assert.ok(count(out, S_TEXT) >= 1 && count(out, S_FORM) >= 1 && count(out, S_XMP) >= 1, 'đối chứng: bản chưa dọn phải còn rò rỉ');
  ok('đối chứng: chưa dọn thì chữ gốc, giá trị ô biểu mẫu và XMP đều còn trong file');
}
{ // 1) có dọn + xóa siêu dữ liệu
  const d = await sample(); const info = replaceFirst(d);
  const rep = scrubAfterRedaction(PDFLib, d, { ...info, stripMeta: true });
  const bytes = await d.save(); const out = await PDFDocument.load(bytes);
  for (const s of [S_TEXT, S_FORM, S_XMP]) assert.equal(count(out, s), 0, 'không còn ' + s);
  assert.ok(count(out, K_TEXT) >= 1, 'chữ trang giữ lại còn'); assert.ok(count(out, K_FORM) >= 1, 'ô biểu mẫu trang giữ lại còn');
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(out.getForm().getFields().map((f) => f.getName()), ['ghi_chu']);
  assert.ok(rep.formFieldsRemoved >= 1);
  assert.equal(await verifyRedactedBytes(PDFLib, bytes, info.removedPages), true);
  ok('sau khi dọn: chữ gốc, ô biểu mẫu, XMP biến mất; phần giữ lại còn nguyên');
}
{ // 2) không xóa siêu dữ liệu: XMP giữ + cảnh báo
  const d = await sample(); const info = replaceFirst(d);
  const rep = scrubAfterRedaction(PDFLib, d, { ...info, stripMeta: false });
  const out = await PDFDocument.load(await d.save());
  assert.equal(count(out, S_TEXT), 0); assert.equal(count(out, S_FORM), 0); assert.equal(count(out, S_XMP), 1);
  assert.ok(rep.warnings.some((w) => /XMP/.test(w)));
  ok('không bật xóa siêu dữ liệu: XMP được giữ và có cảnh báo; nội dung gốc vẫn sạch');
}
{ // 3) liên kết + dấu trang còn trỏ tới trang đã che
  const d = await sample({ link: true, outline: true }); const info = replaceFirst(d);
  const rep = scrubAfterRedaction(PDFLib, d, { ...info, stripMeta: true });
  const bytes = await d.save(); const out = await PDFDocument.load(bytes);
  assert.equal(count(out, S_TEXT), 0, 'trang gốc còn được tham chiếu nhưng nội dung phải sạch');
  assert.ok(rep.tombstoned >= 1);
  assert.ok(rep.warnings.some((w) => /dấu trang/.test(w)));
  assert.equal(await verifyRedactedBytes(PDFLib, bytes, info.removedPages), true);
  ok('dấu trang/liên kết trỏ tới trang đã che không giữ nội dung gốc sống; có cảnh báo');
}
{ // 4) verify bắt được file chưa dọn
  const d = await sample({ link: true }); const info = replaceFirst(d);
  assert.equal(await verifyRedactedBytes(PDFLib, await d.save(), info.removedPages), false);
  ok('verifyRedactedBytes phát hiện đúng file chưa được dọn');
}
console.log(`\n${n} kiểm thử đạt`);
