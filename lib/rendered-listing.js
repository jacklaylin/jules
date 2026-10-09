import {SOURCE_DOMAINS} from './retailers.js';
const cache=new Map();
const resources=[...SOURCE_DOMAINS,'contentstack.io','ynap.com','cloudfront.net','img.ssensemedia.com'];
export async function browserLaunchOptions(puppeteer,chromium){
 return {args:await puppeteer.defaultArgs({args:chromium.args,headless:'shell'}),executablePath:await chromium.executablePath('https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'),headless:'shell',timeout:15000};
}
export function browserResourceURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&resources.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
export async function renderListing(url){
 if(!browserResourceURL(url)||!SOURCE_DOMAINS.some(d=>new URL(url).hostname===d||new URL(url).hostname.endsWith('.'+d)))throw Error('Unsupported merchant');
 if(process.platform!=='linux')throw Error('Hosted browser unavailable on this runtime');
 const cached=cache.get(url);if(cached&&Date.now()-cached.at<60000)return cached.value;
 const [{default:chromium},{default:puppeteer}]=await Promise.all([import('@sparticuz/chromium-min'),import('puppeteer-core')]);
 let browser,page,response;const blockedHosts=new Set();
 try{
  browser=await puppeteer.launch(await browserLaunchOptions(puppeteer,chromium));
  page=await browser.newPage();await page.setViewport({width:1365,height:900});await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome/','Chrome/'));await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});await page.setRequestInterception(true);
  page.on('request',request=>{if(browserResourceURL(request.url())&&!['font','media'].includes(request.resourceType()))void request.continue();else{try{blockedHosts.add(new URL(request.url()).hostname);}catch{}void request.abort();}});
  response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
  if(response?.status()===404||!browserResourceURL(page.url()))throw Error('Browser listing missing');
  await page.waitForFunction(()=>document.querySelector('script[type="application/ld+json"]'),{timeout:10000});
  const html=await page.evaluate(()=>[...document.querySelectorAll('script[type="application/ld+json"],meta,link[rel="canonical"]')].map(el=>el.outerHTML).join('\n'));
  if(Buffer.byteLength(html)>1500000)throw Error('Rendered listing too large');
  const value={html,url:page.url(),retrieval:'browser'};cache.set(url,{at:Date.now(),value});if(cache.size>20)cache.delete(cache.keys().next().value);
  console.log(JSON.stringify({event:'listing_browser_recovered',host:new URL(url).hostname}));return value;
 }catch(error){console.log(JSON.stringify({event:'listing_browser_failed',host:new URL(url).hostname,reason:String(error.message).slice(0,250),http_status:response?.status(),title:await page?.title().catch(()=>null),blocked_hosts:[...blockedHosts].slice(0,20)}));throw error;}finally{await browser?.close();}
}
