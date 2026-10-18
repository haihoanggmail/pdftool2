const ROOT=require('path').resolve(__dirname,'..')+'/';
const fs=require('fs'),vm=require('vm');
const PUB=ROOT+'public/';
const order=[],queue=[];
const body={nodeType:1,firstChild:null,getAttribute(){return null},closest(){return null},querySelectorAll(){return[]},prepend(){}};
const ctx={console,setTimeout,clearTimeout,Promise,localStorage:{getItem:()=>null,setItem:()=>{}},navigator:{language:'vi'},MutationObserver:function(){this.observe=()=>{}},WeakMap};
ctx.window=ctx;ctx.globalThis=ctx;
ctx.document={readyState:'complete',documentElement:{lang:'',getAttribute:()=>'light'},body,getElementById:()=>null,addEventListener(){},createTreeWalker:()=>({nextNode:()=>null}),
  createElement:()=>({style:{},appendChild(){},setAttribute(){}}),
  head:{appendChild:(s)=>{ if(s.src){ queue.push(s)} }}};
vm.createContext(ctx);
setInterval(()=>{ while(queue.length){ const s=queue.shift(); order.push(s.src); vm.runInContext(fs.readFileSync(PUB+s.src,'utf8'),ctx); s.onload(); } },10).unref();
vm.runInContext(fs.readFileSync(PUB+'legacy/80-g.js','utf8'),ctx);
(async()=>{
  const I=ctx.PDFTOOL_I18N; let ok=true;
  console.log('khởi động: gói dịch đã tải =',order.length,'(mong 0)'); ok&&=order.length===0;
  I.setLang('vi'); console.log('chọn vi: đã tải =',order.length,'(mong 0)'); ok&&=order.length===0;
  I.setLang('en'); console.log('ngay sau chọn en: lang =',I.lang,'(mong vi - đang tải gói)'); ok&&=I.lang==='vi';
  await new Promise(r=>setTimeout(r,150));
  console.log('sau khi tải xong: lang =',I.lang,'; thứ tự nạp:',order.map(x=>x.split('/').pop()).join(' > ')); ok&&=I.lang==='en'&&order.length===5;
  ok&&=order.join()===['legacy/90-i18n-a.js','legacy/91-i18n-b.js','legacy/92-i18n-ribbon.js','legacy/93-i18n-ui.js','legacy/94-i18n-v2.js'].join();
  I.setLang('fr'); await new Promise(r=>setTimeout(r,30)); console.log('đổi sang fr: lang =',I.lang,'; tải thêm =',order.length-5,'(mong 0)'); ok&&=I.lang==='fr'&&order.length===5;
  console.log(ok?'ALL OK':'FAIL'); process.exit(ok?0:1);
})();
