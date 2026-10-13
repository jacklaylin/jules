import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {Parser} from 'htmlparser2';
import {digest,gmailGet} from './gmail-client.js';

// Technical data preparation only. Shopping intent and event meaning remain model interpreted.
export function redactReceiptText(value){
 return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
  .replace(/\b(https?:\/\/)[^\s<>]+/gi,'[link removed]')
  .replace(/\b(card(?: number)?|phone|telephone|tel|mobile)\s*[:#=]?\s*[+]?\d[\d ()-]{6,30}/gi,'[labeled payment/contact number removed]')
  .replace(/\b(password|passcode|verification code|security code)\s*[:=]\s*[^\s]+/gi,'[credential removed]');
}
export function receiptHTML(html){
 let output='',hidden=0,cell=false,refs=[];
 const parser=new Parser({onopentag(name,attrs){
  if(['script','style','head'].includes(name)){hidden++;return;}
  if(hidden)return;
  if(['p','div','br','tr','li','table'].includes(name))output+='\n';
  if(['td','th'].includes(name)){if(cell)output+=' | ';cell=true;}
  if(name==='a'&&attrs.href){try{const url=new URL(attrs.href);for(const [key,value]of url.searchParams)if(/^(order|order_id|order_number|receipt|receipt_id|return_id)$/i.test(key)&&value.length<150)refs.push({label:key,value});}catch{}}
 },ontext(value){if(!hidden)output+=value;},onclosetag(name){if(['script','style','head'].includes(name)){hidden=Math.max(0,hidden-1);return;}if(hidden)return;if(name==='tr'){output+='\n';cell=false;}},},{decodeEntities:true});
 parser.write(html);parser.end();return {text:output,link_references:refs};
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
 const headers=message.payload?.headers??[],header=name=>headers.find(h=>h.name.toLowerCase()===name)?.value??'';
 const sections=['SUBJECT\n'+header('Subject')],warnings=[],pdfs=[],bodies={html:[],plain:[]},refs=[];let totalBytes=0,downloads=0;
 async function visit(part,path='0'){
  if(part.mimeType==='text/plain'||part.mimeType==='text/html'||part.mimeType==='application/pdf'){
   const size=part.body?.size??0;totalBytes+=size;
   if(size>4000000||totalBytes>8000000){warnings.push('Attachment/body exceeds pilot limit');return;}
   let data=part.body?.data;
   if(!data&&part.body?.attachmentId){if(++downloads>3){warnings.push('Attachment count exceeds pilot limit');return;}data=(await gmailGet('messages/'+encodeURIComponent(message.id)+'/attachments/'+encodeURIComponent(part.body.attachmentId),tokens,fetcher)).data;}
   if(data){const bytes=Buffer.from(data,'base64url');
    if(bytes.length>4000000){warnings.push('Attachment/body exceeds pilot limit');return;}
    if(part.mimeType==='application/pdf'){try{const text=await pdf(bytes);pdfs.push({id:message.id+':pdf:'+path,text});sections.push('PDF '+path+'\n'+text);}catch{warnings.push('Unreadable PDF attachment');}}
    else if(part.mimeType==='text/html'){const html=receiptHTML(bytes.toString('utf8'));bodies.html.push(html.text);refs.push(...html.link_references);}
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
 const sender=header('From').match(/@([^>\s]+)/)?.[1]?.toLowerCase()??null;
 return {id:message.id,fingerprint:digest(JSON.stringify(message.payload)),date:Number(message.internalDate)||null,sender_domain:sender,text:full.slice(0,60000),warnings,pdf_count:pdfs.length};
}

// Gmail metadata (subject, sender, snippet) for the triage pass; no body or attachment download.
export function triageCandidate(message){
 const headers=message.payload?.headers??[],header=name=>headers.find(h=>h.name.toLowerCase()===name)?.value??'';
 return {id:message.id,date:Number(message.internalDate)||null,sender_domain:header('From').match(/@([^>\s]+)/)?.[1]?.toLowerCase()??null,
  from_name:redactReceiptText(header('From').replace(/<[^>]*>/g,'').trim()).slice(0,120),subject:redactReceiptText(header('Subject')).slice(0,300),snippet:redactReceiptText(message.snippet??'').slice(0,300)};
}
