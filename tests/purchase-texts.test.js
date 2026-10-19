import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptFeedback,applyReceiptFeedback} from '../lib/receipt-feedback.js';
import {sealToken} from '../lib/gmail-client.js';
import {importStep} from '../lib/gmail-import.js';
import {newRefreshJob,refreshStep,refreshOwner,announcePurchases,validPick,purchaseDraft,runDailyRefresh,handleGmailRefresh} from '../lib/purchase-texts.js';

const OWNER='owner-1',DAY=86400000,NOW=Date.parse('2026-10-18T17:00:00Z');
const bought=(id,daysAgo,extra={})=>({id,source_ids:[`gmail:${id}`],brand:'Brand',product:`Item ${id}`,merchant:'shop.com',size_label:'32',color:null,
 source_events:[{kind:'purchased',at:NOW-daysAgo*DAY,source_id:`gmail:${id}`}],...extra});
const cargos=bought('cargo',1,{brand:'Carhartt WIP',product:'Camo Cargo Pants',merchant:'END.'});
// A row in the shape the import leaves it: a finished full import and its purchase history.
function storage({items=[bought('jeans',200),bought('tee',100)],data={},recent=[],token='sealed'}={}){
 let row={conversation_id:OWNER,revision:1,token_ciphertext:token,data:{job:{status:'ready',started_at:'import-1',completed_at:new Date(NOW-3*DAY).toISOString()},feedback:createReceiptFeedback(OWNER,items,[]),...data}};
 const operations=new Map(),sent=[];
 return {sent,operations,get row(){return row;},set row(v){row=v;},
  claimGmailImport:async()=>{row.revision++;return structuredClone(row);},
  finishGmailImport:async(owner,revision,data,token)=>{if(revision!==row.revision)return false;row={...row,data:structuredClone(data),token_ciphertext:token};return true;},
  gmailImport:async()=>structuredClone(row),evidence:async()=>[],profile:async()=>({facts:[]}),
  operation:async key=>operations.get(key)??null,conversation:async()=>({id:OWNER,line:'line',sender_id:'sender'}),recent:async()=>recent,
  reserve:async(o,key,body)=>{if(operations.has(key))return false;operations.set(key,{status:'sending',body,conversation_id:o});return true;},
  finish:async(key,status)=>{operations.get(key).status=status;}};
}
// Stands in for the email reader: records the baseline, adds the purchases "found" in new mail, and finishes the search.
const finding=items=>async row=>{const data=structuredClone(row.data);data.job.baseline_items=row.receipts.state.items.map(i=>i.id);
 data.feedback=createReceiptFeedback(OWNER,[...row.receipts.state.items,...items],[]);data.job.ids=items.map(i=>'m-'+i.id);data.job.status='questions';return {...row,data,evidence:[]};};
const send=store=>async(target,body)=>{store.sent.push(body);return {id:'msg'};};
const pick=value=>async()=>value;

test('the check reads only mail since the last check, with a day of overlap and a 30-day cap',()=>{
 const job=newRefreshJob({refresh:{checked_at:new Date(NOW-DAY).toISOString()}},NOW);
 assert.equal(job.kind,'refresh');assert.equal(job.after,Math.floor((NOW-2*DAY)/1000));
 assert.ok(job.search_plan.every(s=>s.query.includes(`after:${job.after}`)&&s.query.includes('-in:spam')));
 assert.ok(job.search_plan.reduce((n,s)=>n+s.budget,0)<=job.limit);
 // Never checked: from the end of the full import. A long gap is capped.
 assert.equal(newRefreshJob({job:{completed_at:new Date(NOW-3*DAY).toISOString()}},NOW).after,Math.floor((NOW-4*DAY)/1000));
 assert.equal(newRefreshJob({refresh:{checked_at:'2020-01-01T00:00:00Z'}},NOW).after,Math.floor((NOW-31*DAY)/1000));
});

