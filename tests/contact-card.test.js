import test from 'node:test';
import assert from 'node:assert/strict';
import {julesVCard,contactCardFile,loadContactPhoto,CONTACT_CARD_TEXT} from '../lib/contact-card.js';
import {welcomeTester} from '../lib/onboarding.js';
import {sendGreeting} from '../lib/photon.js';

const env={ONBOARDING_ENABLED:'true',CONTACT_CARD_ENABLED:'true',SITE_ORIGIN:'https://jules.example/',JULES_PUBLIC_LINE:'+1 (415) 555-0100'};
const unfold=card=>card.replace(/\r\n /g,'');

test('vCard names Jules, uses the configured line and site, and embeds the orb photo',async()=>{
 const photo=await loadContactPhoto();
 assert.ok(photo.length<20000,'photo stays small enough for an iMessage attachment');
 assert.equal(photo.subarray(0,3).toString('hex'),'ffd8ff','photo is a JPEG');
 const card=julesVCard(env,photo);
 assert.match(card,/^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
 assert.match(card,/\r\nEND:VCARD\r\n$/);
 const lines=unfold(card).split('\r\n');
 assert.ok(lines.includes('FN:Jules'));
 assert.ok(lines.includes('NOTE:Personal shopper'));
 assert.ok(lines.includes('TEL;TYPE=CELL,VOICE,pref:+14155550100'));
 assert.ok(lines.includes('URL:https://jules.example'));
 const encoded=lines.find(l=>l.startsWith('PHOTO;ENCODING=b;TYPE=JPEG:')).split(':')[1];
 assert.deepEqual(Buffer.from(encoded,'base64'),photo);
 for(const line of card.split('\r\n'))assert.ok(line.length<=75,'folded to 75 octets');
});

test('no card without a valid configured line; no photo still yields a card',async()=>{
 assert.equal(julesVCard({SITE_ORIGIN:'https://jules.example'},Buffer.from('x')),null);
 assert.equal(julesVCard({JULES_PUBLIC_LINE:'replace-with-your-photon-line-in-international-format'},null),null);
 assert.equal(await contactCardFile({}),null);
 const logs=[];
 const file=await contactCardFile(env,{load:async()=>{throw Error('missing');},log:l=>logs.push(l)});
 assert.equal(file.name,'jules.vcf');assert.equal(file.mimeType,'text/vcard');
 assert.doesNotMatch(file.bytes.toString(),/PHOTO/);
 assert.match(logs[0],/contact_card_photo_missing/);
});

test('the card carries the line this person texts, falling back to JULES_PUBLIC_LINE',async()=>{
 const own=unfold(julesVCard(env,null,'+1 415 555 0199')).split('\r\n');
 assert.ok(own.includes('TEL;TYPE=CELL,VOICE,pref:+14155550199'));
 assert.ok(!own.some(l=>l.includes('+14155550100')));
 assert.ok(unfold(julesVCard(env,null,'not-a-number')).includes('pref:+14155550100'));
 const file=await contactCardFile({SITE_ORIGIN:'https://jules.example'},{line:'+14155550199',load:async()=>null});
 assert.match(file.bytes.toString(),/pref:\+14155550199/);
 assert.equal(await contactCardFile({},{line:'synthetic-line'}),null);
});

test('the welcome card is built from the tester\'s own conversation line',async()=>{
 const f=fixture('+14155550199');
 const files=[];const send=async(delivery,body,_env,options={})=>{files.push(...(options.files??[]));return {};};
 const result=await welcomeTester('synthetic',f.store,env,send);
 assert.equal(result.contact_card,'sent');
 assert.match(files[0].bytes.toString(),/pref:\+14155550199/);
});

function fixture(line='synthetic-line'){
 const operations=new Map(),sent=[];let state='invited';
 const conversation={id:'tester-id',sender_id:'synthetic-tester',line};
 const store={onboardingInvite:async()=>conversation,onboardingSession:async()=>({state}),advanceOnboarding:async(id,from,to)=>{if(state!==from)return false;state=to;return true;},operation:async id=>operations.get(id),reserve:async(id,key,body)=>{if(operations.has(key))return false;operations.set(key,{conversation_id:id,body,status:'sending'});return true;},finish:async(key,status)=>{operations.get(key).status=status;}};
 const send=async(delivery,body,_env,options={})=>{sent.push({body,files:(options.files??[]).map(f=>f.name)});return {};};
 return {store,send,sent,operations};
}

test('the contact card follows the welcome once, and only after it was delivered',async()=>{
 const f=fixture();
 const result=await welcomeTester('synthetic',f.store,env,f.send);
 assert.equal(result.message_sent,true);assert.equal(result.contact_card,'sent');
 assert.equal(f.sent.length,2);
 assert.deepEqual(f.sent[0].files,[]);
 assert.equal(f.sent[1].body,CONTACT_CARD_TEXT);assert.deepEqual(f.sent[1].files,['jules.vcf']);
 assert.equal(f.operations.get('onboarding:tester-id:contact_card').status,'sent');
 await welcomeTester('synthetic',f.store,env,f.send);
 assert.equal(f.sent.length,2,'no second welcome or card');
});

test('an uncertain welcome gets no card; a missing line sends the welcome alone',async()=>{
 const f=fixture();
 const result=await welcomeTester('synthetic',f.store,env,async()=>{throw Error('network');});
 assert.equal(result.message_status,'uncertain');assert.equal(result.contact_card,undefined);
 assert.equal(f.operations.has('onboarding:tester-id:contact_card'),false);
 const g=fixture();
 const plain=await welcomeTester('synthetic',g.store,{...env,JULES_PUBLIC_LINE:''},g.send);
 assert.equal(plain.message_sent,true);assert.equal(plain.contact_card,'skipped');assert.equal(g.sent.length,1);
});

test('a failed card send never changes the welcome result',async()=>{
 const f=fixture();let calls=0;
 const send=async(...args)=>{if(++calls===2)throw Error('network');return f.send(...args);};
 const result=await welcomeTester('synthetic',f.store,env,send);
 assert.equal(result.message_sent,true);assert.equal(result.contact_card,'uncertain');
});

test('sendGreeting sends the lead-in text, then the file as an attachment',async()=>{
 const sends=[],logs=[];
 const conversation={send:async content=>{sends.push(await content.build?.()??content);return {id:`m${sends.length}`};}};
 const provider=Object.assign(()=>({user:async id=>({id}),space:{create:async()=>conversation}}),{config:()=>({})});
 const file={name:'jules.vcf',mimeType:'text/vcard',bytes:Buffer.from('BEGIN:VCARD\r\nEND:VCARD\r\n')};
 await sendGreeting({space:{phone:'line'},message:{sender:{id:'u'}}},CONTACT_CARD_TEXT,{},{files:[file],connect:async()=>({stop:async()=>{}}),provider,log:l=>logs.push(l)});
 assert.equal(sends.length,2);
 assert.equal(sends[0],CONTACT_CARD_TEXT);
 assert.equal(sends[1].type,'attachment');assert.equal(sends[1].name,'jules.vcf');
 assert.match(logs.join('\n'),/imessage_file_sent/);
});

// Admin › person › Text them Jules's contact card: a one-phone re-test that resets nothing.
import {createAdminHandler} from '../api/admin.js';
const person='00000000-0000-4000-8000-0000000000a1';
async function adminPost(handler,input,origin='https://jules.example'){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.status=this.statusCode;this.data=JSON.parse(value);}};
 await handler({method:'POST',url:'/api/admin',headers:{'content-type':'application/json',...(origin?{origin}:{})},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}},res);
 return res;
}
function adminWorld(){
 const f=fixture();
 f.store.conversation=async id=>id===person?{id:person,sender_id:'synthetic-tester',line:'synthetic-line'}:null;
 return f;
}

