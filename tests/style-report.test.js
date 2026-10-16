import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptLines,validTotal,writeTotal,buildReport,updateReport,reportView,handleReport,FALLBACK_TOTAL,gatekeeper,nicheBrand,validGateLine,writeGateLine,reportWriter,REPORT_MODEL} from '../lib/style-report.js';
import {tagFingerprint} from '../lib/item-tags.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {signInLinks} from '../lib/onboarding.js';

const owner='00000000-0000-4000-8000-000000000001';
let seq=0;
// One purchase. Defaults: a recipient-confirmed personal purchase, so it counts for the person.
const buy=(values,{at=Date.UTC(2024,2,1),returned=false}={})=>{const n=++seq,rows=[purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at,evidence:'line',category:'clothing',
 values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:null,color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+n,recipient:{value:'self',quote:'Ship to Jack'}})];
 if(returned)rows.push(purchaseEvidence({event_id:`r${n}:0`,kind:'returned',source_id:`r${n}`,at:at+86400000,evidence:'returned',values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:null,color:null,size_label:'M',size_system:null,quantity:null,units_per_pack:null,product:values.product},item_id:'item-'+n}));
 return rows;};
const tagsFor=(state,fn)=>Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),...fn(i)}]));
function history(){
 seq=0;
 const rows=[
  ...Array.from({length:6},(_,k)=>buy({product:'Muscle Crop Top '+k,merchant:'John Elliott',order_reference:'JE'+k},{at:Date.UTC(2025,k,1)})).flat(),
  ...Array.from({length:4},(_,k)=>buy({product:'Overshirt '+k,merchant:'SSENSE',brand:'Our Legacy',order_reference:'SS'+k},{at:Date.UTC(2023,k,1),returned:k===0})).flat(),
  ...buy({product:'Gift Scarf',merchant:'SSENSE',order_reference:'SS9'}),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,i=>/Crop/.test(i.product)?{item_type:'muscle half crop top',group:'tops',color_family:'black',resale:false}:{item_type:'overshirt',group:'shirts',color_family:/0|1/.test(i.product)?'black':'navy',resale:false});
 return {rows,state,tags};
}

test('counts leave out returns, and one product ordered in several sizes counts once',()=>{
 seq=0;
 const rows=[
  // One order, two jackets each in a range of sizes: ordering a range to keep one is two products, not five.
  ...['M','L'].flatMap(size=>buy({product:'Brilliant',merchant:'Salomon',brand:'Salomon',order_reference:'SL1',size_label:size})),
  ...['M','L','XL'].flatMap(size=>buy({product:'Venom',merchant:'Salomon',brand:'Salomon',order_reference:'SL1',size_label:size})),
  ...buy({product:'XT-6',merchant:'Salomon',brand:'Salomon',order_reference:'SL2'}),
  ...buy({product:'XT-6 Aegean',merchant:'Salomon',brand:'Salomon',order_reference:'SL3'},{returned:true}),
  ...Array.from({length:3},(_,k)=>buy({product:'Tee '+k,merchant:'COS',brand:'COS',order_reference:'C'+k})).flat(),
 ];
 const state=projectReceiptEvidence(owner,rows).state,r=receiptLines(state,{});
 const salomon=r.lines.find(l=>l.key==='brand:salomon'||l.key==='store:salomon');
 assert.equal(salomon.n,3,'Brilliant, Venom and the kept XT-6');
 assert.equal(r.lines.find(l=>l.key==='returns').n,1,'the return is still its own private line');
});

