import {mountHeader} from './design-system.js';
mountHeader('style');
import {createSession} from './wishlist-session.js';
import {cardText,renderShareCard,canvasBlob} from './style-export.js';
const $=id=>document.getElementById(id);
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let token=session.read()?.access_token||sessionStorage.getItem('jules_wishlist_token'),state=null,busy=false,generation=0;
let exporting=null,exportVersion=0,exportBlob=null;
const urls=new Set();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token')){token=fragment.get('access_token');session.save({access_token:token,refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});sessionStorage.removeItem('jules_wishlist_token');}
if(location.hash)history.replaceState(null,'','/style');
const notice=text=>{$('notice').textContent=text;};
function node(tag,text,cls){const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
function button(text,work){const el=node('button',text);el.type='button';el.onclick=work;return el;}
function clear(){generation++;exportVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();$('sources').replaceChildren();$('cards').replaceChildren();$('export-preview').replaceChildren();$('export-dialog').close();exportBlob=null;exporting=null;state=null;}
function login(){clear();token=null;session.clear();sessionStorage.removeItem('jules_wishlist_token');$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;}
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
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Please try again.');return value;
}
async function work(fn) {
  if(busy)return;busy=true;$('workspace').setAttribute('aria-busy','true');
  const controls=[...$('workspace').querySelectorAll('button,input,select,textarea')].map(el=>({el,disabled:el.disabled}));
  controls.forEach(({el})=>el.disabled=true);
  try{await fn();}catch(e){notice(e.message);}
  finally{busy=false;$('workspace').setAttribute('aria-busy','false');controls.forEach(({el,disabled})=>{if(el.isConnected)el.disabled=disabled;});if(state)$('analyze').disabled=!state.sources.some(s=>s.kind==='outfit');}
}
async function blobURL(query){const response=await authFetch('/api/style'+query);if(!response.ok)throw new Error('Could not load this image.');const url=URL.createObjectURL(await response.blob());urls.add(url);return url;}
function privatePhoto(query,alt) {
  const img=node('img');img.alt=alt;const v=generation;
  blobURL(query).then(url=>{if(v===generation)img.src=url;}).catch(()=>{img.alt='Image unavailable';});return img;
}
function renderSources() {
  $('sources').replaceChildren();
  for(const s of state.sources) {
    const tile=node('article',null,'source-tile');
    tile.append(s.mime_type==='application/pdf'?node('div','Receipt PDF','pdf-tile'):privatePhoto('?source='+s.id,s.kind==='outfit'?'Your outfit':s.kind==='inspiration'?'Style inspiration':'Receipt'));
    tile.append(node('p',({outfit:'Your outfit',inspiration:'Inspiration',receipt:'Receipt'})[s.kind]+(s.occasion?' / '+s.occasion:'')));
    if(s.note)tile.append(node('p',s.note));
    tile.append(button('Remove',()=>work(async()=>{state=await api({action:'remove',source:s.id});render();notice('Removed. The old report and its preferences have been cleared.');})));
    $('sources').append(tile);
  }
}
function checkbox(text,checked=false) {
  const label=node('label',null,'check'),input=node('input');input.type='checkbox';input.checked=checked;label.append(input,node('span',text));return {label,input};
}
function renderCards() {
  const report=state.data.report;
  $('cards').replaceChildren();$('report-section').hidden=!report;
  if(!report)return;
  const draft=report.status==='draft';
  $('report-stage').textContent=draft?'02 / CHECK MY READ':'03 / MAKE IT YOURS';
  $('report-heading').textContent=draft?'Does this sound like you?':'Your style, in a few words.';
  $('report-description').textContent=draft?'Keep what fits, correct what doesn’t, and choose the shopping preferences I should remember. These are interpretations of the inputs you shared.':'Choose a tone, explore the evidence, or make a share card. Your inputs and evidence stay private.';
  $('confirm').hidden=!draft;$('confirmed-note').hidden=draft;
  report.cards.forEach((card,index)=>{
    const article=node('article',null,'style-card');article.dataset.type=card.type;article.dataset.id=card.id;
    if(card.hidden)article.classList.add('hidden-card');
    article.append(node('p',`${String(index+1).padStart(2,'0')} / ${card.private?'SHOPPING HISTORY · PRIVATE BY DEFAULT':'YOUR STYLE'}`,'card-number'),node('h3',card.title),node('p',cardText(card,state.data.tone),'card-copy'));
    if(card.type==='starter'&&report.analysis.crops.length) {
      const gallery=node('div',null,'crop-grid');
      report.analysis.crops.forEach((c,i)=>{const figure=node('figure');figure.append(privatePhoto(`?crop=${i}&report=${report.id}`,c.label),node('figcaption',c.label));gallery.append(figure);});article.append(gallery);
    }
    const detail=node('details');detail.append(node('summary','Why Jules thinks this'));
    const evidence=node('div',null,'evidence');
    for(const o of report.analysis.observations.filter(o=>card.observation_ids.includes(o.id))) {
      evidence.append(node('p',o.text),node('p',o.confidence==='low'?'Tentative interpretation':'From your submitted evidence','fine'));
      for(const id of o.source_ids) {
        if(id==='context'){evidence.append(node('p','Your style notes','fine'));continue;}
        const source=state.sources.find(s=>s.id===id);if(!source)continue;
        evidence.append(button('View '+(source.kind==='outfit'?'outfit':source.kind==='inspiration'?'inspiration':'receipt'),()=>work(async()=>{
          const url=await blobURL('?source='+id);const a=node('a');a.href=url;a.target='_blank';a.rel='noopener';if(source.mime_type==='application/pdf')a.download='receipt.pdf';a.click();
        })));
      }
    }
    detail.append(evidence);article.append(detail);
    if(draft) {
      const review=node('div',null,'review'),set=node('fieldset');set.append(node('legend','Does this fit?'));
      for(const [value,label] of [['yes','That’s me'],['partly','Partly'],['no','Not me']]){
        const l=node('label'),r=node('input');r.type='radio';r.name='review-'+card.id;r.value=value;l.append(r,document.createTextNode(label));set.append(l);
      }
      const correctionLabel=node('label','Your version, if I missed something'),correction=node('textarea');correction.maxLength=420;correction.rows=2;correction.dataset.correction='true';correction.placeholder='This replaces the card copy in every tone.';correctionLabel.append(correction);review.append(set,correctionLabel);
      if(card.preferences.length)review.append(node('p','Select only what you want Jules to remember. You can edit each preference first.','fine'));
      for(const p of card.preferences) {
        const row=node('div',null,'preference'),check=checkbox('Remember this '+p.field+' preference');row.dataset.observation=p.observation_id;
        const input=node('input');input.type='text';input.value=p.value;input.maxLength=400;input.setAttribute('aria-label','Shopping preference to remember');row.append(check.label,input);review.append(row);
      }
      article.append(review);
    } else {
      const actions=node('div',null,'card-actions');
      if(card.accepted)actions.append(button(card.hidden?'Show card':'Hide card',()=>work(async()=>{state=await api({action:'hide',card:card.id,hidden:!card.hidden});renderCards();notice('');})));
      if(card.accepted&&!card.hidden)actions.append(button('Make a share card ↗',()=>openExport(card)));
      if(!card.accepted)article.append(node('p','You left this interpretation out.','fine'));
      article.append(actions);
    }
    $('cards').append(article);
  });
}
function render() {
  generation++;exportVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();
  $('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;
  $('context').value=state.data.notes??'';
  for(const r of document.querySelectorAll('input[name=tone]'))r.checked=r.value===state.data.tone;
  const hasReport=Boolean(state.data.report);
  $('inputs').hidden=$('style-intro').hidden=$('style-steps').hidden=hasReport;
  if(!hasReport)renderSources();else $('sources').replaceChildren();
  renderCards();$('analyze').disabled=!state.sources.some(s=>s.kind==='outfit');
  if(state.data.busy_until&&Date.parse(state.data.busy_until)>Date.now())notice('Your style analysis is running. Reload in a moment to see the result.');
}
async function load(){state=await api();render();if(!state.data.busy_until)notice('');}

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
$('upload-form').onsubmit=e=>{e.preventDefault();work(async()=>{
  const files=[...$('files').files],kind=$('kind').value,occasion=$('occasion').value,note=$('source-note').value;
  if(files.length+state.sources.length>12)throw new Error('You can add up to 12 files total.');
  if(!$('consent').checked)throw new Error('Approve private storage and analysis before uploading.');
  let count=0;
  try{for(const file of files){notice(`Saving ${count+1} of ${files.length}…`);state=await api({action:'upload',kind,occasion,note,data:await encodeFile(file),consent:true});count++;}}
  finally{render();}
  $('files').value='';notice(`${count} ${count===1?'file':'files'} saved privately.`);
});};
$('context-form').onsubmit=e=>{e.preventDefault();work(async()=>{state=await api({action:'context',notes:$('context').value});render();notice('Notes saved.');});};
$('analyze').onclick=()=>work(async()=>{
  if(!$('consent').checked)throw new Error('Check the private storage and OpenAI analysis approval above to continue.');
  if($('context').value.trim()!==state.data.notes){state=await api({action:'context',notes:$('context').value});}
  notice('Reading your outfits and receipts, then putting your report together…');
  try{state=await api({action:'analyze',consent:true});render();notice('Check my read before we save any preferences.');$('report-section').scrollIntoView({behavior:'instant',block:'start'});}
  catch(e){try{state=await api();render();}catch{}throw e;}
});
for(const radio of document.querySelectorAll('input[name=tone]'))radio.onchange=()=>work(async()=>{
  const tone=radio.value;state=await api({action:'tone',tone});
  // Keep unsaved confirmation selections and corrections intact when changing tone.
  document.querySelectorAll('.style-card').forEach(el=>{const card=state.data.report.cards.find(c=>c.id===el.dataset.id);el.querySelector('.card-copy').textContent=cardText(card,tone);});notice('');
});
$('confirm').onclick=()=>work(async()=>{
  const reviews=state.data.report.cards.map(card=>{
    const el=document.querySelector(`[data-id="${card.id}"]`),choice=el.querySelector('input[type=radio]:checked')?.value;
    if(!choice)throw new Error('Choose “That’s me,” “Partly,” or “Not me” for each card.');
    const correction=el.querySelector('[data-correction]').value.trim();if(choice==='partly'&&!correction)throw new Error('Add your version for the cards marked “Partly.”');
    return {id:card.id,accepted:choice!=='no',hidden:choice==='no',correction,preferences:card.preferences.map(p=>{
      const row=el.querySelector(`[data-observation="${p.observation_id}"]`);return {observation_id:p.observation_id,accepted:row.querySelector('input[type=checkbox]').checked,value:row.querySelector('input[type=text]').value};
    })};
  });
  state=await api({action:'confirm',reviews});renderCards();notice('Your read is saved. Only the preferences you selected will guide shopping.');
});
$('edit-inputs').onclick=()=>{$('inputs').hidden=false;renderSources();$('inputs').scrollIntoView({behavior:'instant',block:'start'});};
$('delete').onclick=()=>$('delete-dialog').showModal();$('delete-cancel').onclick=()=>$('delete-dialog').close();
$('delete-confirm').onclick=()=>work(async()=>{state=await api({action:'delete'});$('delete-dialog').close();$('consent').checked=false;render();notice('Your style uploads, report, and its saved preferences were deleted.');});

function closeExport(){exportVersion++;exportBlob=null;exporting=null;$('export-dialog').close();$('export-preview').replaceChildren();}
$('export-close').onclick=closeExport;$('export-dialog').addEventListener('cancel',closeExport);
function openExport(card){
  exporting={card,report:state.data.report.id,tone:state.data.tone,revision:state.revision};exportBlob=null;
  $('private-consent').checked=false;$('photo-consent').checked=false;
  $('private-consent-label').hidden=!card.private;
  $('photo-consent-label').hidden=card.type!=='starter'||!state.data.report.analysis.crops.length;
  $('export-dialog').showModal();updateExport();
}
async function updateExport() {
  const v=++exportVersion;exportBlob=null;$('download').disabled=$('share').disabled=true;$('export-preview').replaceChildren();$('export-notice').textContent='';
  if(!exporting)return;
  if(exporting.card.private&&!$('private-consent').checked){$('export-notice').textContent='Choose whether to include this shopping-history card.';return;}
  try {
    const images=[];
    if($('photo-consent').checked&&!$('photo-consent-label').hidden)for(const [index,c] of state.data.report.analysis.crops.entries()){
      const img=new Image();img.src=await blobURL(`?crop=${index}&report=${exporting.report}`);await img.decode();images.push({image:img,label:c.label});
    }
    if(v!==exportVersion||!exporting)return;
    await document.fonts.ready;
    const canvas=renderShareCard({card:exporting.card,tone:exporting.tone,crops:images,signupURL:state.signup_url});
    const blob=await canvasBlob(canvas);if(v!==exportVersion)return;
    exportBlob=blob;$('export-preview').replaceChildren(canvas);$('download').disabled=false;$('share').disabled=!state.signup_url;
  }catch(e){if(v===exportVersion)$('export-notice').textContent=e.message;}
}
$('photo-consent').onchange=$('private-consent').onchange=updateExport;
async function currentExport() {
  const current=await api();
  if(!exporting||current.revision!==exporting.revision||current.data.report?.id!==exporting.report){closeExport();state=current;render();throw new Error('Your report changed. Make a fresh share card.');}
  if(!exportBlob)throw new Error('Wait for the image preview to finish.');
}
$('download').onclick=async()=>{
  try{await currentExport();const url=URL.createObjectURL(exportBlob);urls.add(url);const a=node('a');a.href=url;a.download='jules-my-style.png';a.click();void api({action:'event',name:'download_requested',card:exporting.card.id}).catch(()=>{});$('export-notice').textContent='Image downloaded. Add it to your story or send it to a friend.';}catch(e){notice(e.message);}
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
