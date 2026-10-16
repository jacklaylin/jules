import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptLines,validTotal,writeTotal,buildReport,updateReport,reportView,handleReport,FALLBACK_TOTAL,gatekeeper,nicheBrand,validGateLine,writeGateLine,reportWriter,REPORT_MODEL,inOut,validInOutLine,writeInOutLine,validEntry,copyLines,lockedCards,MIN_CARDS,sharedView,handleSharedReport,sharePreview,handleSharePage,fourEmojis,spectrum,validEmojiCaption,writeEmojiCaptions,styleMatch,validMatchLine,writeMatchLine,sendNewCardText,sendReportLink,newCardsText} from '../lib/style-report.js';
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
  reportByShareToken:async token=>row.data.style_report?.share?.token===token?{conversation_id:owner,report:structuredClone(row.data.style_report)}:null,
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
 assert.equal(reportView(store.row.data.style_report).votes.receipt,'up');
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

test('Gatekeeper scores brands from the approved list, scored on their most niche brands, and needs three brands covering half the orders',()=>{
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
 // The most niche quarter of brands (at least three), each counted once: Uniqlo's four orders don't drag it down.
 assert.equal(g.score,Math.round((78+64+40)/3));
 assert.equal(g.verdict,'Cult member');
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

const yearOf=(year,k)=>Date.UTC(year,k%12,1+k);
// A history shaped like Jack's: a tailoring year, then a summer one, with a brand that never left
// and one that disappeared.
function inOutHistory(){
 seq=0;
 const many=(n,values,year,returned=false)=>Array.from({length:n},(_,k)=>buy({...values(k),order_reference:values(k).order_reference},{at:yearOf(year,k),returned})).flat();
 const rows=[
  ...many(5,k=>({product:'JE Tee '+k,merchant:'John Elliott',brand:'John Elliott',order_reference:'JE'+k}),2023),
  ...many(6,k=>({product:'Custom Shirt '+k,merchant:'Suitsupply',brand:'Suitsupply',order_reference:'SS'+k}),2024),
  ...many(3,k=>({product:'Lulu Short '+k,merchant:'lululemon athletica',brand:'lululemon athletica',order_reference:'L'+k}),2024),
  ...buy({product:'Sunglasses Old',merchant:'Ray-Ban',brand:'Ray-Ban',order_reference:'RB1'},{at:yearOf(2024,8)}),
  ...many(3,k=>({product:'Lulu Tank '+k,merchant:'Lululemon',brand:'Lululemon',order_reference:'L2'+k}),2026),
  ...many(2,k=>({product:'Swim Brief '+k,merchant:'Todd Snyder',brand:'Todd Snyder',order_reference:'TS'+k}),2026),
  ...many(4,k=>({product:'Sunglasses '+k,merchant:'Oakley',brand:'Oakley',order_reference:'OK'+k}),2026),
  // Returned: never counted.
  ...many(3,k=>({product:'Returned Coat '+k,merchant:'Zara',brand:'Zara',order_reference:'Z'+k}),2026,true),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,i=>/Shirt/.test(i.product)?{item_type:'custom made shirt',group:'shirts',color_family:'white',resale:false}
  :/Swim/.test(i.product)?{item_type:'swim brief',group:'swimwear',color_family:'black',resale:false}
  :/Sunglasses/.test(i.product)?{item_type:'sunglasses',group:'eyewear',color_family:'black',resale:false}
  :/Lulu/.test(i.product)?{item_type:'running short',group:'activewear',color_family:'black',resale:false}
  :/Coat/.test(i.product)?{item_type:'coat',group:'outerwear',color_family:'black',resale:false}
  :{item_type:'tee',group:'tops',color_family:'brown',resale:false});
 return {state,tags};
}
test('In / Out picks what changed most between the earliest and latest busy years, all counted from purchases',()=>{
 const {state,tags}=inOutHistory(),c=inOut(state,tags);
 assert.equal(c.eligible,true);assert.equal(c.then,2024);assert.equal(c.now,2026);
 const said=list=>Object.fromEntries(list.map(x=>[x.plain,x]));
 // IN: a first-ever category, a category whose share jumped, the brand that stayed.
 assert.equal(said(c.in)['swim briefs'].aside,'first ever');assert.equal(said(c.in)['swim briefs'].fact,'swim briefs: none before 2026, 2 in 2026');
 assert.equal(said(c.in)['sunglasses'].fact,'sunglasses: 1 in 2024, 4 in 2026');
 assert.equal(said(c.in)['Lululemon'].aside,'still','receipts’ spellings merged');
 // The colour took over: "all black" in, "colour" out, from the same counts.
 assert.equal(said(c.in)['all black'].fact,'black share of items: 40% in 2024, 100% in 2026');assert.ok(said(c.out)['colour']);
 // OUT: the breakup is the brand bought most before (Suitsupply's 6 beat John Elliott's 5), none now,
 // and the category that went with it.
 assert.deepEqual([said(c.out)['Suitsupply'].kind,said(c.out)['Suitsupply'].aside],['breakup','the breakup']);
 assert.equal(said(c.out)['custom made shirts'].fact,'custom made shirts: 6 in 2024, 0 in 2026');
 // The returned coats aren't bought items anywhere, but the return rate is a private fact.
 assert.ok(![...c.in,...c.out].some(f=>/Zara|coat/.test(f.plain+f.fact)));
 assert.deepEqual([said(c.in)['sending it back'].private,said(c.in)['sending it back'].fact],[true,'items returned: 0 of 10 in 2024, 3 of 12 in 2026']);
 // Every fact has an id the writer cites, strongest first.
 assert.deepEqual(c.in.map(f=>f.id).slice(0,3),['in1','in2','in3']);assert.equal(c.out[0].plain,'Suitsupply');
 // One busy year is not enough.
 seq=0;
 const one=Array.from({length:8},(_,k)=>buy({product:'Tee '+k,merchant:'COS',brand:'COS',order_reference:'E'+k},{at:yearOf(2026,k)})).flat();
 assert.equal(inOut(projectReceiptEvidence(owner,one).state,{}).eligible,false);
});

// A history with relationships: a breakup, the rebound after it, an ex they went back to, a once-a-year
// situationship, the same jogger three times, and late-night orders in the latest year.
function relationshipHistory(){
 seq=0;
 const at=(y,m,h=17)=>Date.UTC(y,m,3,h,30);
 const one=(brand,product,y,m,h)=>buy({product,merchant:brand,brand},{at:at(y,m,h)});
 const rows=[
  ...[0,1,2,3,4].flatMap(m=>one('Our Legacy','Shirt '+m,2023,m)),
  ...one('COS','Knit A',2023,6),...one('COS','Knit B',2023,7),
  ...one('Lululemon','ABC Jogger',2024,2),...one('Lululemon','Tank',2024,3),...one('Uniqlo','Tee 24',2024,5),...one('Arket','Coat',2024,8),
  ...one('Uniqlo','Tee 25',2025,5),...one('Lululemon','ABC Jogger',2025,6),
  // 2026, mostly ordered at 6:30 UTC, which is 1:30am in New York in winter.
  ...one('Uniqlo','Tee 26',2026,0,6),...one('COS','Knit C',2026,1,6),...one('COS','Knit D',2026,2,6),...one('Lululemon','ABC Jogger',2026,10,6),...one('Lululemon','Tank 2',2026,3),...one('Arket','Scarf',2026,4),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 return {state,tags:tagsFor(state,i=>/Jogger/.test(i.product)?{item_type:'jogger',group:'trousers',color_family:'black',resale:false}:{})};
}
test('In / Out reads brand relationships, the same item on repeat and after-midnight checkouts',()=>{
 const {state,tags}=relationshipHistory(),c=inOut(state,tags,{timezone:'America/New_York'});
 assert.equal(c.then,2023);assert.equal(c.now,2026);
 const kind=(list,k)=>list.find(f=>f.kind===k);
 assert.deepEqual([kind(c.out,'breakup').plain,kind(c.out,'breakup').fact],['Our Legacy','Our Legacy: 5 items before 2026, none in 2026']);
 assert.deepEqual([kind(c.in,'rebound').plain,kind(c.in,'rebound').aside,kind(c.in,'rebound').fact],['Lululemon','the rebound','Lululemon: first bought after the last Our Legacy order, 5 items since']);
 assert.deepEqual([kind(c.in,'ex').plain,kind(c.in,'ex').aside,kind(c.in,'ex').fact],['COS','back together','COS: 2 items in 2023, none in 2024 or 2025, 2 in 2026']);
 assert.deepEqual([kind(c.in,'situationship').plain,kind(c.in,'situationship').aside],['Uniqlo','once a year since 2024']);
 assert.deepEqual([kind(c.in,'repeat').plain,kind(c.in,'repeat').aside,kind(c.in,'repeat').fact],['the same jogger','×3','"ABC Jogger" from Lululemon, bought in 3 separate orders']);
 assert.equal(kind(c.in,'night').plain,'1am checkouts');assert.match(kind(c.in,'night').fact,/0% in 2023, 67% in 2026/);
 // Each brand tells one story: the rebound isn't also "new" or "still".
 assert.equal(c.in.filter(f=>f.plain==='Lululemon').length,1);
 // No time zone from the person's browser, no checkout hours: never guessed.
 assert.ok(!kind(inOut(state,tags).in,'night'));assert.ok(!kind(inOut(state,tags,{timezone:'Mars/Olympus'}).in,'night'));
});

test('In / Out reads haul size, buying direct vs multi-brand shops, and returns',()=>{
 seq=0;
 const rows=[
  // 2024: one thing at a time, all through SSENSE, which sells several brands.
  ...['Our Legacy','Acne Studios','Lemaire','Our Legacy','Acne Studios','Lemaire'].flatMap((brand,k)=>buy({product:'Piece '+k,merchant:'SSENSE',brand,order_reference:'S'+k},{at:Date.UTC(2024,k,1)})),
  // 2026: three-item orders straight from the brand, plus six items sent back.
  ...[0,1,2,3,4,5].flatMap(o=>[0,1,2].flatMap(k=>buy({product:`Tee ${o}-${k}`,merchant:'Arket',brand:'Arket',order_reference:'A'+o},{at:Date.UTC(2026,o,1)}))),
  ...[0,1,2,3,4,5].flatMap(k=>buy({product:'Back '+k,merchant:'Arket',brand:'Arket',order_reference:'R'+k},{at:Date.UTC(2026,k,9),returned:true})),
 ];
 const c=inOut(projectReceiptEvidence(owner,rows).state,{});
 const pairOf=k=>[c.in.find(f=>f.kind===k)?.plain,c.out.find(f=>f.kind===k)?.plain];
 assert.deepEqual(pairOf('haul'),['the haul','one thing at a time']);
 assert.equal(c.in.find(f=>f.kind==='haul').fact,'items per order: 1.0 in 2024, 3.0 in 2026');
 assert.deepEqual(pairOf('shops'),['going straight to the brand','scrolling SSENSE']);
 const returns=c.in.find(f=>f.kind==='returns');
 assert.deepEqual([returns.plain,returns.private,returns.fact],['sending it back',true,'items returned: 0 of 6 in 2024, 6 of 24 in 2026']);
});

test('the In / Out list lines cite their facts and use only those facts’ names and numbers',async()=>{
 const {state,tags}=inOutHistory(),card=inOut(state,tags);
 const names=['Suitsupply','Lululemon','John Elliott','Zara','Oakley'];
 const id=(side,plain)=>card[side].find(f=>f.plain===plain).id;
 const facts=(side,...plains)=>plains.map(p=>card[side].find(f=>f.plain===p));
 assert.deepEqual(validEntry({text:'Suitsupply',aside:'(major breakup!)'},facts('out','Suitsupply'),names),{text:'Suitsupply',aside:'major breakup!'});
 assert.deepEqual(validEntry({text:'Speedos',aside:''},facts('in','swim briefs'),names),{text:'speedos',aside:null});
 for(const bad of [{text:'Zara',aside:'the breakup'},{text:'suits',aside:'12 of them'},{text:'you in speedos',aside:''},{text:'x'.repeat(31),aside:''},{text:'speedos',aside:'y'.repeat(27)},{text:'speedos',aside:'loyal to the sea'}])
  assert.equal(validEntry(bad,facts('in','swim briefs'),names),null,JSON.stringify(bad));
 let seen=null;
 const out=await writeInOutLine(card,async({context})=>{seen=context;return {
  in:[{facts:[id('in','swim briefs'),id('in','sunglasses')],text:'speedos and shades',aside:'beach era'},
   {facts:[id('in','Lululemon')],text:'athleisure',aside:'still'},
   {facts:[id('out','Suitsupply')],text:'Suitsupply',aside:'wrong side'},
   {facts:[id('in','sending it back')],text:'returns',aside:''},
   {facts:[id('in','all black')],text:'all black',aside:'you went dark'},
   {facts:['in99'],text:'made up',aside:''}],
  out:[{facts:[id('out','Suitsupply')],text:'Suitsupply',aside:'major breakup!'},
   {facts:[id('out','custom made shirts'),id('out','Suitsupply')],text:'business casual',aside:''},
   {facts:[id('out','custom made shirts')],text:'business casual',aside:'Zara era'}],
  verdict:'Suitsupply out, speedos in, and Lululemon never left',shared:'Jack: Suitsupply out, speedos in'};},names,'Jack');
 // The writer never sees private facts.
 assert.ok(!JSON.stringify(seen).includes('returned'));assert.ok(seen.in.every(f=>f.id&&f.fact&&f.plain));
 assert.deepEqual(out.in.map(e=>[e.text,e.aside,e.source]),[['speedos and shades','beach era','generated'],['athleisure','still','generated'],['sending it back',null,'fact']]);
 assert.equal(out.in.at(-1).private,true);
 assert.deepEqual(out.out.map(e=>[e.text,e.aside]),[['Suitsupply','major breakup!']]);
 assert.equal(out.verdict,'Suitsupply out, speedos in, and Lululemon never left');
 // A writer that fails shows the strongest facts plain, with code's own asides.
 const plain=await writeInOutLine(card,async()=>{throw Error('down');},names);
 assert.equal(plain.written,false);assert.deepEqual(plain.out[0],{text:'Suitsupply',aside:'the breakup',facts:[id('out','Suitsupply')],source:'fact'});
 assert.ok(plain.in.length<=6&&plain.out.length<=4);
});

test('the In / Out closing line uses only the card’s facts, with a fallback',()=>{
 const card={then:2024,now:2026,in:[{id:'in1',plain:'swim briefs',aside:'first ever',fact:'swim briefs: none before 2026, 2 in 2026'},{id:'in2',plain:'Lululemon',aside:'still',fact:'Lululemon: 3 items in 2024, 3 in 2026',names:['Lululemon']},{id:'in3',plain:'sending it back',fact:'items returned: 0 of 10 in 2024, 3 of 12 in 2026',private:true}],
  out:[{id:'out1',plain:'Suitsupply',aside:'the breakup',fact:'Suitsupply: 6 items before 2026, none in 2026',names:['Suitsupply']}]};
 const names=['Suitsupply','Lululemon','John Elliott','Zara'];
 assert.equal(validInOutLine('Suitsupply out, swim briefs in, and Lululemon never left.',card,names),'Suitsupply out, swim briefs in, and Lululemon never left');
 // A private fact's numbers can't reach the closing line.
 for(const bad of ['you traded Zara for swim briefs','12 pairs of sunglasses later','you stayed loyal to black','y'.repeat(91),'12 items, then you sent them back'])assert.equal(validInOutLine(bad,card,names),null,bad);
});

test('the In / Out returns line stays private, every shown line is logged for votes, and the time zone is saved',async()=>{
 const facts={in:[{id:'in1',plain:'swim briefs',aside:'first ever',fact:'swim briefs: none before 2026, 2 in 2026',names:[]},{id:'in2',plain:'sending it back',fact:'items returned: 0 of 10 in 2024, 3 of 12 in 2026',private:true,names:[]}],
  out:[{id:'out1',plain:'Suitsupply',aside:'the breakup',fact:'Suitsupply: 6 items before 2026, none in 2026',names:['Suitsupply']}]};
 const card={type:'inout',then:2024,now:2026,facts,in:[{text:'speedos',aside:'first ever',facts:['in1'],source:'generated'},{text:'sending it back',aside:null,facts:['in2'],source:'fact',private:true}],
  out:[{text:'Suitsupply',aside:'major breakup!',facts:['out1'],source:'generated'}],verdict:'suits out, speedos in',shared:'suits out, speedos in for Jack',written:true};
 const report={id:'r1',built_at:'2026-10-16T00:00:00Z',cards:[card],feedback:[],hidden:{},show_returns:false,share:{token:'t'.repeat(22)}};
 const mine=reportView(report).cards[0];
 assert.deepEqual(mine.in.map(e=>e.text),['speedos']);assert.equal(mine.facts,undefined,'counted facts stay on the server');
 assert.deepEqual(reportView({...report,show_returns:true}).cards[0].in.map(e=>e.text),['speedos','sending it back']);
 assert.deepEqual(sharedView({...report,show_returns:true}).cards[0].in.map(e=>e.text),['speedos']);
 const logged=copyLines([card],{report_id:'r1',at:'2026-10-16T00:00:00Z',allNames:['Suitsupply']});
 assert.deepEqual(logged.map(l=>[l.slot,l.text]),[['in1','speedos (first ever)'],['out1','Suitsupply (major breakup!)'],['verdict','suits out, speedos in']]);
 assert.ok(!JSON.stringify(logged).includes('returned'));
 // The browser's time zone, checked before it's saved.
 const store=fixture();await buildReport(store,owner,{},{interpret:writer});
 await assert.rejects(updateReport(store,owner,{action:'report-timezone',timezone:'Mars/Olympus'}),/time zone/);
 await updateReport(store,owner,{action:'report-timezone',timezone:'America/New_York'});
 assert.equal(store.row.data.style_report.timezone,'America/New_York');assert.equal(reportView(store.row.data.style_report).timezone,'America/New_York');
 await buildReport(store,owner,{},{interpret:writer});assert.equal(store.row.data.style_report.timezone,'America/New_York','kept across rebuilds');
});

// Counts for a light history: one busy year, a few known brands, half the emoji habits.
const sparse={gate:{eligible:false,matched:1,orders:5,covered:1},then:{eligible:false,busy_years:[2025],years:{2025:7,2023:4}},
 emoji:{eligible:false,picks:2},match:{eligible:false,items:7,brands:3},closer:{eligible:false,visible:1,gaps:[{slider:'price',n:3,unit:'known'},{slider:'stores',n:2,unit:'orders'}]}};
test('a report always has at least three cards: missing built cards are shown locked, closest to unlocking first',()=>{
 const locked=lockedCards(['receipt'],sparse);
 assert.equal(1+locked.length,MIN_CARDS);
 // In / Out is 11 of 12 orders there; Style match is 7 of 10 items but 3 of 5 brands (60%).
 assert.deepEqual(locked.map(c=>[c.type,c.card]),[['locked','inout'],['locked','match']]);
 assert.ok(locked.every(c=>c.why&&c.title&&c.unlock));
 // Enough real cards: nothing locked.
 assert.deepEqual(lockedCards(['receipt','gatekeeper','inout'],sparse),[]);
 // Two real cards: the single closest card fills the gap.
 assert.deepEqual(lockedCards(['receipt','inout'],sparse).map(c=>c.card),['match']);
 // Cards that aren't built (Starter pack, Dating) are never offered.
 assert.deepEqual(new Set(lockedCards(['receipt'],{}).map(c=>c.card)).size,2);
 assert.ok(lockedCards([],sparse).every(c=>['gatekeeper','emoji','inout','match','spectrum'].includes(c.card)));
});

test('every locked card names the one action that unlocks it, from real counts and never money',()=>{
 const all=Object.fromEntries(lockedCards(['receipt'],sparse,5).map(c=>[c.card,c]));
 assert.deepEqual(Object.keys(all).sort(),['emoji','gatekeeper','inout','match','spectrum']);
 assert.equal(all.inout.unlock,'2 more orders from 2023');assert.match(all.inout.why,/7 orders from 2025/);
 assert.equal(all.match.unlock,'3 more items, from 2 brands you haven’t bought yet');assert.match(all.match.why,/7 items from 3 brands/);
 assert.equal(all.emoji.unlock,'orders that show 2 more shopping habits');assert.match(all.emoji.why,/2 of the 4/);
 // Gatekeeper: 2 known brands missing, and 5 orders need 3 covered.
 assert.equal(all.gatekeeper.unlock,'3 more orders from brands Jules knows, 2 of them from brands new to you');
 // Spectrum: two scales short, so the nearest slider (stores, 2 orders) is the next step.
 assert.equal(all.spectrum.unlock,'2 more orders for the next scale');assert.match(all.spectrum.why,/1 of the 3/);
 for(const c of Object.values(all))assert.ok(!/\$|€|£|spend|spent|price/i.test(c.why+c.unlock),c.card);
 // One scale short, and the niche scale (Gatekeeper's 2 orders) is nearer than stores (4 orders).
 const one=lockedCards(['receipt','gatekeeper','emoji','inout','match'],{gate:{eligible:false,matched:3,orders:8,covered:3},closer:{visible:2,gaps:[{slider:'stores',n:4,unit:'orders'}]}},1)[0];
 assert.equal(one.card,'spectrum');assert.equal(one.unlock,'2 more orders from brands Jules knows');
 assert.equal(lockedCards(['receipt','inout','match','emoji'],{gate:{eligible:true},closer:{visible:2,gaps:[{slider:'stores',n:4,unit:'orders'},{slider:'price',n:1,unit:'known'}]}},1)[0].unlock,'1 more item from brands Jules knows');
 // In / Out with two busy years but nothing changed can't say what unlocks it, so it isn't offered.
 assert.ok(!lockedCards(['receipt'],{...sparse,then:{eligible:false,busy_years:[2024,2025],years:{2024:6,2025:9}}}).some(c=>c.card==='inout'));
 // No busy year yet: both years' gaps.
 assert.equal(lockedCards(['receipt','match'],{then:{eligible:false,busy_years:[],years:{2025:4,2024:1}}})[0].unlock,'2 more orders from 2025 and 5 more orders from 2024');
});

test('the counts behind locked cards come from the same rules that build the cards',()=>{
 const {state,tags}=history();
 const then=inOut(state,tags);assert.equal(then.eligible,false);assert.deepEqual(then.years,{2023:3,2024:1,2025:6},'the returned overshirt’s order is left out');
 const match=styleMatch(state,tags);assert.equal(match.eligible,false);assert.equal(match.items,10);assert.equal(match.brands,3);
 // Three orders from a store Jules doesn't know: every scale says what it still needs.
 seq=0;const small=projectReceiptEvidence(owner,[0,1,2].flatMap(k=>buy({product:'Tee '+k,order_reference:'T'+k}))).state;
 assert.deepEqual(spectrum(small,{}).gaps,[{slider:'price',n:8,unit:'known'},{slider:'era',n:8,unit:'known'},{slider:'variety',n:7,unit:'items'},{slider:'stores',n:5,unit:'orders'}]);
 assert.deepEqual([fourEmojis(small,{}).eligible,fourEmojis(small,{}).picks],[false,0]);
});

test('a rebuild that turns a card real reports it once, ever',async()=>{
 const store=fixture(),first=await buildReport(store,owner,{},{interpret:writer});
 assert.deepEqual(first.unlocked,[],'a first report has nothing new');
 const realType=first.report.cards.find(c=>c.type!=='locked'&&c.type!=='receipt')?.type;
 assert.ok(realType);
 // A report from before the seen list, whose last build didn't have this card (locked or just missing).
 const drop=()=>{const r=store.row.data.style_report;delete r.seen;r.cards=r.cards.filter(c=>c.type!==realType);};
 drop();
 const second=await buildReport(store,owner,{},{interpret:writer});
 assert.deepEqual(second.unlocked,[realType]);assert.ok(store.row.data.style_report.seen.includes(realType));
 assert.deepEqual((await buildReport(store,owner,{},{interpret:writer})).unlocked,[],'the next rebuild is quiet');
 // A return drops it out and a later order brings it back: not news twice.
 store.row.data.style_report.cards=store.row.data.style_report.cards.filter(c=>c.type!==realType);
 assert.deepEqual((await buildReport(store,owner,{},{interpret:writer})).unlocked,[],'dropping out and coming back is not news twice');
});

test('the new-card text is one signed /report link, sent once per unlock',async()=>{
 const ledger=new Map(),sent=[];
 const store={...fixture(),conversation:async id=>({id,line:'+15550000000',sender_id:'+15551111111'}),createSignInLink:async()=>'tok',
  reserve:async(conversation,operation,body)=>ledger.has(operation)?false:(ledger.set(operation,{conversation_id:conversation,status:'reserved',body}),true),
  operation:async operation=>ledger.get(operation)??null,finish:async(operation,status)=>{ledger.get(operation).status=status;}};
 const env={SITE_ORIGIN:'https://jules.example/'};
 await buildReport(store,owner,{},{interpret:writer});
 const send=async(target,body)=>{sent.push(body);return {id:'m1'};};
 assert.equal(await sendNewCardText(store,owner,env,['gatekeeper'],send),null,'not texted their report link yet');
 // The founder sends the report link; the next build knows it.
 await sendReportLink(store,owner,env,send);sent.length=0;
 await buildReport(store,owner,{},{interpret:writer});
 assert.equal((await store.gmailImport(owner)).data.style_report.linked,true);
 assert.equal(await sendNewCardText(store,owner,env,[],send),null,'nothing unlocked, nothing sent');
 assert.equal((await sendNewCardText(store,owner,env,['gatekeeper'],send)).status,'sent');
 assert.equal((await sendNewCardText(store,owner,env,['gatekeeper'],send)).duplicate,true);
 assert.deepEqual(sent,['your style report has a new card: gatekeeper score. https://jules.example/report#signin=tok']);
 assert.match(newCardsText(['match','spectrum','inout'],'L'),/3 new cards: style match, spectrum and in \/ out\. L$/);
 assert.equal(await sendNewCardText(store,owner,{},['gatekeeper'],send),null,'no site origin, no text');
});

test('the built report puts real cards first and locked cards after, and locked cards take no line edits',async()=>{
 const store=fixture();
 const built=await buildReport(store,owner,{},{interpret:async request=>request.schema.properties.line?{line:'you got to Our Legacy early'}:request.schema.properties.verdict?{verdict:'new year, same black'}:{total:'one colour and a crop top habit'}});
 const types=built.report.cards.map(c=>c.type);
 assert.ok(types.length>=MIN_CARDS);assert.equal(types[0],'receipt');
 assert.ok(types.indexOf('locked')===-1||types.slice(types.indexOf('locked')).every(t=>t==='locked'));
 const locked=built.report.cards.find(c=>c.type==='locked');
 if(locked)await assert.rejects(updateReport(store,owner,{action:'report-lines',card:'locked',hidden:[],show_returns:false}),/no lines/);
});

// The writer answers each card's schema: in-app copy talks to the person, shared copy about them.
const sharingWriter=async request=>request.schema.properties.line?{line:'you got to Our Legacy early',shared:'Jack got to Our Legacy early'}
 :request.schema.properties.verdict?{verdict:'new year, same black',shared:'Jack kept it black'}:{total:'one colour and a crop top habit'};

test('sharing makes an unguessable link the person can turn off, and a rebuild keeps it',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:sharingWriter});
 const shared=await updateReport(store,owner,{action:'report-share'});
 assert.match(shared.share.token,/^[A-Za-z0-9_-]{22}$/);
 // Sharing again keeps the same link.
 assert.equal((await updateReport(store,owner,{action:'report-share'})).share.token,shared.share.token);
 assert.equal(reportView(store.row.data.style_report).share.token,shared.share.token);
 await buildReport(store,owner,{},{interpret:sharingWriter});
 assert.equal(store.row.data.style_report.share.token,shared.share.token,'a rebuild keeps the link working');
 await updateReport(store,owner,{action:'report-unshare'});
 assert.equal(store.row.data.style_report.share,undefined);
});

