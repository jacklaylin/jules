// Manual browser check (needs local Chrome; not part of npm test). Headless check of the wardrobe page: rapid thumbs answers on many cards, out-of-order responses and a
// background photo search returning older views. Usage: node scripts/wardrobe-rapid-thumbs.mjs public
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const sharp=require('sharp'),puppeteer=require('puppeteer-core');
const root=process.argv[2];
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json'};
const jpg=await sharp({create:{width:500,height:500,channels:3,background:'#333'}}).jpeg().toBuffer();
const N=8,answers=new Map();let suggestCalls=0;const photoHits={};
const item=(i,answer)=>({id:'i'+i,brand:'Brand',product:'Item '+i,merchant:'store.com',size:'M',color:'Black',category:'tops',bought_at:`2026-09-${String(10+i).padStart(2,'0')}T00:00:00Z`,
 photo:answer==='yes',photo_source:answer==='yes'?'search_confirmed':null,photo_version:answer==='yes'?'v-yes':null,photo_small:false,suggestion:answer?null:{seller:'Store',version:'s1'},parts:[]});
const view=snapshot=>({status:'done',connections:{gmail:true,shop:false},text_url:null,questions:[],removed:[],items:Array.from({length:N},(_,i)=>item(i,snapshot.get('i'+i)))});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer(async(q,s)=>{
 const u=new URL(q.url,'http://x');
 if(u.pathname==='/api/wishlist'&&u.searchParams.get('wardrobe')==='1'){
  if(q.method==='GET'&&(u.searchParams.has('photo')||u.searchParams.has('suggestion'))){const k=[...u.searchParams.keys()].find(k=>k==='photo'||k==='suggestion')+':'+(u.searchParams.get('photo')??u.searchParams.get('suggestion'));photoHits[k]=(photoHits[k]??0)+1;await sleep(80);s.writeHead(200,{'content-type':'image/jpeg'});return s.end(jpg);}
  if(q.method==='POST'){let body='';for await(const c of q)body+=c;const input=JSON.parse(body||'{}');
   if(input.action==='photo'){const snapshotBefore=new Map(answers);answers.set(input.item_id,input.answer);const after=new Map(answers);await sleep(100+Math.random()*900);
    // The response reflects the server at the time it answered (all answers so far).
    s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify(view(after)));}
   if(input.action==='suggest_photos'){suggestCalls++;const stale=new Map(answers);await sleep(1500);s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify({...view(stale),photo_search:{remaining:suggestCalls<4?5:0}}));}
  }
  s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify(view(new Map(answers))));
 }
 if(u.pathname.startsWith('/api/')){s.writeHead(404,{'content-type':'application/json'});return s.end('{}');}
 const p=u.pathname==='/wardrobe'?'/wardrobe.html':u.pathname;
 try{const d=await readFile(path.join(root,p));s.writeHead(200,{'content-type':types[path.extname(p)]??'application/octet-stream'});s.end(d);}catch{s.writeHead(404);s.end();}
});
await new Promise(r=>server.listen(0,r));const port=server.address().port;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-first-run']});
const page=await browser.newPage();await page.setViewport({width:1280,height:2400});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto(`http://127.0.0.1:${port}/wardrobe#access_token=t&refresh_token=r&expires_in=3600`,{waitUntil:'networkidle0'});
await page.waitForSelector('.suggest-thumb');await sleep(400);
// Watch for any photo frame going back to the placeholder after load, and any pill reappearing after its answer.
await page.evaluate(()=>{window.__flash=0;window.__reask=[];window.__answered=new Set();
 new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes){if(n.nodeType!==1)continue;
  if(n.matches?.('.photo.skeleton')||n.querySelector?.('.photo.skeleton'))window.__flash++;
  const id=n.querySelector?.('.tile strong')?.textContent;if(id&&window.__answered.has(id)&&n.querySelector('.suggest-pill'))window.__reask.push(id);}}).observe(document.getElementById('grid'),{childList:true,subtree:true});});
// Rapid answers: alternate yes/no across all cards, ~60ms apart, without waiting for responses.
const plan=Array.from({length:N},(_,i)=>i%3===0?'no':'yes');
for(let i=0;i<N;i++){
 const name='Item '+i;
 await page.evaluate((name,answer)=>{const card=[...document.querySelectorAll('.product-card')].find(c=>c.querySelector('.tile strong')?.textContent===name);
  const b=card?.querySelectorAll('.suggest-thumb')[answer==='yes'?1:0];window.__answered.add(name);b?.click();return Boolean(b);},name,plan[i]);
 await sleep(60);
}
await sleep(6000);
const result=await page.evaluate(()=>({flash:window.__flash,reask:window.__reask,
 cards:[...document.querySelectorAll('.product-card')].map(c=>({name:c.querySelector('.tile strong')?.textContent,pill:Boolean(c.querySelector('.suggest-pill')),photo:Boolean(c.querySelector('.photo img')),skeleton:Boolean(c.querySelector('.photo.skeleton')),outline:Boolean(c.querySelector('.outline-photo'))}))}));
console.log(JSON.stringify({plan,serverAnswers:Object.fromEntries(answers),photoHits,suggestCalls,errors,...result},null,1));
await browser.close();server.close();
