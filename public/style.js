import {trackedFetch as fetch,withActivity} from './activity.js';
import {mountHeader} from './design-system.js';
mountHeader('style');
import {createSession} from './wishlist-session.js';
import {cardText,renderShareCard,canvasBlob} from './style-export.js';
import {cardTheme,cardVisuals,symbolCanvas,HEADER_FONTS} from './style-visuals.js';
const $=id=>document.getElementById(id);
const session=createSession({fetcher:fetch,storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let token=session.read()?.access_token||sessionStorage.getItem('jules_wishlist_token'),state=null,busy=false,generation=0,storyIndex=0;
let exporting=null,exportVersion=0,exportBlob=null;
const urls=new Set(),photos=new Map();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token')){token=fragment.get('access_token');session.save({access_token:token,refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});sessionStorage.removeItem('jules_wishlist_token');}
if(location.hash)history.replaceState(null,'','/style');
let noticeTimer,analysisPoll;const notice=text=>{clearTimeout(noticeTimer);$('notice').textContent=text;if(text&&document.body.classList.contains('story-mode'))noticeTimer=setTimeout(()=>$('notice').textContent='',8000);};
function node(tag,text,cls){const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
function button(text,work){const el=node('button',text);el.type='button';el.onclick=work;return el;}
function clear(){generation++;exportVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();photos.clear();$('sources').replaceChildren();$('cards').replaceChildren();$('export-preview').replaceChildren();$('export-dialog').close();exportBlob=null;exporting=null;state=null;}
function login(){clearTimeout(analysisPoll);document.body.classList.remove('story-mode');clear();token=null;session.clear();sessionStorage.removeItem('jules_wishlist_token');$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;}
async function authFetch(url,options={}) {
  try{token=await session.token()||token;}catch(error){if(!session.read())login();throw error;}
  const send=()=>fetch(url,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},cache:'no-store'});
  let r=await send();
  if(r.status===401&&session.read()?.refresh_token){try{token=await session.token(true);r=await send();}catch(error){if(!session.read())login();throw error;}}
  if([401,403].includes(r.status))login();
  return r;
}
async function api(input) {
  const response=await authFetch('/api/style',input?{method:'POST',body:JSON.stringify({...input,revision:state.revision})}:{});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'Please try again.'),{code:value.code});return value;
}
async function work(fn,label='Working on your style') {
  if(busy)return;busy=true;$('workspace').setAttribute('aria-busy','true');
  const controls=[...$('workspace').querySelectorAll('button,input,select,textarea')].map(el=>({el,disabled:el.disabled}));
  controls.forEach(({el})=>el.disabled=true);
  try{await withActivity(label,fn);}catch(e){if(e.inline)feedback('review-feedback',e.message,true);else{notice(e.message);$('notice').scrollIntoView({block:'nearest'});}}
  finally{busy=false;$('workspace').setAttribute('aria-busy','false');controls.forEach(({el,disabled})=>{if(el.isConnected)el.disabled=disabled;});if(state){const pending=Date.parse(state.data.busy_until)>Date.now();if(pending)$('workspace').querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);$('analyze').disabled=pending||!state.sources.some(s=>s.kind==='outfit');}}
}
async function blobURL(query){if(photos.has(query))return photos.get(query);const v=generation;const pending=(async()=>{const response=await authFetch('/api/style'+query);if(!response.ok)throw new Error('Could not load this image.');const blob=await response.blob();if(v!==generation)throw new Error('Your report changed.');const url=URL.createObjectURL(blob);urls.add(url);return url;})();photos.set(query,pending);try{return await pending;}catch(error){if(photos.get(query)===pending)photos.delete(query);throw error;}}
function privatePhoto(query,alt) {
  const img=node('img');img.alt=alt;const v=generation;
  blobURL(query).then(url=>{if(v===generation)img.src=url;}).catch(()=>{img.alt='Image unavailable';});return img;
}
function renderSources() {
  $('sources').replaceChildren();
  for(const kind of ['outfit','inspiration','receipt']){
   const sources=state.sources.filter(s=>s.kind===kind);if(!sources.length)continue;
   const group=node('section',null,'source-category'),grid=node('div',null,'source-grid');group.append(node('h3',`${categoryNames[kind]} · ${sources.length}`),grid);$('sources').append(group);
  for(const s of sources) {
    const tile=node('article',null,'source-tile');
    tile.append(s.mime_type==='application/pdf'?node('div','Receipt PDF','pdf-tile'):privatePhoto('?source='+s.id,s.kind==='outfit'?'Your outfit':s.kind==='inspiration'?'Style inspiration':'Receipt'));
    tile.append(node('p',({outfit:'Your outfit',inspiration:'Inspiration',receipt:'Receipt'})[s.kind]+(s.occasion?' / '+s.occasion:'')));
    if(s.note)tile.append(node('p',s.note));
    tile.append(button('Remove',()=>work(async()=>{state=await api({action:'remove',source:s.id});render();notice('Removed. The old report and its preferences have been cleared.');})));
    grid.append(tile);
  }
  }
}
function checkbox(text,checked=false) {
  const label=node('label',null,'check'),input=node('input');input.type='checkbox';input.checked=checked;label.append(input,node('span',text));return {label,input};
}
function feedback(id,text,error=false){const el=$(id);el.textContent=text;el.dataset.error=error;}
function fieldError(el,text){el.setAttribute('aria-invalid','true');let error=el.parentElement.querySelector('.field-error');if(!error){error=node('p',null,'field-error');error.id='error-'+(el.id||el.name);el.parentElement.append(error);}error.textContent=text;el.setAttribute('aria-describedby',error.id);el.scrollIntoView({block:'center'});setTimeout(()=>el.focus(),0);}
function clearErrors(){document.querySelectorAll('[aria-invalid]').forEach(el=>{el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');});document.querySelectorAll('.field-error').forEach(el=>el.remove());feedback('review-feedback','');}
function preferenceKey(p){return p.field+'/'+p.key.trim().toLowerCase();}
function renderPreferences(report){
 $('preference-list').replaceChildren();$('preferences').hidden=report.status!=='draft';
 if(report.status!=='draft')return;
 const grouped=new Map();for(const card of report.cards)for(const p of card.preferences){const key=preferenceKey(p);if(!grouped.has(key))grouped.set(key,p);}
 for(const [key,p] of grouped){const row=node('div',null,'preference');row.dataset.preference=key;const check=checkbox('Remember '+p.field+' / '+p.key);const input=node('input');input.type='text';input.value=p.value;input.maxLength=400;input.setAttribute('aria-label','Preference: '+p.key);row.append(check.label,input);$('preference-list').append(row);}
}
function collage(card){
 const {crops,ingredients}=cardVisuals(state.data.report,card),gallery=node('div',null,'story-collage');
 for(const c of crops){const fig=node('figure');fig.append(privatePhoto(`?crop=${c.index}&report=${state.data.report.id}`,c.label),node('figcaption',c.label));gallery.append(fig);}
 for(const item of ingredients.slice(0,Math.max(0,6-gallery.children.length))){const fig=node('figure');
  if(item.kind!=='color'&&(item.kind==='brand'||item.icon==='none'))fig.append(node('div',item.label,'ingredient-label'));
  else if(item.kind==='color'){const chip=node('div',null,'color-chip');if(item.color)chip.style.background=item.color;fig.append(chip);}
  else fig.append(symbolCanvas(item.icon));
  const fromFile=state.data.report.analysis.observations.some(o=>item.observation_ids?.includes(o.id)&&o.basis==='file');
  fig.append(node('figcaption',item.kind==='brand'?(fromFile?'From your uploads':'From your style notes'):item.label));gallery.append(fig);
 }
 gallery.dataset.count=gallery.children.length;
 for(const figure of gallery.children){
  const enabled=()=>matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
  figure.onpointermove=e=>{if(!enabled()||e.pointerType!=='mouse')return;const box=figure.getBoundingClientRect();const x=Math.max(-1,Math.min(1,(e.clientX-box.left)/box.width*2-1)),y=Math.max(-1,Math.min(1,(e.clientY-box.top)/box.height*2-1));figure.dataset.hover='true';figure.style.setProperty('--pointer-turn',`${x*3}deg`);figure.style.setProperty('--pointer-x',`${-y*4}deg`);figure.style.setProperty('--pointer-y',`${x*4}deg`);};
  figure.onpointerleave=()=>{delete figure.dataset.hover;figure.style.removeProperty('--pointer-turn');figure.style.removeProperty('--pointer-x');figure.style.removeProperty('--pointer-y');};
 }
 return gallery;
}
function evidenceContent(card){
 const content=node('div');content.append(node('h3',card.title),node('p',cardText(card,state.data.tone),'card-copy'),collage(card));
 for(const o of state.data.report.analysis.observations.filter(o=>card.observation_ids.includes(o.id))){
  const text=state.sources.reduce((text,source)=>text.replaceAll(source.id,''),o.text).replace(/ {2,}/g,' ');
  content.append(node('p',text),node('p',o.basis==='context'?'You told Jules':o.confidence==='low'?'Tentative interpretation':o.basis==='file'?'Read from your uploaded files':'From your submitted evidence','fine'));
  if(o.wear_context)content.append(node('p','Worn for: '+o.wear_context,'fine'));
  for(const context of state.data.report.analysis.outfit_contexts||[])if(o.source_ids.includes(context.source_id))content.append(node('p',`${context.basis==='gear'?'Likely activity (confirm)':'Activity'}: ${context.activity}`,'fine'));
  for(const id of o.source_ids){if(id==='context'||id==='saved-profile'){content.append(node('p',id==='context'?'Your style notes':'Your saved shopping preferences','fine'));continue;}const source=state.sources.find(s=>s.id===id);if(!source)continue;
   content.append(button('View '+source.kind,()=>work(async()=>{const url=await blobURL('?source='+id);const a=node('a');a.href=url;a.target='_blank';a.rel='noopener';if(source.mime_type==='application/pdf')a.download='receipt.pdf';a.click();})));
  }
 }
 return content;
}
function openEvidence(card){$('evidence-content').replaceChildren(evidenceContent(card));$('evidence-dialog').showModal();}
function syncStory(){const cards=[...$('cards').children];storyIndex=Math.max(0,Math.min(cards.length-1,Math.round($('cards').scrollLeft/Math.max(1,$('cards').clientWidth+16))));$('story-count').textContent=cards.length?`${storyIndex+1} / ${cards.length} · Swipe to explore`:'All cards hidden';$('story-prev').disabled=storyIndex===0;$('story-next').disabled=storyIndex>=cards.length-1;}
function moveStory(delta){$('cards').scrollTo({left:Math.max(0,storyIndex+delta)*($('cards').clientWidth+16),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
$('story-prev').onclick=()=>moveStory(-1);$('story-next').onclick=()=>moveStory(1);$('cards').onscroll=syncStory;
$('cards').onkeydown=e=>{if(document.body.classList.contains('story-mode')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();moveStory(e.key==='ArrowRight'?1:-1);}};
$('evidence-close').onclick=()=>$('evidence-dialog').close();
$('hidden-cards').onclick=()=>{const content=node('div');for(const card of state.data.report.cards.filter(c=>c.hidden&&c.accepted))content.append(button('Show '+card.title,()=>work(async()=>{state=await api({action:'hide',card:card.id,hidden:false});$('evidence-dialog').close();renderCards();})));$('evidence-content').replaceChildren(content);$('evidence-dialog').showModal();};
function renderCards() {
 const report=state.data.report;$('cards').replaceChildren();$('report-section').hidden=!report;
 const draft=report?.status==='draft';document.body.classList.toggle('story-mode',!!report&&!draft);$('story-nav').hidden=!report||draft;
 if(!report)return;
 $('report-stage').textContent=draft?'02 / CHECK MY READ':'03 / MAKE IT YOURS';$('report-heading').textContent=draft?'Does this sound like you?':'Your style read';
 $('report-description').textContent=draft?'Check each card, then choose the preferences below. Nothing is remembered until you confirm.':'Swipe through your cards.';
 $('confirm').hidden=!draft;$('confirmed-note').hidden=draft;$('hidden-cards').hidden=draft||!report.cards.some(c=>c.hidden&&c.accepted);
 renderPreferences(report);
 report.cards.filter(card=>draft||card.accepted&&!card.hidden).forEach((card,index)=>{
  const article=node('article',null,'style-card');article.dataset.type=card.type;article.dataset.id=card.id;
  const theme=cardTheme(card);article.style.setProperty('--story-a',theme.a);article.style.setProperty('--story-b',theme.b);article.style.setProperty('--story-font',`"${theme.font}"`);
  const copy=node('div',null,'story-copy');copy.append(node('p',`${String(index+1).padStart(2,'0')} / ${card.type==='starter'?'YOUR STARTER PACK':card.private?'SHOPPING HISTORY · PRIVATE':'YOUR STYLE'}`,'card-number'),node('h3',card.title),node('p',cardText(card,state.data.tone),'card-copy'));article.append(copy);
  if(!draft||card.type==='starter'){const visual=collage(card);article.dataset.visuals=visual.children.length?'true':'false';article.append(visual);}
  if(draft){
   const detail=node('details');detail.append(node('summary','Why Jules thinks this'),evidenceContent(card));article.append(detail);
   const review=node('div',null,'review'),set=node('fieldset');set.append(node('legend','Does this fit?'));
   for(const [value,label] of [['yes','That’s me'],['partly','Partly'],['no','Not me']]){const l=node('label'),r=node('input');r.type='radio';r.name='review-'+card.id;r.value=value;l.append(r,document.createTextNode(label));set.append(l);}
   const label=node('label','Your version, if I missed something'),correction=node('textarea');correction.maxLength=420;correction.rows=2;correction.dataset.correction='true';correction.placeholder='This replaces the card copy in every tone.';label.append(correction);review.append(set,label);article.append(review);
  }else{
   const actions=node('div',null,'card-actions');actions.append(button('Read & evidence',()=>openEvidence(card)),button('Share ↗',()=>openExport(card)),button('Hide',()=>work(async()=>{state=await api({action:'hide',card:card.id,hidden:true});renderCards();})));article.append(actions);
  }
  $('cards').append(article);
 });
 requestAnimationFrame(()=>{$('cards').scrollTo({left:storyIndex*($('cards').clientWidth+16),behavior:'instant'});syncStory();});
}
function render() {
  generation++;exportVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();photos.clear();
  $('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;
  $('context').value=state.data.notes??'';
  for(const r of document.querySelectorAll('input[name=tone]'))r.checked=r.value===state.data.tone;
  const hasReport=Boolean(state.data.report);
  $('inputs').hidden=$('style-intro').hidden=$('style-steps').hidden=hasReport;
  if(!hasReport)renderSources();else $('sources').replaceChildren();
  renderCards();$('analyze').disabled=!state.sources.some(s=>s.kind==='outfit');
  if(state.data.busy_until&&Date.parse(state.data.busy_until)>Date.now())notice('Your style analysis is running. Your uploads are saved; this page will check for the result.');
}
async function load(){clearTimeout(analysisPoll);state=await api();render();if(Date.parse(state.data.busy_until)>Date.now()){clearTimeout(noticeTimer);analysisPoll=setTimeout(()=>work(load,'Checking your style analysis'),3000);}else notice('');}

$('login-form').onsubmit=async e=>{
  e.preventDefault();const submit=e.currentTarget.querySelector('button');submit.disabled=true;
  try{const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',email:$('email').value,destination:'style'})});const data=await response.json();if(!response.ok)throw new Error(data.error);notice(data.message);}catch(e){notice(e.message);}finally{submit.disabled=false;}
};
$('logout').onclick=()=>work(async()=>{
  const response=await authFetch('/api/wishlist',{method:'POST',body:JSON.stringify({action:'logout'})});if(!response.ok)throw new Error('Could not end the session. Try again.');login();notice('Signed out.');
});
async function encodeFile(file) {
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)||['image/heic','image/heif'].includes(file.type)||/\.hei[cf]$/i.test(file.name)){
    if(file.size>3*1024*1024)throw new Error('PDF and HEIC files must be under 3 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);
  }
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Use JPEG, PNG or WebP photos under 20 MB, or HEIC under 3 MB.');
  const image=await createImageBitmap(file,{imageOrientation:'from-image'});
  const ratio=Math.min(1,1800/image.width,2200/image.height),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();
  const data=canvas.toDataURL('image/jpeg',.88).split(',')[1];if(data.length>4194304)throw new Error('This photo is still too large. Try a smaller copy.');return data;
}
const categoryNames={outfit:'Outfits',inspiration:'Inspiration',receipt:'Purchase receipts'};
const selectedKind=()=>$('kind').querySelector('input:checked').value;
function updateUploadCategory(){
 const kind=selectedKind();$('upload-form').querySelector('button[type=submit]').textContent='Upload '+categoryNames[kind].toLowerCase()+' ↗';
 $('files').accept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'+(kind==='receipt'?',application/pdf':'');
 $('selected-files').textContent=$('files').files.length?`${$('files').files.length} files selected for ${categoryNames[kind].toLowerCase()}. Notes and occasion apply to this whole batch.`:'';
}
$('kind').onchange=updateUploadCategory;$('files').onchange=updateUploadCategory;updateUploadCategory();
$('upload-form').onsubmit=e=>{e.preventDefault();work(async()=>{
  const files=[...$('files').files],kind=selectedKind(),occasion=$('occasion').value,note=$('source-note').value;
  clearErrors();feedback('upload-feedback','');
  if(!files.length){fieldError($('files'),'Choose at least one file.');return;}
  if(kind!=='receipt'&&files.some(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name))){fieldError($('files'),'PDFs are for receipts. Choose a photo, or change the type to Purchase receipts.');return;}
  if(!$('consent').checked){fieldError($('consent'),'Approve private storage and analysis before uploading.');return;}
  let count=0;const progress=$('upload-progress');progress.max=files.length;progress.value=0;progress.hidden=false;
  try{for(const file of files){feedback('upload-feedback',`Saving ${categoryNames[kind].toLowerCase()}: ${count+1} of ${files.length}…`);notice(`Saving ${count+1} of ${files.length}…`);state=await api({action:'upload',kind,occasion,note,data:await encodeFile(file),consent:true});count++;progress.value=count;}}
  catch(error){feedback('upload-feedback',`${count} saved. ${files[count]?.name||'The upload'}: ${error.message}`,true);try{const remaining=new DataTransfer();files.slice(count).forEach(f=>remaining.items.add(f));$('files').files=remaining.files;}catch{$('files').value='';}updateUploadCategory();notice('');return;}
  finally{render();progress.hidden=true;}
  $('upload-form').reset();$('kind').querySelector(`[value=${kind}]`).checked=true;$('consent').checked=true;updateUploadCategory();feedback('upload-feedback',`${count} ${categoryNames[kind].toLowerCase()} saved privately. Choose another category or get your style read.`);notice('');
});};
$('context-form').onsubmit=e=>{e.preventDefault();work(async()=>{try{state=await api({action:'context',notes:$('context').value});render();feedback('context-feedback','Notes saved.');notice('');}catch(e){feedback('context-feedback',e.message,true);}});};
$('analyze').onclick=()=>work(async()=>{
  feedback('analysis-feedback','');delete $('analysis-feedback').dataset.errorCode;
  if(!state.data.consent_at&&!$('consent').checked){fieldError($('consent'),'Approve private storage and OpenAI analysis to continue.');return;}
  if($('context').value.trim()!==state.data.notes){state=await api({action:'context',notes:$('context').value});}
  notice('Reading your outfits and receipts, then putting your report together…');
  try{state=await api({action:'analyze',consent:true});render();notice('Check my read before we save any preferences.');$('report-section').scrollIntoView({behavior:'instant',block:'start'});}
  catch(e){try{state=await api();render();}catch{}feedback('analysis-feedback',e.message,true);if(e.code)$('analysis-feedback').dataset.errorCode=e.code;notice('');$('analysis-feedback').scrollIntoView({block:'center'});}
});
for(const radio of document.querySelectorAll('input[name=tone]'))radio.onchange=()=>work(async()=>{
  const tone=radio.value;state=await api({action:'tone',tone});
  // Keep unsaved confirmation selections and corrections intact when changing tone.
  if(state.data.report.status==='confirmed'){renderCards();notice('');return;}
  document.querySelectorAll('.style-card').forEach(el=>{const card=state.data.report.cards.find(c=>c.id===el.dataset.id);el.querySelector('.card-copy').textContent=cardText(card,tone);});notice('');
});
$('confirm').onclick=()=>work(async()=>{
  clearErrors();
  const reviews=state.data.report.cards.map(card=>{
    const el=document.querySelector(`[data-id="${card.id}"]`),choice=el.querySelector('input[type=radio]:checked')?.value;
    if(!choice){fieldError(el.querySelector('input[type=radio]'),'Choose That’s me, Partly, or Not me for this card.');throw Object.assign(new Error('Check the highlighted card.'),{inline:true});}
    const correction=el.querySelector('[data-correction]').value.trim();if(choice==='partly'&&!correction){fieldError(el.querySelector('[data-correction]'),'Add your version for this card.');throw Object.assign(new Error('Check the highlighted correction.'),{inline:true});}
    return {id:card.id,accepted:choice!=='no',hidden:choice==='no',correction,preferences:card.preferences.map(p=>{
      const row=[...$('preference-list').children].find(r=>r.dataset.preference===preferenceKey(p));if(row.querySelector('input[type=checkbox]').checked&&!row.querySelector('input[type=text]').value.trim()){fieldError(row.querySelector('input[type=text]'),'Write the preference, or leave it unselected.');throw Object.assign(new Error('Check the highlighted preference.'),{inline:true});}return {observation_id:p.observation_id,accepted:row.querySelector('input[type=checkbox]').checked,value:row.querySelector('input[type=text]').value.trim()||p.value};
    })};
  });
  state=await api({action:'confirm',reviews});notice('');renderCards();notice('Your read is saved. Only the preferences you selected will guide shopping.');
});
$('edit-inputs').onclick=()=>{document.body.classList.remove('story-mode');$('report-section').hidden=true;$('inputs').hidden=false;renderSources();$('inputs').scrollIntoView({behavior:'instant',block:'start'});};
$('delete').onclick=()=>$('delete-dialog').showModal();$('delete-cancel').onclick=()=>$('delete-dialog').close();
$('delete-confirm').onclick=()=>work(async()=>{state=await api({action:'delete'});$('delete-dialog').close();$('consent').checked=false;render();notice('Your style uploads, report, and its saved preferences were deleted.');});

function closeExport(){exportVersion++;exportBlob=null;exporting=null;$('export-dialog').close();$('export-preview').replaceChildren();}
$('export-close').onclick=closeExport;$('export-dialog').addEventListener('cancel',closeExport);
function openExport(card){
  exporting={card,report:state.data.report.id,tone:state.data.tone,revision:state.revision};exportBlob=null;
  $('private-consent').checked=false;$('photo-consent').checked=false;
  $('private-consent-label').hidden=!card.private;
  $('photo-consent-label').hidden=!cardVisuals(state.data.report,card).crops.length;
  $('export-dialog').showModal();updateExport();
}
async function updateExport() {
  const v=++exportVersion;exportBlob=null;$('download').disabled=$('share').disabled=true;$('export-preview').replaceChildren();$('export-notice').textContent='Building your share image…';
  if(!exporting)return;
  if(exporting.card.private&&!$('private-consent').checked){$('export-notice').textContent='Choose whether to include this shopping-history card.';return;}
  try {
    const images=[];
    if($('photo-consent').checked&&!$('photo-consent-label').hidden)for(const c of cardVisuals(state.data.report,exporting.card).crops){
      const img=new Image();img.src=await blobURL(`?crop=${c.index}&report=${exporting.report}`);await img.decode();images.push({image:img,label:c.label});
    }
    if(v!==exportVersion||!exporting)return;
    await Promise.all(HEADER_FONTS.map(font=>document.fonts.load(`48px "${font}"`)));await document.fonts.ready;
    const canvas=renderShareCard({card:exporting.card,tone:exporting.tone,crops:images,ingredients:cardVisuals(state.data.report,exporting.card).ingredients,signupURL:state.signup_url});
    const blob=await canvasBlob(canvas);if(v!==exportVersion)return;
    exportBlob=blob;$('export-notice').textContent='Ready to share.';$('export-preview').replaceChildren(canvas);$('download').disabled=false;$('share').disabled=!state.signup_url;
  }catch(e){if(v===exportVersion)$('export-notice').textContent=e.message;}
}
$('photo-consent').onchange=$('private-consent').onchange=updateExport;
async function currentExport() {
  const current=await api();
  if(!exporting||current.revision!==exporting.revision||current.data.report?.id!==exporting.report){closeExport();state=current;render();throw new Error('Your report changed. Make a fresh share card.');}
  if(!exportBlob)throw new Error('Wait for the image preview to finish.');
}
$('download').onclick=async()=>{
  try{await currentExport();const url=URL.createObjectURL(exportBlob);urls.add(url);const a=node('a');a.href=url;a.download='jules-my-style.png';a.click();void api({action:'event',name:'download_requested',card:exporting.card.id}).catch(()=>{});$('export-notice').textContent='Image downloaded. Add it to your story or send it to a friend.';}catch(e){$('export-notice').textContent=e.message;}
};
$('share').onclick=async()=>{
  if(!exportBlob||!exporting||exporting.revision!==state.revision)return;
  try{
    await currentExport();
    const file=new File([exportBlob],'jules-my-style.png',{type:'image/png'}),url=state.signup_url,text='Jules put together my style read. Get yours:';
    void api({action:'event',name:'share_requested',card:exporting.card.id}).catch(()=>{});
    if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],text,url});
    else if(navigator.share)await navigator.share({text,url});
    else{await navigator.clipboard.writeText(text+' '+url);$('export-notice').textContent='Signup link copied. Download the image above and attach it to your message.';}
  }catch(e){if(e.name!=='AbortError')$('export-notice').textContent='Sharing isn’t available here. Download the image and copy the signup link.';}
};
$('copy-link').onclick=async()=>{try{if(!state.signup_url)throw new Error();await navigator.clipboard.writeText(state.signup_url);$('export-notice').textContent='Signup link copied.';}catch{$('export-notice').textContent=state.signup_url||'The signup address has not been configured.';}};
window.addEventListener('storage',e=>{if(e.key==='jules_wishlist_session'&&!e.newValue){login();notice('Signed out.');}});
window.addEventListener('pageshow',e=>{if(e.persisted&&!session.read()){login();notice('Please sign in again.');}});
if(token){work(load);}else{login();notice('');}
