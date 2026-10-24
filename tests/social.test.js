// Social autopilot (scripts/social): the plan checks, the Zernio request and the slide pages. No live API
// calls and no browser: requests use an injected fetch, and slides are checked as HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkPost,checkPlan,zernioPost} from '../scripts/social/plan.js';
import {slideHtml} from '../scripts/social/slides.js';
import {zernio,pickAccounts,analyticsRows} from '../scripts/social/zernio.js';

const NOW=Date.parse('2026-10-25T12:00:00Z');
const post=(over={})=>({id:'w1-test',pillar:'how-to',hook:'test-hook',publishAt:'2026-10-27T19:00:00-04:00',title:'A title',caption:'A caption.',hashtags:['fashiontok'],
 slides:[{kind:'hook',text:'Hook *here*'},{kind:'list',title:'Steps',items:['one','two']},{kind:'cta'}],...over});

test('the first week plan passes its own checks', () => {
 const plan=JSON.parse(readFileSync(new URL('../docs/social/plans/2026-10-26.json',import.meta.url),'utf8'));
 assert.deepEqual(checkPlan(plan,{now:Date.parse('2026-10-25T12:00:00Z')}),[]);
 assert.ok(plan.posts.length>=6,'enough posts to be live before creator outreach');
});

test('a well-formed post passes', () => assert.deepEqual(checkPost(post(),{now:NOW}),[]));

test('technology branding is refused wherever it appears', () => {
 for(const p of [post({caption:'Your AI stylist.'}),post({title:'An agent that shops'}),post({slides:[{kind:'hook',text:'Powered by GPT'},{kind:'list',title:'x',items:['a','b']},{kind:'cta'}]})])
  assert.ok(checkPost(p,{now:NOW}).some(m=>/technology branding/.test(m)));
 // "said" and "again" contain the letters, not the word.
 assert.deepEqual(checkPost(post({caption:'She said it again.'}),{now:NOW}),[]);
});

test('a price needs a recent dated source and a "prices as of" caption', () => {
 const priced=post({slides:[{kind:'hook',text:'Found it for $140'},{kind:'card',title:'x'},{kind:'cta'}]});
 assert.ok(checkPost(priced,{now:NOW}).some(m=>/sources/.test(m)));
 const sourced={...priced,caption:'Prices as of Oct 25, 2026.',sources:[{claim:'$140 at a store',url:'https://store.example/item',asOf:'2026-10-25'}]};
 assert.deepEqual(checkPost(sourced,{now:NOW}),[]);
 assert.ok(checkPost({...sourced,sources:[{...sourced.sources[0],asOf:'2026-10-01'}]},{now:NOW}).some(m=>/recheck/.test(m)));
 assert.ok(checkPost({...sourced,caption:'Great find.'},{now:NOW}).some(m=>/prices as of/.test(m)));
});

test('a conversation is either real (evidence) or labeled as an example', () => {
 const chat=extra=>post({slides:[{kind:'hook',text:'x'},{kind:'chat',messages:[{from:'me',text:'hi'},{from:'jules',text:'hey'}],...extra},{kind:'cta'}]});
 assert.ok(checkPost(chat({}),{now:NOW}).some(m=>/illustrative/.test(m)));
 assert.deepEqual(checkPost(chat({illustrative:true}),{now:NOW}),[]);
 assert.deepEqual(checkPost(chat({evidence:'uploads/thread.png'}),{now:NOW}),[]);
 assert.match(slideHtml({kind:'chat',illustrative:true,messages:[{from:'me',text:'hi'}]}),/Example conversation/);
});

test('format rules: slide count, cta last, review window, hashtags, duplicate ids', () => {
 assert.ok(checkPost(post({slides:[{kind:'hook',text:'x'},{kind:'cta'}]}),{now:NOW}).some(m=>/3-10 slides/.test(m)));
 assert.ok(checkPost(post({slides:[{kind:'cta'},{kind:'hook',text:'x'},{kind:'hook',text:'y'}]}),{now:NOW}).some(m=>/last slide/.test(m)));
 assert.ok(checkPost(post({publishAt:'2026-10-25T13:00:00Z'}),{now:NOW}).some(m=>/12 hours/.test(m)));
 assert.ok(checkPost(post({publishAt:'2026-10-27 19:00'}),{now:NOW}).some(m=>/offset/.test(m)));
 assert.ok(checkPost(post({hashtags:['#tag']}),{now:NOW}).some(m=>/hashtags/.test(m)));
 assert.ok(checkPlan({posts:[post(),post()]},{now:NOW}).some(m=>/duplicate/.test(m)));
});