test('the receipt counts real purchases: repeated item types, stores, brands and a dominant colour',()=>{
 const {state,tags}=history(),r=receiptLines(state,tags);
 assert.equal(r.eligible,true);
 const byKey=Object.fromEntries(r.lines.map(l=>[l.key,l]));
 assert.equal(byKey['type:muscle half crop top'].label,'MUSCLE HALF CROP TOPS');assert.equal(byKey['type:muscle half crop top'].n,6);
 assert.equal(byKey['store:john elliott'].label,'JOHN ELLIOTT ORDERS');assert.equal(byKey['store:john elliott'].n,6);
 assert.equal(byKey['colour:black'].label,'BLACK ANYTHING');assert.equal(byKey['colour:black'].n,7,'the returned black overshirt is not counted');
 // A group line is dropped when an item-type line from the same group says it better.
 assert.ok(!r.lines.some(l=>l.key==='group:tops'));
 // Returns are a private line.
 assert.deepEqual(r.lines.find(l=>l.key==='returns'),{key:'returns',label:'RETURNED',n:1,private:true});
 assert.deepEqual(r.range,{from:2023,to:2025});
 assert.ok(r.lines.every(l=>!/\$|€|£/.test(l.label)));
});

test('too little data makes no receipt instead of padding it',()=>{
 seq=0;const state=projectReceiptEvidence(owner,[...buy({product:'Tee'}),...buy({product:'Jeans'})]).state;
 assert.equal(receiptLines(state,{}).eligible,false);
});

test('the joke line is checked: no numbers or names the receipt does not show, no money or loyalty claims',()=>{
 const receipt={lines:[{key:'a',label:'JOHN ELLIOTT ORDERS',n:6},{key:'b',label:'BLACK ANYTHING',n:22}],all_names:['John Elliott','Our Legacy','SSENSE']};
 assert.equal(validTotal('one colour and a john elliott problem',receipt),'ONE COLOUR AND A JOHN ELLIOTT PROBLEM');
 assert.equal(validTotal('TOTAL: 22 SHADES OF BLACK.',receipt),'22 SHADES OF BLACK');
 assert.equal(validTotal('23 shades of black',receipt),null);
 assert.equal(validTotal('our legacy forever',receipt),null);
 assert.equal(validTotal('your favourite store',receipt),null);
 assert.equal(validTotal('$4k in black tees',receipt),null);
 assert.equal(validTotal('x'.repeat(41),receipt),null);
});

test('a rejected joke is retried once, then the receipt uses a safe line',async()=>{
 const receipt={lines:[{key:'a',label:'BLACK ANYTHING',n:22}],all_names:[],range:null,items:30};
 let calls=0;
 assert.deepEqual(await writeTotal(receipt,async()=>{calls++;return {total:calls===1?'99 black tees':'still no beige'};}),{total:'STILL NO BEIGE',written:true});
 assert.equal(calls,2);
 assert.deepEqual(await writeTotal(receipt,async()=>({total:'your favourite colour'})),{total:FALLBACK_TOTAL,written:false});
 assert.deepEqual(await writeTotal(receipt,async()=>{throw Error('down');}),{total:FALLBACK_TOTAL,written:false});
});

function fixture(){
 const {rows,tags}=history();
 let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',data:{job:{status:'ready'},sources:[],questions:[],item_tags:tags}},busy=false;
 return {get row(){return row;},set busy(v){busy=v;},
  gmailImport:async()=>structuredClone(row),evidence:async()=>structuredClone(rows),signupFirstName:async()=>'Jack',
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,data,token)=>{if(revision!==row.revision)return false;busy=false;row={...row,data:structuredClone(data),token_ciphertext:token};return true;}};
}
const writer=async()=>({total:'one colour and a crop top habit'});

test('building saves the receipt on the history row, and a rebuild keeps feedback and hidden lines',async()=>{
 const store=fixture(),built=await buildReport(store,owner,{},{interpret:writer});
 assert.equal(built.status,'built');
 const saved=store.row.data.style_report;
 assert.equal(saved.cards[0].type,'receipt');assert.equal(saved.cards[0].total,'ONE COLOUR AND A CROP TOP HABIT');assert.equal(saved.show_returns,false);
 await updateReport(store,owner,{action:'report-feedback',card:'receipt',vote:'down',reason:'not_funny'});
 await updateReport(store,owner,{action:'report-lines',card:'receipt',hidden:['colour:black'],show_returns:false});
 const again=await buildReport(store,owner,{},{interpret:writer});
 assert.notEqual(again.report.id,saved.id);
 assert.deepEqual(store.row.data.style_report.hidden,{receipt:['colour:black']});
 assert.equal(store.row.data.style_report.feedback.length,1);
 store.busy=true;assert.equal((await buildReport(store,owner,{},{interpret:writer})).status,'busy');
});

