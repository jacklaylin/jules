import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {createStyleHandler} from '../api/style.js';
import {prepareSource,validateAnalysis,validateCards,receiptStats,eligibleCards,confirmReport,reportFacts,analyzeStyle,captionStylePhotos,ensureCoreCards} from '../lib/style.js';
import {cardVisuals} from '../public/style-visuals.js';
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
  assert.throws(()=>confirmReport(original,reviews),/navy_knitwear.*different text/);
});
test('report validation rejects invented sources, receipt records from photos, inspiration crops and unsupported purchase cards',()=>{
  const a=analysis();assert.throws(()=>validateAnalysis({...a,observations:[{...observation,source_ids:[other]}]},[source]),error=>error.code==='observation_sources');
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
    else{assert.match(body.instructions,/Speak like a knowledgeable personal shopper/);assert.equal(body.input[0].content.length,1);
      const fields=body.text.format.schema.properties.cards.items.properties;
      assert.equal(fields.title.maxLength,70);assert.equal(fields.variants.properties.roast.maxLength,240);
      assert.deepEqual(fields.observation_ids.items.enum,JSON.parse(body.input[0].content[0].text).observations.map(o=>o.id));assert.equal(fields.title.enum,undefined);
    }
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

test('distinctive starter ingredients require evidence; invented references and colors are rejected',()=>{
 const a=analysis(),ingredient={kind:'interest',label:'Cycling',color:null,icon:'bike',observation_ids:['o1']};
 assert.equal(validateAnalysis({...a,ingredients:[ingredient]},[source]).ingredients[0].icon,'bike');
 assert.throws(()=>validateAnalysis({...a,ingredients:[{...ingredient,observation_ids:['invented']}]},[source]),/ingredient/);
 assert.throws(()=>validateAnalysis({...a,ingredients:[{...ingredient,color:'url(evil)'}]},[source]),/ingredient/);
 assert.throws(()=>validateAnalysis({...a,crops:[{...a.crops[0],observation_ids:['invented']}]},[source]),/crop evidence/);
});
test('starter and explicit brand cards survive model omission without confirming new preferences',()=>{
 const rpt=report();rpt.cards=[{...rpt.cards[0],type:'style'}];
 rpt.analysis.observations.push({id:'brand',text:'User likes Label.',source_ids:['context'],confidence:'high',preference:{field:'brand',key:'Label',value:'Likes Label'}});
 const enriched=ensureCoreCards(rpt);assert.ok(enriched.cards.some(c=>c.type==='starter'));assert.ok(enriched.cards.some(c=>c.type==='brands'));
 assert.deepEqual(enriched.cards.find(c=>c.type==='starter').preferences,[]);assert.equal(enriched.cards.find(c=>c.type==='brands').preferences[0].accepted,false);assert.equal(enriched.cards.at(-1).accepted,false);
 assert.deepEqual(ensureCoreCards(enriched),enriched);assert.deepEqual(ensureCoreCards(rpt),enriched);
 rpt.status='confirmed';rpt.cards[0].accepted=true;
 const existing=ensureCoreCards(rpt);assert.ok(existing.cards.some(c=>c.type==='starter'));assert.ok(!existing.cards.some(c=>c.type==='brands'));
 assert.deepEqual(reportFacts(existing),reportFacts(rpt));
});
test('saved shopping preferences are supplemental context after independent file extraction',async()=>{
 const a=analysis(),brand={id:'b',text:'User likes Label.',source_ids:['saved-profile'],confidence:'high',preference:{field:'brand',key:'Label',value:'Likes Label'}};
 assert.throws(()=>validateAnalysis({...a,observations:[brand]},[source]),error=>error.code==='observation_sources');
 const facts=[{field:'brand',key:'Label',value:'Likes Label'}];
 assert.equal(validateAnalysis({...a,observations:[brand]},[source],'',facts).observations[0].id,'b');
 let call=0;await analyzeStyle([source],'',env,async(_url,options)=>{const body=JSON.parse(options.body);call++;if(call===1){const input=JSON.parse(body.input[0].content[0].text);assert.equal(input.saved_preferences,undefined);assert.equal(input.sources[0].note,undefined);}else{const input=JSON.parse(body.input[0].content[0].text);assert.ok(input.observations.some(o=>o.source_ids.includes('saved-profile')&&o.basis==='context'));}return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(call===1?a:{cards:[rawCard]})}]}]})};},facts);
});
test('analysis reads only this owner’s live shopping memory and excludes old report feedback',async()=>{
 const store=db();store.profile=async id=>{assert.equal(id,owner);return {facts:[{field:'brand',key:'Label',value:'Likes Label',source:'chat'},{field:'brand',key:'old',value:'Old',deleted:true},{field:'style',key:'old-read',value:'Old report',source:'style_report'},{field:'address',key:'home',value:'Not sent'}]};};
 let received;const h=handler(store,{env:{...env,MEMORY_ENABLED:'true'},analyze:async(_sources,_notes,_env,_fetcher,facts)=>{received=facts;return report();}});
 const r=res();await h(req({revision:0,action:'analyze',consent:true}),r);assert.equal(r.statusCode,200);assert.deepEqual(received,[{field:'brand',key:'Label',value:'Likes Label'}]);
});

