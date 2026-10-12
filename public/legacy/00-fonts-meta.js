// Roboto (Regular/Bold/Italic/BoldItalic) đã nhúng sẵn, hỗ trợ đầy đủ tiếng Việt, không cần tải từ mạng
// Danh sách font chọn được (k = hệ số đặt đường cơ sở cho chữ thêm mới, ik = cho ô nhập)
window.FONT_LIST = [
    { key: 'roboto',    label: 'Roboto (Sans)',          css: 'RobotoEmb',   styles: ['regular','bold','italic','bolditalic'], k: 0.842,  ik: 0.928 },
    { key: 'bevietnam', label: 'Be Vietnam Pro (Sans)',  css: 'EmbBeViet',   styles: ['regular','bold','italic','bolditalic'], k: 0.8675, ik: 1.0 },
    { key: 'tinos',     label: 'Tinos (Serif, như Times)', css: 'EmbTinos',  styles: ['regular','bold','italic','bolditalic'], k: 0.8374, ik: 0.9124 },
    { key: 'cousine',   label: 'Cousine (Monospace)',    css: 'EmbCousine',  styles: ['regular','bold','italic','bolditalic'], k: 0.7661, ik: 0.8325 },
    { key: 'pacifico',  label: 'Pacifico (Chữ viết)',    css: 'EmbPacifico', styles: ['regular'], k: 0.925, ik: 1.303 },
    { key: 'patrick',   label: 'Patrick Hand (Viết tay)', css: 'EmbPatrick', styles: ['regular'], k: 0.865, ik: 1.042 }
];
// ----- Font cài trong máy (Local Font Access API: Chrome / Edge) -----
window.LOCAL_FONTS = {};          // family -> { regular: FontData, bold, italic, bolditalic }
window._localMetricCache = {};
function isLocalKey(k) { return typeof k === 'string' && k.indexOf('local:') === 0; }
function localFamily(k) { return k.slice(6); }
function localMetrics(family) {
    var c = window._localMetricCache[family];
    if (c) return c;
    var res = { k: 0.85, ik: 0.95 };
    try {
        var ctx = document.createElement('canvas').getContext('2d');
        ctx.font = "100px '" + family.replace(/'/g, "\\'") + "', Arial";
        var m = ctx.measureText('Hxg');
        if (m.fontBoundingBoxAscent) {
            var a = m.fontBoundingBoxAscent / 100, d = m.fontBoundingBoxDescent / 100;
            res = { k: (1 - (a + d)) / 2 + a, ik: a };
        }
    } catch (e) {}
    window._localMetricCache[family] = res;
    return res;
}
function fontInfo(key) {
    if (isLocalKey(key)) {
        var fam = localFamily(key), mt = localMetrics(fam);
        return { key: key, label: fam, css: fam.replace(/'/g, ''), styles: ['regular','bold','italic','bolditalic'], k: mt.k, ik: mt.ik, local: true };
    }
    return window.FONT_LIST.find(function (f) { return f.key === key; }) || window.FONT_LIST[0];
}
function fontCss(key) { return "'" + fontInfo(key).css + "', 'RobotoEmb', Roboto, Arial, sans-serif"; }
function fontKeyOf(o) {
    var k = o && o.fontFamily;
    if (!k) return 'roboto';
    if (isLocalKey(k)) return k;
    return window.FONT_LIST.some(function (f) { return f.key === k; }) ? k : 'roboto';
}
function faceStyleOf(fd) {
    var s = String(fd.style || '').toLowerCase();
    var b = /bold|black|heavy|semibold|demi/.test(s), i = /italic|oblique/.test(s);
    return b && i ? 'bolditalic' : b ? 'bold' : i ? 'italic' : (/regular|normal|book|roman|medium|^$/.test(s) ? 'regular' : null);
}
async function ensureLocalFonts() {
    if (Object.keys(window.LOCAL_FONTS).length) return true;
    if (typeof window.queryLocalFonts !== 'function') return false;
    var list = await window.queryLocalFonts();
    list.forEach(function (fd) {
        var st = faceStyleOf(fd);
        if (!st) return;
        var fam = fd.family;
        (window.LOCAL_FONTS[fam] = window.LOCAL_FONTS[fam] || {});
        if (!window.LOCAL_FONTS[fam][st]) window.LOCAL_FONTS[fam][st] = fd;
    });
    return true;
}
async function loadLocalFontList() {
    var btn = document.getElementById('editor-local-font-btn');
    var sel = document.getElementById('editor-text-font');
    try {
        if (typeof window.queryLocalFonts !== 'function') {
            alert('Trình duyệt này không hỗ trợ đọc font trong máy. Hãy dùng Chrome hoặc Edge bản mới.');
            return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Đang đọc font...'; }
        await ensureLocalFonts();
        var old = sel.querySelector('optgroup[data-local]');
        if (old) old.remove();
        var g = document.createElement('optgroup');
        g.label = 'Font trong máy này';
        g.setAttribute('data-local', '1');
        Object.keys(window.LOCAL_FONTS).filter(function (f) { return window.LOCAL_FONTS[f].regular; }).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (fam) {
            var o = document.createElement('option');
            o.value = 'local:' + fam; o.textContent = fam;
            o.style.fontFamily = "'" + fam + "'";
            g.appendChild(o);
        });
        sel.appendChild(g);
        if (btn) btn.textContent = 'Đã nạp ' + g.children.length + ' font trong máy';
    } catch (err) {
        console.error(err);
        if (btn) btn.textContent = 'Nạp font có sẵn trong máy';
        alert('Không đọc được font trong máy (cần cho phép quyền truy cập font): ' + (err && err.message ? err.message : err));
    } finally {
        if (btn) btn.disabled = false;
    }
}
function applyFontToEl(el, key) {
    el.style.fontFamily = fontCss(key);
    el.style.fontSynthesis = fontInfo(key).styles.length < 4 ? 'none' : '';
}
function fontBytes(key, style) {
    if (key === 'roboto' || !window.EMBEDDED_FONTS || !window.EMBEDDED_FONTS[key]) return getEmbeddedFont(style);
    var info = fontInfo(key);
    var st = info.styles.indexOf(style) !== -1 ? style : 'regular';
    var b = window.EMBEDDED_FONTS[key][st];
    if (!b) return null;
    var bin = atob(b), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
}
function getEmbeddedFont(style) {
    var b = window.EMBEDDED_ROBOTO && window.EMBEDDED_ROBOTO[style];
    if (!b) return null;
    var bin = atob(b), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
}
