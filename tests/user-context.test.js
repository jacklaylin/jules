import test from 'node:test';
import assert from 'node:assert/strict';
import {readUserContext,tasteView,TASTE_VIEW_FIELDS} from '../lib/user-context.js';
import {shoppingConstraints} from '../lib/relevance.js';
import {stylistConcepts} from '../lib/stylist.js';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';

const quiet=()=>{};
const env={MEMORY_ENABLED:'true',GMAIL_IMPORT_ENABLED:'true',STYLE_ENABLED:'true',OPENAI_API_KEY:'test'};
const stated=[
 {field:'style',key:'aesthetic',value:'90s minimal',basis:'stated'},
 {field:'avoid',key:'logos',value:'dislikes big logos',basis:'stated'},
 {field:'inspiration',key:'carolyn bessette',value:'clean lines',basis:'stated'},
 {field:'size',key:'trousers/us',value:'28',basis:'stated'},
 {field:'brand',key:'old favorite',value:'no longer likes',deleted:true,basis:'stated'},
];
const likedFact={field:'liked_items',key:'summary',basis:'inferred',value:'{"items":2}'};
const outfitFact={field:'outfit_photos',key:'summary',basis:'inferred',value:'{"kept":3}'};
const history={items:4,summary:{items:4,brands:['the row']},detail:async()=>[{field:'shopping_history',key:'item-1',value:'{"brand":"The Row"}'}]};
function store({fail=[]}={}){
 const maybe=(name,value)=>async()=>{if(fail.includes(name))throw Error(name);return value;};
 return {profile:async()=>({facts:stated,version:1}),purchaseHistory:maybe('purchase_history',history),
  styleSources:maybe('outfit_photos',[]),styleSession:async()=>null,
  evidence:maybe('liked_items',[]),recordEvidence:async()=>{},deleteEvidence:async()=>{}};
}

test('every source joins one set of facts, with purchases as a compact summary',async t=>{
 const context=await readUserContext(store(),'owner',env,{log:quiet});
 const fields=context.facts.map(f=>f.field);
 for(const f of ['style','avoid','inspiration','size','shopping_history'])assert.ok(fields.includes(f),f);
 assert.equal(context.facts.filter(f=>f.field==='shopping_history').length,1,'one purchase summary, not every item');
 assert.equal(context.purchases,4);
 const ranked=await context.withPurchaseDetail();
 assert.deepEqual(ranked.filter(f=>f.field==='shopping_history').map(f=>f.key),['item-1'],'ranking sees per-item purchases instead of the summary');
});

test('a failing source leaves the rest of the context intact',async()=>{
 const logs=[];
 const context=await readUserContext(store({fail:['purchase_history','liked_items','outfit_photos']}),'owner',env,{log:l=>logs.push(JSON.parse(l))});
 assert.ok(context.facts.some(f=>f.field==='style'));
 assert.equal(context.purchases,0);
 assert.deepEqual(logs.filter(l=>l.event==='context_read_failed').map(l=>l.source).sort(),['liked_items','outfit_photos','purchase_history']);
 assert.ok(logs.some(l=>l.event==='user_context'),'what was read is logged');
});

test('switched-off sources are not read',async()=>{
 let read=false;
 const s={...store(),purchaseHistory:async()=>{read=true;return history;}};
 const context=await readUserContext(s,'owner',{MEMORY_ENABLED:'true'},{log:quiet});
 assert.equal(read,false);
 assert.ok(!context.facts.some(f=>f.field==='shopping_history'));
});

test('the taste view keeps live taste from every source and drops deleted facts',()=>{
 const view=tasteView([...stated,likedFact,outfitFact]);
 assert.deepEqual(view.map(f=>f.field).sort(),['avoid','inspiration','liked_items','outfit_photos','style']);
 assert.ok(view.every(f=>Object.keys(f).join()==='field,key,value'));
 assert.ok(tasteView(stated,{person:true}).some(f=>f.field==='size'),'the person view adds sizes and department');
 assert.deepEqual(tasteView([...stated,likedFact],{forSomeoneElse:true}),[],'a gift uses none of the person\'s taste');
});

test('search constraints, the stylist and ranking all read the same taste view',async()=>{
 const facts=[...stated,likedFact,outfitFact];
 // Search: dislikes, inspirations, liked items and outfit photos now reach search constraints.
 const constraints=shoppingConstraints(facts,{});
 assert.deepEqual(constraints.taste,tasteView(facts));
 assert.deepEqual(shoppingConstraints(facts,{for_someone_else:true}).taste,[]);
 // Stylist: outfit photos now reach it too.
 let stylistInput=null;
 const reply=body=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(body)}]}]})});
 const stylistFetch=async(_u,o)=>{stylistInput=JSON.parse(JSON.parse(o.body).input);return reply({concepts:[]});};
 await stylistConcepts({query:'a coat',plan:{mode:'discover'},facts,env,fetcher:stylistFetch});
 const stylistFields=new Set(stylistInput.saved_profile.map(f=>f.field));
 for(const f of TASTE_VIEW_FIELDS.filter(f=>f!=='brand'&&facts.some(x=>x.field===f&&!x.deleted)))assert.ok(stylistFields.has(f),f);
 await stylistConcepts({query:'a coat for my dad',plan:{mode:'discover'},facts,forSomeoneElse:true,env,fetcher:stylistFetch});
 assert.deepEqual(stylistInput.saved_profile,[]);
 assert.deepEqual(stylistInput.saved_brands,[]);
 // Ranking: the ranker is given the taste view, or nothing for a gift.
 let rankInput=null;
 const rankFetch=async(_u,o)=>{rankInput=JSON.parse(o.body).input;return reply({indices:[0],rejected_indices:[]});};
 const products=[{name:'Wool coat',url:'https://example.com/coat',brand:'Example'}];
 await rankDiscoveryProducts(products,{query:'a coat',facts,env,fetcher:rankFetch});
 assert.ok(JSON.stringify(rankInput).includes('90s minimal'));
 await rankDiscoveryProducts(products,{query:'a coat for my dad',facts,forSomeoneElse:true,env,fetcher:rankFetch});
 assert.ok(!JSON.stringify(rankInput).includes('90s minimal'));
});
