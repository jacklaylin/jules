// LinkPreview: the one 1200×630 layout every rich iMessage preview uses (DESIGN-SYSTEM.md › Rich link
// previews; designed on the "iMessage link previews" Claude Design canvas). A haze background, the
// headline top-left in a 590px column, the logo bottom-left, and on the right what the link opens.
// No eyebrow. Copy never states prices, stock or counts as facts.
import {PHOTO_CARD,SET_CARDS,FRAMES,FRAME_MARGIN} from '../lib/link-preview-photo.js';

// Each haze is a base colour and brand-colour blobs scattered by a fixed seed, so a rebuild draws the
// same picture. Blobs keep to the right two-thirds; the two quiet ones on the left stay faint so the
// headline keeps its contrast.
export const HAZES={
 butter:['#fffaf0',[['#ffc93c',.55],['#ff8fc7',.45],['#ffc93c',.4],['#ff7a2f',.25],['#ffffff',.85]],11],
 daylight:['#ffffff',[['#ffe7a3',1],['#ffd3ea',.9],['#ffd98a',.6],['#ffe7a3',.8]],23],
 bubblegum:['#ffeff6',[['#ff8fc7',.8],['#ff8fc7',.6],['#6c3bff',.3],['#ffc93c',.4]],37],
 sherbet:['#fff0e6',[['#ff8fc7',.7],['#ff7a2f',.6],['#ffc93c',.55],['#ff8fc7',.5]],41],
 dusk:['#f4efff',[['#6c3bff',.4],['#ff8fc7',.7],['#ff7a2f',.35],['#ff8fc7',.5]],53],
 signup:['#fff4ee',[['#ff8fc7',.55],['#6c3bff',.3],['#ff7a2f',.45],['#ffc93c',.55]],67]
};

export function haze(key,blur=70){
 const [base,palette,seed]=HAZES[key];
 let s=seed*9973;const r=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};
 const pct=()=>Math.round(28+r()*44)+'%';
 const blobs=[];
 for(let i=0;i<9;i++){
  const [c,op]=palette[i%palette.length],quiet=i>=7;
  const w=quiet?14+r()*16:16+r()*30,x=quiet?-8+r()*36:32+r()*72-w/2,y=-35+r()*115,h=w*1.9*(0.55+r()*0.8);
  const rot=Math.round(r()*180),shape=[pct(),pct(),pct(),pct()].join(' ')+' / '+[pct(),pct(),pct(),pct()].join(' ');
  const o=+(op*(quiet?0.35:0.6+r()*0.4)).toFixed(2);
  blobs.push(`<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${w.toFixed(1)}%;height:${h.toFixed(1)}%;background:${c};opacity:${o};border-radius:${shape};transform:rotate(${rot}deg);filter:blur(${blur}px)"></i>`);
 }
 return {base,blobs:blobs.join('')};
}

const bar=(w,h,c,r=h/2)=>`<div style="height:${h}px;width:${w}%;border-radius:${r}px;background:${c}"></div>`;
const hanger=(size,stroke)=>`<svg viewBox="0 0 24 24" style="width:${size}px;height:${size}px" fill="none" stroke="#8a817a" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6a2 2 0 1 1 2 2c-1 0-2 .6-2 1.6v.4"/><path d="M12 10 3 16.5c-.8.6-.4 1.5.5 1.5h17c.9 0 1.3-.9.5-1.5L12 10Z"/></svg>`;
const bell='<svg viewBox="0 0 24 24" style="width:26px;height:26px" fill="none" stroke="#17120f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
const card=(style,inner)=>`<div class="card" style="${style}">${inner}</div>`;

// A product card as the wishlist draws it: photo slot, name and store bars. photo is a data URL or null.
const productCard=({left,top,rotate,w,h,photoH,photo,alert,saved,slot='#f3f1ee'})=>card(
 `left:${left}px;top:${top}px;width:${w}px;height:${h}px;padding:${w>300?18:16}px;transform:rotate(${rotate}deg);gap:12px;background:#fff`,
 `<div style="height:${photoH}px;border-radius:16px;background:${slot};position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center">`
 +(photo?`<img src="${photo}" style="width:100%;height:100%;object-fit:cover">`:saved?hanger(110,1.2):'')
 +(alert?`<div style="position:absolute;right:12px;top:12px;width:48px;height:48px;border-radius:50%;background:#ffc93c;box-shadow:0 3px 6px #17120f40;display:flex;align-items:center;justify-content:center">${bell}</div>`:'')
 +(saved?'<div class="tag">Saved</div>':'')+'</div>'
 +bar(76,13,'#17120f')+bar(38,13,'#8a817a'));

