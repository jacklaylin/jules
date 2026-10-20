import {SOURCE_DOMAINS} from './retailers.js';
import {publicURL} from './public-url.js';
const cache=new Map();
const resources=[...SOURCE_DOMAINS,'contentstack.io','ynap.com','cloudfront.net','img.ssensemedia.com'];
export async function browserLaunchOptions(puppeteer,chromium){
 return {args:await puppeteer.defaultArgs({args:chromium.args,headless:'shell'}),executablePath:await chromium.executablePath('https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'),headless:'shell',timeout:15000};
}
export function browserResourceURL(value,extra=[]){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&[...resources,...extra].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
// The store's own site (shop-us.doverstreetmarket.com -> doverstreetmarket.com; www.vitkac.com -> vitkac.com),
// so a store outside the registry can be rendered with its own assets and nothing else.
export function storeSite(url){
 const labels=new URL(url).hostname.toLowerCase().split('.');
 const keep=labels.length>2&&/^(?:co|com|net|org)$/.test(labels.at(-2))&&labels.at(-1).length===2?3:2;
 return labels.slice(-keep).join('.');
}
// One browser per function instance, shared by every page check: launching Chromium (and, on a cold
// start, unpacking it) took seconds per page, and parallel searches launched several at once. Each
// check gets its own tab, closed when the check ends. Tabs share the default context: serverless
// Chromium runs with --single-process, where opening a page in a second browser context crashes the
// browser ("Target.createTarget: Target closed").
let shared=null;
async function sharedBrowser(){
 const current=await shared?.catch(()=>null);
 if(current?.connected)return current;
 shared=(async()=>{
  const [{default:chromium},{default:puppeteer}]=await Promise.all([import('@sparticuz/chromium-min'),import('puppeteer-core')]);
  const browser=await puppeteer.launch(await browserLaunchOptions(puppeteer,chromium));
  browser.on('disconnected',()=>{shared=null;});
  console.log(JSON.stringify({event:'listing_browser_launched'}));
  return browser;
 })();
 shared.catch(()=>{shared=null;});
 return shared;
}
const freshPage=browser=>{let timer;return Promise.race([browser.newPage(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser not responding')),3000);})]).finally(()=>clearTimeout(timer));};
// Starts the shared browser early (for example while the stylist is thinking), so the first page
// check doesn't wait for Chromium. Only on the hosted runtime; failures surface on the real check.
export function warmBrowser(){if(process.platform==='linux')sharedBrowser().catch(()=>{});}
// At most four pages render at once; more only compete for the function's CPU.
const PAGE_SLOTS=4;let open=0;const waiting=[];
function pageSlot(signal){
 const take=()=>{open++;let done=false;return ()=>{if(done)return;done=true;open--;waiting.shift()?.();};};
 if(open<PAGE_SLOTS)return Promise.resolve(take());
 return new Promise((resolve,reject)=>{
  const ready=()=>{signal?.removeEventListener('abort',cancel);resolve(take());};
  const cancel=()=>{const i=waiting.indexOf(ready);if(i>=0)waiting.splice(i,1);reject(signal.reason??Error('Aborted'));};
  waiting.push(ready);signal?.addEventListener('abort',cancel,{once:true});
 });
}
export async function renderListing(url,{signal}={}){
 signal?.throwIfAborted();
 // Any public store page: a page check reaches the browser only after the store answered our request.
 if(!publicURL(url))throw Error('Unsupported merchant');
 const site=[storeSite(url)],allowed=value=>browserResourceURL(value,site);
 if(process.platform!=='linux')throw Error('Hosted browser unavailable on this runtime');
 const cached=cache.get(url);if(cached&&Date.now()-cached.at<60000)return cached.value;
 let page,response,release=()=>{};const blockedHosts=new Set();
 // An abort closes only this page; the shared browser keeps serving other checks.
 const abort=()=>{void page?.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  release=await pageSlot(signal);
  let browser=await sharedBrowser();signal?.throwIfAborted();
  // A browser kept from an earlier, frozen invocation can look connected but no longer answer: one
  // that can't open a page within 3 seconds is replaced once.
  page=await freshPage(browser).catch(async()=>{shared=null;void browser.close().catch(()=>{});browser=await sharedBrowser();return browser.newPage();});signal?.throwIfAborted();
  await page.setViewport({width:1365,height:900});await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome/','Chrome/'));await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});await page.setRequestInterception(true);
  page.on('request',request=>{if(allowed(request.url())&&!['font','media'].includes(request.resourceType()))void request.continue();else{try{blockedHosts.add(new URL(request.url()).hostname);}catch{}void request.abort();}});
  if(new URL(url).hostname.replace(/^www\./,'')==='satisfyrunning.com'&&!/^\/[a-z]{2}(?:-[a-z]{2})?\//i.test(new URL(url).pathname)&&!['country','currency','market'].some(key=>new URL(url).searchParams.has(key)))await page.setCookie({name:'localization',value:'US',url:new URL(url).origin,secure:true});
  response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
  if(response?.status()===404||!allowed(page.url()))throw Error('Browser listing missing');
  await page.waitForFunction(()=>document.querySelector('script[type="application/ld+json"]'),{timeout:10000});
  const html=await page.evaluate(()=>[...document.querySelectorAll('script[type="application/ld+json"],meta,link[rel="canonical"],select#size-dropdown,select.select-size')].map(el=>el.outerHTML).join('\n'));
  if(Buffer.byteLength(html)>1500000)throw Error('Rendered listing too large');
  const value={html,url:page.url(),retrieval:'browser'};cache.set(url,{at:Date.now(),value});if(cache.size>20)cache.delete(cache.keys().next().value);
  console.log(JSON.stringify({event:'listing_browser_recovered',host:new URL(url).hostname}));return value;
 }catch(error){console.log(JSON.stringify({event:'listing_browser_failed',host:new URL(url).hostname,reason:String(error.message).slice(0,250),http_status:response?.status(),title:await page?.title().catch(()=>null),blocked_hosts:[...blockedHosts].slice(0,20)}));throw error;}finally{signal?.removeEventListener('abort',abort);await page?.close().catch(()=>{});release();}
}
