import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptLines,validTotal,writeTotal,buildReport,updateReport,reportView,handleReport,FALLBACK_TOTAL,gatekeeper,nicheBrand,validGateLine,writeGateLine,reportWriter,REPORT_MODEL,inOut,validInOutLine,writeInOutLine,lockedCards,MIN_CARDS,sharedView,handleSharedReport,sharePreview,handleSharePage,fourEmojis,spectrum,validEmojiCaption,writeEmojiCaptions} from '../lib/style-report.js';
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
 const said=list=>Object.fromEntries(list.map(x=>[x.text,x.fact]));
 // IN: a first-ever category, and a category whose share of the year jumped.
 assert.equal(said(c.in)['swim briefs'],'first ever');
 assert.equal(said(c.in)['sunglasses'],'1 → 4');
 // OUT: the "then" category that vanished, named by the item that was most of it.
 assert.equal(said(c.out)['custom made shirts'],'6 → 0');
 // STILL: the brand bought in both years (receipts' spellings merged) and the colour leading both.
 assert.ok(c.still.includes('Lululemon'));
 // The breakup: the brand bought most before (Suitsupply's 6 beat John Elliott's 5), none in the
 // latest year. It isn't repeated under OUT.
 assert.deepEqual(c.stats.find(s=>s.label==='breakup of the era'),{label:'breakup of the era',value:'Suitsupply 6 → 0'});
 assert.ok(!c.out.some(o=>o.text==='Suitsupply'));
 // Returns never count, so the returned coats don't appear anywhere.
 assert.ok(!JSON.stringify(c).includes('Zara')&&!JSON.stringify(c).includes('coat'));
 assert.ok(c.in.length<=4&&c.out.length<=3&&c.stats.length<=2);
 // One busy year is not enough.
 seq=0;
 const one=Array.from({length:8},(_,k)=>buy({product:'Tee '+k,merchant:'COS',brand:'COS',order_reference:'E'+k},{at:yearOf(2026,k)})).flat();
 assert.equal(inOut(projectReceiptEvidence(owner,one).state,{}).eligible,false);
});

test('the In / Out closing line uses only the card’s facts, with a fallback',async()=>{
 const card={then:2024,now:2026,in:[{text:'swim briefs',fact:'first ever'},{text:'sunglasses',fact:'1 → 4'}],out:[{text:'Suitsupply',fact:'6 → 0'}],still:['Lululemon','black'],stats:[{label:'breakup of the era',value:'John Elliott 5 → 0'}]};
 const names=['Suitsupply','Lululemon','John Elliott','Zara'];
 assert.equal(validInOutLine('Suitsupply out, swim briefs in, and Lululemon never left.',card,names),'Suitsupply out, swim briefs in, and Lululemon never left');
 for(const bad of ['you traded Zara for swim briefs','12 pairs of sunglasses later','you stayed loyal to black','y'.repeat(91)])assert.equal(validInOutLine(bad,card,names),null,bad);
 const fallback=await writeInOutLine(card,async()=>({verdict:'you shop at Zara now',shared:'Jack shops at Zara now'}),names,'Jack');
 assert.equal(fallback.written,false);assert.ok(fallback.verdict);assert.ok(!/\byou(r)?\b/i.test(fallback.shared));
});

test('a report always has at least three cards: missing built cards are shown locked with what unlocks them',()=>{
 const gate={matched:1},then={eligible:false};
 const locked=lockedCards(['receipt'],{gate,then});
 assert.equal(1+locked.length,MIN_CARDS);
 assert.deepEqual(locked.map(c=>[c.type,c.card]),[['locked','gatekeeper'],['locked','inout']]);
 assert.ok(locked.every(c=>c.why&&c.title));
 // Enough real cards: nothing locked.
 assert.deepEqual(lockedCards(['receipt','gatekeeper','inout'],{gate,then}),[]);
 // Two real cards: one locked card fills the gap.
 assert.deepEqual(lockedCards(['receipt','gatekeeper'],{gate,then}).map(c=>c.card),['inout']);
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
 assert.ok(!c.out.some(o=>o.text==='Tiger Leather'),'a single order is not an era');
 assert.ok(c.out.some(o=>o.text==='Lemaire'));
 assert.ok(c.out.some(o=>o.text==='leather accessories'),'accessory → accessories');
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
