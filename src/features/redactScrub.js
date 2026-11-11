// Dọn dữ liệu gốc sau khi Redact thay trang bằng ảnh đã che.
// Vấn đề: doc.removePage() chỉ gỡ trang khỏi cây trang; đối tượng trang cũ (content stream chứa chữ gốc,
// ô biểu mẫu AcroForm, chú thích, XMP...) vẫn nằm trong file khi lưu -> công cụ đọc thô lấy lại được.
// Module này: gỡ ô biểu mẫu của trang đã che -> (tùy chọn) bỏ XMP/Info -> vô hiệu hóa trang gốc còn bị
// dấu trang/liên kết tham chiếu -> xóa mọi đối tượng không còn tham chiếu. Sau đó verifyRedactedBytes kiểm tra lại.
import { pruneUnreferenced } from './stripOriginals.js';

const tagOf = (r) => (r && r.tag) || null;

// Danh sách tag của các annotation (chú thích / widget biểu mẫu) trên một trang. Gọi TRƯỚC khi removePage.
export function annotRefTags(L, page) {
  const { PDFName, PDFArray, PDFRef } = L;
  const out = [];
  const arr = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (arr) for (let i = 0; i < arr.size(); i++) { const r = arr.get(i); if (r instanceof PDFRef) out.push(r.tag); }
  return out;
}

// Gỡ các ô biểu mẫu mà widget nằm trên trang đã che. Trả về số mục đã gỡ.
function removeFormFields(L, doc, removed) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = L;
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acro && acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) return 0;
  let count = 0;
  const prune = (arr) => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const ref = arr.get(i), d = arr.lookupMaybe(i, PDFDict);
      let drop = ref instanceof PDFRef && removed.has(ref.tag);
      if (!drop && d) {
        const kids = d.lookupMaybe(PDFName.of('Kids'), PDFArray);
        if (kids) { prune(kids); drop = kids.size() === 0; }
      }
      if (drop) { arr.remove(i); count++; }
    }
  };
  prune(fields);
  return count;
}

function hasAttachments(L, doc) {
  const { PDFName, PDFDict } = L;
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  return !!((names && names.has(PDFName.of('EmbeddedFiles'))) || doc.catalog.has(PDFName.of('AF')));
}

export function scrubAfterRedaction(L, doc, { removedPages = [], removedAnnots = [], stripMeta = false } = {}) {
  const { PDFName, PDFDict, PDFNumber, PDFArray } = L;
  const ctx = doc.context;
  const rep = { formFieldsRemoved: 0, tombstoned: 0, pruned: 0, warnings: [] };
  const removed = new Set(removedAnnots);

  rep.formFieldsRemoved = removeFormFields(L, doc, removed);

  if (stripMeta) {
    doc.catalog.delete(PDFName.of('Metadata'));
    const ti = ctx.trailerInfo, info = ti.Info && ctx.lookup(ti.Info);
    if (info instanceof PDFDict) info.entries().forEach(([k]) => info.delete(k));
  } else if (doc.catalog.has(PDFName.of('Metadata'))) {
    rep.warnings.push('File còn siêu dữ liệu XMP (có thể chứa tiêu đề/tác giả cũ). Hãy bật "Xóa siêu dữ liệu" nếu tài liệu nhạy cảm.');
  }

  // Trang gốc có thể còn bị dấu trang/liên kết tham chiếu -> thay bằng trang rỗng để nội dung gốc không "sống" theo.
  const tomb = [];
  for (const ref of removedPages) {
    const blank = PDFDict.withContext(ctx);
    blank.set(PDFName.of('Type'), PDFName.of('Page'));
    blank.set(PDFName.of('MediaBox'), ctx.obj([0, 0, 1, 1]));
    ctx.assign(ref, blank); tomb.push(ref);
  }
  rep.pruned = pruneUnreferenced(L, doc);
  rep.tombstoned = tomb.filter((r) => ctx.lookup(r) !== undefined).length;
  if (rep.tombstoned > 0 && doc.catalog.has(PDFName.of('Outlines')))
    rep.warnings.push('Một số dấu trang/liên kết vẫn trỏ tới trang đã che (đã vô hiệu hóa nội dung, nhưng nên kiểm tra mục lục).');
  if (hasAttachments(L, doc)) rep.warnings.push('File có tệp đính kèm; Redact không xử lý nội dung tệp đính kèm. Hãy kiểm tra thủ công.');
  return rep;
}

// Nạp lại file ĐÃ LƯU và xác nhận: không trang gốc nào còn nội dung/chú thích, không widget nào trỏ tới trang đã che.
export async function verifyRedactedBytes(L, bytes, removedPages = []) {
  const { PDFDocument, PDFName, PDFRef, PDFDict, PDFArray, PDFStream } = L;
  let out;
  try { out = await PDFDocument.load(bytes, { ignoreEncryption: true }); } catch (e) { return false; }
  const ctx = out.context, gone = new Set(removedPages.map(tagOf));
  for (const ref of removedPages) {
    const o = ctx.indirectObjects.get(PDFRef.of(ref.objectNumber, ref.generationNumber));
    if (!o) continue;
    const d = o instanceof PDFStream ? o.dict : o;
    if (d instanceof PDFDict && (d.has(PDFName.of('Contents')) || d.has(PDFName.of('Annots')) || d.has(PDFName.of('Resources')))) return false;
  }
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    if (!(o instanceof PDFDict)) continue;
    const p = o.get(PDFName.of('P'));
    if (p instanceof PDFRef && gone.has(p.tag) && o.has(PDFName.of('Subtype'))) return false;
  }
  return out.getPageCount() >= 0;
}
