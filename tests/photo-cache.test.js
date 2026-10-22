import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readList,saveList,forgetLists,tokenSubject,readView,saveView,readPage,savePage,sameData} from '../public/list-cache.js';
import {whenNear} from '../public/lazy-photo.js';
import {createSession} from '../public/wishlist-session.js';
import {groupWishlist,photoCaching} from '../lib/wishlist.js';
import {orderPhotoVersion} from '../lib/wardrobe.js';

const storage=()=>{const values=new Map();return{values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const jwt=sub=>['header',Buffer.from(JSON.stringify({sub})).toString('base64url'),'signature'].join('.');

test('a saved list returns only to the person who saw it',()=>{
 const store=storage(),items=[{id:'a',name:'Jacket'}];
 assert.equal(tokenSubject(jwt('person-1')),'person-1');
 saveList(store,'wishlist',jwt('person-1'),items);
 assert.deepEqual(readList(store,'wishlist',jwt('person-1')),items);
 assert.equal(readList(store,'wishlist',jwt('person-2')),null);
 assert.equal(readList(store,'wardrobe',jwt('person-1')),null);
 // A token that names nobody saves and reads nothing.
 saveList(store,'wardrobe','not-a-token',{items:[]});assert.equal(store.values.has('jules_cache_wardrobe'),false);
 assert.equal(readList(store,'wishlist','not-a-token'),null);
});

test('signing out forgets saved lists, and storage failures never break the page',()=>{
 const store=storage(),session=createSession({storage:store});
 session.save({access_token:jwt('person-1'),refresh_token:'r',expires_at:1e12});
 saveList(store,'wishlist',jwt('person-1'),[{id:'a'}]);saveList(store,'wardrobe',jwt('person-1'),{items:[]});
 session.clear();
 assert.equal(readList(store,'wishlist',jwt('person-1')),null);assert.equal(readList(store,'wardrobe',jwt('person-1')),null);
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('full');},removeItem(){throw Error('blocked');}};
 assert.doesNotThrow(()=>{saveList(broken,'wishlist',jwt('p'),[]);forgetLists(broken);});
 assert.equal(readList(broken,'wishlist',jwt('p')),null);
});

test('Admin › person views return only to the owner who saw them, for the few people opened last, and go on sign-out',()=>{
 const store=storage(),owner=jwt('owner-1'),person=n=>`p${n}`;
 saveView(store,person(1),'summary',owner,{rows:[1]},1000);saveView(store,person(1),'wishlist',owner,{items:[]},2000);
 assert.deepEqual(readView(store,person(1),'summary',owner),{data:{rows:[1]},at:1000});
 assert.deepEqual(readView(store,person(1),'wishlist',owner),{data:{items:[]},at:2000});
 assert.equal(readView(store,person(1),'summary',jwt('someone-else')),null);
 assert.equal(readView(store,person(1),'purchases',owner),null);assert.equal(readView(store,person(2),'summary',owner),null);
 // Only the five people opened most recently are kept.
 for(let n=2;n<=6;n++)saveView(store,person(n),'summary',owner,{n});
 assert.equal(readView(store,person(1),'summary',owner),null);assert.deepEqual(readView(store,person(6),'summary',owner).data,{n:6});
 assert.deepEqual(readView(store,person(2),'summary',owner).data,{n:2});
 // Storage full: other people's copies make room for the one being saved.
 const full=storage(),setItem=full.setItem;let room=2;
 full.setItem=(k,v)=>{if(k.startsWith('jules_cache_admin_person:')&&[...full.values.keys()].filter(x=>x.startsWith('jules_cache_admin_person:')&&x!==k).length>=room)throw Error('full');return setItem(k,v);};
 for(let n=1;n<=3;n++)saveView(full,person(n),'summary',owner,{n});
 assert.deepEqual(readView(full,person(3),'summary',owner).data,{n:3});assert.equal(readView(full,person(1),'summary',owner),null);
 // Signing out forgets them with the lists.
 const session=createSession({storage:store});session.save({access_token:owner,refresh_token:'r',expires_at:1e12});session.clear();
 for(let n=1;n<=6;n++)assert.equal(readView(store,person(n),'summary',owner),null);
 assert.equal([...store.values.keys()].some(k=>k.startsWith('jules_cache_admin')),false);
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('full');},removeItem(){throw Error('blocked');}};
 assert.doesNotThrow(()=>saveView(broken,person(1),'summary',owner,{}));assert.equal(readView(broken,person(1),'summary',owner),null);
});

