export function mountHeader(page){
 const header=document.querySelector('.app-header');
 const brand=document.createElement('a');brand.className='wordmark';brand.href='/wishlist';brand.setAttribute('aria-label','Jules wishlist');
 const glyph=document.createElement('span');glyph.className='wordmark-glyph';glyph.textContent='jules';brand.append(glyph);
 const nav=document.createElement('nav');nav.className='header-actions';nav.setAttribute('aria-label','Your collection');
 const link=document.createElement('a');link.href=page==='wishlist'?'/style':'/wishlist';link.textContent=page==='wishlist'?'Your style ↗':'Wishlist ↗';
 const logout=document.createElement('button');logout.id='logout';logout.type='button';logout.hidden=true;logout.textContent='Log out ↗';
 nav.append(link,logout);header.replaceChildren(brand,nav);initTheme();
}
function initTheme(){
function neonPress(event){const control=event.target.closest('button,a');if(control&&!control.disabled)control.dataset.neon=String(Math.floor(Math.random()*6));}
document.addEventListener('pointerdown',neonPress);
document.addEventListener('keydown',event=>{if(!event.repeat&&['Enter',' '].includes(event.key))neonPress(event);});
document.addEventListener('pointerover',event=>{const control=event.target.closest('button,a');if(control&&!control.contains(event.relatedTarget))neonPress(event);});
const wordmark=document.querySelector('.wordmark');
wordmark.dataset.neon=String(Math.floor(Math.random()*6));
wordmark.addEventListener('pointerenter',event=>{
 if(event.pointerType==='touch'||!matchMedia('(hover:hover) and (pointer:fine)').matches)return;
 const previous=Number(wordmark.dataset.neon);
 wordmark.dataset.neon=String((previous+1+Math.floor(Math.random()*5))%6);
});
const header=document.querySelector('header');
let headerTick=false;
function updateHeader(){header.classList.toggle('compact',scrollY>8);headerTick=false;}
window.addEventListener('scroll',()=>{if(!headerTick){headerTick=true;requestAnimationFrame(updateHeader);}},{passive:true});
updateHeader();

}
