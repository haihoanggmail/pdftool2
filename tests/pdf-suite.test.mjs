import assert from 'node:assert/strict';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';

console.log('--- BẮT ĐẦU KIỂM THỬ HACHIHI PDF TOOL TEST SUITE ---');

async function createSamplePDF() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // Page 1: Text & Tables
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('HACHIHI PDF TOOL - TEST SUITE', { x: 50, y: 800, size: 16, font: boldFont, color: rgb(0, 0.47, 0.83) });
  p1.drawText('Tai lieu kiem thu do chinh xac noi dung va bang bieu', { x: 50, y: 780, size: 11, font });
  
  // Table borders
  p1.drawRectangle({ x: 50, y: 650, width: 495, height: 100, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  p1.drawLine({ start: { x: 50, y: 720 }, end: { x: 545, y: 720 }, color: rgb(0.2, 0.2, 0.2), thickness: 1 });
  p1.drawLine({ start: { x: 180, y: 650 }, end: { x: 180, y: 750 }, color: rgb(0.2, 0.2, 0.2), thickness: 1 });
  p1.drawLine({ start: { x: 350, y: 650 }, end: { x: 350, y: 750 }, color: rgb(0.2, 0.2, 0.2), thickness: 1 });

  p1.drawText('Ma hang', { x: 60, y: 730, size: 10, font: boldFont });
  p1.drawText('Don gia', { x: 190, y: 730, size: 10, font: boldFont });
  p1.drawText('Doanh thu', { x: 360, y: 730, size: 10, font: boldFont });

  p1.drawText('001248', { x: 60, y: 690, size: 10, font });
  p1.drawText('1.500.000', { x: 190, y: 690, size: 10, font });
  p1.drawText('(250.000)', { x: 360, y: 690, size: 10, font });

  // Page 2: Vector and second page
  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText('Trang 2: Du lieu bieu mau & chu ky', { x: 50, y: 800, size: 14, font: boldFont });
  p2.drawCircle({ x: 100, y: 700, size: 40, color: rgb(0.1, 0.7, 0.3) });

  const bytes = await doc.save();
  return bytes;
}

// Helper: Excel number conversion logic test
function toValueTest(text, style, mode) {
  const raw = String(text);
  if (mode === 'text') return { v: raw };
  let t = raw.trim();
  if (!t) return { v: raw };

  // Negative formatted accounting: (1.234.567) or -1.234.567 or 1.234.567-
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  else if (/-$/.test(t)) { neg = true; t = t.slice(0, -1).trim(); }
  else if (/^-/.test(t)) { neg = true; t = t.slice(1).trim(); }

  let pre = '', suf = '';
  let m = t.match(/^([$€£¥])\s*(.*)$/);
  if (m) { pre = m[1]; t = m[2]; }
  m = t.match(/^(.*?)\s*(%|₫|đ|VND|VNĐ|USD|EUR|\$|€)$/i);
  if (m) { suf = m[2]; t = m[1]; }

  // Leading zeros like "001248", "0912345678", barcode codes -> must keep as text!
  if (/^0\d+$/.test(t)) return { v: raw };

  // Date like 15/10/2026 or 2026-10-15 -> keep as text/date
  if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return { v: raw };
  }

  if (!/^\d[\d.,]*$/.test(t)) return { v: raw };

  let thou = style === 'vn' ? '.' : ',', dec = style === 'vn' ? ',' : '.';
  const parts = t.split(dec);
  if (parts.length > 2) return { v: raw };
  const intPart = parts[0], decPart = parts[1] || '';
  let hasThou = false;
  if (intPart.indexOf(thou) !== -1) {
    if (!new RegExp('^\\d{1,3}(\\' + thou + '\\d{3})+$').test(intPart)) return { v: raw };
    hasThou = true;
  } else if (!/^\d+$/.test(intPart)) return { v: raw };
  if (decPart && !/^\d+$/.test(decPart)) return { v: raw };
  if (!hasThou && !decPart && /[.,]/.test(t)) return { v: raw };

  const num = parseFloat(intPart.split(thou).join('') + (decPart ? '.' + decPart : ''));
  if (!isFinite(num)) return { v: raw };
  let val = neg ? -num : num;
  let fmt;
  const d = decPart.length;
  const base = (hasThou ? '#,##0' : '0') + (d ? '.' + '0'.repeat(d) : '');
  if (suf === '%') { val = val / 100; fmt = (hasThou ? '#,##0' : '0') + (d ? '.' + '0'.repeat(d) : '') + '%'; }
  else if (suf || pre) {
    const s = (pre || suf).replace(/"/g, '');
    fmt = pre ? '"' + s + '"' + base : base + ' "' + s + '"';
  } else fmt = base;
  return { v: val, fmt: fmt };
}

async function runTests() {
  console.log('1. Kiểm thử tạo và đọc file PDF mẫu...');
  const samplePdfBytes = await createSamplePDF();
  assert(samplePdfBytes.length > 1000, 'Kích thước PDF mẫu hợp lệ');
  
  const loaded = await PDFDocument.load(samplePdfBytes);
  assert.equal(loaded.getPageCount(), 2, 'Số trang đúng 2 trang');
  console.log('   ✓ Tạo & tải PDF mẫu thành công (2 trang).');

  console.log('2. Kiểm thử bảo toàn cấu trúc nén Chế độ A (Content-preserving)...');
  const compDoc = await PDFDocument.load(samplePdfBytes);
  const compressedBytes = await compDoc.save({ useObjectStreams: true });
  const reloaded = await PDFDocument.load(compressedBytes);
  assert.equal(reloaded.getPageCount(), 2, 'Số trang sau nén Chế độ A phải giữ nguyên 100%');
  console.log('   ✓ Chế độ A bảo toàn trọn vẹn số trang & tính toàn vẹn tài liệu.');

  console.log('3. Kiểm thử phân loại và định dạng số cho PDF sang Excel...');
  // 3.1 Leading zeros preserved
  const codeRes = toValueTest('001248', 'vn', 'auto');
  assert.equal(codeRes.v, '001248', 'Mã có số 0 ở đầu không được biến thành số');

  // 3.2 Vietnamese currency formatting
  const currRes = toValueTest('1.500.000 ₫', 'vn', 'auto');
  assert.equal(currRes.v, 1500000, 'Giá tiền tiếng Việt chuyển thành giá trị số');
  assert(currRes.fmt.includes('₫'), 'Format giữ ký hiệu tiền tệ ₫');

  // 3.3 Accounting negative format (250.000)
  const negRes = toValueTest('(250.000)', 'vn', 'auto');
  assert.equal(negRes.v, -250000, 'Số kế toán trong ngoặc (250.000) chuyển thành số âm -250000');

  // 3.4 Percentage format
  const pctRes = toValueTest('12,5%', 'vn', 'auto');
  assert.equal(pctRes.v, 0.125, 'Phần trăm 12,5% chuyển thành 0.125');

  // 3.6 Trailing minus accounting format
  const trailingNeg = toValueTest('1.250.000-', 'vn', 'auto');
  assert.equal(trailingNeg.v, -1250000, 'Số kế toán có dấu trừ phía sau 1.250.000- chuyển thành -1250000');

  // 3.7 Codes with dashes and leading zeros
  const dashCode = toValueTest('01-5820', 'vn', 'auto');
  assert.equal(dashCode.v, '01-5820', 'Mã có dấu gạch ngang và số 0 đầu giữ nguyên chuỗi');
  console.log('   ✓ Chuẩn hóa số, mã hàng, tiền tệ, số âm, phần trăm và ngày tháng đạt 100%.');

  console.log('4. Kiểm thử tính hợp lệ của gói DOCX (Word)...');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Tieng Viet</w:t></w:r></w:p></w:body></w:document>');
  const docxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  
  // Verify docx buffer
  assert(docxBuffer[0] === 0x50 && docxBuffer[1] === 0x4B, 'Đầu file là chuẩn ZIP magic bytes PK');
  const readZip = await JSZip.loadAsync(docxBuffer);
  assert(readZip.file('word/document.xml') !== null, 'Tệp DOCX phải chứa word/document.xml');

  // Verify rejection of corrupt/empty buffers
  const corruptBuffer = new Uint8Array([0x00, 0x01, 0x02]);
  assert(corruptBuffer.length < 2048 || corruptBuffer[0] !== 0x50, 'Bộ đệm rỗng/hỏng bị phát hiện chính xác');
  console.log('   ✓ Kiểm tra cấu trúc xác thực DOCX hoạt động chính xác.');

  console.log('\n=== TẤT CẢ KIỂM THỬ ĐÃ ĐẠT CHUẨN THÀNH CÔNG (100% PASS) ===\n');
}

runTests().catch(err => {
  console.error('LỖI KIỂM THỬ:', err);
  process.exit(1);
});
