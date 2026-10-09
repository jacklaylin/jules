// Shared outlined logo and request-driven animation. No message content is inspected.
export function createLogo(){
 const logo=document.createElement('span');logo.className='logo';logo.setAttribute('aria-hidden','true');
 const art=document.createElement('img');art.className='logo__art';art.src='/brand/wordmark.svg';art.alt='';art.width=1452;art.height=1050;
 const anchor=document.createElement('span');anchor.className='logo__anchor';
 const hx=document.createElement('span');hx.className='logo__hx';const hy=document.createElement('span');hy.className='logo__hy';const orb=document.createElement('span');orb.className='orb logo__dot';
 hy.append(orb);hx.append(hy);anchor.append(hx);logo.append(art,anchor);return logo;
}
let initialized=false,working=false,frames,finishTimer,frame=0,batchWorked=false;
export function initBrandActivity(){
 if(initialized)return;initialized=true;
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 const icon=document.querySelector('link[rel="icon"]');
 const setIcon=name=>{if(icon)icon.href='/brand/'+name+'.svg';};
 function sync(){
  clearInterval(frames);frames=null;
  const animate=working&&!motion.matches&&!document.hidden;
  document.querySelectorAll('.logo').forEach(logo=>logo.classList.toggle('logo--thinking',animate));
  setIcon('icon');
  if(animate){frame=0;frames=setInterval(()=>setIcon('thinking-'+(frame++%2+1)),350);}
 }
 document.addEventListener('jules:activity',event=>{
  const wasWorking=working;working=event.detail.agentWorking;if(working)batchWorked=true;if(wasWorking===working&&event.detail.busy)return;clearTimeout(finishTimer);
  document.querySelectorAll('.logo').forEach(logo=>logo.classList.remove('logo--done'));sync();
  if(!event.detail.busy&&batchWorked&&event.detail.success&&!motion.matches&&!document.hidden){
   document.querySelectorAll('.logo').forEach(logo=>logo.classList.add('logo--done'));setIcon('done');
   finishTimer=setTimeout(()=>{document.querySelectorAll('.logo').forEach(logo=>logo.classList.remove('logo--done'));setIcon('icon');},600);
  }
  if(!event.detail.busy)batchWorked=false;
 });
 motion.addEventListener('change',()=>{clearTimeout(finishTimer);document.querySelectorAll('.logo').forEach(logo=>logo.classList.remove('logo--done'));sync();});
 document.addEventListener('visibilitychange',sync);
}
