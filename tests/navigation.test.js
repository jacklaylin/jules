import test from 'node:test';
import assert from 'node:assert/strict';

class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.listeners={};this.hidden=false;this.open=false;this.className='';this.classList={toggle:()=>{},remove:()=>{},add:()=>{}};}
 setAttribute(key,value){this.attributes[key]=value;}
 getAttribute(key){return this.attributes[key];}
 addEventListener(type,fn){this.listeners[type]=fn;}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
 append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
 insertBefore(child,reference){child.remove();child.parent=this;this.children.splice(this.children.indexOf(reference),0,child);}
 replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);}
 cloneNode(deep){const copy=new Element(this.tag);Object.assign(copy,{className:this.className,attributes:{...this.attributes},href:this.href});if(deep)copy.append(...this.children.map(child=>child.cloneNode(true)));return copy;}
 showModal(){this.open=true;}
 close(){this.open=false;this.listeners.close?.();}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 querySelectorAll(selector){const match=e=>selector.startsWith('#')?e.id===selector.slice(1):selector.startsWith('.')?e.className.split(' ').includes(selector.slice(1)):false;return this.children.flatMap(child=>[...(match(child)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const body=new Element('body'),header=new Element('header');header.className='app-header';body.append(header);
const media=[];
globalThis.document={body,getElementById:id=>body.querySelector('#'+id),createElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener(){}};
globalThis.window={addEventListener(){}};globalThis.scrollY=0;globalThis.matchMedia=query=>{const value={query,matches:false,addEventListener(type,fn){this.change=fn;}};media.push(value);return value;};
const {mountHeader,enableAdminLink}=await import('../public/design-system.js');
mountHeader('wishlist');
const nav=()=>document.querySelector('.header-actions');

test('shared navigation exposes the companion pages, marks the current page, and keeps restricted actions hidden',()=>{
 const controls=nav().children;assert.deepEqual(controls.filter(c=>c.href).map(c=>c.href),['/wishlist','/wardrobe','/report','/admin','/account']);
 const account=controls.find(c=>c.href==='/account');assert.ok(account.className.includes('nav-account'),'account is shown as an avatar');
 assert.equal(controls[0].getAttribute('aria-current'),'page');assert.equal(controls[1].getAttribute('aria-current'),undefined);
 assert.equal(document.querySelector('#admin-link').hidden,true);assert.equal(document.querySelector('#logout'),null,'log out lives on the Account page');
});
test('mobile menu moves the existing actions without replacing their handlers and restores them on Escape or desktop resize',()=>{
 const admin=document.querySelector('#admin-link');const handler=()=>{};admin.onclick=handler;
 const button=document.querySelector('.menu-toggle'),menu=document.querySelector('#mobile-menu');
 button.onclick();assert.equal(nav().parent,menu);assert.equal(menu.open,true);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(document.querySelector('#admin-link').onclick,handler);
 menu.listeners.cancel({preventDefault(){}});assert.equal(menu.open,false);assert.equal(nav().parent,header);assert.equal(button.getAttribute('aria-expanded'),'false');
 button.onclick();media.find(m=>m.query==='(max-width:800px)').change({matches:false});assert.equal(menu.open,false);assert.equal(nav().parent,header);
});
test('a delayed permission response cannot reveal Admin after sign-out',async()=>{
 let release;globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});const checking=enableAdminLink('fixture-token');await enableAdminLink(null);release({ok:true});await checking;assert.equal(document.querySelector('#admin-link').hidden,true);
 globalThis.fetch=async url=>{assert.equal(url,'/api/admin?view=access');return {ok:true};};await enableAdminLink('another-fixture-token');assert.equal(document.querySelector('#admin-link').hidden,false);
});
