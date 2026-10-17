import test from 'node:test';
import assert from 'node:assert/strict';
import {landing,needsOnboarding} from '../public/login-destination.js';

const fresh={connected:false,last_import_at:null,status:'not_started',connections:{shop:{status:'not_connected',connected:false}}};
const reply=(status,body)=>async(url,opts)=>{assert.equal(url,'/api/wishlist?gmail=1');assert.match(opts.headers.Authorization,/^Bearer t$/);return {ok:status===200,json:async()=>body};};

test('a tester who has connected nothing lands on onboarding after login',async()=>{
 assert.equal(await landing('',  't',reply(200,fresh)),'onboarding');
});
test('anyone who connected or imported anything lands on the wishlist',async()=>{
 for(const status of [{...fresh,connected:true},{...fresh,last_import_at:'2026-10-17'},{...fresh,status:'listing'},
  {...fresh,connections:{shop:{status:'awaiting_approval',connected:false}}},{...fresh,connections:{shop:{status:'ready',connected:true}}}])
  assert.equal(await landing('','t',reply(200,status)),'wishlist',JSON.stringify(status));
});
test('a page named in the link wins, and any doubt keeps the wishlist',async()=>{
 assert.equal(await landing('?next=style','t',()=>assert.fail('no check needed')),'style');
 assert.equal(await landing('?next=elsewhere','t',reply(200,fresh)),'onboarding','unknown pages are ignored');
 assert.equal(await landing('','t',reply(403,{error:'not invited'})),'wishlist','not invited to onboarding');
 assert.equal(await landing('','t',async()=>{throw Error('offline');}),'wishlist');
 assert.equal(needsOnboarding(null),false);
});
