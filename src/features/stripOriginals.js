// Gỡ hẳn chữ / ảnh gốc khỏi nội dung trang khi người dùng sửa, xóa chữ hoặc di chuyển ảnh.
// Trước đây chỉ vẽ ô trắng đè lên, nên chữ cũ vẫn nằm trong file (copy / tìm kiếm / trích xuất vẫn ra).
//
// Cách làm: đọc content stream của trang, theo dõi ma trận (cm, Tm, Td...) để biết điểm bắt đầu của từng lệnh
// hiện chữ (Tj, TJ, ', ") và lệnh vẽ ảnh (Do). Lệnh nào nằm trong vùng cần bỏ thì thay bằng lệnh rỗng.
// Chỉ đụng vào trang có vùng cần bỏ; stream lạ (nhiều lớp mã hóa, có predictor...) thì giữ nguyên
// và vẫn còn ô trắng che như cũ. Chữ nằm trong Form XObject chưa xử lý.

const MUL = (m, n) => [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
];
const IDENT = () => [1, 0, 0, 1, 0, 0];
const WS = ' \t\r\n\f\0';
const DELIM = '()<>[]{}/%';

function bytesToStr(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return s;
}
function strToBytes(s) {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
}

// ---- tách token (giữ vị trí để sửa tại chỗ) ----
export function tokenize(s) {
    const out = [];
    const n = s.length;
    let i = 0;
    while (i < n) {
        const c = s[i];
        if (WS.includes(c)) { i++; continue; }
        if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
        const start = i;
        if (c === '(') {
            let depth = 1; i++;
            while (i < n && depth > 0) {
                const d = s[i];
                if (d === '\\') i += 2;
                else { if (d === '(') depth++; else if (d === ')') depth--; i++; }
            }
            out.push({ t: 'str', s: start, e: i });
        } else if (c === '<' && s[i + 1] === '<') { i += 2; out.push({ t: 'dict+', s: start, e: i }); }
        else if (c === '>' && s[i + 1] === '>') { i += 2; out.push({ t: 'dict-', s: start, e: i }); }
        else if (c === '<') { i++; while (i < n && s[i] !== '>') i++; i++; out.push({ t: 'hex', s: start, e: i }); }
        else if (c === '[') { i++; out.push({ t: 'arr+', s: start, e: i }); }
        else if (c === ']') { i++; out.push({ t: 'arr-', s: start, e: i }); }
        else if (c === '/') {
            i++;
            while (i < n && !WS.includes(s[i]) && !DELIM.includes(s[i])) i++;
            out.push({ t: 'name', s: start, e: i, v: s.slice(start + 1, i) });
        } else {
            while (i < n && !WS.includes(s[i]) && !DELIM.includes(s[i])) i++;
            if (i === start) { i++; continue; }          // ký tự lạ như { }
            const w = s.slice(start, i);
            if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) out.push({ t: 'num', s: start, e: i, v: parseFloat(w) });
            else {
                out.push({ t: 'op', s: start, e: i, v: w });
                if (w === 'BI') {                          // ảnh nhúng trong dòng: bỏ qua phần dữ liệu nhị phân
                    const id = s.indexOf('ID', i);
                    if (id < 0) break;
                    const re = /[\s]EI(?=[\s]|$)/g;
                    re.lastIndex = id + 2;
                    const m = re.exec(s);
                    i = m ? m.index + m[0].length : n;
                }
            }
        }
    }
    return out;
}

