import {createLogo,initBrandActivity} from './brand-ui.js';
import {demoState,DEMO_DURATION} from './landing-timeline.js';
const logo=document.getElementById('headline-logo');logo.replaceChildren(createLogo());initBrandActivity();
const motion=matchMedia('(prefers-reduced-motion: reduce)'),chat=document.getElementById('demo-chat'),messages=[...chat.querySelectorAll('[data-at]')],typing=document.getElementById('demo-typing'),slider=document.getElementById('demo-progress');
let time=0,mode='autoplay',playFrame=0,lastStamp=null,scrollFrame=0,chatFrame=0;
let scrubAnchor=null;
document.documentElement.classList.add('demo-ready');
function setMode(value){mode=value;document.body.dataset.demoMode=value;}
for(const message of [...messages,typing])message.addEventListener('animationend',event=>{if(event.target===message)message.classList.remove('demo-enter','typing-enter');});
function reveal(message,visible,animate){
 if(visible===!message.hidden)return false;
 message.hidden=!visible;
 if(visible&&animate&&!motion.matches)message.classList.add(message===typing?'typing-enter':'demo-enter');
 else message.classList.remove('demo-enter','typing-enter');
 return true;
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
 const state=demoState(t,motion.matches);time=state.time;let changed=false;
 for(const message of messages)changed=reveal(message,Number(message.dataset.at)<=state.time,animate)||changed;
 const visibleBubbles=messages.filter(message=>!message.hidden&&message.matches('.demo-bubble,.demo-photo'));
 visibleBubbles.forEach((message,index)=>{const next=visibleBubbles[index+1];message.classList.toggle('group-end',!next||message.classList.contains('sent')!==next.classList.contains('sent'));});
 changed=reveal(typing,state.typing,animate)||changed;
 document.querySelectorAll('[data-chapter]').forEach(el=>el.classList.toggle('active',Number(el.dataset.chapter)===state.chapter));
 slider.value=Math.round(state.time*10);
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
 if(mode!=='manual'){scrubAnchor={scroll:scrollY,time};setMode('manual');cancelAnimationFrame(playFrame);lastStamp=null;}
}
function scrub(){
 scrollFrame=0;if(motion.matches)return;
 const range=Math.max(1,document.querySelector('.scroll-story').offsetHeight-innerHeight);
 const target=scrubAnchor?scrubAnchor.time+(scrollY-scrubAnchor.scroll)/range*DEMO_DURATION:scrollY/range*DEMO_DURATION;
 render(target);
}
// Scroll gestures hand control to the user without jumping back to the start.
window.addEventListener('wheel',stopForScroll,{passive:true});
window.addEventListener('touchmove',stopForScroll,{passive:true});
window.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)&&!event.target.closest('input,button,a'))stopForScroll();});
window.addEventListener('scroll',()=>{if(motion.matches)return;stopForScroll();if(!scrollFrame)scrollFrame=requestAnimationFrame(scrub);},{passive:true});
window.addEventListener('resize',()=>keepLatestVisible(false));
slider.addEventListener('input',()=>{stopForScroll();render(Number(slider.value)/10);scrubAnchor={scroll:scrollY,time};});
motion.addEventListener('change',()=>{
 cancelAnimationFrame(playFrame);cancelAnimationFrame(chatFrame);lastStamp=null;slider.disabled=motion.matches;scrubAnchor=null;
 setMode(motion.matches?'reduced':'autoplay');render(motion.matches?DEMO_DURATION:0,{animate:false});
 if(!motion.matches)playFrame=requestAnimationFrame(play);
});
document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(playFrame);lastStamp=null;if(!document.hidden&&mode==='autoplay')playFrame=requestAnimationFrame(play);});
chat.querySelector('img').addEventListener('load',()=>keepLatestVisible(false));
document.fonts.ready.then(()=>keepLatestVisible(false));
slider.disabled=motion.matches;setMode(motion.matches?'reduced':'autoplay');render(motion.matches?DEMO_DURATION:0,{animate:false});
if(!motion.matches)playFrame=requestAnimationFrame(play);