// The right-hand side of each surface. Shapes and blank bars only: nothing reads as a fact.
export const VISUALS={
 report:()=>card('left:700px;top:150px;width:250px;height:444px;padding:26px 24px;background:#ffc93c;transform:rotate(-11deg);gap:14px',
   bar(46,10,'#17120f',6)+'<div style="border-top:2px dashed #17120f66;margin:6px 0"></div>'
   +[58,44,66,50].map(w=>`<div style="display:flex;justify-content:space-between">${bar(w,10,'#17120fcc',6)}${bar(14,10,'#17120fcc',6)}</div>`).join(''))
  +card('left:812px;top:96px;width:250px;height:444px;padding:28px 24px;background:#ff8fc7;transform:rotate(-1deg);gap:22px',
   '<div class="card-title">How niche is your taste?</div><svg viewBox="0 0 200 110" style="width:100%;display:block"><path d="M14 100 A86 86 0 0 1 186 100" fill="none" stroke="#17120f33" stroke-width="18" stroke-linecap="round"/><path d="M14 100 A86 86 0 0 1 152 32" fill="none" stroke="#17120f" stroke-width="18" stroke-linecap="round"/></svg>')
  +card('left:930px;top:182px;width:250px;height:444px;padding:28px 24px;background:#fff;transform:rotate(9deg);gap:14px',
   '<div class="card-title" style="margin-bottom:8px">What’s in, what’s out?</div><div class="sans">in:</div>'+bar(90,13,'#17120f')+bar(68,13,'#17120f')
   +'<div class="sans" style="margin-top:8px">out:</div>'+bar(82,13,'#c9c3bd')+bar(60,13,'#c9c3bd')),
 home:({photo})=>`<div class="card chat" style="left:790px;top:64px;width:350px;height:640px;padding:24px 20px;border-radius:40px;background:#fff;transform:rotate(4deg);gap:6px">`
  +`<img src="${photo}" style="align-self:flex-end;width:240px;height:298px;object-fit:cover;border-radius:22px;background:#f3f1ee">`
  +'<div class="bubble sent">can you find these<br>in my size?</div>'
  +'<div class="bubble received">found the shoes in your size at three stores...</div></div>',
 style:()=>card('left:772px;top:120px;width:270px;height:470px;padding:30px 26px;background:#ffc93c;transform:rotate(-8deg);gap:14px',
   bar(88,30,'#17120f',8)+bar(64,30,'#17120f',8)+bar(76,30,'#17120f',8)+`<div style="margin-top:12px">${bar(50,10,'#17120f99',6)}</div>`)
  +card('left:922px;top:150px;width:270px;height:470px;padding:28px 24px;background:#fff;transform:rotate(6deg);gap:26px',
   '<div class="card-title" style="font-size:36px">Where do you sit on the spectrum?</div><div style="display:flex;flex-direction:column;gap:30px">'
   +[68,22,50].map(p=>`<div style="position:relative;height:10px;border-radius:999px;background:#e8e4e0"><div style="position:absolute;left:${p}%;top:-9px;width:28px;height:28px;border-radius:50%;background:#17120f"></div></div>`).join('')+'</div>'),
 // items: how many saved items the link holds (1–3); only the front card carries a photo.
 wishlist:({items=1,photo=null,alert=false}={})=>{
  if(items===1)return productCard({left:810,top:72,rotate:5,w:340,h:500,photoH:350,photo,alert});
  return SET_CARDS.slice(SET_CARDS.length-items).map((c,i,all)=>{const f=FRAMES[c.frame],front=i===all.length-1;
   return productCard({left:c.left,top:c.top,rotate:c.rotate,w:f.width,h:f.height,photoH:f.slotHeight,photo:front?photo:null,alert:front&&alert});}).join('');
 },
 none:()=>'',
 saved:()=>productCard({left:810,top:72,rotate:6,w:340,h:500,photoH:350,saved:true}),
 // The single save with a product photo: the card with an empty white slot; lib/link-preview-photo.js
 // places the photo in it, from the same numbers.
 savedPhoto:()=>productCard({left:PHOTO_CARD.left,top:PHOTO_CARD.top,rotate:PHOTO_CARD.rotate,w:PHOTO_CARD.width,h:PHOTO_CARD.height,photoH:PHOTO_CARD.slotHeight,slot:'#ffffff'})
};

