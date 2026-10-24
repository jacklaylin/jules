// Carousel slides for the Jules social accounts (docs/social/README.md). Each slide is a small HTML page in
// the shared brand (tokens from public/design-system.css, local fonts, the outlined wordmark) screenshotted
// to JPEG: 9:16 for TikTok, 4:5 for the Instagram feed. Pages load nothing from the network.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const font=name=>pathToFileURL(path.join(ROOT,'public/fonts',name)).href;
const WORDMARK=readFileSync(path.join(ROOT,'public/brand/wordmark.svg'),'utf8');
// CSS size of each format; screenshots are taken at 3x, so 360 wide becomes 1080.
export const FORMATS={tiktok:{width:360,height:640},instagram:{width:360,height:450}};
const GROUNDS={butter:['#FFC93C','#17120F'],grape:['#6C3BFF','#FFFFFF'],ink:['#17120F','#FFFFFF'],tangerine:['#FF7A2F','#17120F'],bubblegum:['#FF8FC7','#17120F'],white:['#FFFFFF','#17120F']};
export const GROUND_NAMES=Object.keys(GROUNDS);

const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
// *word* in slide copy is set in the serif italic accent, the way the report cards emphasize a phrase.
const rich=s=>esc(s).replace(/\*([^*]+)\*/g,'<em>$1</em>');
const mark=(color)=>`<div class="mark">${WORDMARK.replace(/fill="#17120F"/g,`fill="${color}"`)}</div>`;

// A chat message: text, a photo from the repo, or a stand-in tile for a photo the person sent ("a TikTok
// screenshot"), drawn as a tile so an example never passes off someone's real photo as ours.
const bubble=m=>{
 const side=m.from==='jules'?'in':'out';
 if(m.image)return `<img class="bubble-photo ${side}" src="${pathToFileURL(path.resolve(ROOT,m.image)).href}" alt="">`;
 if(m.tile)return `<p class="bubble-tile ${side}"><span class="label">Photo</span>${esc(m.tile)}</p>`;
 return `<p class="bubble ${side}">${esc(m.text)}</p>`;
};

function body(slide,{tall}){
 switch(slide.kind){
  case 'hook':return `<main class="hook"><h1>${rich(slide.text)}</h1>${slide.sub?`<p class="sub">${rich(slide.sub)}</p>`:''}</main>`;
  case 'card':return `<main class="card">${slide.label?`<p class="label">${esc(slide.label)}</p>`:''}<h2>${rich(slide.title)}</h2>${slide.body?`<p class="body">${rich(slide.body)}</p>`:''}</main>`;
  case 'list':return `<main class="list"><h2>${rich(slide.title)}</h2><ol>${slide.items.map(i=>`<li><span>${rich(i)}</span></li>`).join('')}</ol></main>`;
  case 'chat':return `<main class="chat"><header class="contact"><span class="orb"></span><b>jules</b>${slide.illustrative?'<span class="label">Example conversation</span>':''}</header><div class="thread">${slide.messages.map(bubble).join('')}</div>${slide.caption?`<p class="body">${rich(slide.caption)}</p>`:''}</main>`;
  case 'photo':return `<main class="photo"><img src="${pathToFileURL(path.resolve(ROOT,slide.image)).href}" alt="">${slide.caption?`<p class="body">${rich(slide.caption)}</p>`:''}</main>`;
  case 'cta':return `<main class="cta"><h2>${rich(slide.text||'What would *yours* say?')}</h2><p class="body">${esc(slide.sub||'Text Jules for your own style report. Free while in early access.')}</p><p class="url">textjules.com</p></main>`;
  default:throw Error(`Unknown slide kind: ${slide.kind}`);
 }
}

// One slide as a standalone page. On 9:16 the right edge keeps clear of TikTok's buttons. index/total draw the small progress ticks a swipeable post shows.
export function slideHtml(slide,{format='tiktok',index=0,total=1}={}){
 const {width,height}=FORMATS[format];
 const [bg,fg]=GROUNDS[slide.kind==='chat'?'white':slide.ground||'butter']??GROUNDS.butter;
 const tall=height/width>1.5;
 return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:B;src:url("${font('bricolage-400.ttf')}");font-weight:400}