test('a daily check records new purchases without touching the full import, and runs once a day',async()=>{
 const store=storage(),before=structuredClone(store.row.data.job);
 assert.equal((await refreshStep(store,OWNER,{},{step:finding([cargos]),now:NOW})).status,'more');
 assert.deepEqual(store.row.data.job,before);assert.equal(store.row.data.refresh.job.kind,'refresh');
 const done=await refreshStep(store,OWNER,{},{step:()=>assert.fail('no reading once the search is done'),now:NOW});
 assert.deepEqual([done.status,done.found],['ready',1]);
 assert.deepEqual(store.row.data.refresh.pending,['cargo']);assert.equal(store.row.data.refresh.checked_on,'2026-10-18');
 assert.deepEqual(store.row.data.job,before);
 assert.equal((await refreshStep(store,OWNER,{},{step:()=>assert.fail(),now:NOW+3600000})).status,'done');
 // The next day starts a new check from where this one ended.
 assert.equal((await refreshStep(store,OWNER,{},{step:finding([]),now:NOW+DAY})).status,'more');
 assert.equal(store.row.data.refresh.job.after,Math.floor((NOW-DAY)/1000));
});

test('the check waits while a full import runs and skips a disconnected Gmail',async()=>{
 const running=storage({data:{job:{status:'extracting',started_at:'import-2'}}});
 assert.deepEqual(await refreshStep(running,OWNER,{},{step:()=>assert.fail(),now:NOW}),{status:'skipped',reason:'import_running'});
 assert.equal(running.row.data.refresh,undefined);
 const disconnected=storage({token:null});
 assert.equal((await refreshStep(disconnected,OWNER,{},{step:()=>assert.fail(),now:NOW})).reason,'not_connected');
});

test('a failed step keeps completed work and is not marked checked',async()=>{
 const store=storage();
 assert.equal((await refreshStep(store,OWNER,{},{step:async()=>{throw Error('gmail down');},now:NOW})).status,'failed');
 assert.equal(store.row.data.refresh?.failures,1);assert.equal(store.row.data.refresh.checked_on,undefined);
});

test('one text names the purchase, uses the chosen angle with items they own, and is sent once a day',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[bought('jeans',200),bought('tee',100),cargos]});
 const result=await announcePurchases(store,OWNER,{},{interpret:pick({send:true,angle:'styling',lead_item_id:'cargo',related_item_ids:['tee','invented'],hook:''}),send:send(store),now:NOW});
 assert.deepEqual([result.status,result.angle],['sent','styling']);
 assert.equal(store.sent.length,1);assert.match(store.sent[0],/Camo Cargo Pants/);assert.match(store.sent[0],/END\./);assert.match(store.sent[0],/Item tee/);assert.doesNotMatch(store.sent[0],/invented/);
 assert.deepEqual(store.row.data.refresh.pending,[]);assert.deepEqual(store.row.data.refresh.announced,['cargo']);
 store.row.data.refresh.pending=['tee'];
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail(),send:send(store),now:NOW+3600000})).status,'already_sent_today');
 assert.equal(store.sent.length,1);
});

test('several purchases on the same day become one text',async()=>{
 const shirt=bought('shirt',2,{product:'Oxford Shirt'});
 const store=storage({data:{refresh:{pending:['cargo','shirt'],announced:[]}},items:[bought('jeans',200),cargos,shirt]});
 await announcePurchases(store,OWNER,{},{interpret:pick({send:true,angle:'new_direction',lead_item_id:'cargo',related_item_ids:[],hook:'first camo in your wardrobe (are we entering a phase?)'}),send:send(store),now:NOW});
 assert.equal(store.sent.length,1);assert.match(store.sent[0],/one other new purchase/);assert.match(store.sent[0],/first camo/);
});

test('gifts, returns and older purchases join the wardrobe without a text',async()=>{
 const items=[bought('jeans',200),bought('gift',1),bought('old',20),bought('back',1)];
 const store=storage({data:{refresh:{pending:['gift','old','back'],announced:[]}},items});
 let history=createReceiptFeedback(OWNER,items,[]);
 for(const [id,change] of [['gift',{action:'set_recipient',value:'other',label:null}],['back',{action:'report_return'}]])
  history=applyReceiptFeedback(history,{id:'closet:'+id,owner_id:OWNER,source:'closet_edit',at:new Date(NOW).toISOString(),item_ids:[id],...change});
 store.row.data.feedback=history;
 const result=await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail('nothing to choose'),send:send(store),now:NOW});
 assert.equal(result.status,'nothing_recent');assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.pending,[]);
});

