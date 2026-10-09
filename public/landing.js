import {createLogo,initBrandActivity} from './brand-ui.js';
import {demoState,DEMO_DURATION} from './landing-timeline.js';
const logo=document.getElementById('headline-logo');logo.replaceChildren(createLogo());initBrandActivity();
const motion=matchMedia('(prefers-reduced-motion: reduce)'),chat=document.getElementById('demo-chat'),messages=[...chat.querySelectorAll('[data-at]')],typing=document.getElementById('demo-typing'),slider=document.getElementById('demo-progress');
let scrollFrame=0;
document.documentElement.classList.add('demo-ready');
function render(t){
 const state=demoState(t,motion.matches);
 for(const message of messages){const visible=Number(message.dataset.at)<=state.time;if(visible&&message.hidden&&!motion.matches)message.classList.add('demo-enter');else message.classList.remove('demo-enter');message.hidden=!visible;}
 const visibleBubbles=messages.filter(message=>!message.hidden&&message.matches('.demo-bubble,.demo-photo'));
 visibleBubbles.forEach((message,index)=>{const next=visibleBubbles[index+1];message.classList.toggle('group-end',!next||message.classList.contains('sent')!==next.classList.contains('sent'));});
 typing.hidden=!state.typing;
 document.querySelectorAll('[data-chapter]').forEach(el=>el.classList.toggle('active',Number(el.dataset.chapter)===state.chapter));
 slider.value=Math.round(state.time*10);
 chat.scrollTop=chat.scrollHeight;
}
function fromScroll(){scrollFrame=0;render(scrollY/Math.max(1,document.querySelector('.scroll-story').offsetHeight-innerHeight)*DEMO_DURATION);}
window.addEventListener('scroll',()=>{if(!motion.matches&&!scrollFrame)scrollFrame=requestAnimationFrame(fromScroll);},{passive:true});
window.addEventListener('resize',fromScroll);
slider.addEventListener('input',()=>render(Number(slider.value)/10));
motion.addEventListener('change',()=>{slider.disabled=motion.matches;fromScroll();});
// Image decoding and font loading can change bubble heights, never the phone size.
chat.querySelector('img').addEventListener('load',()=>{chat.scrollTop=chat.scrollHeight;});
slider.disabled=motion.matches;fromScroll();
