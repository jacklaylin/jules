import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {createStyleHandler} from '../api/style.js';
import {prepareSource,validateAnalysis,validateCards,receiptStats,eligibleCards,confirmReport,reportFacts,analyzeStyle} from '../lib/style.js';
import {cardText,wrapText} from '../public/style-export.js';
import {createStore} from '../lib/store.js';
import {receiveInInbox} from '../lib/inbox.js';

const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const source={id:'00000000-0000-4000-8000-000000000003',kind:'outfit',occasion:'everyday',note:'My staple',mime_type:'image/jpeg',data:'cGhvdG8='};
const receipt={...source,id:'00000000-0000-4000-8000-000000000004',kind:'receipt'};
const observation={id:'o1',text:'Navy knitwear recurs.',source_ids:[source.id],confidence:'medium',preference:{field:'style',key:'navy_knitwear',value:'Prefers navy knitwear for everyday outfits'}};
const analysis=()=>({observations:[structuredClone(observation)],purchases:[],crops:[{label:'Navy sweater',source_id:source.id,box:[.1,.2,.9,.8]}]});
const rawCard={type:'starter',title:'Your starter pack',variants:{nice:'Navy knitwear is a staple.',balanced:'You keep coming back to navy knitwear.',roast:'You keep coming back to navy knitwear.'},observation_ids:['o1']};
const report=()=>({id:other,status:'draft',analysis:analysis(),stats:receiptStats([]),cards:validateCards({cards:[rawCard]},analysis(),[source])});
const env={STYLE_ENABLED:'true',OPENAI_API_KEY:'fake-test',SITE_ORIGIN:'https://shopper.invalid'};
const req=(body,method='POST',url='/api/style')=>Object.assign(Readable.from(body?[JSON.stringify(body)]:[]),{method,url,headers:{'content-type':'application/json',authorization:'Bearer test'}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=value;}});
const data=r=>JSON.parse(r.value);
function db(){
  let state={revision:0,data:{notes:'',tone:'balanced',report:null,consent_at:'2026-10-07T00:00:00Z'}},sources=[structuredClone(source)],facts=[];
  return {
    styleSession:async id=>{assert.equal(id,owner);return structuredClone(state);},
    styleSources:async(id,bytes=false)=>{assert.equal(id,owner);return structuredClone(sources).map(s=>{if(!bytes)delete s.data;return s;});},
    styleSource:async(id,key)=>{assert.equal(id,owner);return structuredClone(sources.find(s=>s.id===key)??null);},
    writeStyle:async(id,revision,value,options={})=>{
      assert.equal(id,owner);if(revision!==state.revision)return false;
      state={revision:revision+1,data:structuredClone(value)};
      if(options.source)sources.push(structuredClone(options.source));if(options.remove)sources=sources.filter(s=>s.id!==options.remove);
      if(options.facts)facts=structuredClone(options.facts);return true;
    },
    deleteStyle:async(id,revision)=>{assert.equal(id,owner);if(revision!==state.revision)return false;sources=[];facts=[];state={revision:revision+1,data:{notes:'',tone:'balanced',report:null}};return true;},
    facts:()=>facts,
  };
}
const handler=(store,options={})=>createStyleHandler({env,auth:async()=>({status:200,conversation:owner}),storeFactory:()=>store,...options});
test('unauthorized style requests never read private state or sources',async()=>{
  const store={styleSession:()=>assert.fail()};const h=handler(store,{auth:async()=>({status:401})});
  const r=res();await h(req(null,'GET','/api/style?source='+other),r);assert.equal(r.statusCode,401);
});
test('GET returns source metadata without bytes, and arbitrary owner IDs cannot retrieve another user source',async()=>{
  const store=db(),h=handler(store);let r=res();await h(req(null,'GET'),r);
  assert.equal(r.statusCode,200);assert.equal(data(r).sources[0].data,undefined);assert.equal(data(r).signup_url,'https://shopper.invalid/style');
  r=res();await h(req(null,'GET','/api/style?source='+other),r);assert.equal(r.statusCode,404);
  r=res();await h(req(null,'GET','/api/style?source='+source.id),r);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers['Content-Type'],'image/jpeg');
});
test('uploads require consent; changed inputs clear old report and its confirmed preferences',async()=>{
  const store=db();await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:report()},{facts:[{value:'old'}]});
  const h=handler(store,{prepare:async()=>({...source,id:other})});let r=res();await h(req({revision:1,action:'upload'}),r);assert.equal(r.statusCode,400);
  r=res();await h(req({revision:1,action:'upload',consent:true}),r);assert.equal(r.statusCode,200);assert.equal(data(r).data.report,null);assert.deepEqual(store.facts(),[]);
  r=res();await h(req({revision:1,action:'context',notes:'stale'}),r);assert.equal(r.statusCode,409);
});
test('one reservation prevents concurrent paid analyses and a provider failure releases it',async()=>{
  const store=db();let calls=0,release;const gate=new Promise(resolve=>release=resolve);
  const h=handler(store,{analyze:async()=>{calls++;await gate;throw new Error('secret provider failure');}});
  const first=res(),running=h(req({revision:0,action:'analyze',consent:true}),first);
  while(!calls)await new Promise(resolve=>setImmediate(resolve));
  const second=res();await h(req({revision:1,action:'analyze',consent:true}),second);assert.equal(second.statusCode,409);assert.equal(calls,1);
  release();await running;assert.equal(first.statusCode,503);assert.doesNotMatch(first.value,/secret/);assert.equal((await store.styleSession(owner)).data.busy_until,null);
});
test('deletion invalidates in-flight model results and prevents resurrection',async()=>{
  const store=db();let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  const h=handler(store,{analyze:async()=>{started();await gate;return report();}});
  const r=res(),running=h(req({revision:0,action:'analyze',consent:true}),r);await ready;
  const deleted=res();await h(req({revision:1,action:'delete'}),deleted);assert.equal(deleted.statusCode,200);
  release();await running;assert.equal(r.statusCode,409);assert.equal((await store.styleSession(owner)).data.report,null);assert.deepEqual(await store.styleSources(owner),[]);
});
test('confirmation only saves explicitly selected edited preferences; a rejected card never saves them',()=>{
  const original=report(),card=original.cards[0];
  const review={id:card.id,accepted:true,hidden:false,correction:'Olive knitwear is my staple.',preferences:[{observation_id:'o1',accepted:true,value:'Prefers olive knitwear'}]};
  const confirmed=confirmReport(original,[review]);assert.equal(cardText(confirmed.cards[0],'roast'),review.correction);
  assert.equal(reportFacts(confirmed)[0].value,'Prefers olive knitwear');assert.equal(reportFacts(confirmed)[0].source,'style_report');
  assert.equal(reportFacts(confirmReport(original,[{...review,preferences:[{...review.preferences[0],accepted:false}]}])).length,0);
  assert.throws(()=>confirmReport(original,[{...review,accepted:false}]),/Keep at least/);
});
test('tone changes never rerun analysis or alter evidence and saved facts',async()=>{
  const store=db();await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:report()},{facts:[{value:'confirmed'}]});
  const h=handler(store,{analyze:()=>assert.fail()});const r=res();await h(req({revision:1,action:'tone',tone:'roast'}),r);
  assert.equal(r.statusCode,200);assert.deepEqual(data(r).data.report.analysis,analysis());assert.deepEqual(store.facts(),[{value:'confirmed'}]);
});
test('receipt statistics deduplicate records, match completed returns, and exclude gifts and uncertain ownership',()=>{
  const p={source_ids:[receipt.id],order_key:'a',item_key:'b',retailer:'Shop',brand:'Label',category:'knitwear',event:'purchase',for_self:true,amount:null,currency:null,discounted:null,date:null};
  const stats=receiptStats([p,{...p},{...p,event:'return_completed'},{...p,item_key:'gift',for_self:false},{...p,item_key:'unknown',for_self:null},{...p,item_key:'unmatched',event:'return_completed'}]);
  assert.equal(stats.items,1);assert.equal(stats.returned,1);assert.equal(stats.sale_known,0);assert.deepEqual(stats.stores,[{name:'shop',count:1}]);
  const conflict=receiptStats([p,{...p,amount:20,currency:'USD',discounted:true}]);assert.equal(conflict.sale_known,0);
});
test('conflicting user-confirmed preferences cannot silently overwrite each other',()=>{
  const original=report();original.cards.push({...original.cards[0],id:source.id});
  const reviews=original.cards.map((card,i)=>({id:card.id,accepted:true,hidden:false,correction:'',preferences:[{observation_id:'o1',accepted:true,value:i?'Prefers olive':'Prefers navy'}]}));
  assert.throws(()=>confirmReport(original,reviews),/different versions/);
});
test('report validation rejects invented sources, receipt records from photos, inspiration crops and unsupported purchase cards',()=>{
  const a=analysis();assert.throws(()=>validateAnalysis({...a,observations:[{...observation,source_ids:[other]}]},[source]),/Unsupported/);
  assert.throws(()=>validateAnalysis({...a,purchases:[{source_ids:[source.id],order_key:'a',item_key:'b',retailer:'Shop',brand:'Label',category:'knitwear',event:'purchase',for_self:true,amount:null,currency:null,discounted:null,date:null}]},[source]),/receipt/);
  assert.throws(()=>validateAnalysis({...a,crops:[{label:'Shirt',source_id:source.id,box:[0,0,1,1]}]},[{...source,kind:'inspiration'}]),/crop/);
  assert.throws(()=>validateCards({cards:[{...rawCard,type:'returns'}]},a,[source]),/unsupported/);
  assert.equal(eligibleCards(a,[source]).includes('stores'),false);
});
test('real image bytes normalize with stripped metadata and PDF receipts stay private file inputs',async()=>{
  const {default:sharp}=await import('sharp');const image=await sharp({create:{width:16,height:16,channels:3,background:'navy'}}).png().toBuffer();
  const normalized=await prepareSource({kind:'outfit',data:image.toString('base64')});assert.equal(normalized.mime_type,'image/jpeg');
  assert.equal((await sharp(Buffer.from(normalized.data,'base64')).metadata()).exif,undefined);
  const heic=await readFile(new URL('./fixtures/white-8x8.heic',import.meta.url));
  const converted=await prepareSource({kind:'outfit',data:heic.toString('base64')});assert.equal(converted.mime_type,'image/jpeg');
  const pdf=Buffer.from('%PDF-1.7\nfixture').toString('base64');assert.equal((await prepareSource({kind:'receipt',data:pdf})).mime_type,'application/pdf');
  await assert.rejects(prepareSource({kind:'outfit',data:pdf}),/PDFs/);
  await assert.rejects(prepareSource({kind:'outfit',data:Buffer.from('not an image').toString('base64')}),/readable/);
});
test('OpenAI extraction and writing are separate, use private inline inputs and the actual voice guide',async()=>{
  let calls=0;
  const result=await analyzeStyle([source,{...receipt,mime_type:'application/pdf',data:'JVBERi0='}],'I like navy.',env,async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);calls++;
    if(calls===1){assert.equal(body.input[0].content.some(c=>c.type==='input_file'),true);assert.match(body.instructions,/untrusted data/);}
    else{assert.match(body.instructions,/Speak like a knowledgeable personal shopper/);assert.equal(body.input[0].content.length,1);}
    return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(calls===1?analysis():{cards:[rawCard]})}]}]})};
  });assert.equal(calls,2);assert.equal(result.status,'draft');assert.equal(result.cards[0].preferences[0].accepted,false);
});
test('crop URLs are tied to the exact report version and owner',async()=>{
  const store=db();await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:report()});
  let calls=0;const h=handler(store,{crop:async s=>{assert.equal(s.id,source.id);calls++;return Buffer.from('crop');}});
  let r=res();await h(req(null,'GET','/api/style?crop=0&report=stale'),r);assert.equal(r.statusCode,409);assert.equal(calls,0);
  r=res();await h(req(null,'GET','/api/style?crop=0&report='+other),r);assert.equal(r.statusCode,200);assert.equal(calls,1);
});
test('private store queries always include authenticated owner, never a caller-supplied owner',async()=>{
  const paths=[];const store=createStore({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},async url=>{paths.push(url);return {ok:true,text:async()=>JSON.stringify([])};});
  await store.styleSession(owner);await store.styleSources(owner);await store.styleSource(owner,other);
  assert.equal(paths.length,3);for(const path of paths)assert.match(path,new RegExp('conversation_id=eq.'+owner));
});
test('sharing events require a current accepted visible card and do not change its revision',async()=>{
  const store=db(),rpt=report();rpt.status='confirmed';rpt.cards[0].accepted=true;
  await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:rpt});
  const h=handler(store);let r=res();await h(req({revision:1,action:'event',name:'download_requested',card:rpt.cards[0].id}),r);
  assert.equal(r.statusCode,200);assert.equal((await store.styleSession(owner)).revision,1);
  r=res();await h(req({revision:1,action:'event',name:'share_requested',card:other}),r);assert.equal(r.statusCode,404);
});
test('long share-card words wrap without overflowing and corrected copy is consistent across tones',()=>{
  const ctx={measureText:text=>({width:text.length*10})};assert.deepEqual(wrapText(ctx,'one extraordinarilylongword',60),['one','extrao','rdinar','ilylon','gword']);
  assert.equal(cardText({...rawCard,correction:'My correction'},'nice'),'My correction');
});
test('style text invitation bypasses model calls and reuses durable reply delivery',async()=>{
  let body;const store={receive:async()=>owner,reserve:async(_id,_op,text)=>{body=text;return {claimed:true};},finish:async()=>{}};
  const delivery={space:{phone:'test-line'},message:{id:'test-message',sender:{id:'test-sender'},content:{text:'get to know my style'}}};
  const status=await receiveInInbox(delivery,env,{store,send:async()=>{},generate:()=>assert.fail()});
  assert.equal(status,'imessage_style_invitation_sent');assert.match(body,/https:\/\/shopper.invalid\/style/);
});