test('a friend opening the link needs no sign-in and sees only what the person chose to share',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:sharingWriter});
 // Hide a line, show returns in the app, and mark one card as not for sharing.
 await updateReport(store,owner,{action:'report-lines',card:'receipt',hidden:['colour:black'],show_returns:true});
 const {share}=await updateReport(store,owner,{action:'report-share'});
 const open=async token=>{const res=response();await handleSharedReport({method:'GET',url:`/api/wishlist?shared=${token}`,headers:{}},res,{store});return res;};
 let res=await open(share.token);
 assert.equal(res.statusCode,200);
 const view=res.body.report,text=JSON.stringify(view);
 assert.equal(view.name,'Jack');assert.equal(view.shared,true);
 assert.ok(!view.cards.some(c=>c.type==='locked'),'locked cards are never shared');
 const receipt=view.cards.find(c=>c.type==='receipt');
 assert.ok(!receipt.lines.some(l=>l.label==='RETURNED'),'returns stay private even when shown in the app');
 assert.ok(!receipt.lines.some(l=>l.label==='BLACK ANYTHING'),'hidden lines stay hidden');
 for(const secret of ['feedback','hidden','share','token','conversation','written','key'])assert.ok(!text.includes(`"${secret}":`),secret);
 const gate=view.cards.find(c=>c.type==='gatekeeper');
 if(gate)assert.equal(gate.line,'Jack got to Our Legacy early','shared copy is about the person');
 // "Wouldn't share" leaves that card out of the link.
 await updateReport(store,owner,{action:'report-feedback',card:'receipt',vote:'down',reason:'wont_share'});
 res=await open(share.token);assert.ok(!res.body.report.cards.some(c=>c.type==='receipt'));
 // Wrong, malformed or turned-off links all look the same: not found.
 for(const token of ['AbCdEfGhIjKlMnOpQrStUv','short','../../etc'])assert.equal((await open(token)).statusCode,404,token);
 await updateReport(store,owner,{action:'report-unshare'});
 assert.equal((await open(share.token)).statusCode,404);
});

