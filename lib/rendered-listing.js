import {SOURCE_DOMAINS} from './retailers.js';
const cache=new Map();
const resources=[...SOURCE_DOMAINS,'contentstack.io','ynap.com','cloudfront.net'];
export function browserResourceURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&resources.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
export async function renderListing(url){
 if(!browserResourceURL(url)||!SOURCE_DOMAINS.some(d=>new URL(url).hostname===d||new URL(url).hostname.endsWith('.'+d)))throw Error('Unsupported merchant');
 if(process.platform!=='linux')throw Error('Hosted browser unavailable on this runtime');
 const cached=cache.get(url);if(cached&&Date.now()-cached.at<60000)return cached.value;
 const [{default:chromium},{default:puppeteer}]=await Promise.all([import('@sparticuz/chromium'),import('puppeteer-core')]);
 let browser;
 try{
  browser=await puppeteer.launch({args:puppeteer.defaultArgs({args:chromium.args,headless:'shell'}),executablePath:await chromium.executablePath(),headless:'shell',timeout:15000});
  const page=await browser.newPage();await page.setRequestInterception(true);
  page.on('request',request=>{if(browserResourceURL(request.url())&&!['font','media'].includes(request.resourceType()))void request.continue();else void request.abort();});
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
  if(!response?.ok()||!browserResourceURL(page.url()))throw Error('Browser listing blocked');
  await page.waitForFunction(()=>document.querySelector('script[type="application/ld+json"]'),{timeout:10000});
  const html=await page.evaluate(()=>[...document.querySelectorAll('script[type="application/ld+json"],meta,link[rel="canonical"]')].map(el=>el.outerHTML).join('\n'));
  if(Buffer.byteLength(html)>1500000)throw Error('Rendered listing too large');
  const value={html,url:page.url(),retrieval:'browser'};cache.set(url,{at:Date.now(),value});if(cache.size>20)cache.delete(cache.keys().next().value);
  console.log(JSON.stringify({event:'listing_browser_recovered',host:new URL(url).hostname}));return value;
 }finally{await browser?.close();}
}
