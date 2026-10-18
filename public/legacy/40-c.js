// ===================== PDF → Excel (PyMuPDF trích bảng/chữ/kiểu + ExcelJS dựng file) =====================
(function () {
    const PY_SETUP = `
import pymupdf, json, re, base64

def _hx(c):
    if c is None: return None
    if isinstance(c, int): return '%06X' % (c & 0xFFFFFF)
    r, g, b = [max(0, min(255, int(round(v * 255)))) for v in list(c)[:3]]
    return '%02X%02X%02X' % (r, g, b)

def _font(n):
    n = re.sub(r'^[A-Z]{6}\\+', '', n or '')
    n = re.split(r'[-,]', n)[0]
    n = re.sub(r'(PS|MT)$', '', n)
    n = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', n).strip()
    n = n.replace('Deja Vu', 'DejaVu')
    alias = {'carlito': 'Calibri', 'caladea': 'Cambria', 'liberation sans': 'Arial', 'arimo': 'Arial', 'liberation serif': 'Times New Roman', 'tinos': 'Times New Roman', 'liberation mono': 'Courier New', 'cousine': 'Courier New', 'helvetica': 'Arial', 'times': 'Times New Roman', 'times roman': 'Times New Roman', 'courier': 'Courier New'}
    n = alias.get(n.lower(), n)
    return n or 'Calibri'

def _cluster(vals, tol):
    vals = sorted(vals)
    out = []
    for v in vals:
        if out and v - out[-1][-1] <= tol: out[-1].append(v)
        else: out.append([v])
    return [sum(g) / len(g) for g in out]

def _near(arr, v):
    best, bd = 0, 1e18
    for i, a in enumerate(arr):
        d = abs(a - v)
        if d < bd: best, bd = i, d
    return best

def _inside(r, x, y, pad=0.5):
    return r[0] - pad <= x <= r[2] + pad and r[1] - pad <= y <= r[3] + pad

def _inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0

def _line_info(l):
    sp = [s for s in l['spans'] if s['text'].strip() != '' or True]
    txt = ''.join(s['text'] for s in sp)
    main = None
    for s in sp:
        if s['text'].strip():
            main = s; break
    if main is None: main = sp[0] if sp else {'font': '', 'size': 11, 'flags': 0, 'color': 0}
    fl = main.get('flags', 0)
    fn = main.get('font', '')
    bold = bool(fl & 16) or bool(re.search(r'bold|black|heavy', fn, re.I))
    ital = bool(fl & 2) or bool(re.search(r'italic|oblique', fn, re.I))
    size = max([s['size'] for s in sp if s['text'].strip()] or [main['size']])
    return {'text': txt, 'bbox': l['bbox'], 'font': _font(fn), 'size': round(size, 1), 'bold': bold, 'italic': ital, 'color': _hx(main.get('color', 0))}

def _b64(b):
    return base64.b64encode(b).decode('ascii')

def _encode_pix(pix, max_side=1600):
    try:
        if pix.colorspace is not None and pix.colorspace.n not in (1, 3):
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    except Exception:
        pass
    k = 0
    m = max(pix.width, pix.height)
    while m > max_side and k < 4:
        m = m // 2
        k += 1
    if k:
        try: pix.shrink(k)
        except Exception: pass
    if pix.alpha:
        return 'png', pix.tobytes('png')
    try:
        return 'jpeg', pix.tobytes('jpeg', jpg_quality=82)
    except Exception:
        return 'png', pix.tobytes('png')

def _xref_image(doc, xref):
    try:
        info = doc.extract_image(xref)
    except Exception:
        info = None
    if not info: return None
    sm = info.get('smask', 0)
    ext = (info.get('ext') or '').lower()
    w, h = info.get('width', 0), info.get('height', 0)
    data = info.get('image')
    if (not sm) and ext in ('jpg', 'jpeg') and max(w, h) <= 1600 and info.get('colorspace') in (1, 3) and data and len(data) < 700000:
        return 'jpeg', data
    try:
        pix = pymupdf.Pixmap(doc, xref)
        if sm:
            try:
                mask = pymupdf.Pixmap(doc, sm)
                pix = pymupdf.Pixmap(pix, mask)
            except Exception:
                pass
        return _encode_pix(pix)
    except Exception:
        return None

def _clip_image(page, rect, dpi=150):
    try:
        pix = page.get_pixmap(clip=rect, dpi=dpi, alpha=False)
        return _encode_pix(pix)
    except Exception:
        return None

def _page_images(page, doc, pr, lines, tbboxes, blobs, budget):
    out = []
    taken = []
    try: infos = page.get_image_info(xrefs=True)
    except Exception: infos = []
    page_area = max(1.0, pr.width * pr.height)
    for inf in infos:
        bb = inf.get('bbox')
        if not bb: continue
        x0, y0, x1, y1 = bb
        w, h = x1 - x0, y1 - y0
        if w < 6 or h < 6: continue
        tr = tuple(bb)
        inside = [li for li in lines if _inside(tr, (li['bbox'][0] + li['bbox'][2]) / 2, (li['bbox'][1] + li['bbox'][3]) / 2, 0)]
        if w * h >= 0.8 * page_area and len(lines) >= 3: continue
        if len(inside) >= 3: continue
        if budget[0] <= 0: break
        xref = inf.get('xref', 0)
        t = inf.get('transform')
        odd = t is not None and (abs(t[1]) > 0.01 or abs(t[2]) > 0.01 or t[0] < 0 or t[3] < 0)
        key = None
        if xref and not odd:
            key = 'x%d' % xref
            if key not in blobs:
                r = _xref_image(doc, xref)
                if r:
                    blobs[key] = {'e': r[0], 'd': _b64(r[1])}
                    budget[0] -= len(r[1])
                else:
                    key = None
        if key is None:
            r = _clip_image(page, pymupdf.Rect(bb))
            if not r: continue
            key = 'c%d_%d' % (page.number, len(out))
            blobs[key] = {'e': r[0], 'd': _b64(r[1])}
            budget[0] -= len(r[1])
        out.append({'k': key, 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1})
        taken.append(tr)
    # hình vector (logo, con dấu, chữ ký vẽ bằng nét) -> chụp đúng vùng đó thành ảnh
    try: regions = page.cluster_drawings()
    except Exception: regions = []
    cnt = 0
    for r in regions:
        w, h = r.width, r.height
        if w < 14 or h < 14 or w * h < 400: continue
        if w * h >= 0.7 * page_area: continue
        if max(w / h, h / w) > 12: continue
        tr = tuple(r)
        ar = max(1.0, w * h)
        if any(_inter(tr, tb) / ar > 0.5 for tb in tbboxes): continue
        if any(_inter(tr, tk) / ar > 0.5 for tk in taken): continue
        if any(_inside(tr, (li['bbox'][0] + li['bbox'][2]) / 2, (li['bbox'][1] + li['bbox'][3]) / 2, 0) for li in lines): continue
        if budget[0] <= 0 or cnt >= 12: break
        rr = _clip_image(page, r, 170)
        if not rr: continue
        key = 'v%d_%d' % (page.number, cnt)
        blobs[key] = {'e': rr[0], 'd': _b64(rr[1])}
        budget[0] -= len(rr[1])
        out.append({'k': key, 'x0': r.x0, 'y0': r.y0, 'x1': r.x1, 'y1': r.y1, 'vec': True})
        cnt += 1
    return out

def w2x_extract(opts_json):
    opts = json.loads(opts_json)
    doc = pymupdf.open('/w2x_in.pdf')
    pages = opts.get('pages')
    if not pages: pages = list(range(doc.page_count))
    res = []
    blobs = {}
    warns = []
    budget = [14000000]
    for pn in pages:
        if pn < 0 or pn >= doc.page_count: continue
        w2x_progress('Đang đọc trang %d/%d...' % (pn + 1, doc.page_count))
        page = doc[pn]
        pr = page.rect
        if opts.get('render'):
            try:
                rp = page.get_pixmap(dpi=opts.get('dpi', 150), alpha=False)
                re_ = _encode_pix(rp, 2600)
                blobs['p%d' % pn] = {'e': re_[0], 'd': _b64(re_[1])}
                res.append({'page': pn + 1, 'w': pr.width, 'h': pr.height, 'items': [], 'images': [], 'render': 'p%d' % pn, 'hasText': True})
            except Exception:
                pass
            continue
        d = page.get_text('dict')
        lines = []
        for b in d.get('blocks', []):
            if b.get('type') != 0: continue
            for l in b.get('lines', []):
                if not l.get('spans'): continue
                li = _line_info(l)
                if li['text'].strip(): lines.append(li)
        fills = []
        strokes = []
        try:
            for dr in page.get_drawings():
                r = dr.get('rect')
                if r is None: continue
                f = dr.get('fill')
                if f is not None and r.width > 2 and r.height > 2 and r.width < pr.width * 0.98:
                    if not all(v > 0.97 for v in list(f)[:3]): fills.append((tuple(r), _hx(f)))
                c = dr.get('color')
                if c is not None: strokes.append((tuple(r), _hx(c)))
        except Exception:
            pass
        tables = []
        try:
            for t in page.find_tables(strategy='lines').tables: tables.append((t, True))
        except Exception as ex_:
            warns.append('Trang %d: không dò được bảng có đường viền (%s)' % (pn + 1, str(ex_)[:90]))
        if opts.get('stream'):
            try:
                for t in page.find_tables(strategy='text').tables:
                    if t.row_count >= 3 and t.col_count >= 2:
                        tb = tuple(t.bbox); ar = max(1, (tb[2] - tb[0]) * (tb[3] - tb[1]))
                        if all(_inter(tb, tuple(o.bbox)) / min(ar, max(1, (o.bbox[2] - o.bbox[0]) * (o.bbox[3] - o.bbox[1]))) < 0.5 for o, _ in tables):
                            tables.append((t, False))
            except Exception as ex_:
                warns.append('Trang %d: không dò được bảng không viền (%s)' % (pn + 1, str(ex_)[:90]))
        items = []
        tbboxes = []
        for t, bordered in tables:
            cells = [tuple(c) for c in t.cells if c is not None]
            if len(cells) < 2: continue
            xs = _cluster([c[0] for c in cells] + [c[2] for c in cells], 2.0)
            ys = _cluster([c[1] for c in cells] + [c[3] for c in cells], 2.0)
            if len(xs) < 3: continue
            tb = tuple(t.bbox)
            bc = {}
            for r, c in strokes:
                if r[0] >= tb[0] - 3 and r[2] <= tb[2] + 3 and r[1] >= tb[1] - 3 and r[3] <= tb[3] + 3: bc[c] = bc.get(c, 0) + 1
            border = max(bc, key=bc.get) if bc else '000000'
            outc = []
            anytext = False
            for rect in cells:
                c0 = _near(xs, rect[0]); c1 = _near(xs, rect[2])
                r0 = _near(ys, rect[1]); r1 = _near(ys, rect[3])
                if c1 <= c0: c1 = c0 + 1
                if r1 <= r0: r1 = r0 + 1
                cl = [li for li in lines if _inside(rect, (li['bbox'][0] + li['bbox'][2]) / 2, (li['bbox'][1] + li['bbox'][3]) / 2, 1.0)]
                cl.sort(key=lambda li: (round(li['bbox'][1] / 2), li['bbox'][0]))
                text = '\\n'.join(li['text'].strip() for li in cl)
                if text.strip(): anytext = True
                cell = {'r': r0, 'c': c0, 'rs': r1 - r0, 'cs': c1 - c0, 'text': text}
                cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
                for fr, fh in reversed(fills):
                    if _inside(fr, cx, cy, 0) and (fr[2] - fr[0]) * (fr[3] - fr[1]) <= (tb[2] - tb[0]) * (tb[3] - tb[1]) * 1.2:
                        cell['fill'] = fh; break
                if cl:
                    m = max(cl, key=lambda li: len(li['text']))
                    cell.update({'font': m['font'], 'size': m['size'], 'bold': any(li['bold'] for li in cl) and sum(len(li['text']) for li in cl if li['bold']) * 2 >= sum(len(li['text']) for li in cl), 'italic': m['italic'], 'color': m['color']})
                    bx0 = min(li['bbox'][0] for li in cl); bx1 = max(li['bbox'][2] for li in cl)
                    by0 = min(li['bbox'][1] for li in cl); by1 = max(li['bbox'][3] for li in cl)
                    lg, rg = bx0 - rect[0], rect[2] - bx1
                    tg, bg = by0 - rect[1], rect[3] - by1
                    wd = rect[2] - rect[0]
                    if lg <= 7.5 and rg > 7.5: cell['h'] = 'left'
                    elif rg <= 7.5 and lg > 7.5: cell['h'] = 'right'
                    elif abs(lg - rg) <= max(3.0, 0.08 * wd): cell['h'] = 'center'
                    elif lg < rg: cell['h'] = 'left'
                    else: cell['h'] = 'right'
                    if abs(tg - bg) <= 3.0: cell['v'] = 'middle'
                    elif bg < tg - 3.0: cell['v'] = 'bottom'
                    else: cell['v'] = 'top'
                outc.append(cell)
            if not anytext and bordered and len(cells) < 4: continue
            tbboxes.append(tb)
            items.append({'type': 'table', 'y0': tb[1], 'y1': tb[3], 'x0': tb[0], 'x1': tb[2], 'xs': xs, 'ys': ys, 'cells': outc, 'border': border if bordered else None})
        rest = [li for li in lines if not any(_inside(tb, (li['bbox'][0] + li['bbox'][2]) / 2, (li['bbox'][1] + li['bbox'][3]) / 2, 1.0) for tb in tbboxes)]
        rest.sort(key=lambda li: ((li['bbox'][1] + li['bbox'][3]) / 2, li['bbox'][0]))
        rows = []
        for li in rest:
            yc = (li['bbox'][1] + li['bbox'][3]) / 2
            if rows and abs(yc - rows[-1]['yc']) < 0.55 * max(li['size'], rows[-1]['size']):
                rows[-1]['lines'].append(li)
                rows[-1]['size'] = max(rows[-1]['size'], li['size'])
            else:
                rows.append({'yc': yc, 'size': li['size'], 'lines': [li]})
        for rw in rows:
            ls = sorted(rw['lines'], key=lambda li: li['bbox'][0])
            segs = []
            for li in ls:
                if segs and li['bbox'][0] - segs[-1]['x1'] < 0.9 * li['size']:
                    sg = segs[-1]
                    sg['text'] += (' ' if li['bbox'][0] - sg['x1'] > 0.15 * li['size'] else '') + li['text'].strip()
                    sg['x1'] = li['bbox'][2]
                else:
                    segs.append({'x0': li['bbox'][0], 'x1': li['bbox'][2], 'text': li['text'].strip(), 'font': li['font'], 'size': li['size'], 'bold': li['bold'], 'italic': li['italic'], 'color': li['color']})
            y0 = min(li['bbox'][1] for li in ls); y1 = max(li['bbox'][3] for li in ls)
            items.append({'type': 'text', 'y0': y0, 'y1': y1, 'segs': segs})
        items.sort(key=lambda it: it['y0'])
        images = []
        if opts.get('images', True):
            try: images = _page_images(page, doc, pr, lines, tbboxes, blobs, budget)
            except Exception: images = []
        res.append({'page': pn + 1, 'w': pr.width, 'h': pr.height, 'items': items, 'images': images, 'hasText': len(lines) > 0})
    doc.close()
    return json.dumps({'pages': res, 'blobs': blobs, 'warns': warns})
`;
    const WORKER_SRC = `
let inst = null, py = null;
self.onmessage = async (ev) => {
    const m = ev.data;
    try {
        if (m.type === 'load') {
            const mod = await import(m.base + 'dist/index.js');
            inst = new mod.PyMuPDF({ assetPath: m.base + 'assets/', ghostscriptUrl: '' });
            self.postMessage({ type: 'status', msg: 'Đang khởi động bộ chuyển đổi...' });
            await inst.load();
            py = await inst.getPyodide();
            py.globals.set('w2x_progress', (s) => self.postMessage({ type: 'progress', msg: String(s) }));
            py.runPython(m.setup);
            self.postMessage({ type: 'loaded' });
        } else if (m.type === 'extract') {
            let out = '';
            try {
                py.FS.writeFile('/w2x_in.pdf', new Uint8Array(m.bytes));
                out = py.globals.get('w2x_extract')(JSON.stringify(m.opts));
            } finally {
                try { py.FS.unlink('/w2x_in.pdf'); } catch (e) {}
            }
            self.postMessage({ type: 'done', id: m.id, json: out });
        }
    } catch (e) {
        self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
    }
};`;

    let worker = null, loadPromise = null, loadedBase = '';
    const listeners = new Set();
    let items = [], seq = 0, busy = false;
    const $ = id => document.getElementById(id);
    const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function setProgress(pct, msg) {
        $('w2x-progress-wrap').style.display = 'block';
        if (pct !== null && pct !== undefined) $('w2x-progress-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (msg !== undefined) $('w2x-status').textContent = msg;
    }

    function ensureEngine() {
        let base = ($('w2x-base').value || '').trim();
        if (!base) base = 'https://cdn.jsdelivr.net/npm/@bentopdf/pymupdf-wasm@0.11.16/';
        if (!base.endsWith('/')) base += '/';
        if (loadPromise && loadedBase === base) return loadPromise;
        if (worker) { try { worker.terminate(); } catch (e) {} }
        loadedBase = base;
        const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
        worker = new Worker(url);
        worker.onmessage = ev => listeners.forEach(fn => fn(ev.data));
        loadPromise = new Promise((resolve, reject) => {
            const fn = m => {
                if (m.type === 'status') setProgress(null, m.msg);
                else if (m.type === 'loaded') { listeners.delete(fn); resolve(); }
                else if (m.type === 'error' && m.id === undefined) { listeners.delete(fn); reject(new Error(m.message)); }
            };
            listeners.add(fn);
            worker.onerror = e => { listeners.delete(fn); reject(new Error(e.message || 'Không khởi động được bộ chuyển đổi')); };
            worker.postMessage({ type: 'load', base: base, setup: PY_SETUP });
        });
        loadPromise.catch(() => { loadPromise = null; });
        return loadPromise;
    }

    function loadScript(urls) {
        return new Promise((resolve, reject) => {
            let i = 0;
            const next = () => {
                if (i >= urls.length) { reject(new Error('Không tải được thư viện ExcelJS (cần kết nối mạng)')); return; }
                const s = document.createElement('script');
                s.src = urls[i++];
                s.onload = resolve;
                s.onerror = () => { s.remove(); next(); };
                document.head.appendChild(s);
            };
            next();
        });
    }
    async function ensureExcelJS() {
        if (typeof ExcelJS !== 'undefined') return;
        await loadScript(['vendor/exceljs.min.js', 'vendor/exceljs.min.js']);
    }

    function parsePages(str, total) {
        str = (str || '').trim();
        if (!str) return null;
        const set = new Set();
        str.split(',').forEach(part => {
            part = part.trim();
            const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
                let a = +m[1], b = +m[2];
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) if (i >= 1 && (!total || i <= total)) set.add(i - 1);
            } else if (/^\d+$/.test(part)) {
                const n = +part;
                if (n >= 1 && (!total || n <= total)) set.add(n - 1);
            }
        });
        return Array.from(set).sort((a, b) => a - b);
    }

    // ---------- Chuyển chuỗi thành số ----------
    function detectNumStyle(pages, mode) {
        if (mode === 'vn' || mode === 'en') return mode;
        let vn = 0, en = 0;
        const texts = [];
        pages.forEach(p => p.items.forEach(it => {
            if (it.type === 'table') it.cells.forEach(c => texts.push(c.text));
            else it.segs.forEach(s => texts.push(s.text));
        }));
        texts.forEach(t => {
            t = String(t).trim();
            if (/^-?\(?\d{1,3}(\.\d{3})+(,\d+)?\)?$/.test(t) || /^-?\d+,\d{1,2}$/.test(t)) vn++;
            if (/^-?\(?\d{1,3}(,\d{3})+(\.\d+)?\)?$/.test(t) || /^-?\d+\.\d{1,2}$/.test(t)) en++;
        });
        return vn >= en ? 'vn' : 'en';
    }
    function toValue(text, style, mode) {
        const raw = String(text);
        if (mode === 'text') return { v: raw };
        let t = raw.trim();
        if (!t) return { v: raw };

        // Negative numbers in accounting format: (1.234.567), -1.234.567, or trailing minus 1.234.567-
        let neg = false;
        if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
        else if (/-$/.test(t)) { neg = true; t = t.slice(0, -1).trim(); }
        else if (/^-/.test(t)) { neg = true; t = t.slice(1).trim(); }

        let pre = '', suf = '';
        let m = t.match(/^([$€£¥])\s*(.*)$/);
        if (m) { pre = m[1]; t = m[2]; }
        m = t.match(/^(.*?)\s*(%|₫|đ|VND|VNĐ|USD|EUR|\$|€)$/i);
        if (m) { suf = m[2]; t = m[1]; }

        // Keep codes with leading zeros (001248, phone numbers, barcode, bank accounts)
        if (/^0\d+$/.test(t) || /^0[\d\s\-\.]+$/.test(t)) return { v: raw };

        // Keep date formats unchanged (15/10/2026, 2026-10-15, 15-10-2026)
        if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
            return { v: raw };
        }

        if (!/^\d[\d.,]*$/.test(t)) return { v: raw };

        let thou = style === 'vn' ? '.' : ',', dec = style === 'vn' ? ',' : '.';
        // chuẩn hóa
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

    // ---------- Dựng workbook ----------
    function cluster(vals, tol) {
        vals = vals.slice().sort((a, b) => a - b);
        const out = [];
        vals.forEach(v => { if (out.length && v - out[out.length - 1][out[out.length - 1].length - 1] <= tol) out[out.length - 1].push(v); else out.push([v]); });
        return out.map(g => g.reduce((a, b) => a + b, 0) / g.length);
    }
    function nearIdx(arr, v) { let b = 0, bd = 1e18; arr.forEach((a, i) => { const d = Math.abs(a - v); if (d < bd) { b = i; bd = d; } }); return b; }
    function colIdxAt(G, x) { let i = 0; for (let k = 0; k < G.length; k++) if (G[k] <= x + 2) i = k; return i; }
    const argb = h => 'FF' + (h || '000000').replace('#', '').toUpperCase();
    const safeName = (s, used) => {
        let n = String(s).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
        let base = n, k = 2;
        while (used[n.toLowerCase()]) { n = base.slice(0, 31 - (' (' + k + ')').length) + ' (' + k + ')'; k++; }
        used[n.toLowerCase()] = 1;
        return n;
    };

    function styleCell(cell, c, numMode, numStyle, border) {
        const f = { name: c.font || 'Calibri', size: Math.max(6, Math.min(72, c.size || 11)), bold: !!c.bold, italic: !!c.italic };
        if (c.color) f.color = { argb: argb(c.color) };
        cell.font = f;
        cell.alignment = { horizontal: c.h || 'left', vertical: c.v || 'middle', wrapText: /\n/.test(c.text || '') || (c.cs || 1) > 0 && (c.wrap !== false) };
        if (c.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.fill) } };
        if (border) {
            const b = { style: 'thin', color: { argb: argb(border) } };
            cell.border = { top: b, left: b, bottom: b, right: b };
        }
    }

    function buildMergedSheet(wb, allTables, o, used) {
        const ws = wb.addWorksheet(safeName('Bảng gộp liên tục', used));
        let maxCols = 0;
        let widestTable = allTables[0].t;
        allTables.forEach(({ t }) => {
            const cols = (t.xs ? t.xs.length - 1 : 0);
            if (cols > maxCols) { maxCols = cols; widestTable = t; }
        });
        const G = widestTable.xs || [];
        for (let i = 0; i < G.length - 1; i++) {
            ws.getColumn(i + 1).width = Math.max(6, Math.min(120, (G[i + 1] - G[i]) / 5.7));
        }

        let currRow = 1;
        const merges = [];
        allTables.forEach(({ pg, t }, idx) => {
            const nR = t.ys.length - 1;
            const start = currRow;
            for (let r = 0; r < nR; r++) {
                ws.getRow(start + r).height = Math.max(8, t.ys[r + 1] - t.ys[r]);
            }
            t.cells.forEach(c => {
                const c0 = c.c + 1;
                const cEnd = Math.max(c0, c.c + (c.cs || 1));
                const r0 = start + c.r;
                const r1 = start + c.r + (c.rs || 1) - 1;
                const tv = toValue(c.text, o.numStyle, o.numMode);
                const cell = ws.getCell(r0, c0);
                cell.value = tv.v;
                if (tv.fmt) cell.numFmt = tv.fmt;
                styleCell(cell, c, o.numMode, o.numStyle, t.border);
                if (cEnd > c0 || r1 > r0) {
                    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= cEnd; cc++) {
                        if (rr === r0 && cc === c0) continue;
                        const x = ws.getCell(rr, cc);
                        if (c.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.fill) } };
                        if (t.border) { const b = { style: 'thin', color: { argb: argb(t.border) } }; x.border = { top: b, left: b, bottom: b, right: b }; }
                    }
                    merges.push([r0, c0, r1, cEnd]);
                }
            });
            currRow = start + nR + 1; // 1 blank row between sections
        });
        merges.forEach(m => { try { ws.mergeCells(m[0], m[1], m[2], m[3]); } catch (e) {} });
        ws.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: !!o.fit, fitToWidth: 1, fitToHeight: 0 };
    }

    // ---------- Ảnh: đặt đúng vị trí theo lưới hàng / cột ----------
    function imgIdOf(o, key) {
        if (!o._img) o._img = { ids: {}, n: 0 };
        const ids = o._img.ids;
        if (ids[key] === undefined) {
            const b = (o.blobs || {})[key];
            if (!b) return undefined;
            ids[key] = o._wb.addImage({ base64: b.d, extension: b.e === 'png' ? 'png' : 'jpeg' });
        }
        return ids[key];
    }
    // y (điểm PDF) -> vị trí hàng (thập phân, tính từ 0) theo các đoạn đã dựng
    function rowAt(map, y) {
        if (!map.length) return Math.max(0, y / 15);
        if (y <= map[0].y0) return Math.max(0, map[0].r0 - (map[0].y0 - y) / 15);
        for (let i = 0; i < map.length; i++) {
            const m = map[i], nx = map[i + 1];
            if (y <= m.y1) {
                const f = (y - m.y0) / Math.max(1e-6, m.y1 - m.y0);
                return m.r0 + Math.max(0, Math.min(1, f)) * (m.r1 - m.r0);
            }
            if (nx && y < nx.y0) {
                const f = (y - m.y1) / Math.max(1e-6, nx.y0 - m.y1);
                return m.r1 + f * (nx.r0 - m.r1);
            }
        }
        const l = map[map.length - 1];
        return l.r1 + (y - l.y1) / 15;
    }
    // x (điểm PDF) -> vị trí cột (thập phân) theo ĐỘ RỘNG CỘT THỰC TẾ của sheet (1 ký tự ~ 5.7 điểm)
    function colAt(cw, x0, x) {
        let st = x0;
        for (let i = 0; i < cw.length; i++) {
            if (x < st + cw[i]) return i + Math.max(0, (x - st) / cw[i]);
            st += cw[i];
        }
        return cw.length + (x - st) / 48;
    }
    function placeImages(ws, pg, o, map, G, endX) {
        const hOf = i => ws.getRow(i + 1).height || 15;
        const scale = {};
        const nCols = Math.max(ws.columns ? ws.columns.length : 0, G.length), cw = [];
        for (let i = 0; i < nCols; i++) cw.push((ws.getColumn(i + 1).width || 8.43) * 5.7);
        const gx0 = G.length ? G[0] : 0;
        const jobs = [];
        pg.images.forEach(im => {
            const id = imgIdOf(o, im.k);
            if (id === undefined) return;
            const r0 = rowAt(map, im.y0), r1 = Math.max(r0 + 0.2, rowAt(map, im.y1));
            const c0 = colAt(cw, gx0, im.x0), c1 = Math.max(c0 + 0.05, colAt(cw, gx0, im.x1));
            // đảm bảo các hàng phủ ảnh đủ cao để ảnh không méo / không đè sang hàng khác
            const i0 = Math.floor(r0), i1 = Math.ceil(r1) - 1;
            let H = 0;
            for (let i = i0; i <= i1; i++) H += (Math.min(r1, i + 1) - Math.max(r0, i)) * hOf(i);
            const need = im.y1 - im.y0;
            if (H > 0 && H < need * 0.97) { const f = need / H; for (let i = i0; i <= i1; i++) scale[i] = Math.max(scale[i] || 1, f); }
            jobs.push({ id, r0, r1, c0, c1 });
        });
        Object.keys(scale).forEach(k => { const i = +k; ws.getRow(i + 1).height = Math.min(409, hOf(i) * scale[k]); });
        // ExcelJS quy đổi phần lẻ theo ô mặc định (64px x 20px) nên tự tính EMU theo độ rộng cột / chiều cao hàng thật
        const colEmu = i => Math.round(((ws.getColumn(i + 1).width || 8.43) * 7 + 5) * 9525);
        const rowEmu = i => Math.round(hOf(i) * 12700);
        const spanC = (a, b) => { let e = 0; for (let i = Math.floor(a); i < Math.ceil(b); i++) e += colEmu(i) * (Math.min(b, i + 1) - Math.max(a, i)); return e; };
        const spanR = (a, b) => { let e = 0; for (let i = Math.floor(a); i < Math.ceil(b); i++) e += rowEmu(i) * (Math.min(b, i + 1) - Math.max(a, i)); return e; };
        const nat = (c, r) => {
            const ci = Math.floor(c), ri = Math.floor(r);
            return { nativeCol: ci, nativeColOff: Math.round((c - ci) * colEmu(ci)), nativeRow: ri, nativeRowOff: Math.round((r - ri) * rowEmu(ri)) };
        };
        jobs.forEach(j => {
            try {
                const wE = spanC(j.c0, j.c1), hE = spanR(j.r0, j.r1);
                let k = 1, cT = null;
                // chữ trong ô nằm bên phải ảnh (ô luôn căn trái cột) -> thu ảnh lại cho khỏi đè lên chữ
                const rA = Math.floor(j.r0), rB = Math.ceil(j.r1) - 1, cA = Math.floor(j.c0), cB = Math.ceil(j.c1) - 1;
                for (let c = cA + 1; c <= cB && cT === null; c++) {
                    for (let r = rA; r <= rB; r++) {
                        const v = ws.getCell(r + 1, c + 1).value;
                        if (v !== null && v !== undefined && v !== '') { cT = c; break; }
                    }
                }
                if (cT !== null && cT < j.c1) { const kk = spanC(j.c0, cT) / wE; if (kk >= 0.4) k = kk; }
                ws.addImage(j.id, { tl: nat(j.c0, j.r0), ext: { width: Math.max(4, wE * k / 9525), height: Math.max(4, hE * k / 9525) }, editAs: 'oneCell' });
                o._img.n++;
            } catch (e) { console.warn('Không chèn được ảnh', e); }
        });
    }
    // Chế độ "giống PDF gốc": mỗi trang là một ảnh đặt đúng khổ giấy
    function buildSheetImage(wb, pg, o, used) {
        const id = pg.render ? imgIdOf(o, pg.render) : undefined;
        if (id === undefined) return false;
        const ws = wb.addWorksheet(safeName('Trang ' + pg.page, used));
        ws.views = [{ showGridLines: false }];
        ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: Math.round(pg.w * 96 / 72), height: Math.round(pg.h * 96 / 72) } });
        ws.pageSetup = { orientation: pg.w > pg.h ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
        o._img.n++;
        return true;
    }

    function buildSheetPage(wb, pg, o, used) {
        const ws = wb.addWorksheet(safeName('Trang ' + pg.page, used));
        const tables = pg.items.filter(i => i.type === 'table');
        const textSegs = [];
        pg.items.forEach(it => { if (it.type === 'text') it.segs.forEach(s => textSegs.push(s)); });
        const cnt = (G, x) => { let n = 0; G.forEach(g => { if (g < x - 3) n++; }); return n; };
        let xs = [];
        tables.forEach(t => { xs = xs.concat(t.xs); });
        let G = cluster(xs, 3);
        // các bảng có chung lưới cột không? (mỗi ô nằm đúng ô lưới, không bị gộp thêm)
        let compat = true;
        tables.forEach(t => {
            const idx = t.xs.map(x => cnt(G, x));
            for (let k = 1; k < idx.length; k++) if (idx[k] - idx[k - 1] !== 1) compat = false;
        });
        let ref = null;
        if (!compat) {
            ref = tables.slice().sort((p, q) => (q.xs.length - p.xs.length) || ((q.x1 - q.x0) - (p.x1 - p.x0)))[0];
            G = ref.xs.slice(0, -1);
        }
        // điểm bắt đầu của chữ nằm ngoài vùng bảng thì thêm cột
        const tLeft = tables.length ? Math.min.apply(null, tables.map(t => t.xs[0])) : null;
        const tRight = tables.length ? Math.max.apply(null, tables.map(t => t.xs[t.xs.length - 1])) : null;
        const extra = [];
        textSegs.forEach(s => { if (tLeft === null || s.x0 < tLeft - 4 || s.x0 > tRight + 4) extra.push(s.x0); });
        cluster(extra, 12).forEach(x => { if (G.every(g => Math.abs(g - x) > 6)) G.push(x); });
        G = cluster(G, 3);
        if (!G.length) G = [0];
        const maxX = Math.max(pg.w, G[G.length - 1] + 20, tRight || 0);
        const endX = (tRight !== null && G[G.length - 1] < tRight - 5) ? tRight : maxX;
        const widthOf = i => ((i + 1 < G.length ? G[i + 1] : endX) - G[i]);
        G.forEach((g, i) => { ws.getColumn(i + 1).width = Math.max(2, Math.min(120, widthOf(i) / 5.7)); });
        // chỉ số cột (0-based) của từng mép cột của bảng
        const bIdxOf = t => {
            if (compat || t === ref) return t.xs.map(x => cnt(G, x));
            return t.xs.map((x, k) => k);
        };
        let row = 1, prevY = null;
        const merges = [], rmap = [];
        pg.items.forEach(it => {
            if (prevY !== null && it.y0 - prevY > 4) {
                ws.getRow(row).height = Math.min(36, it.y0 - prevY);
                rmap.push({ y0: prevY, y1: it.y0, r0: row - 1, r1: row });
                row++;
            }
            if (it.type === 'text') {
                const sz = Math.max.apply(null, it.segs.map(s => s.size));
                ws.getRow(row).height = Math.max(12, sz * 1.35);
                let lastCol = -1;
                it.segs.forEach(s => {
                    let ci = Math.max(0, Math.min(G.length - 1, cnt(G, s.x0 + 6) - 1));
                    if (ci <= lastCol) ci = lastCol + 1;
                    const cell = ws.getCell(row, ci + 1);
                    const tv = toValue(s.text, o.numStyle, o.numMode);
                    cell.value = tv.v;
                    if (tv.fmt) cell.numFmt = tv.fmt;
                    styleCell(cell, { font: s.font, size: s.size, bold: s.bold, italic: s.italic, color: s.color, h: 'left', v: 'middle', text: s.text, wrap: false });
                    lastCol = ci;
                });
                rmap.push({ y0: it.y0, y1: it.y1, r0: row - 1, r1: row });
                row++;
            } else {
                const start = row;
                const nR = it.ys.length - 1;
                for (let r = 0; r < nR; r++) ws.getRow(start + r).height = Math.max(8, it.ys[r + 1] - it.ys[r]);
                const bi = bIdxOf(it);
                const needCols = (compat || it === ref) ? 0 : bi[bi.length - 1];
                for (let k = G.length; k < needCols; k++) {
                    const j = k; // cột bổ sung cho bảng có nhiều cột hơn bảng tham chiếu
                    ws.getColumn(j + 1).width = Math.max(2, Math.min(120, (it.xs[Math.min(j + 1, it.xs.length - 1)] - it.xs[Math.min(j, it.xs.length - 1)]) / 5.7));
                }
                it.cells.forEach(c => {
                    const c0 = bi[c.c] + 1;
                    const cEnd = Math.max(c0, bi[Math.min(c.c + c.cs, bi.length - 1)]);
                    const r0 = start + c.r, r1 = start + c.r + c.rs - 1;
                    const tv = toValue(c.text, o.numStyle, o.numMode);
                    const cell = ws.getCell(r0, c0);
                    cell.value = tv.v;
                    if (tv.fmt) cell.numFmt = tv.fmt;
                    styleCell(cell, c, o.numMode, o.numStyle, it.border);
                    if (cEnd > c0 || r1 > r0) {
                        for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= cEnd; cc++) {
                            if (rr === r0 && cc === c0) continue;
                            const x = ws.getCell(rr, cc);
                            if (c.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.fill) } };
                            if (it.border) { const b = { style: 'thin', color: { argb: argb(it.border) } }; x.border = { top: b, left: b, bottom: b, right: b }; }
                        }
                        merges.push([r0, c0, r1, cEnd]);
                    }
                });
                for (let ri = 0; ri < nR; ri++) rmap.push({ y0: it.ys[ri], y1: it.ys[ri + 1], r0: start - 1 + ri, r1: start + ri });
                row = start + nR;
            }
            prevY = it.y1;
        });
        if (o.images !== false && pg.images && pg.images.length) placeImages(ws, pg, o, rmap, G, endX);
        merges.forEach(m => { try { ws.mergeCells(m[0], m[1], m[2], m[3]); } catch (e) {} });
        ws.pageSetup = { orientation: pg.w > pg.h ? 'landscape' : 'portrait', paperSize: 9, fitToPage: !!o.fit, fitToWidth: 1, fitToHeight: 0 };
        return ws;
    }

    function buildSheetTable(wb, pg, it, idx, o, used) {
        const ws = wb.addWorksheet(safeName('Bảng ' + idx + ' (Trang ' + pg.page + ')', used));
        const G = it.xs;
        for (let i = 0; i < G.length - 1; i++) ws.getColumn(i + 1).width = Math.max(2, Math.min(120, (G[i + 1] - G[i]) / 5.7));
        const nR = it.ys.length - 1;
        for (let r = 0; r < nR; r++) ws.getRow(r + 1).height = Math.max(8, it.ys[r + 1] - it.ys[r]);
        const merges = [];
        it.cells.forEach(c => {
            const c0 = c.c + 1, c1 = Math.min(G.length - 1, c.c + c.cs), r0 = c.r + 1, r1 = c.r + c.rs;
            const tv = toValue(c.text, o.numStyle, o.numMode);
            const cell = ws.getCell(r0, c0);
            cell.value = tv.v;
            if (tv.fmt) cell.numFmt = tv.fmt;
            styleCell(cell, c, o.numMode, o.numStyle, it.border);
            if (c1 > c0 || r1 > r0) {
                for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
                    if (rr === r0 && cc === c0) continue;
                    const x = ws.getCell(rr, cc);
                    if (c.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.fill) } };
                    if (it.border) { const b = { style: 'thin', color: { argb: argb(it.border) } }; x.border = { top: b, left: b, bottom: b, right: b }; }
                }
                merges.push([r0, c0, r1, c1]);
            }
        });
        merges.forEach(m => { try { ws.mergeCells(m[0], m[1], m[2], m[3]); } catch (e) {} });
        ws.pageSetup = { orientation: pg.w > pg.h ? 'landscape' : 'portrait', paperSize: 9, fitToPage: !!o.fit, fitToWidth: 1, fitToHeight: 0 };
    }

    async function buildWorkbook(pages, o) {
        await ensureExcelJS();
        const wb = new ExcelJS.Workbook();
        wb.creator = 'PDF tool by hachihi.vn';
        o._wb = wb; o._img = { ids: {}, n: 0 };
        o.numStyle = detectNumStyle(pages, o.numMode);
        const used = {};
        let tcount = 0, sheetCount = 0;
        if (o.mode === 'image') {
            pages.forEach(pg => { if (buildSheetImage(wb, pg, o, used)) sheetCount++; });
        } else if (o.mode === 'merged') {
            const allTables = [];
            pages.forEach(pg => {
                pg.items.filter(i => i.type === 'table').forEach(t => allTables.push({ pg, t }));
            });
            if (allTables.length) {
                buildMergedSheet(wb, allTables, o, used);
                sheetCount = 1;
            } else {
                pages.forEach(pg => { if (pg.items.length || (o.images !== false && pg.images && pg.images.length)) { buildSheetPage(wb, pg, o, used); sheetCount++; } });
            }
        } else {
            pages.forEach(pg => {
                if (o.mode === 'table') {
                    pg.items.filter(i => i.type === 'table').forEach(it => { buildSheetTable(wb, pg, it, ++tcount, o, used); sheetCount++; });
                } else if (pg.items.length || (o.images !== false && pg.images && pg.images.length)) { buildSheetPage(wb, pg, o, used); sheetCount++; }
            });
        }
        if (!sheetCount) return null;
        const buf = await wb.xlsx.writeBuffer();
        return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), images: o._img.n, sheets: sheetCount, tables: pages.reduce((n, p) => n + p.items.filter(i => i.type === 'table').length, 0) };
    }

    window.__w2x = { buildWorkbook };

    // ---------- Giao diện ----------
    function render() {
        const list = $('w2x-list');
        window.__hvItems_w2x = items;
        if (!items.length) {
            list.innerHTML = '<div style="color:gray; font-style:italic; text-align:center; padding-top:40px;">Chưa chọn file nào. Kéo thả PDF vào đây hoặc bấm "Chọn file PDF".</div>';
        } else {
            list.innerHTML = '';
            items.forEach(it => {
                const row = document.createElement('div');
                row.style.cssText = 'background:#fff; border:1px solid #d2d0ce; border-radius:6px; padding:10px; display:flex; align-items:center; gap:10px;';
                const colors = { wait: '#605e5c', run: '#005a9e', ok: '#107c41', err: '#a80000' };
                row.innerHTML = '<div style="flex:1; min-width:0;"><div style="font-weight:600; font-size:13px; word-break:break-all;">' + esc(it.file.name) + '</div>' +
                    '<div style="font-size:11px; color:#605e5c;">' + fmtBytes(it.file.size) + (it.numPages ? ' • ' + it.numPages + ' trang' : '') + '</div>' +
                    '<div style="font-size:12px; margin-top:3px; color:' + colors[it.status] + ';">' + esc(it.text || '') + '</div>' +
                    (it.warn ? '<div style="font-size:11px; color:#b45309; margin-top:2px;">⚠ ' + esc(it.warn) + '</div>' : '') + (window.PdfConvertAnalysis ? window.PdfConvertAnalysis.rowHtml(it) : '') + '</div>';
                const act = document.createElement('div');
                act.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';
                if (it.pagesData && it.pagesData.some(p => p.items && p.items.some(i => i.type === 'table'))) {
                    const prevBtn = document.createElement('button');
                    prevBtn.className = 'btn btn-small';
                    prevBtn.style.cssText = 'background:#0284c7; color:#fff;';
                    prevBtn.textContent = '👁️ Xem bảng';
                    prevBtn.title = 'Xem trước bảng tính';
                    prevBtn.onclick = () => w2xPreview(it.id);
                    act.appendChild(prevBtn);
                }
                if (it.blob) {
                    const b = document.createElement('button');
                    b.className = 'btn btn-small btn-success';
                    b.textContent = '⬇ Tải .xlsx';
                    b.onclick = () => dl(it);
                    act.appendChild(b);
                }
                if (!busy) {
                    const d = document.createElement('button');
                    d.className = 'btn btn-small btn-danger';
                    d.textContent = '✕';
                    d.title = 'Bỏ file này';
                    d.onclick = () => { items = items.filter(x => x !== it); render(); };
                    act.appendChild(d);
                }
                row.appendChild(act);
                list.appendChild(row);
            });
        }
        $('w2x-run-btn').disabled = busy || !items.length;
        $('w2x-zip-btn').style.display = items.filter(i => i.blob).length > 1 ? 'flex' : 'none';
        $('w2x-clear-btn').style.display = items.length && !busy ? 'flex' : 'none';
    }

    function w2xPreview(id) {
        const it = items.find(x => x.id === id);
        if (!it || !it.pagesData) return;
        const allTables = [];
        it.pagesData.forEach(pg => {
            pg.items.filter(i => i.type === 'table').forEach((t, tidx) => {
                allTables.push({ pg: pg.page, tidx: tidx + 1, table: t });
            });
        });
        if (!allTables.length) {
            alert('Không tìm thấy bảng để xem trước.');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'auth-modal-overlay';
        modal.style.zIndex = '9999';

        let activeIdx = 0;
        function renderTableContent() {
            const cur = allTables[activeIdx];
            const t = cur.table;
            const nR = t.ys.length - 1;
            const nC = t.xs.length - 1;
            const grid = Array.from({ length: nR }, () => Array(nC).fill(''));
            t.cells.forEach(c => {
                if (c.r < nR && c.c < nC) {
                    grid[c.r][c.c] = esc(c.text || '');
                }
            });

            let tableHtml = '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
            grid.forEach((row, rIdx) => {
                tableHtml += '<tr>';
                row.forEach((cell, cIdx) => {
                    const tag = rIdx === 0 ? 'th' : 'td';
                    const style = rIdx === 0
                        ? 'background:#f1f5f9; font-weight:700; border:1px solid #cbd5e1; padding:6px 10px; text-align:left;'
                        : 'border:1px solid #e2e8f0; padding:5px 8px; background:' + (rIdx % 2 === 0 ? '#fff' : '#f8fafc') + ';';
                    tableHtml += '<' + tag + ' style="' + style + '">' + (cell || '&nbsp;') + '</' + tag + '>';
                });
                tableHtml += '</tr>';
            });
            tableHtml += '</table>';

            const container = modal.querySelector('#w2x-preview-table-wrap');
            if (container) container.innerHTML = tableHtml;
            const title = modal.querySelector('#w2x-preview-sub');
            if (title) title.textContent = `Bảng ${cur.tidx} • Trang ${cur.pg} (${nR} hàng × ${nC} cột)`;
        }

        modal.innerHTML = `
            <div class="auth-modal-dialog" style="max-width:880px; width:94%; max-height:85vh; display:flex; flex-direction:column;">
                <div class="auth-modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3 style="margin:0; font-size:15px; color:#1e293b;">📊 Xem trước bảng: ${esc(it.file.name)}</h3>
                        <div id="w2x-preview-sub" style="font-size:11px; color:#64748b; margin-top:2px;"></div>
                    </div>
                    <button class="auth-modal-close" id="w2x-preview-close" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                </div>
                <div style="padding:8px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; align-items:center;">
                    <span style="font-size:12px; font-weight:600;">Chọn bảng:</span>
                    <select id="w2x-table-select" style="padding:4px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:4px; background:#fff;">
                        ${allTables.map((t, i) => `<option value="${i}">Bảng ${t.tidx} (Trang ${t.pg})</option>`).join('')}
                    </select>
                </div>
                <div id="w2x-preview-table-wrap" style="flex:1; overflow:auto; padding:12px; min-height:220px; max-height:480px; background:#fff;">
                </div>
                <div style="padding:10px 16px; background:#f8fafc; border-top:1px solid #e2e8f0; display:flex; justify-content:flex-end; gap:8px;">
                    <button class="btn btn-small" id="w2x-modal-close-btn">Đóng</button>
                    ${it.blob ? '<button class="btn btn-small btn-success" id="w2x-modal-dl-btn">⬇ Tải .xlsx</button>' : ''}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const sel = modal.querySelector('#w2x-table-select');
        sel.addEventListener('change', e => {
            activeIdx = +e.target.value;
            renderTableContent();
        });
        const close = () => modal.remove();
        modal.querySelector('#w2x-preview-close').addEventListener('click', close);
        modal.querySelector('#w2x-modal-close-btn').addEventListener('click', close);
        const dlBtn = modal.querySelector('#w2x-modal-dl-btn');
        if (dlBtn) dlBtn.addEventListener('click', () => { dl(it); close(); });
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        renderTableContent();
    }

    function dl(it) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(it.blob);
        a.download = it.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }

    async function addFiles(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
        for (const f of files) {
            const it = { id: ++seq, file: f, status: 'wait', text: 'Chờ chuyển đổi' };
            items.push(it);
            try {
                const buf = await f.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
                it.numPages = pdf.numPages;
                if (window.PdfConvertAnalysis) {
                    it.text = 'Đang kiểm tra các trang...'; render();
                    it.analysis = await window.PdfConvertAnalysis.analyze(pdf, {
                        onProgress: (p, n) => { if (p % 10 === 0) { it.text = 'Đang kiểm tra trang ' + p + '/' + n + '...'; render(); } }
                    });
                    it.pre = window.PdfConvertAnalysis.verdict(it.analysis, 'excel');
                    it.text = 'Chờ chuyển đổi';
                    if (it.pre.needOcr) {
                        const ocrHint = $('w2x-ocr-hint');
                        if (ocrHint) ocrHint.style.display = 'block';
                    }
                }
                try { pdf.destroy(); } catch (e) {}
            } catch (e) {
                it.warn = 'Không đọc được thông tin file (có thể bị đặt mật khẩu).';
            }
            render();
        }
    }

    function extractOne(it) {
        return new Promise((resolve, reject) => {
            const fn = m => {
                if (m.type === 'progress') {
                    const mm = /(\d+)\/(\d+)/.exec(m.msg);
                    if (mm) setProgress((+mm[1] - 1) / +mm[2] * 100, it.file.name + ': ' + m.msg);
                } else if (m.type === 'done' && m.id === it.id) { listeners.delete(fn); const j = JSON.parse(m.json); resolve(Array.isArray(j) ? { pages: j, blobs: {} } : j); }
                else if (m.type === 'error' && m.id === it.id) { listeners.delete(fn); reject(new Error(m.message)); }
            };
            listeners.add(fn);
            it.file.arrayBuffer().then(buf => {
                const pages = parsePages($('w2x-pages').value, it.numPages);
                if (pages && !pages.length) { listeners.delete(fn); reject(new Error('Khoảng trang không hợp lệ.')); return; }
                worker.postMessage({ type: 'extract', id: it.id, bytes: buf, opts: { pages: pages, stream: $('w2x-stream').checked, images: $('w2x-img') ? $('w2x-img').checked : true, render: $('w2x-mode').value === 'image', dpi: 150 } }, [buf]);
            }).catch(e => { listeners.delete(fn); reject(e); });
        });
    }

    // ---------- Báo cáo chất lượng sau khi chuyển ----------
    function buildExcelReport(it, pages, out, ex, mode) {
        const A = window.PdfConvertAnalysis;
        if (!A) return null;
        const lines = [];
        let level = 'ok';
        const bump = l => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };
        const textLines = pages.reduce((n, p) => n + (p.items || []).filter(i => i.type === 'text').length, 0);
        lines.push('Trong file Excel: ' + out.sheets + ' sheet • ' + out.tables + ' bảng • ' + textLines + ' dòng chữ' + (out.images ? ' • ' + out.images + ' ảnh' : '') + ' (từ ' + pages.length + ' trang).');

        if (mode !== 'image') {
            const noContent = pages.filter(p => !(p.items && p.items.length) && !(p.images && p.images.length)).map(p => p.page);
            const imgOnly = pages.filter(p => !(p.items && p.items.length) && p.images && p.images.length).map(p => p.page);
            if (noContent.length) {
                bump(noContent.length === pages.length ? 'bad' : 'warn');
                lines.push('Trang ' + A.ranges(noContent) + ' không có chữ hay bảng để đưa vào Excel (thường là bản scan hoặc hình).');
            }
            if (imgOnly.length) {
                bump('warn');
                lines.push('Trang ' + A.ranges(imgOnly) + ' chỉ có hình nên được chèn dạng ảnh, không có dữ liệu để chỉnh sửa.');
            }
            if (!out.tables) {
                bump('warn');
                lines.push('Không dò được bảng nào, chữ được xếp theo vị trí.' + (mode === 'page' ? ' Thử bật "Dò cả bảng không có đường viền".' : ''));
            }
        }
        const warns = (ex && ex.warns) || [];
        warns.slice(0, 5).forEach(w => { bump('warn'); lines.push(w); });
        if (warns.length > 5) lines.push('(và ' + (warns.length - 5) + ' cảnh báo khác)');

        if (it.analysis) {
            const got = new Set(pages.map(p => p.page));
            const bad = it.analysis.pages.filter(p => got.has(p.n) && (p.cls === 'garbled' || p.cls === 'legacy')).map(p => p.n);
            if (bad.length) { bump('bad'); lines.push('Trang ' + A.ranges(bad) + ' có chữ loạn mã hoặc font cũ: hãy kiểm tra kỹ nội dung trong Excel.'); }
        }
        if (level === 'ok') lines.push('Đã dựng bảng và chữ. Nên mở file đối chiếu số liệu quan trọng với PDF gốc.');
        return { level: level, lines: lines };
    }

    async function run() {
        if (busy || !items.length) return;
        busy = true;
        render();
        let ok = 0;
        try {
            setProgress(0, 'Đang tải bộ chuyển đổi (lần đầu ~55 MB, các lần sau nhanh hơn)...');
            await ensureEngine();
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it.blob) continue;
                it.status = 'run'; it.text = 'Đang đọc bảng và định dạng...';
                render();
                setProgress(0, 'Đang chuyển ' + it.file.name + ' (' + (i + 1) + '/' + items.length + ')...');
                try {
                    const ex = await extractOne(it);
                    const pages = ex.pages;
                    it.pagesData = pages;
                    setProgress(100, 'Đang tạo file Excel cho ' + it.file.name + '...');
                    const out = await buildWorkbook(pages, { mode: $('w2x-mode').value, numMode: $('w2x-num').value, fit: $('w2x-fit').checked, blobs: ex.blobs || {}, images: $('w2x-img') ? $('w2x-img').checked : true });
                    if (!out) { it.status = 'err'; it.text = 'Không tìm thấy bảng hoặc chữ nào để đưa vào Excel.'; render(); continue; }
                    it.blob = out.blob;
                    it.name = it.file.name.replace(/\.pdf$/i, '') + '.xlsx';
                    try { it.report = buildExcelReport(it, pages, out, ex, $('w2x-mode').value); } catch (e) { console.warn('Không tạo được báo cáo chất lượng:', e); it.report = null; }
                    it.status = 'ok'; it.text = 'Xong • ' + out.sheets + ' sheet • ' + out.tables + ' bảng' + (out.images ? ' • ' + out.images + ' ảnh' : '') + ' • ' + fmtBytes(out.blob.size);
                    ok++;
                    if (typeof logAction === 'function') logAction('pdf_to_excel');
                    if (items.length === 1) dl(it);
                } catch (e) {
                    it.status = 'err'; it.text = 'Lỗi: ' + (e.message || e);
                }
                render();
            }
            setProgress(100, ok ? 'Hoàn tất: đã chuyển ' + ok + ' file.' : 'Không chuyển được file nào.');
        } catch (e) {
            setProgress(0, 'Không tải được bộ chuyển đổi: ' + (e.message || e) + '. Kiểm tra kết nối mạng hoặc địa chỉ nguồn ở mục Nâng cao.');
            items.forEach(it => { if (it.status === 'run') { it.status = 'err'; it.text = 'Chưa chuyển được'; } });
        } finally {
            busy = false;
            render();
        }
    }

    async function zipAll() {
        const done = items.filter(i => i.blob);
        if (!done.length) return;
        if (typeof JSZip === 'undefined') {
            try { await loadScript(['vendor/jszip.min.js', 'vendor/jszip.min.js']); } catch (e) { alert('Không tải được thư viện nén ZIP'); return; }
        }
        const zip = new JSZip(), used = {};
        for (const it of done) {
            let n = it.name; if (used[n]) { used[n]++; n = n.replace(/\.xlsx$/, '') + ' (' + used[n] + ').xlsx'; } else used[n] = 1;
            zip.file(n, it.blob);
        }
        dl({ blob: await zip.generateAsync({ type: 'blob' }), name: 'pdf-to-excel.zip' });
    }

    function init() {
        const inp = $('w2x-input');
        if (!inp) return;
        inp.addEventListener('change', () => { addFiles(inp.files); inp.value = ''; });
        $('w2x-run-btn').addEventListener('click', run);
        $('w2x-zip-btn').addEventListener('click', zipAll);
        $('w2x-clear-btn').addEventListener('click', () => { items = []; $('w2x-progress-wrap').style.display = 'none'; if ($('w2x-ocr-hint')) $('w2x-ocr-hint').style.display = 'none'; render(); });
        const drop = $('w2x-drop');
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.outline = '2px dashed var(--primary)'; });
        drop.addEventListener('dragleave', () => { drop.style.outline = ''; });
        drop.addEventListener('drop', e => { e.preventDefault(); drop.style.outline = ''; addFiles(e.dataTransfer.files); });
        render();
    }
    window._w2x = { get items() { return items; }, run: run, addFiles: addFiles };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