test('shared copy must be about the person, never "you", or it falls back',async()=>{
 const store=fixture();
 const built=await buildReport(store,owner,{},{interpret:async request=>request.schema.properties.line?{line:'you got to Our Legacy early',shared:'you got to Our Legacy early'}:request.schema.properties.verdict?{verdict:'new year, same black',shared:'your closet stayed black'}:{total:'one colour and a crop top habit'}});
 for(const card of built.report.cards.filter(c=>c.shared))assert.ok(!/\byou(r)?\b/i.test(card.shared),card.shared);
 // Older reports without shared copy still share safely.
 const legacy={...built.report,cards:built.report.cards.map(({shared,...c})=>c)};
 for(const card of sharedView(legacy,'Jack').cards)assert.ok(!/\byou(r)?\b/i.test(card.line??card.verdict??''),card.type);
});

test('a share link serves the page with a preview built only from what was shared',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:sharingWriter});
 const {share}=await updateReport(store,owner,{action:'report-share'});
 const page='<!doctype html><html><head><title>Your style report · Jules</title></head><body>page</body></html>';
 const open=async token=>{const res=response();res.end=function(body){this.body=body;};await handleSharePage({method:'GET',url:`/api/wishlist?share_page=${token}`,headers:{host:'jules.test'}},res,{store,env:{},readPage:async()=>page});return res;};
 let res=await open(share.token);
 assert.equal(res.statusCode,200);
 assert.match(res.body,/<title>Jack’s style report · Jules<\/title>/);
 assert.match(res.body,/property="og:title" content="Jack’s style report · Jules"/);
 assert.match(res.body,/property="og:image" content="https:\/\/jules\.test\/brand\/previews\/report-v1\.png"/);
 assert.ok(!res.body.includes('Your style report · Jules'),'the generic title is replaced, not repeated');
 assert.ok(res.body.includes('<body>page</body>'),'the page itself is unchanged');
 // Nothing private reaches the preview: a hidden returns line or feedback never appears.
 assert.ok(!/RETURNED|feedback|wont_share/.test(res.body));
 // A wrong or turned-off link gets the generic preview, with no name.
 for(const token of ['AbCdEfGhIjKlMnOpQrStUv','nope']){res=await open(token);assert.match(res.body,/<title>A style report · Jules<\/title>/);assert.ok(!res.body.includes('Jack'));}
});

