import {createLogo,initBrandActivity} from './brand-ui.js';
import {demoState,bubbleProgress,pickDemo,PLAYBACK_RATE} from './landing-timeline.js';
import {carryRef,rememberArrival} from './signup-ref.js';
carryRef(document.querySelectorAll('a[href="/signup"]'),location.search);
rememberArrival(()=>sessionStorage,{referrer:document.referrer,search:location.search,host:location.hostname});
// Leaving for signup: hand the view transition only the label, so the signup page draws one pill that grows into the compose box
const cta=document.querySelector('.landing-actions .btn--butter');
addEventListener('pageswap',e=>{if(e.viewTransition)cta.classList.add('vt-bare');});
addEventListener('pageshow',()=>cta.classList.remove('vt-bare'));
const logo=document.getElementById('headline-logo');logo.replaceChildren(createLogo());initBrandActivity();
const motion=matchMedia('(prefers-reduced-motion: reduce)'),chat=document.getElementById('demo-chat'),scenes=[...chat.querySelectorAll('.demo-scene')],typing=document.getElementById('demo-typing'),controls=document.getElementById('demo-controls'),replay=document.getElementById('demo-replay'),shuffle=document.getElementById('demo-shuffle');
for(const bubble of chat.querySelectorAll('.received')){const avatar=document.createElement('span');avatar.className='message-avatar';avatar.innerHTML='<span class="orb"></span>';bubble.append(avatar);}
let demo=pickDemo(),messages=[],time=0,mode='idle',playFrame=0,lastStamp=null,chatFrame=0,idleTimer;
document.documentElement.classList.add('demo-ready');
function setMode(value){mode=value;document.body.dataset.demoMode=value;}
function showScene(id){
 demo=id;
 for(const scene of scenes){const active=scene.dataset.demo===id;scene.hidden=!active;if(active)messages=[...scene.querySelectorAll('[data-at]')];}
 chat.dataset.demo=id;
}
function keepLatestVisible(animate){
 cancelAnimationFrame(chatFrame);
 const target=Math.max(0,chat.scrollHeight-chat.clientHeight);
 if(!animate||motion.matches){chat.scrollTop=target;return;}
 const start=chat.scrollTop,stamp=performance.now();
 function step(now){const progress=Math.min(1,(now-stamp)/700);chat.scrollTop=start+(target-start)*(1-Math.pow(1-progress,3));if(progress<1)chatFrame=requestAnimationFrame(step);}
 chatFrame=requestAnimationFrame(step);
}
function render(t,{animate=true}={}){
 const state=demoState(t,motion.matches,demo);time=state.time;let changed=false;
 for(const message of messages){
  const visible=Number(message.dataset.at)<=state.time;
  if(message.hidden===visible)changed=true;
  message.hidden=!visible;
  const p=motion.matches?1:bubbleProgress(time,Number(message.dataset.at));
  message.style.opacity=String(p);message.style.transform=`translateY(${(1-p)*14}px) scale(${.92+.08*p})`;
  message.style.transformOrigin=message.classList.contains('sent')?'bottom right':'bottom left';
 }
 const bubbles=messages.filter(message=>!message.hidden&&message.matches('.demo-bubble,.demo-photo,.demo-link'));
 bubbles.forEach((message,index)=>{const next=bubbles[index+1];message.classList.toggle('group-end',!next||message.classList.contains('sent')!==next.classList.contains('sent'));});
 if(typing.hidden===state.typing)changed=true;
 typing.hidden=!state.typing;typing.style.opacity=String(state.typingProgress);
 if(controls.hidden===state.done){changed=true;controls.hidden=!state.done;chat.classList.toggle('demo-complete',state.done);}
 replay.hidden=motion.matches;
 if(changed)keepLatestVisible(animate);
}
function play(stamp){
 if(mode!=='autoplay'||document.hidden)return;
 const elapsed=lastStamp===null?0:Math.min((stamp-lastStamp)/1000,.1);lastStamp=stamp;
 render(time+elapsed*PLAYBACK_RATE);
 if(demoState(time,false,demo).done)setMode('complete');else playFrame=requestAnimationFrame(play);
}
function autoplay(){
 clearTimeout(idleTimer);cancelAnimationFrame(playFrame);lastStamp=null;
 render(0);setMode('autoplay');playFrame=requestAnimationFrame(play);
}
window.addEventListener('resize',()=>keepLatestVisible(false));
function start(){
 clearTimeout(idleTimer);cancelAnimationFrame(playFrame);cancelAnimationFrame(chatFrame);lastStamp=null;
 showScene(demo);setMode(motion.matches?'reduced':'idle');render(motion.matches?Infinity:0,{animate:false});
 if(!motion.matches)idleTimer=setTimeout(()=>{if(mode==='idle'){setMode('autoplay');playFrame=requestAnimationFrame(play);}},300);
}
replay.addEventListener('click',autoplay);
shuffle.addEventListener('click',()=>{
 showScene(pickDemo(demo));
 if(motion.matches){render(Infinity,{animate:false});return;}
 chat.scrollTop=0;autoplay();
});
motion.addEventListener('change',start);
document.addEventListener('visibilitychange',()=>{
 document.documentElement.classList.toggle('demo-paused',document.hidden);cancelAnimationFrame(playFrame);lastStamp=null;
 if(!document.hidden&&mode==='autoplay')playFrame=requestAnimationFrame(play);
});
for(const image of chat.querySelectorAll('img'))image.addEventListener('load',()=>keepLatestVisible(false));
document.fonts.ready.then(()=>keepLatestVisible(false));
start();
