import test from 'node:test';
import assert from 'node:assert/strict';
import {likedFrom,addLikedItems,forgetLikedItems,likedItemsFact,likedOptionEvidence,likedSourceId,isLiked,LIKED_ITEMS_TOOL} from '../lib/liked-items.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,toolNames,toolOutputs,isClaimAudit} from './helpers/agent.js';

const owner='owner',env={OPENAI_API_KEY:'test'};
const q=value=>({value,quote:value}),none={value:null,quote:null};
const shot=n=>({mime_type:'image/png',data:Buffer.from('likes'+n).toString('base64')});
// A Depop likes grid as the reader returns it: the seller handle is personal, two tiles are sold.
const DEPOP={lines:[{text:'Likes',personal:false},{text:'depop',personal:false},{text:'@vintagebyjo',personal:true},{text:'Jean Paul Gaultier',personal:false},{text:'Sold',personal:false},
 {text:'90s mesh tattoo top',personal:false},{text:'$85.00',personal:false},{text:'Sold',personal:false}],platform:q('depop'),items:[
 {brand:q('Jean Paul Gaultier'),title:none,category:'mesh top',colors:['black','nude'],details:['sheer','tattoo print'],status:'sold',status_quote:'Sold'},
 {brand:none,title:q('90s mesh tattoo top'),category:'Mesh Top',colors:['blue'],details:['$85','long sleeves'],status:'available',status_quote:null},
 // Brand guessed from the look, written nowhere: dropped, but the visible garment stays.
 {brand:{value:'Blumarine',quote:'Blumarine'},title:none,category:'slip skirt',colors:['pink'],details:['lace trim'],status:'sold',status_quote:'SOLD OUT'},
 // The handle is personal, so it can't be a kept title; nothing else is known, so the tile is dropped.
 {brand:none,title:q('@vintagebyjo'),category:null,colors:[],details:[],status:'unknown',status_quote:null},
]};

test('only text written in the screenshot is kept as brand, title, platform or sold label',()=>{
 const read=likedFrom([DEPOP]);
 assert.equal(read.platform,'depop');
 assert.deepEqual(read.items,[
  {brand:'Jean Paul Gaultier',title:null,category:'mesh top',colors:['black','nude'],details:['sheer','tattoo print'],status:'sold'},
  {brand:null,title:'90s mesh tattoo top',category:'mesh top',colors:['blue'],details:['long sleeves'],status:'available'},
  {brand:null,title:null,category:'slip skirt',colors:['pink'],details:['lace trim'],status:'unknown'},
 ]);
 assert.ok(!JSON.stringify(read).includes('vintagebyjo'),'seller handles are never kept');
 assert.ok(!JSON.stringify(read).includes('85'),'prices are never kept');
});

// Evidence as the database keeps it: insert ignores a repeated id; delete removes a source's rows.
function evidenceStore(rows=[]){
 const s={rows:[...rows],reads:0};
 return Object.assign(s,{evidence:async(o,origin)=>s.rows.filter(r=>!origin||r.origin===origin),
  recordEvidence:async(o,list)=>{for(const r of list)if(!s.rows.some(x=>x.id===r.id))s.rows.push(r);},
  deleteEvidence:async(o,origin,source)=>{s.rows=s.rows.filter(r=>!(r.origin===origin&&(source===null||r.source?.id===source)));}});
}
const reader=store=>async()=>{store.reads++;return DEPOP;};