// ---- xử lý một content stream ----
// textRects: [{x0,y0,x1,y1}] vùng (toạ độ PDF) chứa điểm bắt đầu của chữ cần bỏ
// imgRects:  [{x0,y0,x1,y1}] khung ảnh cần bỏ
// isImage(name) -> true nếu XObject tên đó là ảnh
export function stripContent(s, textRects, imgRects, isImage) {
    const toks = tokenize(s);
    const edits = [];                  // {s, e, text}
    const removedImg = {};
    const usedImg = {};
    let ctm = IDENT(), stack = [];
    let tm = IDENT(), tlm = IDENT(), size = 12, leading = 0;
    let ops = [];
    let removedText = 0;

    const hitT = new Set(), hitI = new Set();   // chỉ số vùng đã trúng ít nhất một lệnh -> biết vùng nào CHƯA gỡ được
    const inText = (x, y) => {
        let hit = false;
        textRects.forEach((r, i) => { if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) { hit = true; hitT.add(i); } });
        return hit;
    };
    const originOf = () => { const m = MUL(tm, ctm); return [m[4], m[5]]; };
    const nextLine = () => { tlm = MUL([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); };
    const strLen = (tk) => {
        const raw = s.slice(tk.s, tk.e);
        if (tk.t === 'hex') return Math.max(1, Math.round((raw.replace(/[^0-9a-fA-F]/g, '').length) / 2));
        return Math.max(1, raw.length - 2);
    };
    const advance = (n) => { tm = MUL([1, 0, 0, 1, n * size * 0.5, 0], tm); };

    for (let k = 0; k < toks.length; k++) {
        const tk = toks[k];
        if (tk.t !== 'op') { ops.push(tk); continue; }
        const op = tk.v;
        const num = (i) => (ops[i] && ops[i].t === 'num') ? ops[i].v : 0;
        const first = ops.length ? ops[0].s : tk.s;
        switch (op) {
            case 'q': stack.push(ctm.slice()); break;
            case 'Q': if (stack.length) ctm = stack.pop(); break;
            case 'cm': if (ops.length >= 6) ctm = MUL([num(0), num(1), num(2), num(3), num(4), num(5)], ctm); break;
            case 'BT': tm = IDENT(); tlm = IDENT(); break;
            case 'Tf': size = Math.abs(num(1)) || size; break;
            case 'TL': leading = num(0); break;
            case 'Td': tlm = MUL([1, 0, 0, 1, num(0), num(1)], tlm); tm = tlm.slice(); break;
            case 'TD': leading = -num(1); tlm = MUL([1, 0, 0, 1, num(0), num(1)], tlm); tm = tlm.slice(); break;
            case 'Tm': if (ops.length >= 6) { tm = [num(0), num(1), num(2), num(3), num(4), num(5)]; tlm = tm.slice(); } break;
            case 'T*': nextLine(); break;
            case 'Tj': case 'TJ': case "'": case '"': {
                if (op === "'" || op === '"') nextLine();
                const [x, y] = originOf();
                let chars = 0;
                ops.forEach(t => { if (t.t === 'str' || t.t === 'hex') chars += strLen(t); });
                if (inText(x, y)) {
                    const rep = op === 'TJ' ? '[] TJ' : op === 'Tj' ? '() Tj' : op === "'" ? "() '" :
                        (num(0) + ' ' + num(1) + ' () "');
                    edits.push({ s: first, e: tk.e, text: rep });
                    removedText++;
                }
                advance(chars);
                break;
            }
            case 'Do': {
                const nm = ops.length ? ops[ops.length - 1] : null;
                if (nm && nm.t === 'name') {
                    const name = nm.v;
                    if (isImage(name)) {
                        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
                        const bx0 = Math.min(...corners.map(c => c[0])), bx1 = Math.max(...corners.map(c => c[0]));
                        const by0 = Math.min(...corners.map(c => c[1])), by1 = Math.max(...corners.map(c => c[1]));
                        const area = Math.max(1e-6, (bx1 - bx0) * (by1 - by0));
                        let hit = false;
                        imgRects.forEach((r, i) => {
                            const ix = Math.max(0, Math.min(bx1, r.x1) - Math.max(bx0, r.x0));
                            const iy = Math.max(0, Math.min(by1, r.y1) - Math.max(by0, r.y0));
                            const inter = ix * iy, ra = Math.max(1e-6, (r.x1 - r.x0) * (r.y1 - r.y0));
                            if (inter / (area + ra - inter) > 0.8) { hit = true; hitI.add(i); }
                        });
                        if (hit) { edits.push({ s: nm.s, e: tk.e, text: '' }); removedImg[name] = (removedImg[name] || 0) + 1; }
                        else usedImg[name] = (usedImg[name] || 0) + 1;
                    }
                }
                break;
            }
            default: break;
        }
        ops = [];
    }
    let out = '', pos = 0;
    edits.sort((a, b) => a.s - b.s).forEach(ed => { out += s.slice(pos, ed.s) + ed.text; pos = ed.e; });
    out += s.slice(pos);
    return { content: out, removedText, removedImg, usedImg, changed: edits.length > 0, hitText: [...hitT], hitImg: [...hitI] };
}

