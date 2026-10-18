// Kiểm thử Web Worker xử lý PDF (gộp, dựng lại + watermark) bằng PDF thật tạo từ pdf-lib của dự án
const { makeWorker, makePdf, fontBytes, ok, done } = require('./helpers.cjs');
(async () => {
    const a = await makePdf([[595, 842], [612, 792], [300, 400]]);
    const b = await makePdf([[595, 842], [595, 842]]);
    const big = await makePdf(Array.from({ length: 400 }, () => [595, 842]));
    const PDFLib = a.PDFLib;
    const open = async (u8) => PDFLib.PDFDocument.load(a.fix(u8));

    // 1) gộp
    let w = makeWorker();
    w.send({ id: 1, op: 'merge', payload: { files: [{ name: 'a.pdf', bytes: a.bytes.slice() }, { name: 'b.pdf', bytes: b.bytes.slice() }] } });
    let r = await w.done(1);
    let d = await open(new Uint8Array(r.bytes));
    ok(d.getPageCount() === 5, 'gộp 3 + 2 trang = 5 trang');
    const prog = w.msgs.filter((m) => m.type === 'progress');
    ok(prog.length >= 3 && prog.every((m, i) => i === 0 || m.pct >= prog[i - 1].pct), 'tiến trình tăng dần (' + prog.length + ' mốc)');

    // 2) dựng lại: đảo thứ tự + xoay + lật + watermark tiếng Việt
    w = makeWorker();
    const font = fontBytes();
    w.send({ id: 2, op: 'rebuild', payload: { bytes: a.bytes.slice(), pageOrder: [2, 0, 1], rotations: [90, 0, 180], mirrors: [false, true, false],
        wm: { text: 'BẢN QUYỀN Hachihi', size: 40, color: { r: 1, g: 0, b: 0 }, rotation: 30, opacity: 0.5, relLeft: 20, relTop: 50 }, fontBytes: font } });
    r = await w.done(2);
    const out = new Uint8Array(r.bytes);
    d = await open(out);
    const pg = d.getPages();
    ok(pg.length === 3, 'dựng lại giữ đủ 3 trang');
    ok(Math.round(pg[0].getWidth()) === 300 && pg[0].getRotation().angle === 90, 'trang 1 = trang gốc số 3 (300x400) xoay 90°');
    ok(Math.round(pg[1].getWidth()) === 595 && pg[1].getRotation().angle === 0, 'trang 2 = trang gốc số 1, không xoay');
    ok(Math.round(pg[2].getWidth()) === 612 && pg[2].getRotation().angle === 180, 'trang 3 = trang gốc số 2 xoay 180°');
    const hasFont = (p) => { const r = p.node.Resources(); const f = r && r.lookupMaybe(PDFLib.PDFName.of('Font'), PDFLib.PDFDict); return !!f && f.keys().length > 0; };
    ok(pg.every(hasFont), 'cả 3 trang đều có font nhúng cho watermark tiếng Việt');
    const plain = makeWorker(); plain.send({ id: 9, op: 'rebuild', payload: { bytes: a.bytes.slice(), pageOrder: [0, 1, 2], rotations: [], mirrors: [], wm: null, fontBytes: null } });
    const none = (await open(new Uint8Array((await plain.done(9)).bytes))).getPages();
    ok(none.every((p) => !hasFont(p)), 'không bật watermark thì không nhúng font (đối chứng)');

    // 3) file lớn 400 trang, đảo ngược thứ tự
    w = makeWorker();
    w.send({ id: 3, op: 'rebuild', payload: { bytes: big.bytes.slice(), pageOrder: Array.from({ length: 400 }, (_, i) => 399 - i), rotations: [], mirrors: [], wm: null, fontBytes: null } });
    r = await w.done(3);
    ok((await open(new Uint8Array(r.bytes))).getPageCount() === 400, 'file 400 trang xử lý đủ 400 trang');

    // 4) lỗi
    w = makeWorker(); w.send({ id: 4, op: 'khong-co', payload: {} });
    let msg = ''; try { await w.done(4); } catch (e) { msg = e.message; }
    ok(/không hỗ trợ/.test(msg), 'thao tác lạ -> báo lỗi rõ ràng');
    w = makeWorker(); w.send({ id: 5, op: 'merge', payload: { files: [{ name: 'x.pdf', bytes: new Uint8Array([1, 2, 3]) }] } });
    msg = ''; try { await w.done(5); } catch (e) { msg = e.message; }
    ok(/PDF/i.test(msg), 'PDF hỏng -> báo lỗi, không treo');
    done();
})().catch((e) => { console.error(e); process.exit(1); });
