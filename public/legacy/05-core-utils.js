// ===================== Tiện ích dùng chung =====================
// 1) PDFZoom  : cách tính phóng to/thu nhỏ DUY NHẤT cho mọi khung xem (Xoay, Gộp, So sánh, Chỉnh sửa, Ký, Che...)
// 2) PDFFonts : chuẩn hóa tên font PDF -> font Word/Excel gần giống nhất, sửa file DOCX sau khi chuyển đổi
// 3) PDFJob   : tiện ích cho tác vụ nặng (nhường giao diện, tự giải phóng bộ nhớ khi rảnh)
(function (global) {
    'use strict';

    /* ======================= 1. PHÓNG TO / THU NHỎ NHẤT QUÁN =======================
       Quy ước chung cho MỌI khung xem:
         100%        = kích thước thật của trang (96 dpi): 1 pt PDF = 96/72 px màn hình
         Vừa chiều rộng = chiều rộng trang vừa đúng chiều rộng khung (không bị giới hạn trần)
         Vừa trang      = cả trang (cả chiều rộng lẫn chiều cao) nằm gọn trong khung
         Nhãn phần trăm luôn là tỉ lệ THẬT so với 100% nói trên, nên "Vừa chiều rộng" có thể là 87%, 143%...
         Giới hạn: 10% – 400%. Nút +/- nhảy theo các mốc cố định. */
    const PX_PER_PT = 96 / 72;
    const MIN_PCT = 10, MAX_PCT = 400;
    const STEPS = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400];

    const Z = {
        PX_PER_PT: PX_PER_PT,
        MIN_PCT: MIN_PCT,
        MAX_PCT: MAX_PCT,
        STEPS: STEPS,
        clamp: function (scale) {
            return Math.max(MIN_PCT / 100 * PX_PER_PT, Math.min(MAX_PCT / 100 * PX_PER_PT, scale));
        },
        pct: function (scale) { return Math.round(scale / PX_PER_PT * 100); },
        label: function (scale) { return Z.pct(scale) + '%'; },
        actual: function () { return PX_PER_PT; },
        fitWidth: function (pageW, availW) {
            return pageW > 0 && availW > 0 ? Z.clamp(availW / pageW) : PX_PER_PT;
        },
        fitPage: function (pageW, pageH, availW, availH) {
            if (!(pageW > 0 && pageH > 0 && availW > 0 && availH > 0)) return PX_PER_PT;
            return Z.clamp(Math.min(availW / pageW, availH / pageH));
        },
        // dir > 0: lên mốc kế tiếp, dir < 0: xuống mốc trước
        step: function (scale, dir) {
            const cur = scale / PX_PER_PT * 100;
            let target = cur;
            if (dir > 0) {
                target = STEPS.find(function (p) { return p > cur + 0.5; }) || MAX_PCT;
            } else {
                for (let i = STEPS.length - 1; i >= 0; i--) { if (STEPS[i] < cur - 0.5) { target = STEPS[i]; break; } }
                if (target === cur) target = MIN_PCT;
            }
            return Z.clamp(target / 100 * PX_PER_PT);
        },
        // Ctrl + cuộn chuột
        wheel: function (scale, deltaY) { return Z.clamp(scale * (deltaY < 0 ? 1.1 : 1 / 1.1)); },
        // vùng khả dụng của khung trừ lề
        avail: function (el, padX, padY) {
            return {
                w: Math.max(60, (el.clientWidth || 0) - 2 * (padX || 0)),
                h: Math.max(60, (el.clientHeight || 0) - 2 * (padY == null ? (padX || 0) : padY))
            };
        }
    };
    global.PDFZoom = Z;

    /* ======================= 2. FONT =======================
       PDF lưu tên font dạng "ABCDEF+TimesNewRomanPS-BoldMT". Word/Excel không hiểu tên này nên tự thay bằng font mặc
       định (thường là Calibri) -> khác gốc. Ở đây: bỏ tiền tố, đổi sang tên font quen thuộc, nhận ra đậm/nghiêng,
       và với font hiếm thì chọn font thay thế cùng kiểu (có chân / không chân / đơn cách). */
    const STD = new Set([
        'arial', 'arial narrow', 'arial black', 'times new roman', 'courier new', 'calibri', 'calibri light', 'cambria', 'cambria math',
        'candara', 'consolas', 'constantia', 'corbel', 'segoe ui', 'segoe ui light', 'segoe ui semibold', 'tahoma', 'verdana',
        'georgia', 'trebuchet ms', 'palatino linotype', 'book antiqua', 'garamond', 'century gothic', 'century', 'comic sans ms',
        'impact', 'lucida console', 'lucida sans unicode', 'microsoft sans serif', 'franklin gothic medium', 'gill sans mt',
        'rockwell', 'tw cen mt', 'bookman old style', 'sylfaen', 'symbol', 'wingdings', 'wingdings 2', 'wingdings 3', 'webdings',
        'cambria', 'helvetica', 'times', 'courier', 'roboto', 'open sans', 'noto sans', 'noto serif'
    ]);
    // khóa (chữ thường, bỏ khoảng trắng) -> tên font Word quen thuộc
    const ALIAS = {
        times: 'Times New Roman', timesroman: 'Times New Roman', timesnewroman: 'Times New Roman', timenewroman: 'Times New Roman',
        timesnewromanps: 'Times New Roman', liberationserif: 'Times New Roman', tinos: 'Times New Roman', nimbusroman: 'Times New Roman',
        nimbusromno9l: 'Times New Roman', freeserif: 'Times New Roman', dejavuserif: 'Times New Roman', vntime: 'Times New Roman',
        '.vntime': 'Times New Roman', vntimes: 'Times New Roman', 'vni-times': 'Times New Roman', vnitimes: 'Times New Roman',
        helvetica: 'Arial', helveticaneue: 'Arial', arimo: 'Arial', liberationsans: 'Arial', nimbussans: 'Arial', nimbussansl: 'Arial',
        freesans: 'Arial', vnarial: 'Arial', '.vnarial': 'Arial', arialmt: 'Arial', arialunicodems: 'Arial Unicode MS',
        courier: 'Courier New', couriernew: 'Courier New', couriernewps: 'Courier New', liberationmono: 'Courier New', cousine: 'Courier New',
        nimbusmono: 'Courier New', nimbusmonol: 'Courier New', freemono: 'Courier New', dejavusansmono: 'Courier New',
        carlito: 'Calibri', caladea: 'Cambria', dejavusans: 'Verdana', symbolmt: 'Symbol', segoeui: 'Segoe UI',
        arialnarrow: 'Arial Narrow', arialblack: 'Arial Black', trebuchetms: 'Trebuchet MS', comicsansms: 'Comic Sans MS',
        lucidaconsole: 'Lucida Console', palatinolinotype: 'Palatino Linotype', bookantiqua: 'Book Antiqua', centurygothic: 'Century Gothic',
        gillsans: 'Gill Sans MT', tahoma: 'Tahoma', verdana: 'Verdana', georgia: 'Georgia', calibri: 'Calibri', cambria: 'Cambria',
        consolas: 'Consolas', garamond: 'Garamond', impact: 'Impact', sylfaen: 'Sylfaen', roboto: 'Roboto', opensans: 'Open Sans'
    };
    const RE_MONO = /(mono|courier|consolas|console|typewriter|\bcode\b|menlo|monaco|fixed)/i;
    const RE_SERIF = /(times|serif(?!.*sans)|roman|garamond|georgia|palatino|bookman|antiqua|cambria|minion|baskerville|didot|bodoni|caslon|century(?!\s*gothic)|constantia|song|ming|mincho|merriweather|lora|playfair|sylfaen|tinos)/i;
    const ALT = { serif: 'Times New Roman', sans: 'Arial', mono: 'Courier New' };
    const FAMILY = { serif: 'roman', sans: 'swiss', mono: 'modern' };

    function prettify(base) {
        return String(base)
            .replace(/_+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // raw: tên font gốc trong PDF; flags: cờ font của PyMuPDF (4 = có chân, 8 = đơn cách, 2 = nghiêng, 16 = đậm), có thể bỏ trống
    function parse(raw, flags) {
        let s = String(raw || '').trim();
        s = s.replace(/^[A-Z]{6}\+/, '').replace(/^\+/, '');
        const parts = s.split(/[-,]/);
        let base = parts[0] || '';
        let style = parts.slice(1).join(' ');
        // kiểu dính liền vào tên: "TimesNewRomanBold", "ArialItalic"
        let m;
        while ((m = /(BoldItalic|BoldOblique|Bold|Italic|Oblique)$/.exec(base)) && base.length > m[0].length + 2) {
            style += ' ' + m[1];
            base = base.slice(0, -m[1].length);
        }
        base = base.replace(/(PSMT|PS|MT)$/, '');
        const key = base.toLowerCase().replace(/[\s_]+/g, '');
        let family = ALIAS[key] || prettify(base) || 'Arial';
        const f = flags || 0;
        const bold = /(bold|black|heavy|semibold|demi)/i.test(style) || !!(f & 16);
        const italic = /(italic|oblique|\bit\b)/i.test(style) || !!(f & 2);
        let cls;
        if (f & 8) cls = 'mono';
        else if (RE_MONO.test(family) || RE_MONO.test(base)) cls = 'mono';
        else if (f & 4) cls = 'serif';
        else if (RE_SERIF.test(family) || RE_SERIF.test(base)) cls = 'serif';
        else cls = 'sans';
        const std = STD.has(family.toLowerCase());
        return { family: family, bold: bold, italic: italic, cls: cls, std: std, alt: ALT[cls], wordFamily: FAMILY[cls] };
    }

    // Excel không có bảng thay thế font như Word -> font lạ đổi thẳng sang font thay thế cùng kiểu
    function forExcel(raw, flags) {
        const p = parse(raw, flags);
        return { name: p.std ? p.family : p.alt, bold: p.bold, italic: p.italic, family: p.cls === 'serif' ? 1 : (p.cls === 'mono' ? 3 : 2) };
    }

    const xmlEsc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    const RE_SYMBOL = /^(symbol|wingdings|webdings|marlett|zapfdingbats|dingbats)/i;

    function fixRPr(rpr, used) {
        const mTag = /<w:rFonts\b([^>]*?)\/>/.exec(rpr);
        if (!mTag) return rpr;
        const attrs = mTag[1];
        const get = function (n) { const r = new RegExp('w:' + n + '="([^"]*)"').exec(attrs); return r ? r[1] : ''; };
        const raw = get('ascii') || get('hAnsi') || get('eastAsia') || get('cs');
        if (!raw || RE_SYMBOL.test(raw)) return rpr;
        const p = parse(raw);
        used.set(p.family, p);
        const fam = xmlEsc(p.family);
        const newTag = '<w:rFonts w:ascii="' + fam + '" w:hAnsi="' + fam + '" w:eastAsia="' + fam + '" w:cs="' + fam + '"/>';
        let out = rpr.replace(mTag[0], newTag);
        // PDF ghi đậm/nghiêng trong tên font nhưng đôi khi không có cờ -> bổ sung nếu run chưa có
        if (p.bold && !/<w:b(?=[\s\/>])/.test(out)) out = out.replace(newTag, newTag + '<w:b/>');
        if (p.italic && !/<w:i(?=[\s\/>])/.test(out)) {
            const mb = /<w:b(?=[\s\/>])[^>]*\/>(<w:bCs(?=[\s\/>])[^>]*\/>)?/.exec(out);
            if (mb) out = out.replace(mb[0], mb[0] + '<w:i/>');
            else out = out.replace(newTag, newTag + '<w:i/>');
        }
        return out;
    }

    function loadJSZip() {
        if (global.JSZip) return Promise.resolve(global.JSZip);
        return new Promise(function (res, rej) {
            const s = document.createElement('script');
            s.src = 'vendor/jszip.min.js';
            s.onload = function () { global.JSZip ? res(global.JSZip) : rej(new Error('JSZip')); };
            s.onerror = function () { rej(new Error('Không tải được thư viện nén ZIP')); };
            document.head.appendChild(s);
        });
    }

    // Sửa DOCX sau khi chuyển đổi: tên font chuẩn, đậm/nghiêng, bảng thay thế font (altName) trong fontTable.xml.
    // Lỗi bất kỳ -> trả lại file gốc, không bao giờ làm hỏng kết quả.
    async function fixDocx(bytes) {
        try {
            const JS = await loadJSZip();
            const zip = await JS.loadAsync(bytes);
            const used = new Map();
            const names = Object.keys(zip.files).filter(function (n) {
                return /^word\/(document|styles|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n);
            });
            for (const n of names) {
                let xml = await zip.file(n).async('string');
                xml = xml.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, function (r) { return fixRPr(r, used); });
                zip.file(n, xml);
            }
            const ft = zip.file('word/fontTable.xml');
            if (ft && used.size) {
                let x = await ft.async('string');
                let add = '';
                used.forEach(function (p, fam) {
                    if (p.std) return;
                    if (x.indexOf('w:name="' + xmlEsc(fam) + '"') !== -1) return;
                    add += '<w:font w:name="' + xmlEsc(fam) + '"><w:altName w:val="' + p.alt + '"/><w:charset w:val="00"/>' +
                        '<w:family w:val="' + p.wordFamily + '"/><w:pitch w:val="' + (p.cls === 'mono' ? 'fixed' : 'variable') + '"/></w:font>';
                });
                if (add && /<\/w:fonts>/.test(x)) { x = x.replace('</w:fonts>', add + '</w:fonts>'); zip.file('word/fontTable.xml', x); }
            }
            return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        } catch (e) {
            if (global.console) console.warn('fixDocx bỏ qua:', e);
            return bytes;
        }
    }

    global.PDFFonts = { parse: parse, forExcel: forExcel, fixDocx: fixDocx, loadJSZip: loadJSZip };

    /* ======================= 3. TÁC VỤ NẶNG =======================
       - tick()      : nhường giao diện một nhịp để tab không bị treo
       - idle(fn,ms) : hẹn giờ giải phóng tài nguyên (worker, bộ OCR...) khi người dùng không dùng nữa
       - CANCEL      : mã lỗi dùng chung khi người dùng bấm Hủy */
    const Job = {
        CANCEL: '__CANCELLED__',
        isCancel: function (e) { return !!e && (e.message === '__CANCELLED__' || e.name === 'CancelError'); },
        cancelError: function () { const e = new Error('__CANCELLED__'); e.name = 'CancelError'; return e; },
        tick: function () { return new Promise(function (r) { setTimeout(r, 0); }); },
        idle: function (fn, ms) {
            let t = null;
            return {
                arm: function () { clearTimeout(t); t = setTimeout(fn, ms); },
                disarm: function () { clearTimeout(t); t = null; }
            };
        },
        fmtTime: function (ms) {
            const s = Math.round(ms / 1000);
            return s < 60 ? s + ' giây' : Math.floor(s / 60) + ' phút ' + (s % 60) + ' giây';
        }
    };
    global.PDFJob = Job;
})(typeof window !== 'undefined' ? window : globalThis);
