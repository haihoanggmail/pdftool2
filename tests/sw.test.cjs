const ROOT=require('path').resolve(__dirname,'..')+'/';
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(ROOT+'public/sw.js','utf8').replace(/__BUILD__/g,'b2');
const origin='https://x.test';
const net={}; // url -> body ; ghi lại số lần gọi mạng
const hits=[];
const mk=(u)=>({url:new URL(u,origin+'/').href});
class Resp{constructor(b,ok=true){this.b=b;this.ok=ok;this.type='basic'} clone(){return new Resp(this.b,this.ok)} async text(){return this.b}}
const stores={};
const cacheOf=(n)=>stores[n]||(stores[n]=new Map());
const caches={open:async n=>({add:async r=>{const u=r.url||new URL(r,origin+'/').href;const res=await fetchFn(r.url?r:{url:u});if(!res.ok)throw new Error('404 '+u);cacheOf(n).set(u,res)},put:async(r,res)=>cacheOf(n).set(r.url||r,res),match:async r=>cacheOf(n).get(r.url||new URL(r,origin+'/').href)}),
  keys:async()=>Object.keys(stores),delete:async n=>{delete stores[n]},match:async()=>undefined};
async function fetchFn(r){const u=typeof r==='string'?new URL(r,origin+'/').href:r.url;hits.push(u);const p=new URL(u).pathname;if(online&&(p in net))return new Resp(net[p]);if(online) return new Resp('',false);throw new Error('offline')}
let online=true;
const listeners={};
const ctx={console,setTimeout,clearTimeout,Promise,URL,Request:function(u){this.url=new URL(u,origin+'/').href},Response:Resp,caches,fetch:fetchFn,
  self:{location:{href:origin+'/sw.js',origin},addEventListener:(t,f)=>listeners[t]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}}};
ctx.self.self=ctx.self;vm.createContext(ctx);vm.runInContext(src.replace(/^/,'var self=globalThis.self;'),ctx);
const files=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/logo.png','/vendor/pdf-lib.min.js','/vendor/pdf.min.js','/vendor/pdf.worker.min.js','/vendor/jszip.min.js'];
files.forEach(f=>net[f]='x');
net['/index.html']='<script type="module" src="./assets/index-ABC123.js"></script><link rel="stylesheet" href="./assets/index-DEF456.css"><script src="legacy/10-core.js"></script>';
net['/assets/index-ABC123.js']='import("./sign-XYZ789.js");const a="assets/redact-QQQ111.js"';
net['/assets/index-DEF456.css']='';net['/assets/sign-XYZ789.js']='';net['/assets/redact-QQQ111.js']='';
fs.readdirSync(ROOT+'public/legacy').forEach(f=>net['/legacy/'+f]='x');
const run=async(t,ev)=>{let p;listeners[t]({...ev,waitUntil:q=>p=q,respondWith:q=>p=q});return p};
let fail=0;const ok=(c,m)=>{if(!c){fail++;console.log('FAIL',m)}else console.log('ok  ',m)};
(async()=>{
  await run('install',{});
  const app=cacheOf('pdftool-app-b2'),ven=cacheOf('pdftool-vendor-v1');
  ok(app.has(origin+'/legacy/10-core.js')&&app.has(origin+'/legacy/pdf-ops.worker.js')&&app.has(origin+'/legacy/94-i18n-v2.js'),'precache có legacy/*.js + worker + gói dịch');
  ok(app.has(origin+'/assets/index-ABC123.js')&&app.has(origin+'/assets/index-DEF456.css'),'tự phát hiện bundle build có hash từ index.html');
  ok(app.has(origin+'/assets/sign-XYZ789.js')&&app.has(origin+'/assets/redact-QQQ111.js'),'tự phát hiện chunk import động');
  ok(ven.has(origin+'/vendor/pdf-lib.min.js')&&ven.has(origin+'/vendor/pdf.worker.min.js'),'vendor lõi nằm trong bộ nhớ vendor riêng');
  // ra bản mới: bộ nhớ app cũ bị xóa, vendor giữ nguyên và KHÔNG tải lại
  stores['pdftool-app-OLD']=new Map([['x',1]]);stores['pdftool-v7']=new Map([['y',1]]);
  await run('activate',{});
  ok(!('pdftool-app-OLD' in stores)&&!('pdftool-v7' in stores)&&('pdftool-vendor-v1' in stores)&&('pdftool-app-b2' in stores),'activate: xóa bản cũ, giữ vendor + bản hiện tại');
  hits.length=0; await run('install',{});
  ok(!hits.some(u=>u.includes('/vendor/')),'cài lại: không tải lại vendor đã có');
  // fetch: vendor cache-first => không gọi mạng
  hits.length=0;
  let r=await run('fetch',{request:{method:'GET',url:origin+'/vendor/pdf-lib.min.js',headers:{has:()=>false},mode:'no-cors'}});
  ok(hits.length===0,'/vendor/* lấy từ bộ nhớ, 0 lần gọi mạng');
  // vendor chưa có (jszip) => tải rồi lưu, lần sau không gọi mạng
  await run('fetch',{request:{method:'GET',url:origin+'/vendor/jszip.min.js',headers:{has:()=>false},mode:'no-cors'}});
  hits.length=0;await run('fetch',{request:{method:'GET',url:origin+'/vendor/jszip.min.js',headers:{has:()=>false},mode:'no-cors'}});
  ok(hits.length===0&&ven.has(origin+'/vendor/jszip.min.js'),'vendor chưa có: tải 1 lần rồi lưu');
  // navigate khi OFFLINE => trả index đã lưu
  online=false;
  r=await run('fetch',{request:{method:'GET',url:origin+'/',headers:{has:()=>false},mode:'navigate'}});
  ok(r&&r.b==='x'||r&&r.b&&r.b.includes('assets/index'),'offline: mở app lần đầu vẫn có trang');
  r=await run('fetch',{request:{method:'GET',url:origin+'/legacy/50-d.js',headers:{has:()=>false},mode:'no-cors'}});
  ok(!!r,'offline: file legacy lấy từ bộ nhớ đã tải sẵn');
  online=true;
  // /api không bị can thiệp
  let handled=false;listeners.fetch({request:{method:'GET',url:origin+'/api/track',headers:{has:()=>false}},respondWith:()=>handled=true});
  ok(!handled,'/api/* đi thẳng ra mạng');
  process.exit(fail?1:0);
})();
