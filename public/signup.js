// Signup as a short chat with Jules. Each answer is a real labelled input; one POST at the end.
// The page only asks fixed questions and checks formats: it never interprets free text as intent.
import {createLogo,initBrandActivity} from './brand-ui.js';
import {SIGNUP_CONSENT,SIGNUP_VERSION} from './signup-consent.js';
import {refFromSearch,rememberArrival} from './signup-ref.js';
import {splitName,maskBirthday,parseBirthday,starSign,GENDERS,validPhone,formatPhone,outcomeLines} from './signup-chat.js';

const $=id=>document.getElementById(id),thread=$('thread'),dock=$('dock');
$('signup-logo').replaceChildren(createLogo());initBrandActivity();
$('privacy-open').onclick=()=>$('signup-privacy').showModal();
const ref=refFromSearch(location.search),arrival=rememberArrival(()=>sessionStorage,{referrer:document.referrer,search:location.search,host:location.hostname});
const el=(tag,props={},...kids)=>{const node=Object.assign(document.createElement(tag),props);node.append(...kids.filter(k=>k!==null&&k!==undefined&&k!==false));return node;};

let state,seen=new Set();
const fresh=()=>({phase:'checking',available:false,answers:{},consent:false,editing:null,hint:{},error:'',outcome:null,requestId:crypto.randomUUID()});
state=fresh();

// The step still to answer, in order; an answer being edited takes precedence.
function currentStep(){
 const a=state.answers;
 if(state.editing)return state.editing;
 if(!a.first)return 'name';
 if(!a.last)return 'last';
 if(!a.birthday)return 'birthday';
 if(!a.gender)return 'gender';
 if(!a.phone)return 'phone';
 return 'consent';
}

function avatar(){return el('img',{className:'av-img',src:'/brand/avatar-orb.svg',alt:'',width:26,height:26});}
// A group of Jules's lines; the avatar sits beside the last one.
function jules(key,lines,{error=false}={}){
 return lines.map((text,i)=>{
  const row=el('div',{className:'them'+(error?' them--error':'')},el('span',{className:'av'},i===lines.length-1?avatar():null),el('div',{className:'bubble bubble--them',textContent:text}));
  if(error)row.setAttribute('role','alert');
  row.dataset.key=`${key}:${i}:${text}`;return row;
 });
}
// Your answer: a pill you can tap to change it until the signup is sent.
function mine(key,text,step,label,extra){
 const done=state.phase==='saving'||state.phase==='done';
 const pill=done?el('div',{className:'bubble bubble--me',textContent:text}):el('button',{type:'button',className:'bubble bubble--me',textContent:text,onclick:()=>{state.editing=step;render(true);}});
 if(!done)pill.setAttribute('aria-label',`Change your ${label}: ${text}`);
 const wrap=el('div',{className:'me'},pill,extra);wrap.dataset.key=`${key}:${text}:${done}`;return wrap;
}
const gap=()=>el('div',{className:'gap'});

function consentCard(){
 const text=el('span');
 // The stored disclosure is plain text; its policy names become links on the page.
 text.append(...SIGNUP_CONSENT.split(/(Privacy Policy|Terms)/).map(part=>['Privacy Policy','Terms'].includes(part)?el('a',{href:part==='Terms'?'/terms':'/privacy',target:'_blank',textContent:part}):part));
 const box=el('input',{type:'checkbox',id:'consent',checked:state.consent,disabled:state.phase!=='chat',onchange:e=>{state.consent=e.target.checked;renderDock();}});
 const card=el('label',{className:'check consent'},box,text);card.dataset.key=`consent-card:${state.phase==='chat'}`;return card;
}