test('the preview description comes from the best shared card',()=>{
 assert.equal(sharePreview({name:'Jack',cards:[{type:'receipt',lines:[{label:'BLACK ANYTHING',n:22}]},{type:'gatekeeper',score:71,verdict:'Cult member'}]}).description,'Niche score 71, cult member. How niche are you?');
 assert.equal(sharePreview({name:'Jack',cards:[{type:'receipt',lines:[{label:'BLACK ANYTHING',n:22}]}]}).description,'Black anything ×22. What would yours say?');
 assert.equal(sharePreview({name:null,cards:[]}).title,'A style report · Jules');
});

test('a line that starts with the person’s name keeps the name’s capital, even if the writer lowercased it',()=>{
 const gate={score:71,verdict:'Cult member',brands:[{name:'Mfpen'},{name:'Eckhaus Latta'}]};
 assert.equal(validGateLine('jack found Mfpen before the group chat',gate,'Jack'),'Jack found Mfpen before the group chat');
 assert.equal(validGateLine('You found Mfpen before the group chat',gate,'Jack'),'you found Mfpen before the group chat');
});

test('four emojis: each is earned by a counted fact, the four strongest win, and the variety limits hold',()=>{
 seq=0;
 const rows=[
  // 12 SSENSE orders of black tees: 🖤 and the store emojis 🔁 / 📦 (only one of that pair may show).
  ...Array.from({length:12},(_,k)=>buy({product:'Tee '+k,merchant:'SSENSE',brand:'Our Legacy',order_reference:'S'+k})).flat(),
  // Cycling kit from a cycling brand: 🚲.
  ...Array.from({length:4},(_,k)=>buy({product:'Jersey '+k,merchant:'MAAP',brand:'MAAP',order_reference:'M'+k})).flat(),
  // Six pairs of sneakers: 👟.
  ...Array.from({length:6},(_,k)=>buy({product:'Sneaker '+k,merchant:'Nike',brand:'Nike',order_reference:'N'+k})).flat(),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,i=>/Tee/.test(i.product)?{item_type:'t-shirt',group:'tops',color_family:'black',resale:false}
  :/Jersey/.test(i.product)?{item_type:'race jersey',group:'activewear',color_family:'black',resale:false}
  :{item_type:'sneakers',group:'shoes',color_family:'white',resale:false});
 const e=fourEmojis(state,tags,{gateScore:80});
 assert.equal(e.eligible,true);assert.equal(e.picks.length,4);
 const emojis=e.picks.map(p=>p.emoji);
 // Never both of a pair, never two colours.
 assert.ok(!(emojis.includes('🔁')&&emojis.includes('📦')));
 assert.ok(emojis.filter(x=>['🖤','🤍','🩶','💙','🤎','🩷','🫒','🌈'].includes(x)).length<=1);
 // Every caption is a fact from the purchases, never an amount.
 assert.ok(e.picks.every(p=>p.fact&&!/[$€£]/.test(p.fact)));
 const fact=Object.fromEntries(e.picks.map(p=>[p.emoji,p.fact]));
 if(fact['🗝️'])assert.equal(fact['🗝️'],'niche score 80');
 if(fact['🚲'])assert.equal(fact['🚲'],'4 pieces of cycling kit');
 // Too little to earn four: no card, no filler.
 seq=0;
 const thin=Array.from({length:3},(_,k)=>buy({product:'Tee '+k,merchant:'COS',brand:'COS',order_reference:'C'+k})).flat();
 assert.equal(fourEmojis(projectReceiptEvidence(owner,thin).state,{}).eligible,false);
});

