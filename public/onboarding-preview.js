import {mountPublicHeader} from './design-system.js';
import {createLogo} from './brand-ui.js';
mountPublicHeader();
const $=id=>document.getElementById(id),key='jules_onboarding_preview';
let state={step:0,messages:[],saved:false},timer;
try{const saved=JSON.parse(sessionStorage.getItem(key));if(saved&&Number.isInteger(saved.step)&&saved.step>=0&&saved.step<=6&&Array.isArray(saved.messages))state=saved;}catch{}
const text=(tag,copy)=>{const el=document.createElement(tag);el.textContent=copy;return el;};
function message(who,body){state.messages.push({who,body});}
function next(step){state.step=step;sessionStorage.setItem(key,JSON.stringify(state));render();$('heading').tabIndex=-1;$('heading').focus();}
function button(label,action){const el=text('button',label);el.onclick=action;$('actions').append(el);return el;}
function render(){
 clearTimeout(timer);$('content').replaceChildren();$('actions').replaceChildren();$('notice').textContent='';$('step').textContent=`PREVIEW STEP ${state.step+1} OF 7`;
 $('thread').replaceChildren(...state.messages.map(m=>text('li',`${m.who}: ${m.body}`)));
 const headings=['Have to have it? Text Jules.','Sign up to text Jules.','A text from Jules.','Let Jules read your receipts.','Jules is thinking.','Your demo is ready.','Your practice wishlist.'];$('heading').textContent=headings[state.step];
 if(state.step===0){$('content').append(text('p','Start the onboarding walkthrough.'));button('Text Jules',()=>next(1));}
 if(state.step===1){
  $('content').append(text('p','Use a demo tester — no number or email required.'));
  const label=text('label',''),check=document.createElement('input');check.type='checkbox';check.id='preview-consent';label.className='check';label.append(check,document.createTextNode('I agree to the simulated signup. No real messaging consent is recorded.'));$('content').append(label);
  const signup=button('Sign up — preview',()=>{message('Jules','hey, it’s jules. want to try a style reading? Gmail is a demo for now.');next(2);});signup.disabled=true;check.onchange=()=>{signup.disabled=!check.checked;};
 }
 if(state.step===2){
  $('content').append(text('p',state.messages.at(-1)?.body||'Want to try a style reading?'));
  button('Reply yes',()=>{message('You','yes');message('Jules','great, open the Gmail demo to continue.');next(3);});
  button('Reply not now',()=>{message('You','not now');message('Jules','no problem. send me something you’d like to save whenever you’re ready.');next(6);});
 }
 if(state.step===3){$('content').append(text('p','This is the dummy Gmail button. No inbox will be accessed.'));button('Connect Gmail — demo',()=>{message('Jules','while you wait, send me things you like: photos, screenshots, links. tell me what you’d like saved.');next(4);});button('Not now',()=>next(6));}
 if(state.step===4){
  const logo=createLogo();logo.classList.add('logo--thinking');const frame=document.createElement('div');frame.id='thinking-logo';frame.append(logo);$('content').append(frame,text('p','Making room for your next favorite thing. You could close the real screen and wait for a text.'));
  button('Simulate the completion text',()=>{message('Jules','your style reading demo is ready. open your wishlist.');next(5);});
 }
 if(state.step===5){$('content').append(text('p','Jules: your style reading demo is ready.'));button('Open the text link',()=>{const frame=document.createElement('div');frame.id='thinking-logo';const logo=createLogo();logo.classList.add('logo--thinking');frame.append(logo);$('content').replaceChildren(frame,text('p','Taking you to your practice wishlist…'));$('actions').replaceChildren();timer=setTimeout(()=>next(6),matchMedia('(prefers-reduced-motion: reduce)').matches?0:1800);});}
 if(state.step===6){
  $('content').append(text('p',state.saved?'1 practice item saved in this preview. Your real wishlist is unchanged.':'The real flow opens your private wishlist here. Try the first-save step below.'));
  if(state.saved)$('content').append(text('h2','Your practice item'));
  else button('Simulate “save this to my wishlist”',()=>{state.saved=true;message('You','save this practice item to my wishlist');message('Jules','saved — your first practice item.');next(6);});
  const link=text('a','Open my real wishlist ↗');link.href='/wishlist';link.className='btn';$('actions').append(link);
 }
}
$('reset').onclick=()=>{state={step:0,messages:[],saved:false};next(0);};render();