test('generated cards cannot include explicit body commentary',()=>{assert.throws(()=>validateCards({cards:[{...rawCard,title:'Muscular precision',variants:{nice:'Your gym gains define the look.',balanced:'Your body type defines the look.',roast:'Your physique defines the look.'}}]},analysis(),[source]),/appearance comments/);});

test('color evidence prioritizes matching garment labels rather than upload order',()=>{
 const rpt=report();rpt.analysis.crops=[{label:'Track top',source_id:source.id,verified:true},{label:'Pants',source_id:source.id,verified:true},{label:'Brown jacket',source_id:source.id,verified:true},{label:'Brown pants',source_id:source.id,verified:true}];
 const visual=cardVisuals(rpt,{...rawCard,type:'colors',title:'Earth tones',variants:{balanced:'You wear a lot of brown.'}});
 assert.deepEqual(visual.crops.slice(0,2).map(c=>c.label),['Brown jacket','Brown pants']);
});

test('specialized outfit contexts stay tentative and save scoped preferences only after confirmation',()=>{
 const a=analysis();a.outfit_contexts=[{source_id:source.id,activity:'cycling',basis:'gear',confidence:'medium',dedicated:true}];a.observations[0].wear_context='cycling';
 validateAnalysis(a,[source]);
 assert.throws(()=>validateAnalysis({...a,outfit_contexts:[{...a.outfit_contexts[0],confidence:'high'}]},[source]),/Unsupported outfit context/);
 assert.throws(()=>validateAnalysis(a,[{...source,kind:'inspiration'}]),/outfit context/);
 const cards=validateCards({cards:[rawCard]},a,[source]);assert.match(cards[0].preferences[0].value,/^For cycling:/);assert.match(cards[0].preferences[0].key,/context\/cycling/);
 const r={...report(),analysis:a,cards};assert.equal(reportFacts(r).length,0);
 const confirmed=confirmReport(r,cards.map(c=>({id:c.id,accepted:true,hidden:false,correction:'',preferences:c.preferences.map(p=>({...p,accepted:true}))})));
 assert.match(reportFacts(confirmed)[0].value,/^For cycling:/);
 assert.equal(cardVisuals(r,{...cards[0],type:'style'}).crops.length,0);
 assert.equal(cardVisuals(r,cards[0]).crops.length,1);
});

test('category batches can upload beyond twelve and all saved files reach analysis',async()=>{
 const store=db(),h=handler(store,{prepare:async input=>({...source,id:crypto.randomUUID(),kind:input.kind})});
 for(let i=0;i<15;i++){
  const response=res();await h(req({revision:i,action:'upload',kind:i<13?'outfit':'inspiration',consent:true}),response);
  assert.equal(response.statusCode,200);assert.equal(data(response).sources.length,i+2);
 }
 const sources=await store.styleSources(owner);assert.equal(sources.length,16);assert.equal(sources.filter(s=>s.kind==='outfit').length,14);
 let analyzed=0;const analyzeHandler=handler(store,{analyze:async inputs=>{analyzed=inputs.length;return report();}});
 const response=res();await analyzeHandler(req({revision:15,action:'analyze',consent:true}),response);assert.equal(response.statusCode,200);assert.equal(analyzed,16);
});
test('style source pagination retains category metadata and reads every page for analysis',async()=>{
 const paths=[];const store=createStore({SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},async url=>{
  const u=new URL(url);paths.push(u);const offset=Number(u.searchParams.get('offset'));return {ok:true,text:async()=>JSON.stringify(Array.from({length:Math.min(Number(u.searchParams.get('limit')),103-offset)},(_,i)=>({id:offset+i,kind:'outfit'})))};
 });
 const sources=await store.styleSources(owner,true);assert.equal(sources.length,103);assert.equal(paths.length,21);
 assert.equal(paths[1].searchParams.get('offset'),'5');assert.match(paths[0].searchParams.get('select'),/data$/);assert.equal(paths[0].searchParams.get('conversation_id'),'eq.'+owner);
});

