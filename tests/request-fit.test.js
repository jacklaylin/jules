import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestFit,contradictions,fitEvidence} from '../lib/request-fit.js';
import {textWishlistAction} from '../lib/text-wishlist.js';

// October 21–22: in a bright red half-zip search an off-white Aran crewneck was shown, and the reply said
// it wasn't red. A listing that contradicts the request's hard constraints is left out before the reply.
const listing=(id,{name,color=null,description=''})=>({brand:'Brand '+id,name,url:`https://${id}.example/products/${id}`,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:name,product_brand:'Brand '+id,color,description},price_snapshot:{amount:180,currency:'USD',evidence_level:'verified'}});
const aran=listing('aran',{name:'Aran Cable Crewneck',color:'Off-White',description:'A classic Aran cable knit crewneck in undyed wool.'});
const red=listing('red',{name:'Chunky Half-Zip Sweater',color:'Bright Red',description:'A chunky knit half-zip.'});
const ruby=listing('ruby',{name:'Ribbed Half Zip',color:'Ruby',description:'Ribbed merino half zip.'});
const full=listing('full',{name:'Cable Full-Zip Cardigan',color:'Red',description:'Full zip cardigan.'});
const requested={hard_constraints:['bright red','half-zip sweater'],guidance:['chunky knit']};
const env={OPENAI_API_KEY:'test'};
const answer=value=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
// One call per listing; the stub answers by the listing's name.
const model=byName=>{const calls=[];const fetcher=async(_u,o)=>{const body=JSON.parse(o.body);calls.push(body);const {listing:l}=JSON.parse(body.input[0].content);
 const reply=byName[l.name];if(reply instanceof Error)throw reply;return answer(reply??{verdicts:[]});};fetcher.calls=calls;return fetcher;};
const v=(constraint,verdict,quote='')=>({constraint,verdict,quote});

test('a listing whose own text contradicts a requested constraint is left out, with the constraint and quote',async()=>{
 const fetcher=model({'Aran Cable Crewneck':{verdicts:[v('bright red','contradicts','Off-White'),v('half-zip sweater','contradicts','Aran Cable Crewneck')]},
  'Chunky Half-Zip Sweater':{verdicts:[v('bright red','fits','Bright Red'),v('half-zip sweater','fits','Half-Zip Sweater')]},
  'Ribbed Half Zip':{verdicts:[v('bright red','unknown'),v('half-zip sweater','fits','Half Zip')]}});
 const record={};
 const dropped=await requestFit([aran,red,ruby],{requested,env,fetcher,record});
 assert.deepEqual([...dropped.keys()],[aran.url]);
 assert.deepEqual(dropped.get(aran.url),{constraint:'bright red',quote:'Off-White'});
 assert.equal(fetcher.calls.length,3,'one listing per call');
 assert.equal(fetcher.calls[0].temperature,0);
 assert.deepEqual(JSON.parse(fetcher.calls[0].input[0].content).requested,['bright red','half-zip sweater']);
 assert.deepEqual(record.request_fit,{checked:3,failed:0,dropped:[{url:aran.url,constraint:'bright red',quote:'Off-White'}]});
});

test('a contradiction counts only with a requested constraint and a quote from the listing itself',()=>{
 const evidence=fitEvidence(aran),asked=['bright red','half-zip sweater'];
 // Not quoted from the listing, an empty quote, a constraint nobody asked for, or not a contradiction: kept.
 for(const verdicts of [[v('bright red','contradicts','cream colour')],[v('bright red','contradicts','')],[v('cashmere','contradicts','wool')],[v('bright red','unknown','Off-White')],[v('bright red','fits','Off-White')]])
  assert.deepEqual(contradictions({verdicts},evidence,asked),[],JSON.stringify(verdicts));
 // Case and punctuation are format, not meaning.
 assert.deepEqual(contradictions({verdicts:[v('Half-Zip Sweater','contradicts','aran cable crewneck')]},evidence,asked),[{constraint:'half-zip sweater',quote:'aran cable crewneck'}]);
 assert.deepEqual(contradictions(null,evidence,asked),[]);
});

