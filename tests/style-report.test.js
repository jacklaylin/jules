import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptLines,validFine,validName,writeReceipt,fineCheck,clock,buildReport,updateReport,reportView,handleReport,FALLBACK_FINE,gatekeeper,nicheBrand,validGateLine,writeGateLine,reportWriter,REPORT_MODEL,inOut,validInOutLine,writeInOutLine,validEntry,copyLines,lockedCards,MIN_CARDS,sharedView,handleSharedReport,sharePreview,handleSharePage,fourEmojis,EMOJI_PERSONAS,emojiPersona,spectrum,validEmojiCaption,writeEmojiCaptions,styleMatch,validMatchLine,writeMatchLine,sendNewCardText,sendReportLink,newCardsText,missingSources} from '../lib/style-report.js';
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

test('the receipt proves it read the orders: repeat products, the first order and a few fields',()=>{
 seq=0;
 const sock=(order,at,quantity=1)=>buy({product:'Ribbed Calf Sock Black L',merchant:'Bombas',brand:'Bombas',color:'Black',size_label:'L',order_reference:order,quantity},{at});
 const rows=[...sock('B1',Date.UTC(2024,0,5),3),...sock('B2',Date.UTC(2024,5,5)),...sock('B3',Date.UTC(2025,0,5)),...sock('B4',Date.UTC(2025,6,5)),
  ...Array.from({length:6},(_,k)=>buy({product:'Muscle Crop Top '+k,merchant:'John Elliott',order_reference:'JE'+k},{at:Date.UTC(2025,k,1)})).flat(),
  ...Array.from({length:3},(_,k)=>buy({product:'Overshirt '+k,merchant:'SSENSE',brand:'Our Legacy',order_reference:'SS'+k},{at:Date.UTC(2023,k+2,1)})).flat(),
  ...buy({product:'Overshirt 9',merchant:'SSENSE',brand:'Our Legacy',order_reference:'SS9'},{at:Date.UTC(2026,9,3,8,14)})];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=tagsFor(state,i=>/Sock/.test(i.product)?{item_type:'sock',group:'underwear_basics',color_family:'black'}:/Crop/.test(i.product)?{item_type:'muscle half crop top',group:'tops',color_family:'black'}:{item_type:'overshirt',group:'shirts',color_family:'navy'});
 const r=receiptLines(state,tags);
 assert.equal(r.eligible,true);
 const sockLine=r.lines.find(l=>l.key.startsWith('product:bombas|'));
 assert.deepEqual({label:sockLine.label,n:sockLine.n},{label:'RIBBED CALF SOCK BLACK',n:6},'the same sock across four orders, size left off; a 3-pack order counts 3');
 assert.ok(!r.lines.some(l=>l.key==='brand:bombas'),'a product line says more than its brand line');
 assert.ok(r.lines.some(l=>l.key==='type:muscle half crop tops'||l.key==='type:muscle half crop top'),'six different crop tops fill in as an item type');
 assert.ok(r.lines.every(l=>!/ORDERS$/.test(l.label)),'store order counts are gone');
 assert.equal(r.first.label,'OVERSHIRT 0');assert.equal(r.first.at,Date.UTC(2023,2,1));
 const fields=Object.fromEntries(r.fields.map(f=>[f.key,f]));
 assert.equal(fields['field:kept'].value,'16');
 assert.equal(fields['field:not-colour'].label,'ITEMS NOT BLACK');assert.equal(fields['field:not-colour'].value,'4');
 assert.equal(fields['field:stores'].value,'3');
 assert.equal(fields['field:last'].at,Date.UTC(2026,9,3,8,14),'the last order keeps its time, shown in the person’s own time zone');
 assert.equal(r.fields.length,4);assert.equal(r.fields.at(-1).key,'field:last');
 assert.ok(!fields['field:reordered'],'the sock is already a line');
 assert.deepEqual(r.sources[sockLine.key],{brand:'Bombas',product:'Ribbed Calf Sock Black L',color:'Black'});
 assert.ok(r.lines.every(l=>!/\$|€|£/.test(l.label)));
});

