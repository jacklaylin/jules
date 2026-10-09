import {createLogo,initBrandActivity} from './brand-ui.js';
for(const brand of document.querySelectorAll('header .brand')){brand.replaceChildren(createLogo());brand.setAttribute('aria-label','Jules inbox');}
const empty=document.querySelector('.empty-mark');if(empty){empty.replaceChildren();const orb=document.createElement('span');orb.className='orb';orb.setAttribute('aria-hidden','true');empty.append(orb);}
initBrandActivity();