export function page({hazeKey,headline,visual,fonts,logo}){
 const {base,blobs}=haze(hazeKey);
 const face=(family,data,weight)=>`@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${data}) format("truetype");font-weight:${weight}}`;
 const css=face('Instrument Serif',fonts.serif,400)+face('Bricolage Grotesque',fonts.sans,600)+face('JetBrains Mono',fonts.mono,500)
  +`*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden}`
  +`.frame{position:relative;width:1200px;height:630px;overflow:hidden;color:#17120f;font-family:"Instrument Serif",serif;background:${base}}`
  +`.haze{position:absolute;inset:0}.haze i{position:absolute;display:block}`
  +`.copy{position:absolute;left:72px;top:64px;bottom:60px;width:590px;display:flex;flex-direction:column;justify-content:space-between}`
  +`h1{margin:0;font-weight:400;font-size:112px;line-height:.9;letter-spacing:-.04em;text-wrap:balance}`
  +`.mark{position:relative;width:150px;height:109px}.mark svg{display:block;width:100%;height:100%}`
  +`.orb{position:absolute;left:0;top:9px;width:22px;height:22px;border-radius:50%;background:radial-gradient(at 65% 12%,#6c3bff,transparent 52%),radial-gradient(at 25% 30%,#ff8fc7,transparent 65%),linear-gradient(#ff8fc7,#ffc93c);box-shadow:0 0 14px 5px #ff8fc755}`
  +`.card{position:absolute;display:flex;flex-direction:column;border-radius:24px;box-shadow:0 22px 60px #17120f33}`
  +`.card-title{font-size:34px;line-height:.95;letter-spacing:-.04em}.sans{font:600 19px "Bricolage Grotesque",sans-serif}`
  +`.tag{position:absolute;left:14px;top:14px;padding:8px 16px;border-radius:999px;background:#ffc93c;box-shadow:0 3px 6px #17120f40;font:500 16px "JetBrains Mono",monospace;letter-spacing:.08em;text-transform:uppercase}`
  +`.chat{font:21px/1.24 -apple-system,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif}`
  +`.bubble{width:fit-content;max-width:262px;padding:8px 16px 9px;border-radius:21px}.sent{align-self:flex-end;background:#0a6bf0;color:#fff;white-space:nowrap}.received{align-self:flex-start;margin-top:14px;background:#e9e9eb;color:#000;text-wrap:balance}`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="frame">`
  +`<div class="haze">${blobs}</div>${visual}`
  +`<div class="copy"><h1>${headline}</h1><div class="mark">${logo}<span class="orb"></span></div></div></div></body></html>`;
}

// Every static preview: file name (versioned), haze, headline and the visual's options.
export const SURFACES=[
 {file:'home-v2.png',haze:'daylight',headline:'Have to have it? Text Jules.',visual:'home'},
 {file:'wishlist-v2.png',haze:'bubblegum',headline:'Your wishlist',visual:'wishlist',options:{items:3,photo:null}},
 {file:'style-v2.png',haze:'sherbet',headline:'Your style report is ready',visual:'style'},
 {file:'saved-v2.png',haze:'dusk',headline:'Added to your wishlist',visual:'saved'},
 {file:'report-v2.png',haze:'butter',headline:'A style report is in',visual:'report'},
 // The style report share without its headline: lib/report-preview.js draws the sharer's name on it.
 {file:'report-bg-v1.png',haze:'butter',headline:'',visual:'report'},
 {file:'saved-photo-bg-v1.png',haze:'bubblegum',headline:'Added to your wishlist',visual:'savedPhoto'},
 // A save of several items: the haze, headline and logo only; lib/link-preview-photo.js lays the cards on it.
 {file:'saved-set-bg-v1.png',haze:'bubblegum',headline:'Added to your wishlist',visual:'none'}
];

// Card frames for that save: one card, unturned, with an empty white slot and its shadow, on transparent.
export function framePage(kind){
 const f=FRAMES[kind],m=FRAME_MARGIN;
 return {width:f.width+2*m,height:f.height+2*m,html:`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:transparent}`
  +`.card{position:absolute;display:flex;flex-direction:column;border-radius:24px;box-shadow:0 22px 60px #17120f33}</style></head><body>`
  +productCard({left:m,top:m,rotate:0,w:f.width,h:f.height,photoH:f.slotHeight,slot:'#ffffff'})+'</body></html>'};
}
