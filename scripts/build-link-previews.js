// Rebuild the static rich-preview images from the shared LinkPreview template (scripts/link-preview-template.js)
// with the bundled fonts and the outlined wordmark. CHROME_PATH may point to a locally installed Chromium browser.
import {readFile,mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {page as render,VISUALS,SURFACES,framePage} from './link-preview-template.js';
import {FRAMES} from '../lib/link-preview-photo.js';
const file=path=>readFile(new URL(path,import.meta.url));
const fonts={serif:(await file('../public/fonts/instrument-serif.ttf')).toString('base64'),sans:(await file('../public/fonts/bricolage-600.ttf')).toString('base64'),mono:(await file('../public/fonts/jetbrains-500.ttf')).toString('base64')};
const logo=(await file('../public/brand/wordmark.svg')).toString('utf8');
const photo='data:image/jpeg;base64,'+(await file('./link-preview-assets/home-shoe.jpg')).toString('base64');
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const tab=await browser.newPage();await tab.setViewport({width:1200,height:630,deviceScaleFactor:1});
 await mkdir(new URL('../public/brand/previews/',import.meta.url),{recursive:true});
 for(const surface of SURFACES){
  const visual=VISUALS[surface.visual]({photo,...surface.options});
  await tab.setContent(render({hazeKey:surface.haze,headline:surface.headline,visual,fonts,logo}),{waitUntil:'load'});
  await tab.evaluate(()=>document.fonts.ready);
  await tab.screenshot({path:new URL(`../public/brand/previews/${surface.file}`,import.meta.url).pathname});
  console.log('built',surface.file);
 }
 for(const kind of Object.keys(FRAMES)){
  const {width,height,html}=framePage(kind);
  await tab.setViewport({width,height,deviceScaleFactor:1});await tab.setContent(html,{waitUntil:'load'});
  await tab.screenshot({path:new URL(`../public/brand/previews/${FRAMES[kind].file}`,import.meta.url).pathname,omitBackground:true});
  console.log('built',FRAMES[kind].file);
 }
}finally{await browser.close();}