test('without hard constraints, a model key or time, nothing is checked; a link the user sent and failed checks are kept',async()=>{
 const fetcher=model({});
 for(const input of [{requested:{hard_constraints:[],guidance:['red']},env},{requested:null,env},{requested,env:{}},{requested,env,timeout:500}])
  assert.equal((await requestFit([aran],{...input,fetcher})).size,0);
 assert.equal(fetcher.calls.length,0);
 const sent=model({'Aran Cable Crewneck':{verdicts:[v('bright red','contradicts','Off-White')]}});
 assert.equal((await requestFit([aran],{requested,keep:[aran.url],env,fetcher:sent})).size,0);
 assert.equal(sent.calls.length,0,'the user’s own link is never checked');
 const record={};
 const failing=model({'Aran Cable Crewneck':new Error('down'),'Cable Full-Zip Cardigan':{verdicts:[v('half-zip sweater','contradicts','Full-Zip Cardigan')]}});
 const dropped=await requestFit([aran,full],{requested,env,fetcher:failing,record});
 assert.deepEqual([...dropped.keys()],[full.url]);assert.equal(record.request_fit.failed,1);
});

// The discovery turn: the check runs on the ranker's pool and the reply is written from what's left.
const plan={continuation:false,mode:'discover',hard_constraints:['bright red','half-zip sweater'],guidance:['chunky knit'],keep_option_indices:[],exclude_option_indices:[]};
const turn=async(products,unfitURLs)=>{
 let result,seen;
 const reply=await textWishlistAction({action:'start',query:'chunky bright red half zip',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},
  stylist:async()=>[],search:async()=>({status:'found',products}),rank:async list=>list,owned:async()=>[],
  fit:async(list,{requested,record})=>{seen={requested,urls:list.map(p=>p.url)};const out=new Map(list.filter(p=>unfitURLs.includes(p.url)).map(p=>[p.url,{constraint:'bright red',quote:p.listing_check.color}]));record.request_fit={checked:list.length,failed:0,dropped:[...out].map(([url,w])=>({url,...w}))};return out;}});
 return {reply,result,seen};
};

test('an option that contradicts the request is never shown; the reply says one was left out and why',async()=>{
 const {reply,result,seen}=await turn([red,aran,ruby],[aran.url]);
 assert.deepEqual(seen.requested.hard_constraints,plan.hard_constraints);
 assert.deepEqual(seen.urls.sort(),[red.url,aran.url,ruby.url].sort(),'the whole ranked pool is checked');
 assert.ok(!reply.includes(aran.url),'the aran is not shown');
 assert.ok(reply.includes(red.url)&&reply.includes(ruby.url));
 assert.match(reply,/left out one that didn’t match what you asked for \(bright red\)/);
 const state=result.text_wishlist_state;
 assert.deepEqual(state.options.map(o=>o.url),[red.url,ruby.url]);
 assert.ok(state.excluded_urls.includes(aran.url),'"look for more" will not bring it back');
 assert.equal(result.text_wishlist_diagnostics.rank.request_fit.dropped[0].url,aran.url);
});

test('a dropped option is replaced from the pool when one is left; nothing is said when none would have shown',async()=>{
 const more=listing('more',{name:'Mock Neck Half Zip',color:'Red'});
 const {reply,result}=await turn([red,aran,ruby,more],[aran.url]);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[red.url,ruby.url,more.url]);
 assert.match(reply,/left out one/);
 // The fourth candidate would not have been shown, so leaving it out isn't news.
 const quiet=await turn([red,ruby,more,aran],[aran.url]);
 assert.ok(!/left out/.test(quiet.reply));
 assert.equal(quiet.result.text_wishlist_state.options.length,3);
 // Nothing contradicts: the set is unchanged.
 const plain=await turn([red,aran,ruby],[]);
 assert.ok(plain.reply.includes(aran.url)&&!/left out/.test(plain.reply));
});

test('when every option contradicts the request, Jules says so instead of showing them',async()=>{
 const {reply,result}=await turn([aran,full],[aran.url,full.url]);
 assert.ok(!/https?:\/\//.test(reply),'no links to options that are not what was asked for');
 assert.match(reply,/left out 2 that didn’t match what you asked for/);
 assert.match(reply,/haven’t found a close enough option yet/);
 assert.equal(result.text_wishlist_diagnostics.status,'request_constraints_rejected');
});