test('freeform exports scale images to remaining space and keep them above the footer',async()=>{
 const {shareCollageLayout}=await import('../public/style-export.js');
 const items=[{image:{naturalWidth:400,naturalHeight:600}},{image:{naturalWidth:600,naturalHeight:400}}];
 for(const height of [600,950]){
  const layout=shareCollageLayout(items,{y:770,width:912,height});assert.ok(layout[0].height>layout[1].height);assert.ok(layout[0].width*layout[0].height>layout[1].width*layout[1].height);assert.notEqual(layout[0].y,layout[1].y);
  for(const item of layout){const c=Math.abs(Math.cos(item.angle)),s=Math.abs(Math.sin(item.angle)),half=(item.width*s+(item.height+54)*c)/2;assert.ok(item.y-half>=770);assert.ok(item.y+half<=770+height);}
 }
 assert.ok(shareCollageLayout(items,{y:770,height:950})[0].height>shareCollageLayout(items,{y:770,height:600})[0].height);
});

test('observations may cite more than twelve uploaded sources',()=>{
 const sources=Array.from({length:16},(_,i)=>({...source,id:'source-'+i})),a=analysis();a.crops=[];a.observations[0].source_ids=sources.map(s=>s.id);
 assert.equal(validateAnalysis(a,sources),a);
});