test('the Zernio request: 9:16 slides and a brand disclosure for TikTok, 4:5 and the caption for Instagram', () => {
 const body=zernioPost(post(),{tiktok:'tt1',instagram:'ig1'},{tiktok:['https://x/t1.jpg'],instagram:['https://x/i1.jpg']});
 const [tt,ig]=body.platforms;
 assert.equal(body.scheduledFor,'2026-10-27T19:00:00-04:00');
 assert.equal(tt.platform,'tiktok');assert.equal(tt.customContent,'A title');
 assert.deepEqual(tt.customMedia,[{type:'image',url:'https://x/t1.jpg'}]);
 const s=tt.platformSpecificData.tiktokSettings;
 assert.equal(s.media_type,'photo');assert.equal(s.commercialContentType,'brand_organic');
 assert.equal(s.content_preview_confirmed,true);assert.equal(s.express_consent_given,true);
 assert.match(s.description,/A caption\.\n\n#fashiontok/);
 assert.equal(ig.platform,'instagram');assert.deepEqual(ig.customMedia,[{type:'image',url:'https://x/i1.jpg'}]);
 assert.deepEqual(body.tags,['jules-social','how-to','w1-test']);
 // Only connected platforms are targeted.
 assert.deepEqual(zernioPost(post(),{tiktok:null,instagram:'ig1'},{tiktok:[],instagram:[]}).platforms.map(p=>p.platform),['instagram']);
});

test('slides escape copy and set *phrases* in the serif accent', () => {
 const html=slideHtml({kind:'hook',text:'<b>x</b> and *this*'});
 assert.match(html,/&lt;b&gt;x&lt;\/b&gt; and <em>this<\/em>/);
 assert.match(slideHtml({kind:'cta'},{format:'instagram'}),/textjules\.com/);
 assert.match(slideHtml({kind:'cta'},{format:'instagram'}),/height:450px/);
});

test('the client presigns, uploads without auth, and treats 409 as already posted', async () => {
 const calls=[];
 const fetch=async (url,init)=>{calls.push({url,init});
  if(url.endsWith('/media/presign'))return new Response(JSON.stringify({uploadUrl:'https://storage.invalid/put',publicUrl:'https://cdn.invalid/a.jpg'}));
  if(url==='https://storage.invalid/put')return new Response('');
  if(url.endsWith('/posts'))return new Response(JSON.stringify({existingPostId:'p1'}),{status:409});
  return new Response('{}',{status:500});};
 const api=zernio({key:'sk_test',fetch});
 assert.equal(await api.upload(Buffer.from('x'),'a.jpg'),'https://cdn.invalid/a.jpg');
 assert.equal(calls[0].init.headers.Authorization,'Bearer sk_test');
 assert.equal(calls[1].init.headers.Authorization,undefined);
 const {status,data}=await api.createPost({},'k1');
 assert.equal(status,409);assert.equal(data.existingPostId,'p1');
 assert.equal(calls[2].init.headers['Idempotency-Key'],'k1');
 await assert.rejects(api.analytics(),/500/);
});

test('account picking and analytics rows', () => {
 const accounts=[{_id:'a',platform:'tiktok',username:'one'},{_id:'b',platform:'tiktok',username:'textjules'},{_id:'c',platform:'instagram'}];
 assert.deepEqual(pickAccounts(accounts,{}),{tiktok:'a',instagram:'c'});
 assert.deepEqual(pickAccounts(accounts,{ZERNIO_TIKTOK_ACCOUNT:'textjules'}),{tiktok:'b',instagram:'c'});
 const rows=analyticsRows({posts:[{latePostId:'p1',publishedAt:'2026-10-27',content:'Title\nmore',platformAnalytics:[{platform:'tiktok',analytics:{views:900,shares:4,saves:7}},{platform:'instagram',analytics:{impressions:300}}]}]});
 assert.deepEqual(rows.map(r=>[r.post,r.platform,r.views,r.shares,r.content]),[['p1','tiktok',900,4,'Title'],['p1','instagram',300,0,'Title']]);
});
