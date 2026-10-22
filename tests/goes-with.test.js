import test from 'node:test';
import assert from 'node:assert/strict';
import {openOffer,openRecord,loadOpenOffer,acceptedBrief,declinedBrief,settleOffer,offerContext,readOfferReply,OFFER_OPEN_MS,REPLY_OUTCOMES} from '../lib/goes-with.js';
import {generateReply} from '../lib/ai.js';
import {receiveInInbox} from '../lib/inbox.js';
import {agentTurn,tool,agentContext,toolNames,toolOutputs} from './helpers/agent.js';

const OWNER='00000000-0000-4000-8000-000000000001',NOW=Date.parse('2026-10-21T17:00:00Z'),HOUR=3600000;
const jeans={id:'item-jeans',name:'Black Our Legacy Third Cut Jeans',brand:'Our Legacy',product:'Third Cut Jeans',color:'Black',category:'bottoms',merchant:'SSENSE',size:'32'};
const OP=`gmail:${OWNER}:purchases:2026-10-21`;
const offer=openRecord(jeans,OP,NOW);

// The history row (data.nudges) and the message ledger, as the application uses them.
function storage({nudges={open:offer,log:[]},status='sent'}={}){
 let row={conversation_id:OWNER,revision:1,token_ciphertext:'sealed',data:{nudges}};
 return {get row(){return row;},
  nudgeState:async()=>structuredClone(row.data.nudges??null),operation:async key=>key===OP?{status,conversation_id:OWNER}:null,
  claimGmailImport:async()=>{row.revision++;return structuredClone(row);},
  finishGmailImport:async(_o,revision,data,token)=>{if(revision!==row.revision)return false;row={...row,data:structuredClone(data),token_ciphertext:token};return true;}};
}

test('an offer is open for two days after its text went out, and only then',async()=>{
 assert.deepEqual(offer.item,{id:'item-jeans',name:'Black Our Legacy Third Cut Jeans',brand:'Our Legacy',product:'Third Cut Jeans',color:'Black',category:'bottoms',merchant:'SSENSE',size_bought:'32'});
 assert.equal(openOffer({open:offer},NOW+HOUR),offer);
 assert.equal(openOffer({open:offer},NOW+OFFER_OPEN_MS),null);
 assert.equal(openOffer({open:offer},NOW+HOUR,'uncertain'),null,'a text that may not have arrived opens nothing');
 assert.equal(openOffer({open:null},NOW),null);
 assert.equal((await loadOpenOffer(storage(),OWNER,NOW+HOUR))?.operation,OP);
 assert.equal(await loadOpenOffer(storage({status:'blocked'}),OWNER,NOW+HOUR),null);
 assert.equal(await loadOpenOffer(storage({nudges:null}),OWNER,NOW),null);
});

test('the model sees the offer as named in the purchase, never the purchased size',()=>{
 const seen=offerContext(offer);
 assert.equal(seen.item.name,'Black Our Legacy Third Cut Jeans');assert.equal(seen.item.bought_from,'SSENSE');
 assert.doesNotMatch(JSON.stringify(seen),/"32"/);
 const brief=acceptedBrief(offer);
 assert.match(brief,/find_products/);assert.match(brief,/Black Our Legacy Third Cut Jeans/);assert.match(brief,/not another bottoms/);
 assert.match(brief,/saved sizes/);assert.match(brief,/not a general size/);assert.doesNotMatch(brief,/\b32\b/);
 assert.match(declinedBrief('declined'),/do not search/);assert.match(declinedBrief('not_now'),/not now/);
});

test('the first reply settles the offer once, with its outcome logged',async()=>{
 const store=storage();
 const logged=await settleOffer(store,OWNER,offer,'accepted',{messageId:'m1',now:NOW+2*HOUR});
 assert.deepEqual([logged.kind,logged.status,logged.reason,logged.item_ids],['goes_with','replied','accepted',['item-jeans']]);
 assert.equal(store.row.data.nudges.open,null);
 assert.deepEqual(store.row.data.nudges.last_reply,{operation:OP,outcome:'accepted',source:'agent',message_id:'m1',at:new Date(NOW+2*HOUR).toISOString()});
 // A second message (or a replayed turn) does not settle it again.
 assert.equal(await settleOffer(store,OWNER,offer,'unrelated',{now:NOW+3*HOUR}),null);
 assert.equal(store.row.data.nudges.log.length,1);
 await assert.rejects(settleOffer(storage(),OWNER,offer,'maybe'));
 assert.deepEqual(REPLY_OUTCOMES,['accepted','declined','not_now','unrelated','stopped']);
});