test('feedback and line edits are validated and change nothing when invalid',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:writer});
 const before=structuredClone(store.row.data.style_report);
 for(const input of [{action:'report-feedback',card:'receipt',vote:'meh'},{action:'report-feedback',card:'receipt',vote:'up',reason:'wrong'},{action:'report-feedback',card:'starter',vote:'up'},
  {action:'report-lines',card:'receipt',hidden:['returns'],show_returns:false},{action:'report-lines',card:'receipt',hidden:['nope'],show_returns:false},{action:'report-lines',card:'receipt',hidden:[]},{action:'delete',card:'receipt'}])
  await assert.rejects(updateReport(store,owner,input),e=>e.status===400,JSON.stringify(input));
 assert.deepEqual(store.row.data.style_report,before);
 // The lease is released after each refusal.
 assert.ok(await store.claimGmailImport(owner));
});

test('the page view hides hidden lines and shows returns only when turned on',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:writer});
 let view=reportView(store.row.data.style_report,'Jack');
 assert.equal(view.name,'Jack');assert.equal(view.cards[0].lines.find(l=>l.key==='returns').hidden,true);
 await updateReport(store,owner,{action:'report-lines',card:'receipt',hidden:['colour:black'],show_returns:true});
 view=reportView(store.row.data.style_report);
 assert.equal(view.cards[0].lines.find(l=>l.key==='returns').hidden,false);assert.equal(view.cards[0].lines.find(l=>l.key==='colour:black').hidden,true);
 await updateReport(store,owner,{action:'report-feedback',card:'receipt',vote:'up'});
 assert.deepEqual(reportView(store.row.data.style_report).votes,{receipt:'up',gatekeeper:null});
});

const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
test('the report page API needs the person signed in and only shows their own report',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:writer});
 let res=response();
 await handleReport({method:'GET',headers:{}},res,{store,env:{},auth:async()=>({status:401}),fetcher:fetch});
 assert.equal(res.statusCode,401);assert.equal(res.body.report,undefined);
 res=response();
 await handleReport({method:'GET',headers:{authorization:'Bearer t'}},res,{store,env:{},auth:async()=>({status:200,conversation:owner}),fetcher:fetch});
 assert.equal(res.statusCode,200);assert.equal(res.body.report.name,'Jack');assert.equal(res.body.report.cards[0].type,'receipt');
 res=response();
 const post={method:'POST',headers:{authorization:'Bearer t','content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({action:'report-feedback',card:'receipt',vote:'sideways'}));}};
 await handleReport(post,res,{store,env:{},auth:async()=>({status:200,conversation:owner}),fetcher:fetch});
 assert.equal(res.statusCode,400);
});

test('report links in texts are signed like onboarding links',async()=>{
 const env={SITE_ORIGIN:'https://jules.example'},store={createSignInLink:async()=>'tok'};
 assert.equal(await signInLinks('ready: https://jules.example/report',{store,conversationId:owner,env}),'ready: https://jules.example/report#signin=tok');
 assert.equal(await signInLinks('go to https://jules.example/onboarding now',{store,conversationId:owner,env}),'go to https://jules.example/onboarding#signin=tok now');
 assert.equal(await signInLinks('https://jules.example/reports',{store,conversationId:owner,env}),'https://jules.example/reports');
});