test('the emoji card is shared as just its emojis and facts',()=>{
 const report={id:'r',built_at:'2026-10-16T00:00:00Z',hidden:{},feedback:[],cards:[{type:'emoji',picks:[{emoji:'🖤',fact:'82% black',secret:'x'}]}]};
 assert.deepEqual(sharedView(report,'Jack').cards,[{type:'emoji',picks:[{emoji:'🖤',fact:'82% black'}]}]);
});

test('Spectrum computes sliders from purchases and the brand list, then names the approved type that fits best',()=>{
 seq=0;
 // Twelve black J.Crew tees from one store over two years: uniform, classic, one store, mall.
 const rows=Array.from({length:12},(_,k)=>buy({product:'Tee '+k,merchant:'J.Crew',brand:'J.Crew',order_reference:'J'+k},{at:Date.UTC(k<6?2023:2024,k%6,1)})).flat();
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,()=>({item_type:'t-shirt',group:'tops',color_family:'black',resale:false}));
 const s=spectrum(state,tags,{gateScore:10});
 assert.equal(s.eligible,true);
 const v=Object.fromEntries(s.sliders.map(x=>[x.key,x.value]));
 assert.ok(v.variety<=33,'one kind of thing, one colour, one brand is uniform');
 assert.ok(v.era>=67,'a classic brand bought steadily is classic');
 assert.ok(v.stores<=33,'one store');
 assert.equal(v.niche,10);
 // Three matches (Era R, Variety L, Niche L) beat two-match types like The Uniform and The Creature of Habit,
 // and more extreme sliders beat The Comfort Zone's three.
 assert.equal(s.type,'The Steady Classicist');
 assert.ok(s.line.length>0);
 // There is no Sale slider until receipts carry a sale flag, so sale types never appear.
 assert.ok(!s.sliders.some(x=>x.key==='sale'));
 // Too little data: fewer than three sliders, so no card.
 seq=0;
 assert.equal(spectrum(projectReceiptEvidence(owner,buy({product:'Tee',merchant:'COS',brand:'COS',order_reference:'C1'})).state,{}).eligible,false);
});

