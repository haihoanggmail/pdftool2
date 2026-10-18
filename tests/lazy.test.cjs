const ROOT=require('path').resolve(__dirname,'..')+'/';
const fs=require('fs'),vm=require('vm');
const PUB=ROOT+'public/';
const ctx={console,setTimeout,clearTimeout,TextEncoder,TextDecoder,Buffer,atob,btoa};
ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;
const log=[];
ctx.XMLHttpRequest=function(){this.open=(m,u,a)=>{this.u=u;this.a=a};this.send=()=>{log.push('SYNC '+this.u);try{this.responseText=fs.readFileSync(PUB+this.u,'utf8');this.status=200}catch(e){this.status=404}}};
ctx.document={createElement:()=>({}),head:{appendChild:(s)=>{ if(s.text){vm.runInContext(s.text,ctx);} else if(s.src){log.push('ASYNC '+s.src); setTimeout(()=>{vm.runInContext(fs.readFileSync(PUB+s.src,'utf8'),ctx);s.onload&&s.onload()},5)} },removeChild:()=>{}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(PUB+'legacy/04-lazy-libs.js','utf8'),ctx);
const run=c=>vm.runInContext(c,ctx);
let fail=0;const ok=(c,m)=>{if(!c){fail++;console.log('FAIL',m)}else console.log('ok  ',m)};
ok(log.length===0,'không tải gì khi khởi động');
ok(run("typeof window.PDFLazy")==='object','PDFLazy có sẵn');
(async()=>{
  // async: tải fonts rồi đọc đồng bộ không cần XHR
  await run('PDFLazy.fonts()');
  ok(log.filter(x=>x.startsWith('ASYNC')).length===1,'tải async fonts-data.js đúng 1 lần');
  run('PDFLazy.fonts()'); await run('PDFLazy.fonts()');
  ok(log.filter(x=>x.startsWith('ASYNC')).length===1,'gọi lại không tải lần 2');
  ok(run("typeof window.EMBEDDED_ROBOTO.regular")==='string' && run("Object.keys(window.EMBEDDED_FONTS).length")===5,'dữ liệu font có đủ sau khi tải');
  ok(log.filter(x=>x.startsWith('SYNC')).length===0,'đọc dữ liệu sau khi tải không cần XHR đồng bộ');
  // fontkit: đọc đồng bộ khi chưa tải -> tự tải
  ok(run("typeof fontkit")!=='undefined' ,'đọc fontkit tự tải đồng bộ (dự phòng)');
  ok(log.filter(x=>x.startsWith('SYNC')).length===1,'chỉ 1 lần XHR đồng bộ');
  run("typeof fontkit"); ok(log.filter(x=>x.startsWith('SYNC')).length===1,'đọc lại fontkit không tải lại');
  // prefetchForTab
  const n=log.length; run("PDFLazy.prefetchForTab('tab-merge')"); ok(log.length===n,'tab gộp không tải font');
  process.exit(fail?1:0);
})();