test('the independent reading is for the log only and is unavailable without a model',async()=>{
 assert.equal(await readOfferReply({offer,reply:'sure',env:{}}),null);
 const reply=outcome=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({outcome})}]}]})});
 assert.equal(await readOfferReply({offer,reply:'yes, a jacket maybe',env:{OPENAI_API_KEY:'k'},fetcher:reply('accepted')}),'accepted');
 assert.equal(await readOfferReply({offer,reply:'x',env:{OPENAI_API_KEY:'k'},fetcher:reply('banana')}),null);
 assert.equal(await readOfferReply({offer,reply:'x',env:{OPENAI_API_KEY:'k'},fetcher:async()=>{throw Error('down');}}),null);
});

test('the agent is offered the answer tool only while an offer is open, and a yes returns the search brief',async()=>{
 const env={AI_ENABLED:'true',OPENAI_API_KEY:'k',SEARCH_ENABLED:'true'};
 const messages=[{direction:'outbound',status:'sent',body:'saw your new jeans. want me to find a couple of things that go with them?'},{id:'m1',direction:'inbound',body:'yes please'}];
 const requests=[],answers=[];let round=0;
 const rounds=[agentTurn({...tool('conversation_reply'),name:'answer_goes_with_offer',arguments:JSON.stringify({outcome:'accepted'}),call_id:'c1'}),agentTurn({...tool('conversation_reply',{response:'on it.'}),call_id:'c2'})];
 await generateReply(messages,env,async(_u,o)=>{requests.push(o);return rounds[Math.min(round++,1)];},{goesWithOffer:offer,goesWithAction:async outcome=>{answers.push(outcome);return acceptedBrief(offer);}}).catch(()=>{});
 assert.ok(toolNames(requests[0]).includes('answer_goes_with_offer'));
 assert.equal(agentContext(requests[0]).goes_with_offer.item.name,'Black Our Legacy Third Cut Jeans');
 assert.deepEqual(answers,['accepted']);
 assert.ok(toolOutputs(requests[1]).some(o=>JSON.stringify(o).includes('find_products')),'the brief goes back to the model');
 const without=[];
 await generateReply(messages,env,async(_u,o)=>{without.push(o);return agentTurn(tool('conversation_reply',{response:'hi'}));},{}).catch(()=>{});
 assert.equal(toolNames(without[0]).includes('answer_goes_with_offer'),false);
 assert.equal(agentContext(without[0]).goes_with_offer,undefined);
});

// One inbound message through the real inbox, with the agent stubbed to what the model chose.
async function turn(store,text,agent){
 const C=OWNER;let delivered=null;
 Object.assign(store,{receive:async()=>C,claimAI:async()=>true,context:async()=>[{id:'00000000-0000-4000-8000-0000000000aa',provider_id:'p1',direction:'inbound',body:text,status:'received',created_at:new Date(NOW+HOUR).toISOString()}],
  prepareAI:async()=>{},finish:async()=>{},searchResult:async()=>{},recordAdoptionEvent:async()=>{}});
 await receiveInInbox({space:{phone:'l'},message:{id:'p1',sender:{id:'s'},content:{type:'text',text},attachments:[]}},{AI_ENABLED:'true',PURCHASE_TEXTS_ENABLED:'true'},
  {store,send:async(_d,body)=>{delivered=body;return {id:'out'};},compose:async args=>({body:args.draft,captions:[],composed:true}),generate:async(_m,_e,_f,memory)=>agent(memory)});
 return delivered;
}

test('multi-turn: yes, no, not now and an unrelated reply each settle the offer as the turn read it',async()=>{
 const cases=[
  ['ooh yes',async m=>{assert.equal(m.goesWithOffer.item.id,'item-jeans');assert.match(await m.goesWithAction('accepted'),/find_products/);return 'here are a few.';},'accepted','agent'],
  ['nah',async m=>{await m.goesWithAction('declined');return 'no worries.';},'declined','agent'],
  ['maybe next week',async m=>{await m.goesWithAction('not_now');return 'sure, anytime.';},'not_now','agent'],
  ['can you find a belt for my dad',async()=>'on it.','unrelated','fallback'],
 ];
 for(const [text,agent,outcome,source] of cases){
  const store=storage();
  // The offer went out an hour before this message (the turn reads the clock).
  store.row.data.nudges.open={...offer,at:new Date(Date.now()-HOUR).toISOString()};
  const reply=await turn(store,text,agent);
  assert.ok(reply,`${text}: replied`);
  assert.equal(store.row.data.nudges.open,null,`${text}: settled`);
  assert.deepEqual([store.row.data.nudges.last_reply.outcome,store.row.data.nudges.last_reply.source],[outcome,source],text);
  assert.equal(store.row.data.nudges.log.at(-1).reason,outcome);
 }
 // With no open offer the tool is not offered and nothing is written.
 const none=storage({nudges:{log:[]}});
 await turn(none,'hi',async m=>{assert.equal(m.goesWithAction,undefined);return 'hey.';});
 assert.deepEqual(none.row.data.nudges,{log:[]});
});
