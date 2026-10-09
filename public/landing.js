import {createLogo} from './brand-ui.js';
import {mountPublicHeader} from './design-system.js';
import {demoState,DEMO_DURATION} from './landing-timeline.js';
const logo=document.getElementById('headline-logo');logo.replaceChildren(createLogo());mountPublicHeader();
const motion=matchMedia('(prefers-reduced-motion: reduce)'),chat=document.getElementById('demo-chat'),messages=[...chat.querySelectorAll('[data-at]')],typing=document.getElementById('demo-typing'),slider=document.getElementById('demo-progress'),watch=document.getElementById('watch');
let time=0,frame=0,playing=false,lastStamp,scrollFrame=0;
document.documentElement.classList.add('demo-ready');
function render(t){time=t;const state=demoState(t,motion.matches);for(const message of messages){const visible=Number(message.dataset.at)<=state.time;if(visible&&message.hidden&&!motion.matches)message.classList.add('demo-enter');else message.classList.remove('demo-enter');message.hidden=!visible;}typing.hidden=!state.typing;document.querySelectorAll('[data-chapter]').forEach(el=>el.classList.toggle('active',Number(el.dataset.chapter)===state.chapter));slider.value=Math.round(state.time*10);chat.scrollTop=chat.scrollHeight;}
function stop(){playing=false;cancelAnimationFrame(frame);watch.textContent=motion.matches?'Demo complete':'Watch it work ↓';}
function autoplay(stamp){if(!playing)return;const elapsed=Math.min((stamp-lastStamp)/1000,.1);lastStamp=stamp;render(Math.min(DEMO_DURATION,time+elapsed));if(time>=DEMO_DURATION)stop();else frame=requestAnimationFrame(autoplay);}
watch.onclick=()=>{if(motion.matches)return;if(playing){stop();return;}playing=true;render(0);lastStamp=performance.now();watch.textContent='Pause demo';frame=requestAnimationFrame(autoplay);};
function fromScroll(){scrollFrame=0;stop();render(scrollY/Math.max(1,document.querySelector('.scroll-story').offsetHeight-innerHeight)*DEMO_DURATION);}
window.addEventListener('scroll',()=>{if(!motion.matches&&!scrollFrame)scrollFrame=requestAnimationFrame(fromScroll);},{passive:true});
window.addEventListener('resize',()=>{if(!playing)fromScroll();});
slider.addEventListener('input',()=>{stop();render(Number(slider.value)/10);});
motion.addEventListener('change',()=>{stop();watch.disabled=motion.matches;slider.disabled=motion.matches;fromScroll();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
watch.disabled=motion.matches;slider.disabled=motion.matches;fromScroll();