test('analysis schemas constrain evidence IDs and reject fabricated citations with safe diagnostics',async()=>{
 const {analysisSchemaFor}=await import('../lib/style.js');const schema=analysisSchemaFor([source,receipt],'notes',[{field:'brand',key:'brand',value:'likes'}]);
 assert.deepEqual(schema.$defs.source.enum,[source.id,receipt.id,'context','saved-profile']);assert.deepEqual(schema.$defs.outfit.enum,[source.id]);assert.deepEqual(schema.$defs.receipt.enum,[receipt.id]);
 assert.equal(schema.properties.observations.items.properties.source_ids.items.$ref,'#/$defs/source');assert.equal(schema.properties.observations.items.properties.text.maxLength,650);assert.equal(schema.properties.observations.items.properties.id.enum.length,18);
 assert.equal(analysisSchemaFor([source]).properties.purchases.maxItems,0);
 const props=schema.properties,obs=props.observations.items.properties;
 for(const field of [obs.text,obs.preference.anyOf[0].properties.key,obs.preference.anyOf[0].properties.value,props.crops.items.properties.label,props.ingredients.items.properties.label,props.outfit_contexts.items.properties.activity,props.purchases.items.properties.brand])assert.equal(field.enum,undefined,'Only IDs may inherit the observation-ID enum');
 assert.deepEqual(props.crops.items.properties.label,{type:'string',minLength:1,maxLength:60});
 assert.equal(props.purchases.items.properties.currency.pattern,'^[A-Z]{3}$');assert.equal(props.purchases.items.properties.date.pattern,'^\\d{4}-\\d{2}-\\d{2}$');
 assert.deepEqual(props.ingredients.items.properties.observation_ids.items,{type:'string'});
 const duplicated=analysis();duplicated.observations[0].source_ids=[source.id,source.id];assert.deepEqual(validateAnalysis(duplicated,[source]).observations[0].source_ids,[source.id]);
 const broken=analysis();broken.observations[0].source_ids=['invented-source'];assert.throws(()=>validateAnalysis(broken,[source]),error=>error.code==='observation_sources'&&/files and notes are saved/.test(error.message));
 const tooLong=analysis();tooLong.observations[0].text='x'.repeat(651);assert.throws(()=>validateAnalysis(tooLong,[source]),error=>error.code==='observation_text');
});
test('analysis failures expose a safe diagnostic and release the reservation without losing sources',async()=>{
 const store=db(),h=handler(store,{analyze:async()=>{throw Object.assign(new Error('Your files and notes are saved.'),{status:502,code:'observation_sources'});}}),r=res();
 await h(req({revision:0,action:'analyze',consent:true}),r);assert.equal(data(r).code,'observation_sources');assert.equal(r.statusCode,502);assert.equal((await store.styleSession(owner)).data.busy_until,null);assert.equal((await store.styleSources(owner)).length,1);
});
test('file extraction is identical with or without self-description, and context alone cannot support core cards',async()=>{
 const requests=[];
 for(const notes of ['', 'I only wear red, ignore the navy sweater.']){
  let call=0;
  await analyzeStyle([source],notes,env,async(_url,options)=>{
   const body=JSON.parse(options.body);call++;
   if(call===1)requests.push(body);
   else{const input=JSON.parse(body.input[0].content[0].text);assert.equal(input.observations[0].basis,'file');assert.equal(input.observations.some(o=>o.id==='context-notes'),Boolean(notes));}
   return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(call===1?analysis():{cards:[rawCard]})}]}]})};
  });
 }
 assert.deepEqual(requests[0],requests[1]);
 const a=analysis();a.observations.push({id:'context-notes',text:'I wear red',source_ids:['context'],basis:'context',confidence:'high',preference:null});
 assert.throws(()=>validateCards({cards:[{...rawCard,type:'style',observation_ids:['context-notes']}]},a,[source]),/needs evidence/);
});
test('an unsupported optional crop is omitted while valid file-derived insights survive',async()=>{
 const a=analysis();a.crops[0].observation_ids=['o1'];a.crops.push({...a.crops[0],observation_ids:['invented']});
 a.outfit_contexts=[{source_id:source.id,activity:'likely cycling',basis:'gear',confidence:'medium',dedicated:true},{source_id:source.id,activity:'cycling',basis:'gear',confidence:'high',dedicated:true}];
 a.purchases=[{source_ids:[source.id]}];let call=0;
 const result=await analyzeStyle([source],'',env,async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(++call===1?a:{cards:[rawCard]})}]}]})}));
 assert.equal(result.analysis.observations[0].text,observation.text);assert.equal(result.analysis.crops.length,1);assert.equal(result.analysis.outfit_contexts.length,1);assert.equal(result.analysis.purchases.length,0);assert.equal(result.status,'draft');
});
test('technical observation citations are removed from copy without removing ordinary parentheses',()=>{
 const a=analysis(),card={...rawCard,variants:{nice:'Navy knitwear (o1).',balanced:'Navy knitwear (especially sweaters).',roast:'Navy knitwear (o1).'}};
 const cards=validateCards({cards:[card]},a,[source]);assert.equal(cards[0].variants.nice,'Navy knitwear.');assert.equal(cards[0].variants.balanced,card.variants.balanced);
 const updated=ensureCoreCards({...report(),cards:[{...report().cards[0],variants:card.variants}]});assert.equal(updated.cards[0].variants.roast,'Navy knitwear.');
});
test('unchecked crops use the full source image and neutral captions; checked crops retain their bounds',async()=>{
 for(const verified of [false,true]){
  const store=db(),rpt=report();rpt.analysis.crops[0].verified=verified;
  await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:rpt});
  let box;const h=handler(store,{crop:async(_source,bounds)=>{box=bounds;return Buffer.from('image');}}),r=res();
  await h(req(null,'GET','/api/style?crop=0&report='+rpt.id),r);assert.equal(r.statusCode,200);assert.deepEqual(box,verified?rpt.analysis.crops[0].box:[0,0,1,1]);
  assert.equal(cardVisuals(rpt,rpt.cards[0]).crops[0].label,verified?'Navy sweater':'Photo details pending');
 }
});
test('starter packs prioritize clothing and activity details while the label card gets actual logo assets',async()=>{
 const rpt=report();rpt.analysis.crops=Array.from({length:5},(_,i)=>({...rpt.analysis.crops[0],label:'Garment '+i,verified:true}));
 rpt.analysis.ingredients=[...['Sown Again','Oakley','Adidas Originals','SSENSE','Unknown Label'].map(label=>({kind:'brand',label,icon:'none',observation_ids:['o1']})),{kind:'object',label:'Cycling',icon:'bike',observation_ids:['o1']}];
 const starter=cardVisuals(rpt,{...rawCard,type:'starter'}),brands=cardVisuals(rpt,{...rawCard,type:'brands'});
 assert.equal(starter.crops.length,4);assert.ok(starter.ingredients.some(i=>i.icon==='bike'));assert.equal(starter.ingredients.filter(i=>i.kind==='brand').length,1);
 assert.equal(brands.crops.length,0);assert.equal(brands.ingredients.length,4);
 const {brandAssetFor}=await import('../public/brand-assets.js');assert.equal(brandAssetFor('Unknown Label'),null);
 for(const i of brands.ingredients){const asset=brandAssetFor(i.label);assert.ok(asset);const bytes=await readFile(new URL('../public'+asset.src,import.meta.url));const {default:sharp}=await import('sharp');assert.ok((await sharp(bytes).metadata()).width>0);}
});
test('the writer checks actual rendered crop pixels against originals before a crop is marked verified',async()=>{
 const {default:sharp}=await import('sharp');const original=await sharp({create:{width:100,height:160,channels:3,background:'navy'}}).jpeg().toBuffer();
 const s={...source,data:original.toString('base64')},a=analysis();a.crops[0].observation_ids=['o1'];let call=0;
 const rpt=await analyzeStyle([s],'',env,async(_url,options)=>{
  const body=JSON.parse(options.body);call++;
  if(call===2){const images=body.input[0].content.filter(c=>c.type==='input_image');assert.equal(images.length,2);assert.equal(images[0].image_url,'data:image/jpeg;base64,'+s.data);assert.notEqual(images[1].image_url,images[0].image_url);assert.ok(body.text.format.schema.required.includes('crop_checks'));}
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(call===1?a:{cards:[rawCard],crop_checks:[{index:0,visible:true,full_caption:'Navy sweater with cream trousers'}]})}]}]})};
 });assert.equal(rpt.analysis.crops[0].verified,true);assert.equal(rpt.analysis.crops[0].full_caption,'Navy sweater with cream trousers');
});