async function inflate(u8) {
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter(); w.write(u8); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function deflate(u8) {
    const cs = new CompressionStream('deflate');
    const w = cs.writable.getWriter(); w.write(u8); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

// Đọc toàn bộ content stream của trang -> chuỗi (null nếu có stream không đọc được)
async function pageContentString(L, pdfDoc, page) {
    const { PDFName, PDFArray, PDFRawStream, PDFRef } = L;
    const c = page.node.lookup(PDFName.of('Contents'));
    const parts = [];
    const list = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : [c];
    for (const st of list) {
        if (!(st instanceof PDFRawStream)) return null;
        let raw = st.getContents();
        const f = st.dict.lookup(PDFName.of('Filter'));
        let fl = [];
        if (f instanceof PDFName) fl = [f];
        else if (f instanceof PDFArray) for (let i = 0; i < f.size(); i++) fl.push(f.lookup(i));
        if (fl.length > 1) return null;
        if (fl.length === 1) {
            if (fl[0] !== PDFName.of('FlateDecode') || st.dict.has(PDFName.of('DecodeParms'))) return null;
            try { raw = await inflate(raw); } catch (e) { return null; }
        }
        parts.push(bytesToStr(raw));
    }
    return parts.join('\n');
}

// Xóa object không còn được tham chiếu (ví dụ ảnh gốc đã bị gỡ khỏi trang)
export function pruneUnreferenced(L, pdfDoc) {
    const { PDFRef, PDFDict, PDFArray, PDFRawStream } = L;
    const ctx = pdfDoc.context;
    const seen = new Set(), stack = [];
    const push = v => { if (v instanceof PDFRef) { if (!seen.has(v.tag)) { seen.add(v.tag); stack.push(v); } } else if (v) stack.push(v); };
    const ti = ctx.trailerInfo;
    [ti.Root, ti.Info, ti.Encrypt].forEach(push);
    while (stack.length) {
        let v = stack.pop();
        if (v instanceof PDFRef) v = ctx.lookup(v);
        if (!v) continue;
        if (v instanceof PDFRawStream) v = v.dict;
        if (v instanceof PDFDict) v.entries().forEach(([, x]) => push(x));
        else if (v instanceof PDFArray) for (let i = 0; i < v.size(); i++) push(v.get(i));
    }
    let removed = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); removed++; }
    return removed;
}