function threadItems(){
 const a=state.answers,items=[];
 // The server can say why signup is closed (for example, Jules is over its spending cap: lib/cost-caps.js).
 if(state.phase==='closed')return jules('closed',state.closedMessage?['hey, it’s jules.',state.closedMessage]:['hey, it’s jules. signups aren’t open yet.','check back soon.']);
 if(state.phase==='unreachable')return jules('unreachable',['hey, it’s jules. i couldn’t check whether signups are open.','reload to try again.'],{error:true});
 items.push(...jules('intro',['hey, it’s jules. i’m a personal shopper who lives in your texts.','a few quick things and i’ll text you first.','what should i call you?']));
 if(state.phase==='checking')return items;
 if(a.first){items.push(gap(),mine('name',a.last&&a.oneWord!==true?`${a.first} ${a.last}`:a.first,'name','name'));}
 if(a.first&&a.oneWord){items.push(gap(),...jules('last',['and your last name?']));if(a.last)items.push(gap(),mine('last',a.last,'last','last name'));}
 if(!a.last)return items;
 items.push(gap(),...jules('hello',[`nice to meet you, ${a.first.toLowerCase()}.`,'when’s your birthday?']));
 if(state.hint.birthday)items.push(...jules('hint-bday',[state.hint.birthday],{error:true}));
 if(a.birthday){const sign=starSign(a.birthday.month,a.birthday.day);const tap=el('span',{className:'tapback',textContent:sign.symbol+'\uFE0E'});tap.setAttribute('role','img');tap.setAttribute('aria-label',`Jules reacted with the ${sign.name} sign`);items.push(gap(),mine('bday',a.birthday.text,'birthday','birthday',tap));}
 else return items;
 items.push(gap(),...jules('gender-q',['and which fits you best?']));
 if(!a.gender||state.editing==='gender'){items.push(gap(),genderChips());if(!a.gender)return items;}
 else items.push(gap(),mine('gender',GENDERS.find(([v])=>v===a.gender)[1],'gender','answer'));
 items.push(gap(),...jules('phone-q',['last one. what’s your number?','i’ll text you first.']));
 if(state.hint.phone)items.push(...jules('hint-phone',[state.hint.phone],{error:true}));
 if(!a.phone)return items;
 items.push(gap(),mine('phone',a.phone.text,'phone','number'));
 items.push(gap(),...jules('fine-q',['before i do, the fine print:']),consentCard());
 if(state.phase==='saving'||state.phase==='done'){const sent=el('div',{className:'me'},el('div',{className:'bubble bubble--me',textContent:'Have Jules text me'}));sent.dataset.key='sent';items.push(gap(),sent);}
 if(state.phase==='saving'){const typing=el('div',{className:'them'},el('span',{className:'av'},avatar()),el('div',{className:'bubble bubble--them typing'},el('i'),el('i'),el('i')));typing.setAttribute('aria-label','Jules is typing');typing.dataset.key='typing';items.push(gap(),typing);}
 if(state.error)items.push(gap(),...jules('error',[state.error],{error:true}));
 if(state.outcome)items.push(gap(),...jules('outcome',state.outcome.lines));
 return items;
}

function genderChips(){
 const set=el('fieldset',{className:'quick'});set.setAttribute('aria-label','Gender');set.dataset.key=`gender-chips:${state.answers.gender??''}`;
 for(const [value,label] of GENDERS){const input=el('input',{type:'radio',name:'gender',value,checked:state.answers.gender===value,onclick:()=>{answer({gender:value});}});set.append(el('label',{},input,label));}
 return set;
}

function compose(step){
 const spec={
  name:{label:'Your first and last name',placeholder:'First and last name',autocomplete:'name',value:state.answers.first?[state.answers.first,state.answers.oneWord?'':state.answers.last].filter(Boolean).join(' '):''},
  last:{label:'Your last name',placeholder:'Last name',autocomplete:'family-name',value:state.answers.oneWord?state.answers.last??'':''},
  birthday:{label:'Your birthday, month, day and year',placeholder:'MM / DD / YYYY',autocomplete:'bday',inputMode:'numeric',value:state.answers.birthday?.text??''},
  phone:{label:'Your mobile number. In the US or Canada, 10 digits; elsewhere start with + and your country code',placeholder:'Mobile number',autocomplete:'tel',type:'tel',inputMode:'tel',value:state.answers.phone?.text??''},
 }[step];
 const input=el('input',{id:'reply',type:spec.type??'text',placeholder:spec.placeholder,autocomplete:spec.autocomplete,maxLength:step==='phone'?32:80,value:state.draft?.step===step?state.draft.value:spec.value,enterKeyHint:'send'});
 if(spec.inputMode)input.inputMode=spec.inputMode;
 input.setAttribute('aria-label',spec.label);
 if(step==='birthday')input.addEventListener('input',()=>{input.value=maskBirthday(input.value);});
 const form=el('form',{className:'compose',onsubmit:e=>{e.preventDefault();submitStep(step,input.value);}},input,el('button',{type:'submit',className:'send',textContent:'↑'}));
 form.lastChild.setAttribute('aria-label','Send');
 return form;
}