test('an admin report returns only to the owner who saw it, only for the same period and date, and goes on sign-out',()=>{
 const store=storage(),owner=jwt('owner-1');
 savePage(store,'admin_costs',owner,{total:3},'month:2026-10-22',1000);savePage(store,'admin_scorecard',owner,{turns:[]},'',2000);
 assert.deepEqual(readPage(store,'admin_costs',owner,'month:2026-10-22'),{data:{total:3},at:1000});
 assert.equal(readPage(store,'admin_costs',owner,'day:2026-10-22'),null);
 assert.equal(readPage(store,'admin_scorecard',jwt('someone-else')),null);assert.deepEqual(readPage(store,'admin_scorecard',owner).data,{turns:[]});
 // A report that differs only in when it was generated is the same report: it is not drawn again.
 assert.equal(sameData({generated_at:'a',turns:[1]},{generated_at:'b',turns:[1]}),true);assert.equal(sameData({turns:[1]},{turns:[2]}),false);
 forgetLists(store);
 assert.equal(readPage(store,'admin_costs',owner,'month:2026-10-22'),null);assert.equal(readPage(store,'admin_scorecard',owner),null);
});

test('photo URLs are versioned by the last photo write, and only versioned URLs are cached',()=>{
 const row=(stamp)=>({item_id:'item-1',reply_id:'r',source_image_id:'s',target:'jacket',name:'Jacket',has_image:'image/jpeg',image_kind:'product',photo_attempted_at:stamp,links:[{url:'https://shop.example.com/jacket'}]});
 const [first]=groupWishlist([row('2026-10-01T00:00:00Z')]);
 assert.equal(first.photo_version,'2026-10-01T00:00:00Z');assert.equal(first.links[0].photo_version,'2026-10-01T00:00:00Z');
 // A replaced photo gets a new URL, so the browser fetches it instead of showing the old one.
 assert.notEqual(groupWishlist([row('2026-10-02T00:00:00Z')])[0].photo_version,first.photo_version);
 assert.equal(groupWishlist([row(undefined)])[0].photo_version,'0');
 assert.match(photoCaching(new URLSearchParams('item=x&image=product&v=1')),/^private, /);
 assert.equal(photoCaching(new URLSearchParams('item=x&image=product')),'no-store');
});

test('photos start loading only when their frame comes near the screen',()=>{
 let ran=0;const original=globalThis.IntersectionObserver;
 try{
  delete globalThis.IntersectionObserver;whenNear({},()=>ran++);assert.equal(ran,1);
  let notify,observed=[];
  globalThis.IntersectionObserver=class{constructor(callback){notify=callback;}observe(t){observed.push(t);}unobserve(t){observed=observed.filter(o=>o!==t);}};
  const far={},near={};whenNear(far,()=>ran++);whenNear(near,()=>ran+=10);
  assert.equal(ran,1);
  notify([{target:near,isIntersecting:true},{target:far,isIntersecting:false}]);
  assert.equal(ran,11);assert.deepEqual(observed,[far]);
 }finally{globalThis.IntersectionObserver=original;}
});

test('a sharpened order photo gets a new version, so the blurry thumbnail is not kept',()=>{
 const stored={version:'2026-10-01T00:00:00Z',width:'120',height:'120'};
 assert.equal(orderPhotoVersion(stored),orderPhotoVersion({...stored}));
 assert.notEqual(orderPhotoVersion({...stored,width:'900',height:'900'}),orderPhotoVersion(stored));
});
