import {browserLaunchOptions} from './rendered-listing.js';
import {sharedView,SHARE_TOKEN} from './style-report.js';
import {json} from './http.js';

// One card of a shared style report as a 1080×1920 PNG, for an Instagram Story (founder, 16 Oct: one
// share sheet everywhere, Story first). The image is a screenshot of the share link's own page in export
// mode (/r/<link>?export=<card>), so it shows exactly what a friend would see: only shared cards, written
// about the person, never anything private.
const W=360,H=640,SCALE=3;
let browser=null;
// A warm function keeps its browser, so the next card (the end screen shares them all) skips the launch.
async function openBrowser(){
 if(browser?.connected)return browser;
 const [{default:chromium},{default:puppeteer}]=await Promise.all([import('@sparticuz/chromium-min'),import('puppeteer-core')]);
 browser=await puppeteer.launch(await browserLaunchOptions(puppeteer,chromium));
 return browser;
}
export async function renderReportCard(origin,token,card){
 if(process.platform!=='linux')throw Error('Hosted browser unavailable on this runtime');
 const page=await (await openBrowser()).newPage();
 try{
  await page.setViewport({width:W,height:H,deviceScaleFactor:SCALE});
  // Only this site: the page, its scripts, styles, fonts and the person's own card images.
  await page.setRequestInterception(true);
  page.on('request',request=>{const url=request.url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('https://fonts.googleapis.com/')||url.startsWith('https://fonts.gstatic.com/'))void request.continue();else void request.abort();});
  await page.goto(`${origin}/r/${token}?export=${encodeURIComponent(card)}`,{waitUntil:'networkidle0',timeout:15000});
  // The page says when the card is drawn with its fonts and images, or that it has no such card.
  const state=await page.waitForFunction(()=>document.documentElement.dataset.export,{timeout:10000}).then(h=>h.jsonValue());
  if(state!=='ready')throw Object.assign(Error('No such card.'),{status:404});
  return Buffer.from(await page.screenshot({type:'png',clip:{x:0,y:0,width:W,height:H}}));
 }finally{await page.close().catch(()=>{});}
}

// GET /api/image?report=<link>&card=<type>: public like the share link itself, and only for a card the
// share view shows.
export async function handleReportImage(req,res,{store,env,render=renderReportCard}){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return json(res,405,{error:'Method not allowed.'});}
 const params=new URL(req.url,'https://jules.invalid').searchParams,token=params.get('report')??'',card=params.get('card')??'';
 const gone=()=>json(res,404,{error:'This card isn’t shared.'});
 if(!SHARE_TOKEN.test(token)||!/^[a-z]{2,20}$/.test(card))return gone();
 const row=await store.reportByShareToken(token);
 if(!row?.report||row.report.share?.token!==token||!sharedView(row.report).cards.some(c=>c.type===card))return gone();
 const origin=(env.SITE_ORIGIN||`https://${req.headers?.host}`).replace(/\/$/,'');
 const started=Date.now();
 try{
  const png=await render(origin,token,card);
  console.log(JSON.stringify({event:'style_report_image',card,ms:Date.now()-started}));
  res.statusCode=200;res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','private, max-age=60');res.setHeader('X-Robots-Tag','noindex');
  return res.end(png);
 }catch(error){
  console.log(JSON.stringify({event:'style_report_image_failed',card,ms:Date.now()-started,reason:String(error.message).slice(0,200)}));
  if(error.status===404)return gone();
  // A browser that failed mid-render isn't reused.
  await browser?.close().catch(()=>{});browser=null;
  return json(res,503,{error:'Couldn’t make the image. Try again.'});
 }
}