function submitStep(step,value){
 value=value.trim();if(!value)return;
 if(step==='name'){const name=splitName(value);if(!name)return;answer(name.last?{first:name.first,last:name.last,oneWord:false}:{first:name.first,last:'',oneWord:true});return;}
 if(step==='last'){answer({last:value});return;}
 if(step==='birthday'){
  const parsed=parseBirthday(value);
  if(parsed.error){state.draft={step,value};state.hint.birthday=parsed.error==='under_18'?'you need to be 18 or older to use jules.':parsed.error==='format'?'i need that as MM / DD / YYYY.':'that date doesn’t look right. try MM / DD / YYYY.';render(true);return;}
  state.hint.birthday='';answer({birthday:{...parsed,text:maskBirthday(value)}});return;
 }
 if(step==='phone'){
  const e164=validPhone(value);
  if(!e164){state.draft={step,value};state.hint.phone='that number doesn’t look right. in the US or Canada, use 10 digits; elsewhere start with + and your country code.';render(true);return;}
  state.hint.phone='';answer({phone:{text:formatPhone(e164,value),e164}});
 }
}

function answer(values){
 Object.assign(state.answers,values);
 state.editing=null;state.error='';state.draft=null;state.requestId=crypto.randomUUID();
 render(true);
}

function renderDock(focus){
 const step=currentStep();
 dock.replaceChildren();
 if(state.phase==='chat'){
  if(step==='gender'){const off=el('div',{className:'compose compose--off'},el('span',{textContent:'Pick one above'}));dock.append(off);}
  else if(step==='consent'){const go=el('button',{type:'button',id:'signup-button',className:'btn--butter',textContent:'Have Jules text me',disabled:!state.consent||!state.available,onclick:send});dock.append(go);}
  else{dock.append(compose(step));if(focus)$('reply').focus();}
 }
 if(state.phase==='done'){
  if(state.outcome.open&&state.outcome.text_url)dock.append(el('a',{className:'btn btn--butter',id:'start-text',href:state.outcome.text_url,textContent:'Open Messages ↗'}));
  dock.append(el('button',{type:'button',className:'link-button',textContent:'Wrong number? Start over',onclick:()=>{const answers={...state.answers,phone:undefined};state={...fresh(),available:state.available,phase:'chat',answers};render(true);}}));
 }
}

function render(focus=false){
 const items=threadItems();
 for(const item of items){const key=item.dataset?.key;if(key&&!seen.has(key)){item.classList.add('new');item.addEventListener('animationend',()=>item.classList.remove('new'),{once:true});seen.add(key);}}
 // Lines already on screen are kept as they are, so the live region only announces new ones.
 const old=new Map([...thread.children].filter(n=>n.dataset.key).map(n=>[n.dataset.key,n]));
 thread.replaceChildren(...items.map(item=>old.get(item.dataset?.key)??item));
 document.body.classList.toggle('chatting',Boolean(state.answers.first));
 renderDock(focus);
 thread.scrollTop=thread.scrollHeight;
}

async function send(){
 if(state.phase!=='chat'||!state.consent||!state.available)return;
 const a=state.answers;
 state.phase='saving';state.error='';render();
 try{
  const response=await fetch('/api/wishlist?public_signup=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:a.phone.e164,profile:{first_name:a.first,last_name:a.last,birthday:a.birthday.iso,gender:a.gender},consent:state.consent,consent_version:SIGNUP_VERSION,request_id:state.requestId,...(ref?{ref}:{}),...(arrival?{arrival}:{})})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.saved!==true)throw new Error(result.error||'Could not save your signup. Please try again.');
  // Jules's closing lines say what actually happened; a waitlisted number is asked to text first (lib/waitlist.js).
  state.outcome={...outcomeLines(result,a.phone.e164),text_url:result.text_url};state.phase='done';
 }catch(error){state.phase='chat';state.error=`hmm, that didn’t go through. ${error.message}`;}
 render();
 if(state.phase==='done')($('start-text')??thread).focus?.();
}

render();
try{
 const response=await fetch('/api/wishlist?public_signup=1');const config=await response.json();
 state.available=response.ok&&config.enabled===true;state.phase=state.available?'chat':'closed';if(typeof config.message==='string')state.closedMessage=config.message;
}catch{state.phase='unreachable';}
// Desktop starts typing straight away; phones wait for a tap so the keyboard doesn't cover the welcome.
render(matchMedia('(pointer:fine)').matches);
