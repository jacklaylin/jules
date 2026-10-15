import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiveInInbox} from '../lib/inbox.js';

// A fallback reply must leave a diagnosable reason in the logs, never the user's message text.
test('a failed AI reply logs its error class and code, then sends the fallback',async()=>{
 const logs=[],sent=[],original=console.log;console.log=line=>logs.push(String(line));
 try{
  const store={receive:async()=>'conversation',claimAI:async()=>true,context:async()=>[{id:'m',provider_id:'p',direction:'inbound',body:'Both were for me, kept one'}],
   prepareAI:async()=>{},finish:async()=>{},searchResult:async()=>{},recordDelivery:async()=>{}};
  const delivery={space:{phone:'fake'},message:{id:'p',sender:{id:'fake'},content:{type:'text',text:'Both were for me, kept one'},attachments:[]}};
  const failure=Object.assign(new Error('Database request failed'),{database_status:409,database_code:'P0001'});
  await receiveInInbox(delivery,{AI_ENABLED:'true'},{store,progress:async()=>async()=>{},generate:async()=>{throw failure;},send:async(d,body)=>{sent.push(body);return {id:'out'};}});
 }finally{console.log=original;}
 const event=logs.map(l=>{try{return JSON.parse(l);}catch{return null;}}).find(e=>e?.event==='ai_reply_failed');
 assert.ok(event);assert.equal(event.reason,'Database request failed');assert.equal(event.database_status,409);assert.equal(event.database_code,'P0001');
 assert.ok(logs.every(l=>!l.includes('kept one')),'message text is never logged');
 assert.equal(sent.length,1);
});