test('the item reordered most gets its own field when it isn’t already a line',()=>{
 seq=0;
 const brands=['COS','Arket','Sunspel','Asket','Hanro'];
 const rows=[...brands.flatMap((b,k)=>buy({product:'Tee',merchant:b,brand:b,order_reference:'C'+k,quantity:4})),
  ...Array.from({length:3},(_,k)=>buy({product:'Ankle Sock',merchant:'Uniqlo',brand:'Uniqlo',order_reference:'U'+k})).flat()];
 const r=receiptLines(projectReceiptEvidence(owner,rows).state,{});
 assert.equal(r.lines.length,5);
 const field=r.fields.find(f=>f.key==='field:reordered');
 assert.equal(field.value,'ANKLE SOCK · 3 ORDERS');
});

test('product lines are one per brand, so the receipt isn’t a list of one brand’s products',()=>{
 seq=0;
 const je=['Villain Hoodie','Flash Tee','Himalayan Pant'].flatMap((product,k)=>[0,1,2].flatMap(o=>buy({product,merchant:'John Elliott',brand:'John Elliott',order_reference:`J${k}${o}`})));
 const rows=[...je,...[0,1].flatMap(o=>buy({product:'Calf Sock',merchant:'Bombas',brand:'Bombas',order_reference:'B'+o})),
  ...[0,1,2].flatMap(o=>buy({product:'Team Jersey '+o,merchant:'MAAP',brand:'MAAP',order_reference:'M'+o}))];
 const r=receiptLines(projectReceiptEvidence(owner,rows).state,{});
 const products=r.lines.filter(l=>l.key.startsWith('product:'));
 assert.deepEqual(products.map(l=>l.key.split('|')[0]),['product:john elliott','product:bombas'],'one John Elliott product, not three');
 assert.ok(r.lines.some(l=>l.key==='brand:maap'),'other brands fill in');
 assert.ok(!r.lines.some(l=>l.key==='brand:john elliott'),'its product line already speaks for the brand');
 // Someone who only buys one brand still gets a receipt from that brand's products.
 seq=0;
 const solo=receiptLines(projectReceiptEvidence(owner,je).state,{});
 assert.equal(solo.eligible,true);assert.equal(solo.lines.filter(l=>l.key.startsWith('product:john elliott')).length,3);
});

test('with no repeat products the receipt fills in with item types and brands',()=>{
 const {state,tags}=history(),r=receiptLines(state,tags);
 assert.equal(r.eligible,true);
 const byKey=Object.fromEntries(r.lines.map(l=>[l.key,l]));
 assert.equal(byKey['type:muscle half crop top'].label,'MUSCLE HALF CROP TOPS');assert.equal(byKey['type:muscle half crop top'].n,6);
 assert.equal(byKey['brand:john elliott'].label,'JOHN ELLIOTT');
 assert.deepEqual(r.lines.find(l=>l.key==='returns'),{key:'returns',label:'RETURNED',n:1,private:true});
 assert.deepEqual(r.range,{from:2023,to:2025});
});

test('too little data makes no receipt instead of padding it',()=>{
 seq=0;const state=projectReceiptEvidence(owner,[...buy({product:'Tee'}),...buy({product:'Jeans'})]).state;
 assert.equal(receiptLines(state,{}).eligible,false);
});

test('a short product name may only remove words from what the receipt says',()=>{
 const source={brand:'Bombas',product:"Men's Ribbed Calf Sock 3-Pack",color:'Black'};
 assert.equal(validName('ribbed calf sock, black',source),'RIBBED CALF SOCK, BLACK');
 assert.equal(validName('BOMBAS CALF SOCK',source),'BOMBAS CALF SOCK');
 assert.equal(validName('BLACK CALF SOCK',source),null,'reordered');
 assert.equal(validName('RIBBED CREW SOCK',source),null,'a word the receipt doesn’t have');
 assert.equal(validName('BOMBAS MEN\'S RIBBED CALF SOCK BLACK',source),null,'too long for a line');
 assert.equal(validName('',source),null);assert.equal(validName('SOCK',null),null);
});

