// Tiện ích dùng chung cho các bài kiểm thử: chạy script của dự án trong vm, giả lập Web Worker
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..') + '/';
const LEG = ROOT + 'public/legacy/';

function baseCtx(extra) {
    const ctx = Object.assign({ console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Buffer, atob, btoa, performance, queueMicrotask }, extra || {});
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    return vm.createContext(ctx);
}
function load(ctx, file) { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx); }

// Mảng/đối tượng gửi vào vm phải được tạo lại trong vm (khác "realm" thì pdf-lib không nhận ra Array)
function toRealm(ctx) {
    return vm.runInContext('(function fix(o){ if (o===null||typeof o!=="object") return o; if (ArrayBuffer.isView(o)) return new Uint8Array(o.buffer,o.byteOffset,o.byteLength); if (Array.isArray(o)) return Array.from(o,fix); const r={}; for (const k of Object.keys(o)) r[k]=fix(o[k]); return r; })', ctx);
}

// Chạy pdf-ops.worker.js như một worker thật: importScripts đọc file trong public/, postMessage gom vào msgs
function makeWorker() {
    const msgs = [];
    const ctx = baseCtx({ postMessage: (d) => msgs.push(d) });
    ctx.importScripts = (...rel) => rel.forEach((r) => load(ctx, path.resolve(LEG, r)));
    load(ctx, LEG + 'pdf-ops.worker.js');
    const fix = toRealm(ctx);
    return {
        ctx, msgs,
        send: (m) => ctx.onmessage({ data: fix(m) }),
        done: (id) => new Promise((res, rej) => {
            const t = setInterval(() => {
                const f = msgs.find((x) => x.id === id && (x.type === 'done' || x.type === 'error'));
                if (f) { clearInterval(t); f.type === 'done' ? res(f) : rej(new Error(f.message)); }
            }, 10);
        })
    };
}

// Tạo PDF mẫu bằng chính pdf-lib của dự án
async function makePdf(sizes) {
    const ctx = baseCtx();
    load(ctx, ROOT + 'public/vendor/pdf-lib.min.js');
    const PDFLib = ctx.PDFLib, fix = toRealm(ctx);
    const doc = await PDFLib.PDFDocument.create();
    fix(sizes).forEach((sz) => doc.addPage(sz));
    return { bytes: new Uint8Array(await doc.save()), PDFLib, fix };
}

function fontBytes() {
    const s = fs.readFileSync(ROOT + 'public/legacy/fonts-data.js', 'utf8');
    const m = /EMBEDDED_ROBOTO = (\{.*?\});/.exec(s);
    return new Uint8Array(Buffer.from(JSON.parse(m[1]).regular, 'base64'));
}

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const done = () => process.exit(fails ? 1 : 0);

module.exports = { ROOT, LEG, fs, vm, baseCtx, load, makeWorker, makePdf, fontBytes, ok, done };