test('mid-conversation, the text waits for the next day with its purchases kept',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[cargos],recent:[{direction:'inbound',body:'hi',created_at:new Date(NOW-5*60000).toISOString()}]});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail(),send:send(store),now:NOW})).status,'held');
 assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.pending,['cargo']);
});

test('a purchase the model judges not worth a text is settled quietly',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[cargos]});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:pick({send:false,angle:'just_added',lead_item_id:'cargo',related_item_ids:[],hook:''}),send:send(store),now:NOW})).status,'not_worth_a_text');
 assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.announced,['cargo']);
});

test('unsupported choices fall back to a plain "added to your wardrobe" text',async()=>{
 const items=[{id:'cargo',product:'Camo Cargo Pants'}],wardrobe=[{id:'tee',product:'Tee'}];
 assert.equal(validPick({send:true,angle:'styling',lead_item_id:'cargo',related_item_ids:['invented'],hook:''},items,wardrobe).angle,'just_added');
 assert.equal(validPick({send:true,angle:'pattern',lead_item_id:'cargo',related_item_ids:['tee'],hook:'now $40 off'},items,wardrobe).angle,'just_added');
 assert.equal(validPick({send:true,angle:'new_direction',lead_item_id:'cargo',related_item_ids:[],hook:'see https://x.example'},items,wardrobe).angle,'just_added');
 const unknown=validPick({send:true,angle:'price_watch',lead_item_id:'nope',related_item_ids:[],hook:''},items,wardrobe);
 assert.deepEqual([unknown.angle,unknown.lead.id],['just_added','cargo']);
 const failed=validPick(null,items,wardrobe);assert.deepEqual([failed.send,failed.angle],[true,'just_added']);
 assert.match(purchaseDraft(failed,items,wardrobe),/added it to your wardrobe\. tell me if it was a gift/);
 // A failed model call still sends the plain text.
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[cargos]});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:async()=>{throw Error('down');},send:send(store),now:NOW})).angle,'just_added');
});

test('an observation must agree with what they already own',()=>{
 const items=[{id:'cargo',product:'Wide Leg Cargo Pants',category:'bottoms'}];
 const wardrobe=[{id:'old-cargo',product:'Straight-Leg Cargo Trousers',category:'bottoms'},{id:'oxford',product:'Oxford Shirt',category:'tops'},{id:'jeans',product:'Straight Jeans',category:'bottoms'}];
 const choose=extra=>validPick({send:true,lead_item_id:'cargo',related_item_ids:[],hook:'another pair for the collection (a uniform is forming)',...extra},items,wardrobe);
 // "Their first of its kind" is refused when they own one; it stands when they own none.
 assert.equal(choose({angle:'new_direction',similar_owned_item_ids:['old-cargo']}).angle,'just_added');
 assert.equal(choose({angle:'new_direction',similar_owned_item_ids:[]}).angle,'new_direction');
 // "Another one" needs the similar items it repeats, of the same kind; invented or off-category ones don't count.
 assert.equal(choose({angle:'pattern',similar_owned_item_ids:[]}).angle,'just_added');
 assert.equal(choose({angle:'pattern',similar_owned_item_ids:['oxford','invented']}).angle,'just_added');
 const pattern=choose({angle:'pattern',similar_owned_item_ids:['old-cargo','oxford']});
 assert.deepEqual([pattern.angle,pattern.related],['pattern',['old-cargo']]);
 // Counts and dates are left out of observations; the model miscounts them.
 assert.equal(choose({angle:'pattern',similar_owned_item_ids:['old-cargo'],hook:'your 5th pair of cargos'}).angle,'just_added');
});