// Hàm chính. spec = { text: [{page, x0,y0,x1,y1}], images: [{page, x0,y0,x1,y1}] } (page tính từ 1, toạ độ PDF)
// Trả về { text, images, pages } = số lệnh chữ / ảnh đã gỡ và số trang đã sửa.
export async function stripOriginals(pdfDoc, spec, L) {
    L = L || window.PDFLib;
    const { PDFName, PDFDict } = L;
    const pages = pdfDoc.getPages();
    const byPage = new Map();
    (spec.text || []).forEach(r => { if (!byPage.has(r.page)) byPage.set(r.page, { t: [], i: [] }); byPage.get(r.page).t.push(r); });
    (spec.images || []).forEach(r => { if (!byPage.has(r.page)) byPage.set(r.page, { t: [], i: [] }); byPage.get(r.page).i.push(r); });
    // unconfirmed = số vùng chữ/ảnh yêu cầu gỡ nhưng KHÔNG xác nhận được (chỉ còn bị che bằng ô trắng, vẫn copy/tìm kiếm được)
    const res = { text: 0, images: 0, pages: 0, total: { text: (spec.text || []).length, images: (spec.images || []).length }, unconfirmed: { text: 0, images: 0 } };
    let imgRemoved = false;
    for (const [pn, rects] of byPage) {
        let ct = rects.t.length, ci = rects.i.length;   // mặc định: chưa xác nhận gì; chỉ trừ đi khi vùng thật sự trúng lệnh
        const page = pages[pn - 1];
        if (!page) { res.unconfirmed.text += ct; res.unconfirmed.images += ci; continue; }
        try {
            const s = await pageContentString(L, pdfDoc, page);
            if (s == null) continue;
            const resources = page.node.Resources();
            const xo = resources && resources.lookup(PDFName.of('XObject'));
            const isImage = (name) => {
                if (!(xo instanceof PDFDict)) return false;
                const o = xo.lookup(PDFName.of(name));
                return !!(o && o.dict && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
            };
            const r = stripContent(s, rects.t, rects.i, isImage);
            ct = Math.max(0, rects.t.length - r.hitText.length); ci = Math.max(0, rects.i.length - r.hitImg.length);
            if (!r.changed) continue;
            const bytes = strToBytes(r.content);
            let stream;
            try { stream = pdfDoc.context.stream(await deflate(bytes), { Filter: 'FlateDecode' }); }
            catch (e) { stream = pdfDoc.context.stream(bytes, {}); }
            page.node.set(PDFName.of('Contents'), pdfDoc.context.register(stream));
            // ảnh đã gỡ hết lần dùng -> bỏ khỏi Resources để dữ liệu ảnh không còn nằm trong file
            // Bảng Resources / XObject có thể DÙNG CHUNG giữa nhiều trang (kế thừa từ Pages hoặc cùng 1 đối tượng gián tiếp).
            // Xóa thẳng trong đó sẽ làm các trang khác mất ảnh -> sao chép riêng cho trang này rồi mới bỏ tên ảnh khỏi bản sao.
            if (xo instanceof PDFDict) {
                const gone = Object.keys(r.removedImg).filter(name => !r.usedImg[name]);
                if (gone.length) {
                    const ownXo = xo.clone(pdfDoc.context);
                    gone.forEach(name => ownXo.delete(PDFName.of(name)));
                    const ownRes = resources.clone(pdfDoc.context);
                    ownRes.set(PDFName.of('XObject'), ownXo);
                    page.node.set(PDFName.of('Resources'), ownRes);
                    imgRemoved = true;
                }
            }
            res.text += r.removedText;
            res.images += Object.values(r.removedImg).reduce((a, b) => a + b, 0);
            res.pages++;
        } catch (e) { ct = rects.t.length; ci = rects.i.length; console.warn('stripOriginals: bỏ qua trang ' + pn, e); }
        finally { res.unconfirmed.text += ct; res.unconfirmed.images += ci; }
    }
    // Dọn mọi đối tượng không còn được tham chiếu: content stream cũ (chứa chữ gốc) và ảnh gốc không còn nằm trong file.
    // Nếu không dọn, pdf-lib vẫn ghi các đối tượng mồ côi đó ra file khi lưu -> chữ gốc còn lấy lại được bằng công cụ đọc thô.
    if (res.pages > 0) { try { pruneUnreferenced(L, pdfDoc); } catch (e) { /* giữ nguyên, che bằng ô trắng vẫn còn */ } }
    return res;
}

if (typeof window !== 'undefined') window.stripOriginals = (pdfDoc, spec) => stripOriginals(pdfDoc, spec, window.PDFLib);
