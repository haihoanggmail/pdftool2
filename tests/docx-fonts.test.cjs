// Kiểm thử chuẩn hóa font DOCX (PDFFonts.fixDocx) trên một DOCX tối thiểu tạo bằng JSZip
const { ROOT, fs, baseCtx, load, ok, done } = require('./helpers.cjs');
(async () => {
    const ctx = baseCtx();
    load(ctx, ROOT + 'public/vendor/jszip.min.js');
    load(ctx, ROOT + 'public/legacy/05-core-utils.js');
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const run = (t, f, extra) => `<w:r><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>${extra || ''}<w:sz w:val="24"/></w:rPr><w:t>${t}</w:t></w:r>`;
    const doc = `<?xml version="1.0"?><w:document ${NS}><w:body><w:p>` +
        run('a', 'ABCDEF+TimesNewRomanPS-BoldMT') + run('b', 'Arial-ItalicMT') + run('c', 'XYZABC+BeVietnamPro-Medium') +
        run('d', 'SourceSerifPro-BoldItalic', '<w:b/>') + run('e', 'Wingdings') + `</w:p></w:body></w:document>`;
    const ft = `<?xml version="1.0"?><w:fonts ${NS}><w:font w:name="Arial"/></w:fonts>`;
    const z = new ctx.JSZip();
    z.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    z.file('word/document.xml', doc); z.file('word/fontTable.xml', ft);
    const inb = await z.generateAsync({ type: 'uint8array' });
    const out = await ctx.PDFFonts.fixDocx(inb);
    const z2 = await ctx.JSZip.loadAsync(out);
    const x = await z2.file('word/document.xml').async('string');
    const t = await z2.file('word/fontTable.xml').async('string');
    const rpr = (txt) => new RegExp('<w:rPr>((?:(?!</w:rPr>).)*)</w:rPr><w:t>' + txt + '</w:t>').exec(x)[1];
    ok(/w:ascii="Times New Roman"/.test(rpr('a')) && /<w:b\/>/.test(rpr('a')), 'ABCDEF+TimesNewRomanPS-BoldMT -> Times New Roman, đậm');
    ok(/w:ascii="Arial"/.test(rpr('b')) && /<w:i\/>/.test(rpr('b')), 'Arial-ItalicMT -> Arial, nghiêng');
    ok(/w:ascii="Be Vietnam Pro"/.test(rpr('c')), 'font lạ giữ tên gốc sạch (bỏ tiền tố)');
    ok(/<w:b\/>.*<w:i\/>|<w:i\/>.*<w:b\/>/.test(rpr('d')) && (rpr('d').match(/<w:b\/>/g) || []).length === 1, 'đậm+nghiêng đủ, không thêm trùng thẻ đậm');
    ok(/w:ascii="Wingdings"/.test(rpr('e')), 'font ký hiệu (Wingdings) giữ nguyên');
    ok(/w:name="Be Vietnam Pro"><w:altName w:val="Arial"\/>.*w:val="swiss"/.test(t), 'fontTable: font lạ không chân có altName Arial + họ swiss');
    ok(/w:name="Source Serif Pro"><w:altName w:val="Times New Roman"\/>.*w:val="roman"/.test(t), 'fontTable: font lạ có chân có altName Times New Roman + họ roman');
    ok(out !== inb && out.length > 0, 'trả về file mới hợp lệ');
    // lỗi: dữ liệu không phải zip -> trả lại nguyên bản
    const bad = new Uint8Array([1, 2, 3]);
    ok((await ctx.PDFFonts.fixDocx(bad)) === bad, 'dữ liệu hỏng -> giữ nguyên, không ném lỗi');
    done();
})().catch((e) => { console.error(e); process.exit(1); });
