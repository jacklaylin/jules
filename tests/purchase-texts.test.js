import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptFeedback,applyReceiptFeedback} from '../lib/receipt-feedback.js';
import {sealToken} from '../lib/gmail-client.js';
import {importStep} from '../lib/gmail-import.js';
import {newRefreshJob,refreshStep,refreshOwner,announcePurchases,managePurchaseTexts,validPick,goesWithDraft,goesWithFits,sendTestNudge,goesWithCandidates,TEST_LABEL,runDailyRefresh,handleGmailRefresh} from '../lib/purchase-texts.js';

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
  reserve:async(o,key,body)=>{if(operations.has(key))return false;operations.set(key,{status:'sending',body,conversation_id:o,created_at:sentAt(key)});return true;},
  finish:async(key,status)=>{operations.get(key).status=status;},
  optedOut:false,smsOptedOut:async function(){return this.optedOut;},
  lastInbound:async()=>null,unpromptedSince:async(o,since)=>[...operations].map(([operation_id,m])=>({operation_id,status:m.status,created_at:m.created_at})).filter(m=>m.created_at>=since)};
}
// A ledger row's time: the day in its key (the daily text keys end in a date), at the run's hour.
const sentAt=key=>{const day=key.match(/\d{4}-\d{2}-\d{2}$/)?.[0];return day?`${day}T17:00:00.000Z`:new Date(NOW).toISOString();};
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

test('one text names the new purchase as the email does and offers to find things that go with it, once a day',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[bought('jeans',200),bought('tee',1),cargos]});
 const result=await announcePurchases(store,OWNER,{},{interpret:pick({send:true,lead_item_id:'cargo'}),send:send(store),now:NOW});
 assert.deepEqual([result.status,result.item_id],['sent','cargo']);
 assert.equal(store.sent.length,1);assert.match(store.sent[0],/Carhartt WIP Camo Cargo Pants from END\./);assert.match(store.sent[0],/go with it\?/);
 // Nothing it doesn't know: no price, size, stock or shipping.
 assert.doesNotMatch(store.sent[0],/[$€£]|\b32\b|stock|ship/i);
 assert.deepEqual(store.row.data.refresh.pending,[]);assert.deepEqual(store.row.data.refresh.announced,['cargo']);
 assert.deepEqual(store.row.data.nudges.log.map(e=>[e.kind,e.status,e.item_ids]),[['goes_with','sent',['cargo']]]);
 // The offer waits for a reply, naming the item as the email did (lib/goes-with.js).
 assert.deepEqual([store.row.data.nudges.open.operation,store.row.data.nudges.open.item.name,store.row.data.nudges.open.item.merchant],[`gmail:${OWNER}:purchases:2026-10-18`,'Carhartt WIP Camo Cargo Pants','END.']);
 store.row.data.refresh.pending=['tee'];
 const again=await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail('held before choosing'),send:send(store),now:NOW+3600000});
 assert.deepEqual([again.status,store.sent.length],['held',1]);
 assert.equal(store.row.data.nudges.log.at(-1).reason,'daily_cap');
});

test('several new purchases still make one offer, about the item the model picks',async()=>{
 const shirt=bought('shirt',2,{product:'Oxford Shirt'});
 const store=storage({data:{refresh:{pending:['cargo','shirt'],announced:[]}},items:[bought('jeans',200),cargos,shirt]});
 await announcePurchases(store,OWNER,{},{interpret:pick({send:true,lead_item_id:'shirt'}),send:send(store),now:NOW});
 assert.equal(store.sent.length,1);assert.match(store.sent[0],/Oxford Shirt/);assert.doesNotMatch(store.sent[0],/Cargo/);
 assert.deepEqual(store.row.data.refresh.announced.sort(),['cargo','shirt']);
});

