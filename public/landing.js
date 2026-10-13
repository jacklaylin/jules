import {createLogo,initBrandActivity} from './brand-ui.js';
import {demoState,DEMO_DURATION,approachDemoTime,bubbleProgress} from './landing-timeline.js';
const logo=document.getElementById('headline-logo');logo.replaceChildren(createLogo());initBrandActivity();
const motion=matchMedia('(prefers-reduced-motion: reduce)'),chat=document.getElementById('demo-chat'),messages=[...chat.querySelectorAll('[data-at]')],typing=document.getElementById('demo-typing'),replay=document.getElementById('demo-replay');
for(const bubble of chat.querySelectorAll('.received')){const avatar=document.createElement('span');avatar.className='message-avatar';avatar.innerHTML='<span class="orb"></span>';bubble.append(avatar);}
let time=0,mode='idle',playFrame=0,lastStamp=null,scrollFrame=0,chatFrame=0,idleTimer,touch=false;
document.documentElement.classList.add('demo-ready');
function setMode(value){mode=value;document.body.dataset.demoMode=value;}
function keepLatestVisible(animate){
 cancelAnimationFrame(chatFrame);
 const target=Math.max(0,chat.scrollHeight-chat.clientHeight);
 if(!animate||motion.matches){chat.scrollTop=target;return;}
 const start=chat.scrollTop,stamp=performance.now();
 function step(now){const progress=Math.min(1,(now-stamp)/700);chat.scrollTop=start+(target-start)*(1-Math.pow(1-progress,3));if(progress<1)chatFrame=requestAnimationFrame(step);}
 chatFrame=requestAnimationFrame(step);
}
function render(t,{animate=true}={}){
 const state=demoState(t,motion.matches);time=state.time;let changed=false;
 for(const message of messages){
  const visible=Number(message.dataset.at)<=state.time;
  if(message.hidden===visible)changed=true;
  message.hidden=!visible;
  const p=motion.matches||message.classList.contains('demo-delivered')?1:bubbleProgress(time,Number(message.dataset.at));
  message.style.opacity=String(p);message.style.transform=`translateY(${(1-p)*14}px) scale(${.92+.08*p})`;
  message.style.transformOrigin=message.classList.contains('sent')?'bottom right':'bottom left';
 }
 const bubbles=messages.filter(message=>!message.hidden&&message.matches('.demo-bubble,.demo-photo,.demo-link'));
 bubbles.forEach((message,index)=>{const next=bubbles[index+1];message.classList.toggle('group-end',!next||message.classList.contains('sent')!==next.classList.contains('sent'));});
 if(typing.hidden===state.typing)changed=true;
 typing.hidden=!state.typing;typing.style.opacity=String(state.typingProgress);
 const done=!motion.matches&&state.time>=DEMO_DURATION;
 if(replay.hidden===done){changed=true;replay.hidden=!done;chat.classList.toggle('demo-complete',done);}
 if(changed)keepLatestVisible(animate);
}
function play(stamp){
 if(mode!=='autoplay'||document.hidden)return;
 const elapsed=lastStamp===null?0:Math.min((stamp-lastStamp)/1000,.1);lastStamp=stamp;
 render(time+elapsed);
 if(time>=DEMO_DURATION)setMode('complete');else playFrame=requestAnimationFrame(play);
}
function stopForScroll(){
 if(motion.matches)return;
 clearTimeout(idleTimer);setMode('manual');cancelAnimationFrame(playFrame);lastStamp=null;
}
function scrub(stamp){
 scrollFrame=0;if(motion.matches||document.hidden)return;
 const range=Math.max(1,document.querySelector('.scroll-story').offsetHeight-innerHeight),target=Math.max(0,Math.min(1,scrollY/range))*DEMO_DURATION;
 const delta=lastStamp===null?1/60:Math.min(.05,(stamp-lastStamp)/1000);lastStamp=stamp;
 const next=approachDemoTime(time,target,{touch,deltaSeconds:delta});render(next);
 if(next!==target)scrollFrame=requestAnimationFrame(scrub);else lastStamp=null;
}
window.addEventListener('wheel',()=>{touch=false;stopForScroll();},{passive:true});
window.addEventListener('touchmove',()=>{touch=true;stopForScroll();},{passive:true});
window.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)&&!event.target.closest('input,button,a')){touch=false;stopForScroll();}});
window.addEventListener('scroll',()=>{if(motion.matches)return;stopForScroll();if(!scrollFrame)scrollFrame=requestAnimationFrame(scrub);},{passive:true});
window.addEventListener('resize',()=>keepLatestVisible(false));
function start(){
 clearTimeout(idleTimer);cancelAnimationFrame(playFrame);cancelAnimationFrame(chatFrame);cancelAnimationFrame(scrollFrame);lastStamp=null;
 setMode(motion.matches?'reduced':'idle');render(motion.matches?DEMO_DURATION:0,{animate:false});
 if(!motion.matches)idleTimer=setTimeout(()=>{if(mode==='idle'){setMode('autoplay');playFrame=requestAnimationFrame(play);}},6000);
}
replay.addEventListener('click',()=>{
 clearTimeout(idleTimer);cancelAnimationFrame(playFrame);cancelAnimationFrame(scrollFrame);lastStamp=null;
 render(0);setMode('autoplay');playFrame=requestAnimationFrame(play);
});
motion.addEventListener('change',start);
document.addEventListener('visibilitychange',()=>{
 document.documentElement.classList.toggle('demo-paused',document.hidden);cancelAnimationFrame(playFrame);cancelAnimationFrame(scrollFrame);lastStamp=null;
 if(!document.hidden&&mode==='autoplay')playFrame=requestAnimationFrame(play);
 if(!document.hidden&&mode==='manual')scrollFrame=requestAnimationFrame(scrub);
});
chat.querySelector('img').addEventListener('load',()=>keepLatestVisible(false));
document.fonts.ready.then(()=>keepLatestVisible(false));
start();
