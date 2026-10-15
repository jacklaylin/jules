import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSignIn} from '../public/admin-session.js';

const memory=(initial={})=>{const values=new Map(Object.entries(initial));return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
const page=(hash,path='/admin')=>{const calls=[];return {location:{hash,pathname:path,search:''},history:{replaceState:(...args)=>calls.push(args)},calls};};
const saved=store=>JSON.parse(store.getItem('jules_wishlist_session'));

test('a magic-link return becomes the shared renewable session and leaves no tokens in the URL',()=>{
 const local=memory(),tab=memory({jules_token:'old-tab-token'}),{location,history,calls}=page('#access_token=fixture-access&refresh_token=fixture-refresh&expires_at=2000000000');
 assert.equal(captureSignIn({location,history,localStore:local,tabStore:tab}),null);
 assert.deepEqual(saved(local),{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:2000000000});
 assert.equal(tab.getItem('jules_token'),null);
 assert.deepEqual(calls,[[null,'','/admin']]);
});
test('an expired link reports a useful error and keeps any existing session untouched',()=>{
 const local=memory({jules_wishlist_session:JSON.stringify({access_token:'existing'})}),{location,history}=page('#error_description=Email+link+is+invalid');
 assert.match(captureSignIn({location,history,localStore:local,tabStore:memory()}),/expired or was already used/);
 assert.equal(saved(local).access_token,'existing');
});
test('a tab signed in on an old admin page keeps working, but never overrides the shared session',()=>{
 const tab=memory({jules_token:'tab-token'}),fresh=memory(),{location,history,calls}=page('');
 captureSignIn({location,history,localStore:fresh,tabStore:tab,now:()=>0});
 assert.deepEqual(saved(fresh),{access_token:'tab-token',expires_at:3600});
 assert.equal(calls.length,0);
 const existing=memory({jules_wishlist_session:JSON.stringify({access_token:'shared'})});
 captureSignIn({location,history,localStore:existing,tabStore:tab});
 assert.equal(saved(existing).access_token,'shared');
});
