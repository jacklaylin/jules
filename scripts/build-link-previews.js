// Rebuild static preview art with the bundled font and outlined brand mark.
// CHROME_PATH may point to a locally installed Chromium browser.
import {readFile, mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const font=(await readFile(new URL('../public/fonts/instrument-serif.ttf',import.meta.url))).toString('base64');
const logo=await readFile(new URL('../public/brand/wordmark.svg',import.meta.url),'utf8');
const mark=`<div class="mark">${logo}<span class="orb"></span></div>`;
const css=`@font-face{font-family:Instrument;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;color:#17120f;font-family:Instrument}.mark{position:relative;width:300px;height:217px}.mark svg{width:100%;height:100%;overflow:visible}.orb{position:absolute;left:0;top:8%;width:14.5%;aspect-ratio:1;border-radius:50%;background:radial-gradient(at 65% 12%,#6c3bff,transparent 52%),radial-gradient(at 25% 30%,#ff8fc7,transparent 65%),linear-gradient(#ff8fc7,#ffc93c);box-shadow:0 0 13px 5px #ff8fc755}.style{background:#ffcf36;display:flex;align-items:center;justify-content:center}.fallback{background:radial-gradient(ellipse at 73% 19%,#fff0c6 0,transparent 47%),radial-gradient(ellipse at 95% 100%,#ffe4f2 0,transparent 38%),white;padding:174px 80px 60px}.headline{font-size:150px;line-height:1.02;letter-spacing:-5px;white-space:nowrap}.second{display:flex;align-items:baseline;font-size:150px;line-height:1;letter-spacing:-5px;gap:12px}.second .mark{width:225px;height:163px;transform:translateY(39px);margin-top:-22px}.period{margin-left:-12px}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:1200,height:630,deviceScaleFactor:1});
 await mkdir(new URL('../public/brand/previews/',import.meta.url),{recursive:true});
 for(const [name,body] of [['fallback','<div class="headline">Have to have it?</div><div class="second">Text '+mark+'<span class="period">.</span></div>'],['style',mark]]){
  await page.setContent(`<style>${css}</style><body class="${name}">${body}</body>`);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:new URL(`../public/brand/previews/${name}-v1.png`,import.meta.url).pathname});
 }
}finally{await browser.close();}