test('liked items are kept as chat taste evidence, once per screenshot set, and never as wishlist items',async()=>{
 const store=evidenceStore([{id:'chat:m0:x',kind:'chat_statement',origin:'chat',source:{type:'message',id:'m0'},data:{}}]);
 const first=await addLikedItems({store,owner,messageIds:['m1'],images:[shot(1)],env,read:reader(store),now:()=>'2026-10-19T00:00:00Z'});
 assert.equal(first.added,3);assert.match(first.body,/Not added to the wishlist/);assert.match(first.body,/1 is marked sold/);
 const liked=store.rows.filter(isLiked);
 assert.equal(liked.length,3);assert.ok(liked.every(r=>r.origin==='chat'&&r.kind==='photo_observation'&&r.source.id===likedSourceId(['m1'])&&r.data.signal==='liked'&&r.data.platform==='depop'));
 const replay=await addLikedItems({store,owner,messageIds:['m1'],images:[shot(1)],env,read:reader(store)});
 assert.equal(replay.added,0);assert.equal(store.reads,1,'a replayed delivery is not read again');
 // The same screenshot read again together with a scrolled second one replaces the first read.
 await addLikedItems({store,owner,messageIds:['m1','m2'],images:[shot(1),shot(2)],env,read:reader(store)});
 assert.ok(store.rows.filter(isLiked).every(r=>r.source.id===likedSourceId(['m1','m2'])));
 assert.equal(store.rows.filter(r=>r.kind==='chat_statement').length,1,'what the user said is untouched');
});

test('an unreadable or empty screenshot keeps nothing and says so',async()=>{
 const store=evidenceStore();
 const failed=await addLikedItems({store,owner,messageIds:['m1'],images:[shot(1)],env,read:async()=>{throw Error('model down');}});
 assert.equal(failed.added,0);assert.match(failed.body,/could not be read/);
 const empty=await addLikedItems({store,owner,messageIds:['m2'],images:[shot(2)],env,read:async()=>({lines:[],platform:none,items:[]})});
 assert.equal(empty.added,0);assert.match(empty.body,/No clothing/);assert.equal(store.rows.length,0);
 assert.equal((await addLikedItems({store,owner,messageIds:['m3'],images:[],env})).added,0);
});

test('forgetting removes liked items from one screenshot set or all of them, and nothing else',async()=>{
 const store=evidenceStore([{id:'chat:m0:x',kind:'chat_statement',origin:'chat',source:{type:'message',id:'m0'},data:{}}]);
 await addLikedItems({store,owner,messageIds:['m1'],images:[shot(1)],env,read:reader(store)});
 await addLikedItems({store,owner,messageIds:['m2'],images:[shot(2)],env,read:reader(store)});
 assert.equal((await forgetLikedItems({store,owner,messageIds:['m1']})).removed,3);
 assert.ok(store.rows.filter(isLiked).every(r=>r.source.id===likedSourceId(['m2'])));
 const all=await forgetLikedItems({store,owner});assert.equal(all.removed,3);assert.match(all.body,/No liked items are kept now/);
 assert.deepEqual(store.rows.map(r=>r.kind),['chat_statement']);
 assert.equal((await forgetLikedItems({store,owner})).removed,0);
});

test('the liked-items fact summarises brands, garments and details as soft evidence',()=>{
 assert.equal(likedItemsFact([]),null);
 const rows=[...likedFrom([DEPOP]).items.map((item,n)=>({id:'liked:likes:m1:'+n,data:{signal:'liked',...item,platform:'depop'}})),{id:'chat:m0:x',data:{quote:'x'}}];
 const fact=likedItemsFact(rows),value=JSON.parse(fact.value);
 assert.equal(fact.field,'liked_items');assert.equal(fact.basis,'inferred');
 assert.equal(value.items,3);assert.equal(value.sold,1);
 assert.deepEqual(value.brands,[{name:'Jean Paul Gaultier',count:1}]);
 assert.ok(value.categories.some(c=>c.name==='mesh top'&&c.count===2));
 assert.match(value.meaning,/never wishlist items/);
});

test('a shown option the user likes keeps its name, brand and store, not its price',()=>{
 const rows=likedOptionEvidence('m5',[{name:'Cotton Black Printed Mesh Top',brand:'Snow Xue Gao',url:'https://www.snowxuegao.com/products/top',price:'$134'},{name:'',url:'https://x.example'}],{at:'t'});
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0].data,{signal:'liked',brand:'Snow Xue Gao',title:'Cotton Black Printed Mesh Top',category:null,colors:[],details:[],status:'unknown',platform:'snowxuegao.com',from:'shown_option',at:'t'});
 assert.ok(isLiked(rows[0]));assert.ok(!JSON.stringify(rows).includes('134'));
});