test('photo captions read distinct full images without old labels or notes and preserve confirmed report content',async()=>{
 const rpt=report();rpt.status='confirmed';rpt.analysis.crops.push({...rpt.analysis.crops[0]});
 const checked=await captionStylePhotos(rpt,[source],env,async(_url,options)=>{
  const body=JSON.parse(options.body),content=body.input[0].content;
  assert.equal(content.filter(v=>v.type==='input_image').length,1);
  assert.equal(content[1].image_url,'data:image/jpeg;base64,'+source.data);
  assert.doesNotMatch(JSON.stringify(content),/Navy sweater|My staple|everyday/);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({captions:[{source_id:source.id,text:'Striped track jacket with cream trousers'}]})}]}]})};
 });
 assert.deepEqual(checked.cards,rpt.cards);assert.equal(checked.status,'confirmed');assert.equal(rpt.analysis.crops[0].full_caption,undefined);
 assert.ok(checked.analysis.crops.every(c=>c.full_caption==='Striped track jacket with cream trousers'));
 assert.equal(cardVisuals(checked,checked.cards[0]).crops[0].label,'Striped track jacket with cream trousers');
 await assert.rejects(()=>captionStylePhotos(rpt,[source],env,async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({captions:[{source_id:other,text:'Invented source'}]})}]}]})})),/Could not check/);
});
test('caption backfill preserves cards and saved preferences and becomes a no-op after checking',async()=>{
 const store=db(),rpt=report();rpt.status='confirmed';const facts=[{field:'brand',key:'label',value:'Loved brand'}];
 await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:rpt},{facts});let calls=0;
 const h=handler(store,{caption:async(r,sources)=>{calls++;assert.equal(sources.length,1);return {...r,analysis:{...r.analysis,crops:r.analysis.crops.map(c=>({...c,full_caption:'Navy knit with pale trousers'}))}};}});
 let r=res();await h(req({revision:1,action:'captions',report:rpt.id}),r);assert.equal(r.statusCode,200);assert.equal(data(r).data.report.status,'confirmed');assert.deepEqual(data(r).data.report.cards,rpt.cards);assert.deepEqual(store.facts(),facts);
 const revision=data(r).revision;r=res();await h(req({revision,action:'captions',report:rpt.id}),r);assert.equal(r.statusCode,200);assert.equal(calls,1);assert.equal(data(r).revision,revision);
});
test('deletion during caption checking prevents a stale report from being restored',async()=>{
 const store=db(),rpt=report();await store.writeStyle(owner,0,{...((await store.styleSession(owner)).data),report:rpt});
 let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 const h=handler(store,{caption:async r=>{started();await gate;return r;}}),r=res(),running=h(req({revision:1,action:'captions',report:rpt.id}),r);await ready;
 const deleted=res();await h(req({revision:2,action:'delete'}),deleted);assert.equal(deleted.statusCode,200);release();await running;assert.equal(r.statusCode,409);assert.equal((await store.styleSession(owner)).data.report,null);
});
