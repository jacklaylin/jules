// Jules+ fake-door test (lib/plus-test.js, api/plus.js, public/plus.html): what gets counted, for whom, and how often.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {recordPlusEvent,PLUS_PRICE} from '../lib/plus-test.js';
import {createPlusHandler} from '../api/plus.js';

const PERSON='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const OWNER='11111111-1111-4111-8111-111111111111';
function fakeStore({fail=false}={}){
 const rows=[];
 return {rows,
  async recordAdoptionEvent(row){if(fail)throw Object.assign(new Error('missing'),{database_status:400});rows.push(row);},
  async hasAdoptionEvent({conversation_id,kind,ref,since}){return rows.some(r=>r.conversation_id===conversation_id&&r.kind===kind&&r.ref===ref&&(r.at??0)>=Date.parse(since));}};
}
const request=(input,headers={})=>Object.assign(Readable.from([JSON.stringify(input)]),{method:'POST',headers:{'content-type':'application/json','user-agent':PERSON,...headers}});
const response=()=>({setHeader(){},end(value){this.data=JSON.parse(value);}});

test('a signed-in tester counts once a day for views and once ever for the tap, with the price shown',async()=>{
 const store=fakeStore();
 const stamp=()=>{store.rows.at(-1).at=Date.now();};
 assert.equal((await recordPlusEvent(store,{owner:OWNER,event:'view',agent:PERSON})).recorded,true);stamp();
 assert.equal((await recordPlusEvent(store,{owner:OWNER,event:'view',agent:PERSON})).recorded,false);
 assert.equal((await recordPlusEvent(store,{owner:OWNER,event:'view',agent:PERSON},()=>new Date(Date.now()+25*3600*1000))).recorded,true);
 await recordPlusEvent(store,{owner:OWNER,event:'interest',agent:PERSON});stamp();
 await recordPlusEvent(store,{owner:OWNER,event:'interest',agent:PERSON},()=>new Date(Date.now()+90*24*3600*1000));
 assert.deepEqual(store.rows.filter(r=>r.kind==='plus_interest').map(({at,...r})=>r),[{conversation_id:OWNER,kind:'plus_interest',ref:String(PLUS_PRICE),quantity:1}]);
});

test('signed-out visitors count anonymously; bots, unknown events and a missing table record nothing',async()=>{
 const store=fakeStore();
 await recordPlusEvent(store,{event:'interest',agent:PERSON});
 await recordPlusEvent(store,{event:'interest',agent:'facebookexternalhit/1.1'});
 await recordPlusEvent(store,{event:'buy',agent:PERSON});
 assert.deepEqual(store.rows,[{conversation_id:null,kind:'plus_interest',ref:String(PLUS_PRICE),quantity:1}]);
 assert.equal((await recordPlusEvent(fakeStore({fail:true}),{event:'view',agent:PERSON})).recorded,false);
});

test('the endpoint counts a signed-in tap as that tester, and a failed sign-in as anonymous instead of an error',async()=>{
 const store=fakeStore();
 const signedIn=createPlusHandler({env:{},storeFactory:()=>store,auth:async()=>({status:200,conversation:OWNER})});
 let res=response();await signedIn(request({event:'interest'},{authorization:'Bearer x'}),res);
 assert.deepEqual(res.data,{ok:true,signed_in:true});
 const expired=createPlusHandler({env:{},storeFactory:()=>store,auth:async()=>({status:401})});
 res=response();await expired(request({event:'interest'},{authorization:'Bearer x'}),res);
 assert.deepEqual(res.data,{ok:true,signed_in:false});
 assert.deepEqual(store.rows.map(r=>r.conversation_id),[OWNER,null]);
 res=response();await signedIn(request({event:'charge'}),res);
 assert.equal(res.statusCode,400);assert.equal(store.rows.length,2);
});

test('the page shows the same price the events record, says nothing is charged, and stays out of search',()=>{
 const html=readFileSync(new URL('../public/plus.html',import.meta.url),'utf8');
 assert.match(html,new RegExp(`data-price="${PLUS_PRICE}"><span class="plus-amount">\\$${PLUS_PRICE}</span>`));
 assert.match(html,/You haven’t been charged/);
 assert.match(html,/<meta name="robots" content="noindex">/);
});