test('admin can text the contact card again without resetting onboarding',async()=>{
 const f=adminWorld();
 // Welcome and first card already went out during onboarding.
 await welcomeTester('synthetic',f.store,env,f.send);
 const before=[...f.operations.keys()];
 const handler=createAdminHandler({auth:async()=>200,env,storeFactory:()=>f.store,send:f.send});
 const first=await adminPost(handler,{action:'send-contact-card',conversation:person,confirm:true});
 assert.equal(first.data.contact_card,'sent');
 const second=await adminPost(handler,{action:'send-contact-card',conversation:person,confirm:true});
 assert.equal(second.data.contact_card,'sent','each click is its own send');
 const cards=f.sent.filter(m=>m.files.includes('jules.vcf'));
 assert.equal(cards.length,3);assert.ok(cards.every(m=>m.body===CONTACT_CARD_TEXT));
 for(const key of before)assert.equal(f.operations.get(key).status,'sent','onboarding ledger untouched');
});

test('admin contact card needs the admin page, confirmation and a configured line',async()=>{
 const f=adminWorld();
 const handler=(e=env)=>createAdminHandler({auth:async()=>200,env:e,storeFactory:()=>f.store,send:f.send});
 for(const origin of [null,'https://evil.example'])assert.match((await adminPost(handler(),{action:'send-contact-card',conversation:person,confirm:true},origin)).data.error,/admin page/);
 assert.match((await adminPost(handler(),{action:'send-contact-card',conversation:person})).data.error,/Confirm/);
 assert.match((await adminPost(handler({...env,JULES_PUBLIC_LINE:''}),{action:'send-contact-card',conversation:person,confirm:true})).data.error,/JULES_PUBLIC_LINE/);
 assert.equal(f.sent.length,0);
});