test('In / Out: one order of several colourways is not a habit that went out, and plurals read right',()=>{
 seq=0;
 const rows=[
  // One December order of four colourways, then nothing: not "out".
  ...Array.from({length:4},(_,k)=>buy({product:'Opaline '+k,merchant:'Tiger Leather',brand:'Tiger Leather',order_reference:'T1'},{at:Date.UTC(2024,11,4)})).flat(),
  // Four separate orders of accessories in 2024, none in 2026: a real habit that went out.
  ...Array.from({length:4},(_,k)=>buy({product:'Belt '+k,merchant:'Lemaire',brand:'Lemaire',order_reference:'B'+k},{at:Date.UTC(2024,k,1)})).flat(),
  // A sixth 2024 order, so both years are busy enough for the card.
  ...buy({product:'Tee old',merchant:'Arket',brand:'Arket',order_reference:'A1'},{at:Date.UTC(2024,6,1)}),
  ...Array.from({length:6},(_,k)=>buy({product:'Tee '+k,merchant:'COS',brand:'COS',order_reference:'C'+k},{at:Date.UTC(2026,k,1)})).flat(),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,i=>/Tee/.test(i.product)?{item_type:'tee',group:'tops',color_family:'black',resale:false}:{item_type:'leather accessory',group:'accessories',color_family:'brown',resale:false});
 const c=inOut(state,tags);
 assert.ok(!c.out.some(o=>o.plain==='Tiger Leather'),'a single order is not an era');
 assert.ok(c.out.some(o=>o.plain==='Lemaire'));
 assert.ok(c.out.some(o=>o.plain==='leather accessories'),'accessory → accessories');
});