test('opening Your style builds the report on the first visit, but not while an import is still reading',async()=>{
 const auth=async()=>({status:200,conversation:owner}),get={method:'GET',headers:{authorization:'Bearer t'}};
 let store=fixture(),res=response(),built=0;
 const build=(s,o,e)=>{built++;return buildReport(s,o,e,{interpret:writer});};
 await handleReport(get,res,{store,env:{OPENAI_API_KEY:'k'},auth,fetcher:fetch,build});
 assert.equal(built,1);assert.equal(res.body.report.cards[0].type,'receipt');assert.ok(store.row.data.style_report);
 // Later visits read the saved report.
 res=response();await handleReport(get,res,{store,env:{OPENAI_API_KEY:'k'},auth,fetcher:fetch,build});assert.equal(built,1);
 store=fixture();Object.assign(store.row.data.job,{status:'extracting',ids:['a','b','c','d'],processed:['a']});res=response();
 await handleReport(get,res,{store,env:{OPENAI_API_KEY:'k'},auth,fetcher:fetch,build});
 assert.equal(res.body.report,null);assert.equal(res.body.status,'reading');assert.equal(built,1);
 assert.deepEqual(res.body.progress,{read:1,total:4},'the page can show how far the import has got');
});

test('the owner can open any tester’s report read-only from admin',async()=>{
 const {createAdminHandler}=await import('../api/admin.js');
 const store=fixture();store.conversation=async id=>id===owner?{id}:null;await buildReport(store,owner,{},{interpret:writer});
 const before=structuredClone(store.row.data);
 const res=response();
 await createAdminHandler({auth:async()=>200,storeFactory:()=>store})({method:'GET',url:`/api/admin?view=report&conversation=${owner}`,headers:{}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.report.name,'Jack');assert.equal(res.body.report.cards[0].type,'receipt');
 assert.deepEqual(store.row.data,before);
 const denied=response();
 await createAdminHandler({auth:async()=>401,storeFactory:()=>store})({method:'GET',url:`/api/admin?view=report&conversation=${owner}`,headers:{}},denied);
 assert.equal(denied.statusCode,401);assert.equal(denied.body.report,undefined);
});

test('Gatekeeper scores brands from the approved list, weighting repeat orders, and needs three brands covering half the orders',()=>{
 seq=0;
 const rows=[
  ...Array.from({length:4},(_,k)=>buy({product:'Tee '+k,merchant:'Uniqlo',brand:'Uniqlo',order_reference:'U'+k})).flat(),
  ...buy({product:'Coat',merchant:'SSENSE',brand:'Our Legacy',order_reference:'S1'}),
  // The item's brand wins over the multi-brand store it came from.
  ...buy({product:'Trousers',merchant:'SSENSE',brand:'Auralee',order_reference:'S2'}),
  // No brand on the receipt: the store's own row is used.
  ...buy({product:'Scarf',merchant:'SSENSE',order_reference:'S3'}),
  // Not on the list: left out, never guessed.
  ...buy({product:'Mystery',merchant:'Tiny Label Nobody Knows',brand:'Tiny Label Nobody Knows',order_reference:'T1'}),
  // Returned: not counted.
  ...buy({product:'Jacket',merchant:'Lemaire',brand:'Lemaire',order_reference:'L1'},{returned:true}),
 ];
 const g=gatekeeper(projectReceiptEvidence(owner,rows).state);
 assert.equal(g.eligible,true);
 assert.deepEqual(g.brands.map(b=>b.name),['Auralee','Our Legacy','SSENSE','Uniqlo']);
 // Uniqlo (5) has four orders, so it weighs twice as much as each one-order brand: (78+64+40+5*2)/5.
 assert.equal(g.score,Math.round((78+64+40+5*2)/5));
 assert.equal(g.verdict,'Early-ish adopter');
 // Two brands are not enough.
 seq=0;
 const thin=[...buy({product:'Tee',merchant:'Uniqlo',brand:'Uniqlo',order_reference:'U1'}),...buy({product:'Coat',merchant:'SSENSE',brand:'Our Legacy',order_reference:'S1'})];
 assert.equal(gatekeeper(projectReceiptEvidence(owner,thin).state).eligible,false);
 // Three brands, but most orders are from labels not on the list: not enough to say anything.
 seq=0;
 const unknown=[...thin,...buy({product:'Trousers',merchant:'Auralee',brand:'Auralee',order_reference:'A1'}),
  ...Array.from({length:5},(_,k)=>buy({product:'Thing '+k,merchant:'Unknown Shop',brand:'Unknown Shop',order_reference:'X'+k})).flat()];
 assert.equal(gatekeeper(projectReceiptEvidence(owner,unknown).state).eligible,false);
});

test('Gatekeeper matches the ways receipts write a label without over-matching',()=>{
 for(const [written,name] of [['lululemon athletica','Lululemon'],['ON RUNNING','On'],['Suit Supply B.V.','Suitsupply'],['MM6 MAISON MARGIELA','Maison Margiela'],['OUR LEGACY Slack','Our Legacy'],['thombrowne.com','Thom Browne'],['LOFT','Ann Taylor']])
  assert.equal(nicheBrand(written)?.name,name,written);
 for(const written of ['Gapper','Coachella merch','Tiny Label Nobody Knows'])assert.equal(nicheBrand(written),null,written);
});

test('the Gatekeeper line names only the person’s own brands and falls back when the writer misses',async()=>{
 const gate={score:62,verdict:'Cult member',brands:[{name:'Auralee'},{name:'Our Legacy'},{name:'COS'}]};
 assert.equal(validGateLine('You knew Auralee before your barista did.',gate),'you knew Auralee before your barista did');
 for(const bad of ['you knew Lemaire before your barista did','you and your 12 coats','your favourite label is Auralee','x'.repeat(81)])assert.equal(validGateLine(bad,gate),null,bad);
 const fallback=await writeGateLine(gate,async()=>({line:'you shop at Zara too'}));
 assert.equal(fallback.written,false);assert.ok(fallback.line.length>0);
});

test('the report adds a Gatekeeper card after the receipt, and its lines cannot be edited',async()=>{
 const store=fixture();
 const built=await buildReport(store,owner,{},{interpret:async request=>request.schema.properties.line?{line:'you got to Our Legacy early'}:{total:'one colour and a crop top habit'}});
 const card=built.report.cards[1];
 assert.equal(card.type,'gatekeeper');assert.equal(card.line,'you got to Our Legacy early');assert.ok(card.score>=0&&card.score<=100);
 assert.equal(reportView(built.report).cards[1].type,'gatekeeper');
 await assert.rejects(updateReport(store,owner,{action:'report-lines',card:'gatekeeper',hidden:[],show_returns:false}),/no lines/);
 await updateReport(store,owner,{action:'report-feedback',card:'gatekeeper',vote:'up'});
 assert.equal(reportView(store.row.data.style_report).votes.gatekeeper,'up');
});

test('the report copy has its own model setting, separate from receipt reading and chat',async()=>{
 const sent=[];
 const fetcher=async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"total":"x"}'}]}]})};};
 await reportWriter({OPENAI_API_KEY:'k',OPENAI_MODEL:'gpt-4.1-mini'},fetcher)({schema:{},instructions:'i',context:{}});
 assert.equal(sent[0].model,REPORT_MODEL);assert.equal(REPORT_MODEL,'gpt-5.5');
 assert.deepEqual(sent[0].reasoning,{effort:'low'});assert.equal(sent[0].temperature,undefined);
 await reportWriter({OPENAI_API_KEY:'k',OPENAI_MODEL:'gpt-4.1-mini',STYLE_REPORT_MODEL:'gpt-5.4-mini'},fetcher)({schema:{},instructions:'i',context:{}});
 assert.equal(sent[1].model,'gpt-5.4-mini');
});
