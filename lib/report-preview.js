import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {SHARE_TOKEN} from './style-report.js';
import {firstName} from './memory.js';
import {loadFont,headlineSvg,reportHeadline} from './link-preview-headline.js';

// GET /api/image?share_preview=<link>: the iMessage preview image for a shared style report, with the
// sharer's first name in the headline ("William’s style report is in"). Public like the share link; it
// shows only the first name the page title already shows. A link that is off, a missing name, or a name
// the font can't draw gets the generic "A style report is in". Made once per headline and cached.
const MAX_NAME=40;
const images=new Map();
let background=null;
const loadBackground=()=>background??=readFile(new URL('../public/brand/previews/report-bg-v1.png',import.meta.url));

export async function reportPreviewImage(name){
 const font=await loadFont(),wanted=reportHeadline(name);
 const drawn=headlineSvg(font,wanted),headline=drawn?wanted:reportHeadline(null);
 let bytes=images.get(headline);
 if(!bytes){
  const art=drawn??headlineSvg(font,headline);
  bytes=await sharp(await loadBackground()).composite([{input:Buffer.from(art.svg)}]).png({compressionLevel:9}).toBuffer();
  images.set(headline,bytes);if(images.size>50)images.delete(images.keys().next().value);
  console.log(JSON.stringify({event:'report_preview_image',named:Boolean(name),drawn_name:Boolean(name&&drawn),size:art.size,lines:art.lines.length}));
 }
 return {bytes,named:Boolean(name&&drawn)};
}

export async function handleReportPreview(req,res,{store}){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');return res.end();}
 const token=new URL(req.url,'https://jules.invalid').searchParams.get('share_preview')??'';
 if(!SHARE_TOKEN.test(token)){res.statusCode=404;res.setHeader('Cache-Control','no-store');return res.end('Preview unavailable');}
 try{
  const row=await store.reportByShareToken(token).catch(()=>null);
  const shared=Boolean(row?.report&&row.report.share?.token===token);
  const found=shared?await firstName(store,row.conversation_id).catch(()=>null):null;
  const name=found&&found.length<=MAX_NAME?found:null;
  const {bytes,named}=await reportPreviewImage(name);
  res.statusCode=200;res.setHeader('Content-Type','image/png');res.setHeader('Content-Length',bytes.length);
  res.setHeader('Cache-Control',named?'public, max-age=3600, s-maxage=86400':'public, max-age=60, s-maxage=60');
  return res.end(req.method==='HEAD'?undefined:bytes);
 }catch(error){
  console.log(JSON.stringify({event:'report_preview_image_failed',reason:String(error?.message??'').slice(0,60)}));
  res.statusCode=503;res.setHeader('Cache-Control','no-store');return res.end('Preview unavailable');
 }
}