test('only clothing, shoes, bags and accessories get an offer; basics and other things join the wardrobe quietly',async()=>{
 assert.ok(goesWithFits({category:'bottoms'}));assert.ok(goesWithFits({category:'accessories'}));assert.ok(goesWithFits({category:null}));
 assert.equal(goesWithFits({category:'other'}),false);
 const socks=bought('socks',1,{product:'Crew Socks'});
 const store=storage({data:{refresh:{pending:['socks'],announced:[]},item_tags:{}},items:[socks]});
 // The owner filed them as other (underwear, socks and non-clothing land there).
 store.row.data.feedback=applyReceiptFeedback(store.row.data.feedback,{id:'closet:socks',owner_id:OWNER,source:'closet_edit',at:new Date(NOW).toISOString(),item_ids:['socks'],action:'correct_fields',values:{wardrobe_category:'other'}});
 const result=await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail('nothing to choose'),send:send(store),now:NOW});
 assert.equal(result.status,'not_clothing');assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.pending,[]);
 assert.deepEqual(store.row.data.nudges.log.map(e=>[e.status,e.reason]),[['skipped','not_clothing']]);
});

test('a model pick naming an unknown item falls back to the first new purchase; a failed pick still offers',async()=>{
 const items=[{id:'cargo',product:'Camo Cargo Pants'}];
 assert.equal(validPick({send:true,lead_item_id:'invented'},items).lead.id,'cargo');
 assert.deepEqual([validPick(null,items).send,validPick(null,items).lead.id],[true,'cargo']);
 assert.equal(goesWithDraft({product:'1996 Jeans',brand:'Acne Studios',color:'Black',merchant:'SSENSE'}),'saw your new Black Acne Studios 1996 Jeans from SSENSE in your email. want me to find a couple of things that go with it?');
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[cargos]});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:async()=>{throw Error('down');},send:send(store),now:NOW})).status,'sent');
});

test('the shared rules hold the offer: quiet hours, a price alert today, the weekly limit; STOP settles it',async()=>{
 const pending=()=>({refresh:{pending:['cargo'],announced:[]}});
 // 8am Eastern (no known time zone: noon to 8pm Eastern only).
 const early=storage({data:pending(),items:[cargos]});
 assert.equal((await announcePurchases(early,OWNER,{},{interpret:()=>assert.fail(),send:send(early),now:Date.parse('2026-10-18T12:00:00Z')})).status,'held');
 assert.equal(early.row.data.nudges.log[0].reason,'quiet_hours');assert.deepEqual(early.row.data.refresh.pending,['cargo']);
 // Their own time zone, from the style report page: 1pm in London is fine.
 const london=storage({data:{...pending(),style_report:{timezone:'Europe/London'}},items:[cargos]});
 assert.equal((await announcePurchases(london,OWNER,{},{interpret:pick({send:true,lead_item_id:'cargo'}),send:send(london),now:Date.parse('2026-10-18T12:00:00Z')})).status,'sent');
 const alerted=storage({data:pending(),items:[cargos]});alerted.operations.set('price-alert:a1:1:fp',{status:'sent',created_at:new Date(NOW-4*3600000).toISOString()});
 assert.equal((await announcePurchases(alerted,OWNER,{},{interpret:()=>assert.fail(),send:send(alerted),now:NOW})).status,'held');
 assert.equal(alerted.row.data.nudges.log[0].reason,'price_alert_today');
 const busyWeek=storage({data:pending(),items:[cargos]});
 for(const d of [1,3,5])busyWeek.operations.set(`gmail:${OWNER}:fit-check:2026-10-1${8-d}`,{status:'sent',created_at:new Date(NOW-d*DAY).toISOString()});
 assert.equal((await announcePurchases(busyWeek,OWNER,{},{interpret:()=>assert.fail(),send:send(busyWeek),now:NOW})).status,'held');
 assert.equal(busyWeek.row.data.nudges.log[0].reason,'weekly_cap');
 // Two nudges in a row went unanswered: paused; a message from them since lifts the pause.
 const ignored=storage({data:pending(),items:[cargos]});
 for(const d of [6,4])ignored.operations.set(`gmail:${OWNER}:purchases:2026-10-1${8-d}`,{status:'sent',created_at:new Date(NOW-d*DAY).toISOString()});
 assert.equal((await announcePurchases(ignored,OWNER,{},{interpret:()=>assert.fail(),send:send(ignored),now:NOW})).status,'held');
 assert.equal(ignored.row.data.nudges.log.at(-1).reason,'ignored_backoff');assert.deepEqual(ignored.row.data.refresh.pending,['cargo']);
 ignored.lastInbound=async()=>new Date(NOW-DAY).toISOString();
 assert.equal((await announcePurchases(ignored,OWNER,{},{interpret:pick({send:true,lead_item_id:'cargo'}),send:send(ignored),now:NOW})).status,'sent');
 const stopped=storage({data:pending(),items:[cargos]});stopped.optedOut=true;
 assert.equal((await announcePurchases(stopped,OWNER,{},{interpret:()=>assert.fail(),send:send(stopped),now:NOW})).status,'opted_out');
 assert.deepEqual([stopped.sent.length,stopped.row.data.refresh.pending],[0,[]]);
});

