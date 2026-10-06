import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../public/wishlist-session.js';
const storage=()=>{const values=new Map();return{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
const stale={access_token:'old',refresh_token:'refresh',expires_at:1};
const renewed={access_token:'new',refresh_token:'rotated',expires_at:10000};
test('sessions persist across page instances and do not refresh valid access tokens',async()=>{
 const store=storage();const session=createSession({storage:store,now:()=>1000,fetcher:()=>{throw Error('Unexpected refresh');}});session.save(renewed);
 assert.equal(await createSession({storage:store,now:()=>1000}).token(),'new');session.clear();assert.equal(session.read(),null);
});
test('concurrent requests rotate tokens once and persist the new pair',async()=>{
 let calls=0;const session=createSession({storage:storage(),now:()=>100000,fetcher:async()=>{calls++;return{ok:true,json:async()=>renewed}}});session.save(stale);
 assert.deepEqual(await Promise.all([session.token(),session.token()]),['new','new']);assert.equal(calls,1);assert.deepEqual(session.read(),renewed);
});
test('rejected refresh clears session while temporary failures preserve it',async()=>{
 for(const status of [401,503]){const session=createSession({storage:storage(),fetcher:async()=>({ok:false,status})});session.save(stale);await assert.rejects(session.token());assert.equal(Boolean(session.read()),status===503);}
});
test('refresh finishing after logout cannot restore the session',async()=>{
 let finish;const session=createSession({storage:storage(),fetcher:()=>new Promise(resolve=>{finish=resolve;})});session.save(stale);const pending=session.token();session.clear();finish({ok:true,json:async()=>renewed});assert.equal(await pending,null);assert.equal(session.read(),null);
});