@font-face{font-family:B;src:url("${font('bricolage-600.ttf')}");font-weight:600}
@font-face{font-family:B;src:url("${font('bricolage-800.ttf')}");font-weight:800}
@font-face{font-family:S;src:url("${font('instrument-serif.ttf')}")}
@font-face{font-family:M;src:url("${font('jetbrains-500.ttf')}")}
*{box-sizing:border-box;margin:0}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:${bg};color:${fg};font-family:B,system-ui,sans-serif;display:flex;flex-direction:column;padding:${tall?'64px 56px 40px 28px':'34px 26px 26px'}}
main{flex:1;display:flex;flex-direction:column;justify-content:center;gap:${tall?18:12}px}
em{font-family:S,serif;font-style:italic;font-weight:400}
h1{font-weight:800;font-size:${tall?46:40}px;line-height:1.02;letter-spacing:-.02em}
h2{font-weight:800;font-size:${tall?36:30}px;line-height:1.05;letter-spacing:-.01em}
.sub,.body{font-size:${tall?18:16}px;line-height:1.4;opacity:.9}
.label{font-family:M,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
ol{padding-left:0;list-style:none;counter-reset:n;display:flex;flex-direction:column;gap:${tall?14:9}px}
li{counter-increment:n;font-size:${tall?19:16}px;line-height:1.3;display:flex;gap:12px}
li::before{content:counter(n);font-family:S,serif;font-size:1.5em;line-height:.9;min-width:20px}
.chat{background:linear-gradient(160deg,#FFF4EE,#FFE3F1 50%,#ECE4FF)}
body:has(.chat){padding:0}.chat{padding:${tall?'64px 22px 40px':'30px 20px 20px'}}
.thread{display:flex;flex-direction:column;gap:6px;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}
.bubble{font-size:15px;line-height:1.3;padding:8px 13px;border-radius:18px;max-width:80%;white-space:pre-line}
.contact{display:flex;align-items:center;gap:8px;margin-bottom:${tall?14:6}px;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;font-size:14px}
.contact .label{margin-left:auto}
.orb{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff 0,#fff0 25%),radial-gradient(circle at 35% 35%,#FFC93C,#FF8FC7 45%,#FF7A2F 70%,#6C3BFF)}
.bubble-photo{width:150px;border-radius:16px}.bubble-photo.out,.bubble-tile.out{align-self:flex-end}.bubble-photo.in,.bubble-tile.in{align-self:flex-start}
.bubble-tile{width:150px;height:${tall?180:120}px;border-radius:16px;background:#D9D4CF;color:#4A433D;font-size:12px;line-height:1.3;padding:12px;display:flex;flex-direction:column;justify-content:flex-end;gap:6px}
.bubble.out{align-self:flex-end;background:#0A6BF0;color:#fff}
.bubble.in{align-self:flex-start;background:#E9E9EB;color:#000}
.photo img{width:100%;max-height:${tall?440:290}px;object-fit:contain;border-radius:18px}
.url{font-family:M,monospace;font-size:16px;margin-top:8px}
.cta h2{font-size:${tall?44:36}px}
footer{display:flex;align-items:center;justify-content:space-between;padding-top:12px}
body:has(.chat) footer{padding:0 22px ${tall?40:20}px;background:#ECE4FF}
.mark{height:30px}.mark svg{height:100%;width:auto}
.ticks{display:flex;gap:4px}.ticks span{width:14px;height:3px;border-radius:2px;background:currentColor;opacity:.3}.ticks span.on{opacity:1}
</style></head><body>${body(slide,{tall})}<footer>${mark(slide.kind==='chat'?'#17120F':fg)}${total>1?`<div class="ticks">${Array.from({length:total},(_,i)=>`<span class="${i===index?'on':''}"></span>`).join('')}</div>`:''}</footer></body></html>`;
}

// A local Chrome: CHROME_PATH, the cloud container's Playwright Chromium, or Chrome on a Mac.
export function chromePath(env=process.env){
 if(env.CHROME_PATH)return env.CHROME_PATH;
 const pw='/opt/pw-browsers';
 if(existsSync(pw))for(const dir of readdirSync(pw).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse()){const bin=path.join(pw,dir,'chrome-linux64/chrome');if(existsSync(bin))return bin;}
 const mac='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 if(existsSync(mac))return mac;
 throw Error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
}

// Renders every slide of a post in both formats. Returns {tiktok:[paths],instagram:[paths]}.
export async function renderPost(post,outDir,{browser}){
 const out={tiktok:[],instagram:[]};
 for(const format of Object.keys(FORMATS)){
  const {width,height}=FORMATS[format];
  for(const [index,slide] of post.slides.entries()){
   const page=await browser.newPage();
   try{
    await page.setViewport({width,height,deviceScaleFactor:3});
    await page.setContent(slideHtml(slide,{format,index,total:post.slides.length}),{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);
    const file=path.join(outDir,`${post.id}-${format}-${String(index+1).padStart(2,'0')}.jpg`);
    await page.screenshot({path:file,type:'jpeg',quality:92,clip:{x:0,y:0,width,height}});
    out[format].push(file);
   }finally{await page.close();}
  }
 }
 return out;
}