test('the fine print is checked: only numbers and names the card prints, no money or loyalty claims',()=>{
 const card={lines:[{key:'a',label:'JOHN ELLIOTT',n:6},{key:'b',label:'RIBBED CALF SOCK',n:6}],first:{label:'OVERSHIRT'},fields:[{key:'field:not-colour',label:'ITEMS NOT BLACK',value:'4'},{key:'field:last',label:'LAST ORDER',at:1}]};
 const check={...fineCheck(card),all_names:['John Elliott','Our Legacy']};
 assert.equal(validFine('no exchanges for colour.',check),'NO EXCHANGES FOR COLOUR');
 assert.equal(validFine('4 colours in stock',check),'4 COLOURS IN STOCK');
 assert.equal(validFine('5 colours in stock',check),null);
 assert.equal(validFine('john elliott members only',check),'JOHN ELLIOTT MEMBERS ONLY');
 assert.equal(validFine('our legacy sold separately',check),null,'a brand the card doesn’t show');
 assert.equal(validFine('your favourite sock',check),null);
 assert.equal(validFine('no refunds over $50',check),null);
 assert.equal(validFine('thank you, come again!',check),null);
 assert.equal(validFine('x'.repeat(35),check),null);
});

test('the writer shortens names and writes the fine print; anything that fails a check falls back safely',async()=>{
 const receipt={lines:[{key:'product:bombas|sock',label:'RIBBED CALF SOCK 3 PACK',n:6},{key:'type:tee',label:'TEES',n:4},{key:'brand:cos',label:'COS',n:3}],
  first:{key:'first',at:1,label:'LINEN SHIRT CREAM',source:{brand:'COS',product:'Linen Shirt',color:'Cream'}},
  fields:[{key:'field:kept',label:'ITEMS KEPT',value:'13'},{key:'field:last',label:'LAST ORDER',at:2}],
  sources:{'product:bombas|sock':{brand:'Bombas',product:'Ribbed Calf Sock 3-Pack',color:'Black'},first:{brand:'COS',product:'Linen Shirt',color:'Cream'}},range:null,all_names:['Bombas','COS']};
 let calls=0;
 const out=await writeReceipt(receipt,async()=>{calls++;return calls===1?{names:[{key:'product:bombas|sock',label:'RIBBED CALF SOCK, BLACK'},{key:'first',label:'WHITE LINEN SHIRT'}],fine:'99 socks served'}
  :{names:[{key:'first',label:'COS LINEN SHIRT'}],fine:'socks are final sale'};});
 assert.equal(calls,2,'the fine print failed its check once, so the writer was asked again');
 assert.equal(out.lines[0].label,'RIBBED CALF SOCK, BLACK','a name that passed on the first try is kept');
 assert.equal(out.lines[1].label,'TEES','item-type lines are never renamed');
 assert.equal(out.first.label,'COS LINEN SHIRT');
 assert.equal(out.fine,'SOCKS ARE FINAL SALE');assert.equal(out.written,true);
 const down=await writeReceipt(receipt,async()=>{throw Error('down');});
 assert.equal(down.fine,FALLBACK_FINE);assert.equal(down.written,false);
 assert.equal(down.lines[0].label,'RIBBED CALF SOCK 3 PACK','without the writer the code’s own label stays');
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
const writer=async()=>({names:[],fine:'one colour and a crop top habit'});

test('building saves the receipt on the history row, and a rebuild keeps feedback and hidden lines',async()=>{
 const store=fixture(),built=await buildReport(store,owner,{},{interpret:writer});
 assert.equal(built.status,'built');
 const saved=store.row.data.style_report;
 assert.equal(saved.cards[0].type,'receipt');assert.equal(saved.cards[0].fine,'ONE COLOUR AND A CROP TOP HABIT');assert.equal(saved.show_returns,false);
 await updateReport(store,owner,{action:'report-feedback',card:'receipt',vote:'down',reason:'not_funny'});
 await updateReport(store,owner,{action:'report-lines',card:'receipt',hidden:['type:muscle half crop top'],show_returns:false});
 const again=await buildReport(store,owner,{},{interpret:writer});
 assert.notEqual(again.report.id,saved.id);
 assert.deepEqual(store.row.data.style_report.hidden,{receipt:['type:muscle half crop top']});
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
 await updateReport(store,owner,{action:'report-lines',card:'receipt',hidden:['type:muscle half crop top','first','field:last'],show_returns:true});
 view=reportView(store.row.data.style_report);
 assert.equal(view.cards[0].lines.find(l=>l.key==='returns').hidden,false);assert.equal(view.cards[0].lines.find(l=>l.key==='type:muscle half crop top').hidden,true);
 // The first order and the fields can be hidden like lines.
 assert.equal(view.cards[0].first.hidden,true);assert.equal(view.cards[0].fields.find(f=>f.key==='field:last').hidden,true);
 assert.equal(view.cards[0].fields.find(f=>f.key==='field:kept').hidden,false);
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

test('the end card offers only the order sources this deployment supports and the person hasn’t linked',async()=>{
 const both={GMAIL_IMPORT_ENABLED:'true',SHOP_ORDERS_ENABLED:'true'};
 assert.deepEqual(missingSources({token_ciphertext:'sealed',data:{connections:{shop:{credential:'sealed'}}}},both),[]);
 assert.deepEqual(missingSources({token_ciphertext:'sealed',data:{}},both),['shop']);
 assert.deepEqual(missingSources({token_ciphertext:null,data:{connections:{shop:{credential:'sealed'}}}},both),['gmail']);
 assert.deepEqual(missingSources({data:{}},{}),[],'a source that isn’t turned on is never offered');
 const store=fixture(),res=response();await buildReport(store,owner,{},{interpret:writer});
 await handleReport({method:'GET',headers:{authorization:'Bearer t'}},res,{store,env:both,auth:async()=>({status:200,conversation:owner}),fetcher:fetch});
 assert.deepEqual(res.body.missing_sources,['shop']);
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
 const built=await buildReport(store,owner,{},{interpret:async request=>request.schema.properties.line?{line:'you got to Our Legacy early'}:{names:[],fine:'one colour and a crop top habit'}});
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
 const built=await buildReport(store,owner,{},{interpret:async request=>request.schema.properties.line?{line:'you got to Our Legacy early'}:request.schema.properties.verdict?{verdict:'new year, same black'}:{names:[],fine:'one colour and a crop top habit'}});
 const types=built.report.cards.map(c=>c.type);
 assert.ok(types.length>=MIN_CARDS);assert.equal(types[0],'receipt');
 assert.ok(types.indexOf('locked')===-1||types.slice(types.indexOf('locked')).every(t=>t==='locked'));
 const locked=built.report.cards.find(c=>c.type==='locked');
 if(locked)await assert.rejects(updateReport(store,owner,{action:'report-lines',card:'locked',hidden:[],show_returns:false}),/no lines/);
});

// The writer answers each card's schema: in-app copy talks to the person, shared copy about them.
const sharingWriter=async request=>request.schema.properties.line?{line:'you got to Our Legacy early',shared:'Jack got to Our Legacy early'}
 :request.schema.properties.verdict?{verdict:'new year, same black',shared:'Jack kept it black'}:{names:[],fine:'one colour and a crop top habit'};

test('sharing makes one permanent unguessable link, and a rebuild keeps it',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:sharingWriter});
 const shared=await updateReport(store,owner,{action:'report-share'});
 assert.match(shared.share.token,/^[A-Za-z0-9_-]{22}$/);
 // Sharing again keeps the same link.
 assert.equal((await updateReport(store,owner,{action:'report-share'})).share.token,shared.share.token);
 assert.equal(reportView(store.row.data.style_report).share.token,shared.share.token);
 await buildReport(store,owner,{},{interpret:sharingWriter});
 assert.equal(store.row.data.style_report.share.token,shared.share.token,'a rebuild keeps the link working');
 // There is no turning the link off.
 await assert.rejects(updateReport(store,owner,{action:'report-unshare'}));
 assert.equal(store.row.data.style_report.share.token,shared.share.token);
});

test('a friend opening the link needs no sign-in and sees only what the person chose to share',async()=>{
 const store=fixture();await buildReport(store,owner,{},{interpret:sharingWriter});
 // Hide a line, show returns in the app, and mark one card as not for sharing.
 await updateReport(store,owner,{action:'report-lines',card:'receipt',hidden:['type:muscle half crop top'],show_returns:true});
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
 // Wrong or malformed links look the same: not found.
 for(const token of ['AbCdEfGhIjKlMnOpQrStUv','short','../../etc'])assert.equal((await open(token)).statusCode,404,token);
});

test('shared copy must be about the person, never "you", or it falls back',async()=>{
 const store=fixture();
 const built=await buildReport(store,owner,{},{interpret:async request=>request.schema.properties.line?{line:'you got to Our Legacy early',shared:'you got to Our Legacy early'}:request.schema.properties.verdict?{verdict:'new year, same black',shared:'your closet stayed black'}:{names:[],fine:'one colour and a crop top habit'}});
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
 const e=fourEmojis(state,tags,{gateScore:80,seed:'person-1'});
 assert.equal(e.eligible,true);assert.equal(e.picks.length,4);
 const emojis=e.picks.map(p=>p.signal);
 // The card shows each signal's persona emoji and an approved persona name.
 for(const p of e.picks){assert.equal(p.emoji,EMOJI_PERSONAS[p.signal][0]);assert.ok(p.persona);}
 // The same person always gets the same persona.
 assert.deepEqual(fourEmojis(state,tags,{gateScore:80,seed:'person-1'}).picks,e.picks);
 // Never both of a pair, never two colours.
 assert.ok(!(emojis.includes('🔁')&&emojis.includes('📦')));
 assert.ok(emojis.filter(x=>['🖤','🤍','🩶','💙','🤎','🩷','🫒','🌈'].includes(x)).length<=1);
 // Every caption is a fact from the purchases, never an amount.
 assert.ok(e.picks.every(p=>p.fact&&!/[$€£]/.test(p.fact)));
 const fact=Object.fromEntries(e.picks.map(p=>[p.signal,p.fact]));
 if(fact['🗝️'])assert.equal(fact['🗝️'],'niche score 80');
 if(fact['🚲'])assert.equal(fact['🚲'],'4 pieces of cycling kit');
 // Too little to earn four: no card, no filler.
 seq=0;
 const thin=Array.from({length:3},(_,k)=>buy({product:'Tee '+k,merchant:'COS',brand:'COS',order_reference:'C'+k})).flat();
 assert.equal(fourEmojis(projectReceiptEvidence(owner,thin).state,{}).eligible,false);
});

test('every emoji signal has an approved persona, and no two personas share an emoji',()=>{
 const signals=['🖤','🤍','🩶','💙','🤎','🩷','🫒','🌈','🔁','📦','🛍️','💎','♻️','🗝️','🏬','🔍','🚲','🏃','🧘','🏔️','🩱','👟','👢','👠','👖','🧶','🧥','👔','👕','🧢','👜','💍','🕶️','👗','🧦','👯','🎨','🎄','⚡','🐢'];
 assert.deepEqual(Object.keys(EMOJI_PERSONAS).sort(),[...signals].sort());
 const shown=Object.values(EMOJI_PERSONAS).map(([e])=>e);assert.equal(new Set(shown).size,shown.length);
 assert.deepEqual(emojiPersona('🛍️'),{emoji:'🏋️',persona:'olympic shopper'});
 assert.equal(emojiPersona('🔁',{store:'SSENSE'}).persona,'married to SSENSE');
 // Two options: a person's seed picks one, and different people can get different ones.
 const both=new Set(Array.from({length:20},(_,k)=>emojiPersona('🚲',{},'p'+k).persona));
 assert.deepEqual([...both].sort(),['coffee ride regular','kit before watts']);
});

test('the emoji card is shared as just its emojis and facts',()=>{
 const report={id:'r',built_at:'2026-10-16T00:00:00Z',hidden:{},feedback:[],cards:[{type:'emoji',picks:[{emoji:'🖤',fact:'82% black',secret:'x'}]}]};
 assert.deepEqual(sharedView(report,'Jack').cards,[{type:'emoji',picks:[{emoji:'🖤',fact:'82% black'}]}]);
 const personas={...report,cards:[{type:'emoji',picks:[{emoji:'🦇',signal:'🖤',persona:'vampire hours',fact:'82% black',caption:'82% black, lights off',shared:'82% black, lights off',secret:'x'}]}]};
 assert.deepEqual(sharedView(personas,'Jack').cards,[{type:'emoji',picks:[{emoji:'🦇',persona:'vampire hours',fact:'82% black, lights off'}]}]);
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

test('emoji asides still state the fact, and fall back to the fact when they don’t',async()=>{
 const names=['MAAP','Lululemon','SSENSE'];
 assert.equal(validEmojiCaption('15 pieces, bike pending.','15 pieces of cycling kit',names),'15 pieces, bike pending');
 // The card adds the brackets.
 assert.equal(validEmojiCaption('(45 stores, still training)','45 different stores',names),'45 stores, still training');
 for(const bad of ['cycling kit, tour de drawer','15 pieces, 0 races','15 pieces from Lululemon','15 pieces, obsessed','15 '+'y'.repeat(30)])
  assert.equal(validEmojiCaption(bad,'15 pieces of cycling kit',names),null,bad);
 const picks=[{emoji:'🚴',signal:'🚲',persona:'kit before watts',fact:'15 pieces of cycling kit'},{emoji:'🏋️',signal:'🛍️',persona:'olympic shopper',fact:'44 different stores'}];
 let context=null;
 const out=await writeEmojiCaptions(picks,async r=>{context=r.context;return {captions:[{emoji:'🚴',caption:'15 pieces, bike pending',shared:'15 pieces, Jack’s bike pending'},{emoji:'🏋️',caption:'so many stores',shared:'they shop a lot'}]};},names,'Jack');
 // The writer sees each persona, so the aside can play off it.
 assert.deepEqual(context.emojis.map(e=>e.persona),['kit before watts','olympic shopper']);
 assert.equal(out[0].caption,'15 pieces, bike pending');assert.equal(out[0].shared,'15 pieces, Jack’s bike pending');assert.equal(out[0].persona,'kit before watts');
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
 // What they both love comes with counts; what they both hate is what the purchases never include.
 assert.deepEqual(m.loves.find(l=>l.text==='Our Legacy'),{text:'Our Legacy',fact:'Our Legacy: 3 of 12 items'});
 assert.deepEqual(m.avoids.map(a=>a.key),['colour','prints','suits_tailoring']);
 assert.equal(m.avoids[0].fact,'0 of 12 items with a known colour are a colour');
 // Never a hate the icon is known for: a pink icon doesn't "hate colour".
 const colourful=matchHistory(['Juicy Couture','Juicy Couture','Skims','Miu Miu','Von Dutch','Zara','Gap','Uniqlo','H&M','Skims']);
 const paris=styleMatch(colourful.state,colourful.tags,{});
 assert.equal(paris.icon.name,'Paris Hilton');assert.ok(!paris.avoids.some(a=>a.key==='colour'));
 // Too little history: no card.
 assert.equal(styleMatch(matchHistory(['Nike','Nike','Nike']).state,{}).eligible,false);
});

test('the match card says what you both love and what you both hate, each a counted fact',async()=>{
 const card={icon:{name:'Frank Ocean',first:'Frank',traits:['Cult brands','Clean shapes','Says little']},shared:{brands:['Our Legacy','Nike'],signals:[],palette:null},
  loves:[{text:'Our Legacy',fact:'Our Legacy: 6 of 40 items'},{text:'Nike',fact:'Nike: 5 of 40 items'}],
  avoids:[{key:'prints',text:'prints',words:'print|pattern|stripe|check|floral',fact:'0 prints in 31 items with a known colour'}]};
 const names=['Our Legacy','Nike','Zara'];
 assert.equal(validMatchLine('You both love Our Legacy enough to own 6 of the same idea.',card,names),'you both love Our Legacy enough to own 6 of the same idea');
 assert.equal(validMatchLine('you both hate a print, 31 items and not one pattern',card,names,null,{kind:'hate'}),'you both hate a print, 31 items and not one pattern');
 // The frame is checked per line, numbers must come from that line's facts, and a hate is about a counted avoid.
 for(const [bad,kind] of [['you both buy Our Legacy like the care label has a syllabus','love'],['you both hate a print','love'],['you both love Our Legacy','hate'],
  ['you both love Our Legacy, all 7 pieces','love'],['you both hate logos more than mondays','hate'],['you both love Zara','love'],['you both love Nike and are loyal to it','love'],['you both love '+'y'.repeat(70),'love']])
  assert.equal(validMatchLine(bad,card,names,null,{kind}),null,bad);
 const out={love:'you both love Our Legacy enough to own 6 of the same idea',hate:'you both hate a print, 31 items and not one pattern',
  shared_love:'Jack and Frank both love Our Legacy enough to own 6 of the same idea',shared_hate:'Jack and Frank both hate a print, 31 items and not one pattern'};
 const written=await writeMatchLine(card,async()=>out,names,'Jack');
 assert.deepEqual(written,{...out,written:{love:true,hate:true}});
 // A line that fails keeps the other one and falls back to its plain fact, never filler.
 const half=await writeMatchLine(card,async()=>({...out,hate:'you both hate logos'}),names,'Jack');
 assert.equal(half.love,out.love);assert.equal(half.hate,'you both hate a print');assert.equal(half.shared_hate,'Jack and Frank both hate a print');
 const fallback=await writeMatchLine(card,async()=>{throw Error('down');},names,'Jack');
 assert.deepEqual([fallback.love,fallback.hate,fallback.shared_love],['you both love Our Legacy and Nike','you both hate a print','Jack and Frank both love Our Legacy and Nike']);
 // With nothing they both avoid, the card has only the love line.
 const loveOnly=await writeMatchLine({...card,avoids:[]},async()=>({...out,hate:''}),names,'Jack');
 assert.equal(loveOnly.hate,null);assert.equal(loveOnly.love,out.love);
 // The share view shows both lines about the person and leaves out what they were computed from.
 const view=sharedView({cards:[{type:'match',pct:94,icon:{key:'frank-ocean',...card.icon,kind:'real',photo:null},shared:card.shared,loves:card.loves,avoids:card.avoids,orders:121,...written}],feedback:[],hidden:{}},'Jack');
 assert.deepEqual(Object.keys(view.cards[0]).sort(),['hate','icon','love','pct','type']);
 assert.equal(view.cards[0].hate,'Jack and Frank both hate a print, 31 items and not one pattern');
 assert.equal(sharePreview(view).description,'94% style match with Frank Ocean. Who’s your style icon?');
 // A report built before the two lines keeps its single line.
 const old=sharedView({cards:[{type:'match',pct:94,icon:{key:'frank-ocean',...card.icon,kind:'real',photo:null},shared:card.shared,orders:121,line:'you both love Nike',shared_line:'Jack and Frank both love Nike'}],feedback:[],hidden:{}},'Jack');
 assert.equal(old.cards[0].line,'Jack and Frank both love Nike');
});

test('a shared receipt shows the last order’s time in the person’s time zone, never its date, and leaves out hidden parts',()=>{
 const at=Date.UTC(2026,9,3,8,14);
 const card={type:'receipt',range:{from:2022,to:2026},written:true,fine:'NO EXCHANGES FOR COLOUR',
  lines:[{key:'a',label:'RIBBED CALF SOCK',n:6},{key:'b',label:'TEES',n:4},{key:'returns',label:'RETURNED',n:2,private:true}],
  first:{key:'first',at:Date.UTC(2022,2,14),label:'MAAP TEAM JERSEY'},
  fields:[{key:'field:kept',label:'ITEMS KEPT',value:'70'},{key:'field:stores',label:'STORES USED',value:'3'},{key:'field:last',label:'LAST ORDER',at}]};
 const report={cards:[card],feedback:[],hidden:{receipt:['field:stores']},timezone:'America/Los_Angeles'};
 assert.equal(clock(at,'America/Los_Angeles'),'1:14 AM');
 assert.deepEqual(sharedView(report,'Jack').cards,[{type:'receipt',range:{from:2022,to:2026},fine:'NO EXCHANGES FOR COLOUR',
  lines:[{label:'RIBBED CALF SOCK',n:6},{label:'TEES',n:4}],
  fields:[{label:'ITEMS KEPT',value:'70'},{label:'LAST ORDER',value:'1:14 AM'}],first:{at:Date.UTC(2022,2,14),label:'MAAP TEAM JERSEY'}}]);
 // No time zone yet: the last order is left out rather than shown in someone else's clock.
 const noZone=sharedView({...report,timezone:undefined,hidden:{receipt:['first']}},'Jack').cards[0];
 assert.deepEqual(noZone.fields.map(f=>f.label),['ITEMS KEPT','STORES USED']);
 assert.equal(noZone.first,undefined);
 // Reports from before the proof receipt still share their TOTAL line.
 assert.equal(sharedView({cards:[{type:'receipt',total:'NO FURTHER QUESTIONS',range:null,lines:[{key:'a',label:'TEES',n:4}]}],feedback:[],hidden:{}}).cards[0].total,'NO FURTHER QUESTIONS');
});