test('emoji captions are jokes that still state the fact, and fall back to the fact when they don’t',async()=>{
 const names=['MAAP','Lululemon','SSENSE'];
 assert.equal(validEmojiCaption('15 pieces of cycling kit, tour de drawer.','15 pieces of cycling kit',names),'15 pieces of cycling kit, tour de drawer');
 for(const bad of ['cycling kit, tour de drawer','15 pieces of cycling kit, 0 races','15 pieces of cycling kit from Lululemon','15 pieces of cycling kit, obsessed','x15 '+'y'.repeat(40)])
  assert.equal(validEmojiCaption(bad,'15 pieces of cycling kit',names),null,bad);
 const picks=[{emoji:'🚲',fact:'15 pieces of cycling kit'},{emoji:'🛍️',fact:'44 different stores'}];
 const out=await writeEmojiCaptions(picks,async()=>({captions:[{emoji:'🚲',caption:'15 pieces of cycling kit, tour de drawer',shared:'Jack: 15 pieces of cycling kit, tour de drawer'},{emoji:'🛍️',caption:'so many stores',shared:'you shop a lot'}]}),names,'Jack');
 assert.equal(out[0].caption,'15 pieces of cycling kit, tour de drawer');assert.equal(out[0].shared,'Jack: 15 pieces of cycling kit, tour de drawer');
 // The second dropped its number, so the plain fact stays.
 assert.equal(out[1].caption,'44 different stores');assert.equal(out[1].shared,'44 different stores');
 // A writer that fails keeps every fact.
 assert.deepEqual((await writeEmojiCaptions(picks,async()=>{throw Error('down');},names)).map(p=>p.caption),['15 pieces of cycling kit','44 different stores']);
});