test('an admin test nudge goes only to the designated test conversation, labelled, and can be sent again',async()=>{
 const store=storage({items:[bought('jeans',200),cargos]});const env={PRICE_ALERT_TEST_CONVERSATION_ID:OWNER};
 assert.deepEqual((await goesWithCandidates(store,OWNER)).map(i=>i.id),['cargo','jeans']);
 await assert.rejects(sendTestNudge(store,OWNER,'cargo',{},{send:send(store)}),/designated test conversation/);
 await assert.rejects(sendTestNudge(store,OWNER,'cargo',{PRICE_ALERT_TEST_CONVERSATION_ID:'someone-else'},{send:send(store)}),/designated test conversation/);
 await assert.rejects(sendTestNudge(store,OWNER,'invented',env,{send:send(store)}),/not in their wardrobe/);
 // An old purchase works too, outside the limits; pending purchases are untouched.
 const first=await sendTestNudge(store,OWNER,'jeans',env,{send:send(store),now:NOW});
 const second=await sendTestNudge(store,OWNER,'jeans',env,{send:send(store),now:NOW});
 assert.deepEqual([first.status,second.status],['sent','sent']);
 assert.equal(store.sent.length,2);assert.ok(store.sent.every(b=>b.startsWith(TEST_LABEL)&&b.includes('Item jeans')));
 assert.deepEqual(store.row.data.nudges.log.map(e=>[e.status,e.test]),[['sent',true],['sent',true]]);
 // A test offer opens like a real one, so a reply goes down the same path.
 assert.deepEqual([store.row.data.nudges.open.test,store.row.data.nudges.open.item.id],[true,'jeans']);assert.match(store.row.data.nudges.open.operation,/^nudge-test:/);
 // Test texts never count toward the person's limits.
 assert.equal([...store.operations.keys()].filter(k=>k.startsWith('gmail:')).length,0);
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

test('a purchase the model judges not worth an offer is settled quietly',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[cargos]});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:pick({send:false,lead_item_id:'cargo'}),send:send(store),now:NOW})).status,'not_worth_a_text');
 assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.announced,['cargo']);
});

test('mid-conversation, the text waits for the next day with its purchases kept',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]}},items:[cargos],recent:[{direction:'inbound',body:'hi',created_at:new Date(NOW-5*60000).toISOString()}]});
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail(),send:send(store),now:NOW})).status,'held');
 assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.pending,['cargo']);
});