// The agent's turns: the scripted tool call, then a reply once its result is back.
const scripted=(call,seen)=>async(url,options)=>{
 if(isClaimAudit(options))return {ok:false};
 const outputs=toolOutputs(options);
 if(outputs.length){seen.outputs=outputs;return agentTurn(tool('conversation_reply',{response:'love these. noted.'}));}
 seen.tools=toolNames(options);seen.instructions=JSON.parse(options.body).instructions;return agentTurn(call);
};

test('the agent can keep liked items from a screenshot and forget them later, through one tool',async()=>{
 const calls=[],seen={},likedItemsAction=async(operation,ids)=>{calls.push({operation,ids});return operation==='add'?'Kept 3 liked items as taste signals. Not added to the wishlist.':'Forgot 3 liked items.';};
 await generateReply([{direction:'inbound',status:'received',body:'my depop likes, most are sold. log my interests'}],env,
  scripted({type:'function_call',name:'add_liked_items',arguments:JSON.stringify({operation:'add',image_message_ids:[]})},seen),{images:[shot(1)],likedItemsAction});
 assert.ok(seen.tools.includes('add_liked_items'));assert.match(seen.instructions,/LIKED ITEMS/);
 assert.equal(seen.outputs[0].status,'done');
 // A later text-only turn can still forget them.
 await generateReply([{direction:'inbound',status:'received',body:'actually forget those depop ones'}],env,
  scripted({type:'function_call',name:'add_liked_items',arguments:JSON.stringify({operation:'forget',image_message_ids:[]})},seen),{likedItemsAction});
 assert.deepEqual(calls,[{operation:'add',ids:[]},{operation:'forget',ids:[]}]);
 let names;
 await generateReply([{direction:'inbound',status:'received',body:'hi'}],env,async(u,o)=>{names=toolNames(o);return agentTurn(tool('conversation_reply',{response:'hey'}));},{});
 assert.ok(!names.includes('add_liked_items'),'without memory there is nowhere to keep them');
 assert.deepEqual(LIKED_ITEMS_TOOL.parameters.required,['operation','image_message_ids']);
});

const options=[{name:'Printed Mesh Top',brand:'Snow Xue Gao',url:'https://snowxuegao.com/p/1'},{name:'Mesh Sleeve Button-Down',brand:'',url:'https://abovethecrowd.example/p/2'},{name:'Draped Taffeta Top',brand:'Self-Portrait',url:'https://self-portrait.example/p/3'}];
const shopping=liked=>({wishlistState:{stage:'choice',options},wishlistAction:async()=>'Noted.',likedOptionsAction:async picked=>{liked.push(...picked.map(o=>o.name));}});
test('liking a subset of shown options keeps only those as taste signals; declining keeps nothing',async()=>{
 const sEnv={...env,SEARCH_ENABLED:'true'},liked=[],seen={};
 await generateReply([{direction:'inbound',status:'received',body:'i like the first most, really not the other two'}],sEnv,
  scripted(tool('respond_to_options',{decision:'interest',option_indices:[0]}),seen),shopping(liked));
 assert.deepEqual(liked,['Printed Mesh Top']);
 await generateReply([{direction:'inbound',status:'received',body:'all of them are cute'}],sEnv,
  scripted(tool('respond_to_options',{decision:'interest',option_indices:[0,1,2]}),seen),shopping(liked));
 assert.equal(liked.length,4);
 await generateReply([{direction:'inbound',status:'received',body:'nah none of these'}],sEnv,
  scripted(tool('respond_to_options',{decision:'decline',option_indices:[]}),seen),shopping(liked));
 assert.equal(liked.length,4,'a decline keeps nothing');
 // Keeping the signal never blocks the reply.
 const failing={...shopping([]),likedOptionsAction:async()=>{throw Error('db down');}};
 const body=await generateReply([{direction:'inbound',status:'received',body:'the first one'}],sEnv,scripted(tool('respond_to_options',{decision:'interest',option_indices:[0]}),seen),failing);
 assert.match(body,/noted/);
});