test('Spectrum price counts each brand once and leans on the most premium brands, so restocks do not drown them out',()=>{
 seq=0;
 const rows=[
  // Twenty restocks of one mid-tier brand...
  ...Array.from({length:20},(_,k)=>buy({product:'Legging '+k,merchant:'Lululemon',brand:'Lululemon',order_reference:'L'+k})).flat(),
  // ...and one piece each from three luxury houses.
  ...['Dries Van Noten','Bottega Veneta','Prada'].flatMap((b,k)=>buy({product:'Coat '+k,merchant:b,brand:b,order_reference:'X'+k})),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,i=>({item_type:/Legging/.test(i.product)?'legging':'coat',group:/Legging/.test(i.product)?'activewear':'outerwear',color_family:/Legging/.test(i.product)?'black':'brown',resale:false}));
 const price=spectrum(state,tags,{gateScore:40}).sliders.find(x=>x.key==='price').value;
 // Per item this would be about 42 (twenty 33s and three 100s); per brand, blended with the top quarter, it's spendy.
 assert.ok(price>=67,`price ${price}`);
});

// A closet built for a known icon: Frank Ocean's anchors (Prada, Homer, Our Legacy, Nike), neutrals.
function matchHistory(brands){
 seq=0;
 const rows=brands.flatMap((brand,k)=>buy({product:'Item '+k,merchant:brand,brand,order_reference:'M'+k},{at:Date.UTC(2025,k%12,1)}));
 const state=projectReceiptEvidence(owner,rows).state;
 return {state,tags:tagsFor(state,i=>({item_type:'tee',group:'tops',color_family:['white','grey','navy'][Number(i.product.split(' ')[1])%3],resale:false}))};
}
test('the style match picks the icon whose brands, palette, price and signals fit best, and its score is the percentage',()=>{
 const {state,tags}=matchHistory(['Our Legacy','Our Legacy','Nike','Nike','Prada','COS','Uniqlo','Lemaire','Auralee','Margaret Howell','Our Legacy','Nike']);
 const m=styleMatch(state,tags,{gateScore:62,spectrumValues:{price:80,variety:60}});
 assert.equal(m.eligible,true);
 assert.equal(m.icon.name,'Frank Ocean');
 assert.deepEqual([...m.shared.brands].sort(),['Nike','Our Legacy','Prada']);
 assert.ok(m.pct>=50&&m.pct<=100);
 // Same history, same icon: the match is computed, not random.
 assert.deepEqual(styleMatch(state,tags,{gateScore:62,spectrumValues:{price:80,variety:60}}),m);
 // Without price or signal data those parts are left out, not guessed: still a match from brands.
 const plain=styleMatch(state,tags,{});
 assert.equal(plain.eligible,true);assert.ok(plain.shared.brands.length>=2);
 // Too little history: no card.
 assert.equal(styleMatch(matchHistory(['Nike','Nike','Nike']).state,{}).eligible,false);
});

test('the match line names only shared brands and has a third-person twin for share links',async()=>{
 const card={icon:{name:'Frank Ocean',first:'Frank',traits:['Cult brands','Clean shapes','Says little']},shared:{brands:['Our Legacy','Nike'],signals:[],palette:null}};
 const names=['Our Legacy','Nike','Zara'];
 assert.equal(validMatchLine('You both love Our Legacy and say very little.',card,names),'you both love Our Legacy and say very little');
 assert.equal(validMatchLine('you both hate a logo more than an early meeting',card,names),'you both hate a logo more than an early meeting');
 // Every line keeps the card's love/hate frame.
 assert.equal(validMatchLine('you both buy Our Legacy like the care label has a syllabus',card,names),null);
 for(const bad of ['you both love Zara','you both love 4 hoodies','you both love Nike and are loyal to it','you both love '+'y'.repeat(90)])assert.equal(validMatchLine(bad,card,names),null,bad);
 const written=await writeMatchLine(card,async()=>({line:'you both love Our Legacy and say very little',shared:'Jack and Frank both love Our Legacy and say very little'}),names,'Jack');
 assert.equal(written.shared,'Jack and Frank both love Our Legacy and say very little');
 const fallback=await writeMatchLine(card,async()=>({line:'you both love Zara',shared:'you both love Zara'}),names,'Jack');
 assert.equal(fallback.written,false);assert.equal(fallback.line,'you both love Our Legacy and Nike, and the rest is just details');assert.match(fallback.shared,/^Jack and Frank both love/);assert.ok(!/\byou\b/.test(fallback.shared));
 // The share view shows the match about the person and leaves out what it was computed from.
 const view=sharedView({cards:[{type:'match',pct:94,icon:{key:'frank-ocean',...card.icon,kind:'real',photo:null},shared:card.shared,orders:121,line:written.line,shared_line:written.shared}],feedback:[],hidden:{}},'Jack');
 assert.deepEqual(Object.keys(view.cards[0]).sort(),['icon','line','pct','type']);
 assert.equal(view.cards[0].line,'Jack and Frank both love Our Legacy and say very little');
 assert.equal(sharePreview(view).description,'94% style match with Frank Ocean. Who’s your style icon?');
});