test('the person turns purchase texts off and back on in chat, and can ask where they stand',async()=>{
 const store=storage(),wait=async()=>{};
 assert.match(await managePurchaseTexts(store,OWNER,'status',{wait}),/ are on/);
 assert.match(await managePurchaseTexts(store,OWNER,'turn_off',{messageId:'m1',now:NOW,wait}),/^done: no more texts/);
 assert.deepEqual(store.row.data.purchase_texts,{enabled:false,changed_at:new Date(NOW).toISOString(),message_id:'m1'});
 // Asking again changes nothing and says so; the full import is untouched.
 assert.match(await managePurchaseTexts(store,OWNER,'turn_off',{wait}),/already off/);
 assert.equal(store.row.data.job.started_at,'import-1');
 assert.match(await managePurchaseTexts(store,OWNER,'status',{wait}),/ are off/);
 assert.match(await managePurchaseTexts(store,OWNER,'turn_on',{messageId:'m2',wait}),/^done: i'll text you again/);
 assert.equal(store.row.data.purchase_texts.enabled,true);
 // With Gmail disconnected, turning them on says there is nothing to read.
 const disconnected=storage({token:null});
 assert.match(await managePurchaseTexts(disconnected,OWNER,'turn_on',{wait}),/isn't connected/);
 await assert.rejects(managePurchaseTexts(store,OWNER,'delete',{wait}));
});

test('without email history there is nothing to turn off, and a busy history is retried before giving up',async()=>{
 const none=storage();none.gmailImport=async()=>null;none.claimGmailImport=async()=>assert.fail('nothing to change');
 assert.match(await managePurchaseTexts(none,OWNER,'turn_off',{wait:async()=>{}}),/don't read your email/);
 const busy=storage();let claims=0;const claim=busy.claimGmailImport;busy.claimGmailImport=async()=>++claims<3?null:claim();
 assert.match(await managePurchaseTexts(busy,OWNER,'turn_off',{wait:async()=>{}}),/^done/);assert.equal(claims,3);
 const stuck=storage();stuck.claimGmailImport=async()=>null;
 assert.match(await managePurchaseTexts(stuck,OWNER,'turn_off',{wait:async()=>{}}),/couldn't change that/);
});

test('with purchase texts off, new purchases join the wardrobe without a text',async()=>{
 const store=storage({data:{refresh:{pending:['cargo'],announced:[]},purchase_texts:{enabled:false}},items:[cargos]});
 assert.deepEqual(await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail('no choice needed'),send:send(store),now:NOW}),{status:'texts_off',items:1});
 assert.equal(store.sent.length,0);assert.deepEqual(store.row.data.refresh.pending,[]);assert.deepEqual(store.row.data.refresh.announced,['cargo']);
 // Turned back on later, a purchase already settled is not texted about.
 store.row.data.purchase_texts.enabled=true;
 assert.equal((await announcePurchases(store,OWNER,{},{interpret:()=>assert.fail(),send:send(store),now:NOW})).status,'nothing_new');
});

test('a purchase-texts change is not mistaken for an alert change, and real alert claims are still caught',async()=>{
 const {auditProblems}=await import('../lib/compose.js');
 const read=extra=>({texts_about_purchases_changed:true,saved_now:false,alerts_turned_on:false,alerts_turned_off:false,names_other_saved_item:false,...extra});
 // The audit read "no more purchase texts" as alerts off too: the same change, not a false claim.
 assert.deepEqual(auditProblems(read({alerts_turned_off:true}),{alerts_turned_off:false,purchase_texts:'turned_off'}),[]);
 assert.deepEqual(auditProblems(read({alerts_turned_on:true}),{alerts_turned_on:false,purchase_texts:'turned_on'}),[]);
 // The opposite direction, no purchase-texts change this turn, or a message not about it: still a problem.
 assert.equal(auditProblems(read({alerts_turned_on:true}),{purchase_texts:'turned_off'}).length,1);
 assert.equal(auditProblems(read({alerts_turned_off:true}),{}).length,1);
 assert.equal(auditProblems(read({texts_about_purchases_changed:false,alerts_turned_off:true}),{purchase_texts:'turned_off'}).length,1);
});

test('the chat agent is offered the purchase-texts tool only when the person can get those texts',async()=>{
 const {AGENT_EVAL_CASES}=await import('../lib/agent-eval.js');
 const cases=AGENT_EVAL_CASES.filter(c=>c.category==='purchase_texts');
 assert.ok(cases.length>=6);
 assert.ok(cases.some(c=>c.expect.args?.action==='turn_off')&&cases.some(c=>c.expect.args?.action==='turn_on')&&cases.some(c=>c.expect.args?.action==='status'));
 assert.ok(cases.some(c=>c.expect.not?.includes('manage_purchase_texts')));
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
