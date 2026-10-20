import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {Parser} from 'htmlparser2';
import {digest,gmailGet} from './gmail-client.js';
import {publicURL} from './public-url.js';

// Technical data preparation only. Shopping intent and event meaning remain model interpreted.
export function redactReceiptText(value){
 return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
  .replace(/\b(https?:\/\/)[^\s<>]+/gi,'[link removed]')
  .replace(/\b(card(?: number)?|phone|telephone|tel|mobile)\s*[:#=]?\s*[+]?\d[\d ()-]{6,30}/gi,'[labeled payment/contact number removed]')
  .replace(/\b(password|passcode|verification code|security code)\s*[:=]\s*[^\s]+/gi,'[credential removed]');
}
// Images smaller than this (declared or decoded) are tracking pixels, spacers or icons, never a product photo.
export const MIN_PHOTO_SIDE=40;
const CANDIDATE_LIMIT=30;
const declared=(attrs,side)=>{const n=Number.parseInt(attrs[side],10);if(Number.isFinite(n))return n;const m=(attrs.style??'').match(new RegExp('(?:^|;)\\s*'+side+'\\s*:\\s*(\\d+)px','i'));return m?Number(m[1]):null;};
const hiddenStyle=attrs=>/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style??'');
// Order-email media: each product <img> (https only, tracking params removed) with the link around it
// or the one link in its table row, plus text links. These are only candidates: the model may pick one
// per item by reference, never by writing a URL (lib/order-media.js validates the reference).
// start numbers the refs so several HTML bodies in one email share one candidate list.
export function receiptHTML(html,start=0){
 let output='',hidden=0,cell=false,refs=[];
 const images=[],links=[],anchors=[],rows=[];
 const ref=()=>start+images.length+links.length;
 const parser=new Parser({onopentag(name,attrs){
  if(['script','style','head'].includes(name)){hidden++;return;}
  if(hidden)return;
  if(['p','div','br','tr','li','table'].includes(name))output+='\n';
  if(['td','th'].includes(name)){if(cell)output+=' | ';cell=true;}
  if(name==='tr')rows.push({links:[],images:[]});
  if(name==='a'){
   const link=attrs.href?publicURL(attrs.href):null;anchors.push({link,text:''});if(link)rows.at(-1)?.links.push(link);
   if(attrs.href){try{const url=new URL(attrs.href);for(const [key,value]of url.searchParams)if(/^(order|order_id|order_number|receipt|receipt_id|return_id)$/i.test(key)&&value.length<150)refs.push({label:key,value});}catch{}}
  }
  if(name==='img'){
   const image=publicURL(attrs.src??''),small=['width','height'].some(side=>{const n=declared(attrs,side);return n!==null&&n<MIN_PHOTO_SIDE;});
   if(!image||small||hiddenStyle(attrs)||images.length>=CANDIDATE_LIMIT)return;
   const known=images.find(i=>i.image===image);
   const alt=(attrs.alt??attrs.title??'').replace(/\s+/g,' ').trim().slice(0,120);
   const candidate=known??{ref:ref(),image,alt,link:anchors.findLast(a=>a.link)?.link??null};
   if(!known){images.push(candidate);if(!candidate.link)rows.at(-1)?.images.push(candidate);}
   output+=` [image ${candidate.ref}${alt?': '+alt:''}] `;
  }
 },ontext(value){if(hidden)return;output+=value;for(const a of anchors)a.text+=value;},onclosetag(name){
  if(['script','style','head'].includes(name)){hidden=Math.max(0,hidden-1);return;}if(hidden)return;
  if(name==='tr'){output+='\n';cell=false;
   // An image with no link of its own takes its row's link when the row has exactly one.
   // Otherwise its links and unlinked images count toward the enclosing row (nested email tables).
   const row=rows.pop();if(row){const distinct=[...new Set(row.links)];if(distinct.length===1)for(const i of row.images)i.link=distinct[0];
    if(rows.length){rows.at(-1).links.push(...row.links);if(distinct.length!==1)rows.at(-1).images.push(...row.images);}}
  }
  if(name==='a'){const a=anchors.pop(),text=a?.text.replace(/\s+/g,' ').trim().slice(0,120);
   if(a?.link&&text&&links.length<CANDIDATE_LIMIT&&!links.some(l=>l.link===a.link))links.push({ref:ref(),alt:text,link:a.link});}
 },},{decodeEntities:true});
 parser.write(html);parser.end();
 // Text links that only repeat an image's link add nothing.
 const imageLinks=new Set(images.map(i=>i.link).filter(Boolean));
 return {text:output,link_references:refs,next:ref(),candidates:[...images,...links.filter(l=>!imageLinks.has(l.link))].sort((a,b)=>a.ref-b.ref)};
}
export async function receiptPDF(bytes){
 if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Invalid PDF');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,standardFontDataUrl:dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))+'/standard_fonts/'});
 const doc=await task.promise;
 try{if(doc.numPages>20)throw Error('PDF page limit');let text='';
  for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();text+=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('')+'\n';}
  if(!text.trim())throw Error('PDF needs OCR');return text;
 }finally{await task.destroy();}
}
export async function prepareReceiptEmail(message,tokens,{fetcher=fetch,pdf=receiptPDF}={}){
 const headers=message.payload?.headers??[],header=name=>headers.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value??'';
 // Sender name/domain and addressee name (never the addresses) let the model recognise a brand's
 // own store and a ship-to name that matches the account holder.
 let nextRef=0;const candidates=[],sections=['SUBJECT\n'+header('Subject')+'\nFROM\n'+displayName(header('From'))+(senderDomain(header)?' ('+senderDomain(header)+')':'')+'\nTO\n'+displayName(header('To'))],warnings=[],pdfs=[],bodies={html:[],plain:[]},refs=[];let totalBytes=0,downloads=0;
 async function visit(part,path='0'){
  if(part.mimeType==='text/plain'||part.mimeType==='text/html'||part.mimeType==='application/pdf'){
   const size=part.body?.size??0;totalBytes+=size;
   if(size>4000000||totalBytes>8000000){warnings.push('Attachment/body exceeds pilot limit');return;}
   let data=part.body?.data;
   if(!data&&part.body?.attachmentId){if(++downloads>3){warnings.push('Attachment count exceeds pilot limit');return;}data=(await gmailGet('messages/'+encodeURIComponent(message.id)+'/attachments/'+encodeURIComponent(part.body.attachmentId),tokens,fetcher)).data;}
   if(data){const bytes=Buffer.from(data,'base64url');
    if(bytes.length>4000000){warnings.push('Attachment/body exceeds pilot limit');return;}
    if(part.mimeType==='application/pdf'){try{const text=await pdf(bytes);pdfs.push({id:message.id+':pdf:'+path,text});sections.push('PDF '+path+'\n'+text);}catch{warnings.push('Unreadable PDF attachment');}}
    else if(part.mimeType==='text/html'){const html=receiptHTML(bytes.toString('utf8'),nextRef);nextRef=html.next;bodies.html.push(html.text);refs.push(...html.link_references);candidates.push(...html.candidates);}
    else bodies.plain.push(bytes.toString('utf8'));
   }
  }else if(part.filename)warnings.push('Unsupported attachment type');
  for(const [i,child]of(part.parts??[]).entries())await visit(child,path+'.'+i);
 }
 await visit(message.payload??{});
 // Most receipts carry the same content as plain and HTML alternatives; sending both wastes the
 // text budget. Plain text is kept only when it is longer than the HTML (an image-only HTML body).
 const html=bodies.html.join('\n'),plain=bodies.plain.join('\n');
 const body=[...(html.trim()?['HTML BODY\n'+html]:[]),...(plain.trim()&&plain.replace(/\s+/g,'').length>html.replace(/\s+/g,'').length?['PLAIN BODY\n'+plain]:[]),
  ...(refs.length?['LINK REFERENCES (not independently verified identities)\n'+JSON.stringify(refs)]:[])];
 const full=redactReceiptText([sections[0],...body,...sections.slice(1)].join('\n\n'));
 if(full.length>60000)warnings.push('Email text truncated at pilot limit');
 const sender=senderDomain(header);
 // addressee is the account holder's display name from To, or null when the header names no one.
 return {id:message.id,fingerprint:digest(JSON.stringify(message.payload)),date:Number(message.internalDate)||null,sender_domain:sender,addressee:displayName(header('To'))||null,text:full.slice(0,60000),warnings,pdf_count:pdfs.length,
  ...(candidates.length?{media:{source:'order_email',candidates}}:{})};
}

const displayName=value=>value.split(',')[0].replace(/<[^>]*>/g,'').replace(/["']/g,'').replace(/\S+@\S+/g,'').trim().slice(0,120);
// Technical address parsing: the From domain, else the first other header that names the sender.
function senderDomain(header){
 for(const name of ['from','sender','reply-to','return-path']){const domain=header(name).match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase();if(domain)return domain;}
 return null;
}
// Gmail metadata (subject, sender, snippet) for the triage pass; no body or attachment download.
export function triageCandidate(message){
 const headers=message.payload?.headers??[],header=name=>headers.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value??'';
 return {id:message.id,date:Number(message.internalDate)||null,sender_domain:senderDomain(header),
  from_name:redactReceiptText(displayName(header('From'))),subject:redactReceiptText(header('Subject')).slice(0,300),snippet:redactReceiptText(message.snippet??'').slice(0,300)};
}