test('the composer is told the purchase was recorded in the wardrobe, not saved to the wishlist',async()=>{
 const {composeReply}=await import('../lib/compose.js');const bodies=[];
 const reply=text=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text}]}]}),{status:200});
 const fetcher=async(url,init)=>{const body=JSON.parse(init.body);bodies.push(body);
  return body.text.format.name==='claim_audit'?reply(JSON.stringify({saved_now:false,alerts_turned_on:false,alerts_turned_off:false,names_other_saved_item:false}))
   :reply(JSON.stringify({reply:'added your cargos to your wardrobe. yet another pair (a uniform is forming).',claims:{saved_now:false,alerts_turned_on:false,alerts_turned_off:false},photo_captions:[]}));};
 const result=await composeReply({draft:'i saw your new Cargo Pants in your email and added it to your wardrobe.',facts:{wardrobe_added:['Cargo Pants']},purpose:'new_purchase',env:{OPENAI_API_KEY:'k',WISHLIST_ENABLED:'true'},fetcher});
 assert.equal(result.composed,true);
 assert.ok(JSON.stringify(bodies[0].input).includes('wardrobe_added'));
 assert.ok(bodies[1].input.some(m=>m.content.startsWith('ADDED_TO_WARDROBE')));
});

test('a person\'s daily run reads, then texts about what it found',async()=>{
 const store=storage();let clock=NOW;
 const result=await refreshOwner(store,OWNER,{},{step:finding([cargos]),now:()=>clock,deadline:NOW+60000,
  announce:(s,o,e)=>announcePurchases(s,o,e,{interpret:pick({send:true,angle:'just_added',lead_item_id:'cargo',related_item_ids:[],hook:''}),send:send(store),now:clock})});
 assert.deepEqual(result,{check:'ready',text:'sent',fit_check:'not_checked'});assert.equal(store.sent.length,1);
});

test('the daily run covers everyone connected and one failure does not stop the rest',async()=>{
 const seen=[];const store={gmailConnections:async()=>['a','b','c']};
 const summary=await runDailyRefresh(store,{},{owner:async(s,id)=>{seen.push(id);if(id==='b')throw Error('boom');return {check:'ready',text:id==='a'?'sent':'nothing_new'};}});
 assert.deepEqual(seen,['a','b','c']);assert.deepEqual(summary,{people:3,checked:2,texted:1,fit_checks:0,unfinished:0,failed:1});
});

test('the real email reader runs the check on its own job and leaves the full import as it was',async()=>{
 const env={SITE_ORIGIN:'https://jules.example',GOOGLE_GMAIL_CLIENT_ID:'c',GOOGLE_GMAIL_CLIENT_SECRET:'s',GMAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
 const store=storage({token:sealToken({access_token:'a',refresh_token:'r',expires_at:Date.now()+3600000},OWNER,env)}),before=structuredClone(store.row.data.job),queries=[];
 // Gmail has nothing new: every search comes back empty.
 const fetcher=async url=>{queries.push(new URL(url).searchParams.get('q'));return new Response(JSON.stringify({messages:[]}),{status:200,headers:{'Content-Type':'application/json'}});};
 const step=(row,e)=>importStep(row,e,{fetcher,interpret:()=>assert.fail('no model calls without mail')});
 let result,steps=0;do{result=await refreshStep(store,OWNER,env,{step,now:NOW});steps++;}while(result.status==='more'&&steps<10);
 assert.deepEqual([result.status,result.found],['ready',0]);
 assert.equal(queries.length,3);assert.ok(queries.every(q=>q.startsWith(`after:${Math.floor((NOW-4*DAY)/1000)} `)));
 assert.deepEqual(store.row.data.job,before);assert.equal(store.row.data.refresh.job.status,'ready');
});

test('the cron endpoint needs the cron secret and both switches',async()=>{
 const res=()=>({headers:{},setHeader(){},end(b){this.body=JSON.parse(b);}});
 const env={CRON_SECRET:'c'.repeat(40),GMAIL_IMPORT_ENABLED:'true',PURCHASE_TEXTS_ENABLED:'true'},run=async()=>({people:0});
 let r=res();await handleGmailRefresh({method:'GET',headers:{}},r,{},env,run);assert.equal(r.statusCode,401);
 r=res();await handleGmailRefresh({method:'GET',headers:{authorization:'Bearer wrong'}},r,{},env,run);assert.equal(r.statusCode,401);
 r=res();await handleGmailRefresh({method:'GET',headers:{authorization:'Bearer '+env.CRON_SECRET}},r,{},{...env,PURCHASE_TEXTS_ENABLED:'false'},run);assert.equal(r.statusCode,503);
 r=res();await handleGmailRefresh({method:'GET',headers:{authorization:'Bearer '+env.CRON_SECRET}},r,{},env,run);assert.equal(r.statusCode,200);
});
