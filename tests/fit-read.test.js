import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {cropFrame,placeStickers,stickerHeight,validReadLine,readFit,READ_CATEGORIES,READ_BANDS,FRAME,readPhoto,askJudges,pickLine,READ_EXAMPLES,READ_PROMPT} from '../lib/fit-read.js';
import {buildReport,sharedView,withReadPhoto,readAfterOutfits,sendReportLink,reportView,READ_ASK,shuffleRead,updateReport,COPY_CARDS} from '../lib/style-report.js';
import {lineVotes,cardLessons,shownLine,promptVersion,RETIRE_PEOPLE} from '../lib/report-copy.js';
import {judgeStyle,judgesFacts,JUDGES_PROMPT} from '../lib/style-judges.js';
import {tagFingerprint} from '../lib/item-tags.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';

const owner='00000000-0000-4000-8000-000000000001';
const photo=async(width=900,height=1200)=>(await sharp({create:{width,height,channels:3,background:'#887766'}}).jpeg().toBuffer()).toString('base64');

test('the crop is 3:4 around the person with 30% room, kept inside the photo, and a tiny person is refused',()=>{
 const crop=cropFrame({x0:400,y0:200,x1:600,y1:900},900,1200);
 assert.equal(crop.height,Math.round(0.7*1200*1.3));assert.equal(crop.width,Math.round(crop.height*3/4));
 assert.ok(crop.left>=0&&crop.top>=0&&crop.left+crop.width<=900&&crop.top+crop.height<=1200,'inside the photo');
 const centre=crop.left+crop.width/2;assert.ok(Math.abs(centre-450)<2,'centred on the person');
 assert.equal(cropFrame({x0:450,y0:400,x1:500,y1:600},900,1200),null,'under a third of the height');
 const edge=cropFrame({x0:0,y0:0,x1:150,y1:1000},900,1200);assert.equal(edge.left,0,'clamped at the edge');
});

test('stickers never cover a callout point or each other',()=>{
 const sets=[
  [{x:172,y:171,text:'sunglasses on a cloudy day, purely for the paparazzi'},{x:206,y:243,text:'the orange strap is holding this whole palette together'},{x:142,y:282,text:'cream harrington: off-duty sailor who has never sailed'}],
  [{x:120,y:120,text:'bucket hat: coastal grandpa, minus the grandkids'},{x:240,y:130,text:'iced coffee posed on a piling'},{x:110,y:230,text:'a tote carrying absolutely nothing, beautifully'},{x:250,y:270,text:'first swim brief ever and you skipped the beginner colours'}]];
 for(const points of sets){
  const placed=placeStickers(points);
  for(const s of placed){
   const h=stickerHeight(s.text);
   assert.ok(s.ly>=FRAME.y&&s.ly+h<=FRAME.y+FRAME.h,'inside the photo band');
   for(const p of points)assert.ok(!(p.x>=s.lx-10&&p.x<=s.lx+118+10&&p.y>=s.ly-10&&p.y<=s.ly+h+10),`sticker "${s.text}" covers a point`);
   for(const o of placed)if(o!==s&&o.lx===s.lx)assert.ok(o.ly>=s.ly+h||s.ly>=o.ly+stickerHeight(o.text),'stickers overlap');
  }
 }
});

test('read lines are checked: no AI phrases, body, money or invented counts; shared copy has no "you"',()=>{
 const counts=[31,4];
 assert.equal(validReadLine('track jacket that has never once seen a track',{counts}),'track jacket that has never once seen a track');
 assert.equal(validReadLine('One of your 300 sleeveless tops.',{counts}),'one of your 300 sleeveless tops','hyperbole over a real count of 10+, full stop dropped');
 assert.equal(validReadLine('one of your 31 sleeveless tops',{counts}),'one of your 31 sleeveless tops');
 assert.equal(validReadLine('your 7th pair of loafers',{counts}),null,'a count they do not have');
 assert.equal(validReadLine('your 120 swim briefs',{counts:[4]}),null,'hyperbole needs a real count of 10+');
 for(const bad of ['the jacket is doing the heavy lifting','sunglasses with intent','abs out for the yacht','a $400 coat','cargo shorts, giving main character vibes','your favourite store again'])
  assert.equal(validReadLine(bad,{counts}),null,bad);
 assert.ok(validReadLine('wide-leg tan chinos, old money on a budget',{counts:[]})===null,'money words still drop');
 assert.ok(validReadLine('wide-leg tan chinos, very old money',{counts:[]}),'clothing words that share a body word are fine');
 assert.equal(validReadLine('one of your 31 sleeveless tops',{counts,shared:true}),null);
 assert.equal(validReadLine('one of Jack’s 31 sleeveless tops',{counts,shared:true}),'one of Jack’s 31 sleeveless tops');
 assert.equal(validReadLine('loafers straight from Arket',{counts:[],names:['Arket']}),null,'a brand that is not visible');
 assert.ok(validReadLine('loafers straight from Arket',{counts:[],names:['Arket'],visible:'Arket loafers'}));
});

// A judges' answer for one 900×1200 photo, coordinates 0–1000.
const answer=(over={})=>({photo_id:'p2',problem:'none',person:{x0:350,y0:150,x1:650,y1:950},face:{x0:450,y0:160,x1:550,y1:260},
 callouts:[
  {item:'cap',kind:'headwear',x:500,y:170,options:[{line:'patch cap: merch from a dive bar you’ve never been to',shared:'patch cap: merch from a dive bar Jack’s never been to'}]},
  {item:'face',kind:'clothing',x:500,y:220,options:[{line:'what a jawline',shared:'what a jawline'}]},
  {item:'track jacket',kind:'clothing',x:520,y:400,options:[{line:'the jacket is doing the heavy lifting',shared:'Jack’s jacket is doing the heavy lifting'},{line:'track jacket that has never once seen a track',shared:'a track jacket that has never once seen a track'}]},
  {item:'jacket again',kind:'clothing',x:522,y:402,options:[{line:'too close to the last one',shared:'too close to the last one'}]},
  {item:'jeans',kind:'clothing',x:480,y:700,options:[{line:'one of your 300 pairs of cream jeans',shared:'one of Jack’s 300 pairs of cream jeans'},{line:'cream jeans in the city and somehow still clean',shared:'cream jeans in the city and somehow still clean'}]}],
 scores:[8,7,9],closer:{line:'clean, sporty and a little smug, and the judges allow it',shared:'clean, sporty and a little smug, and the judges allow it'},...over});
const allOk=async({context})=>({results:context.lines.map(l=>({id:l.id,ok:true}))});

test('a read keeps lines off the face, apart and checked, and scores three drawn categories (the verdict is the judges card’s)',async()=>{
 const photos=[{id:'p1',data:await photo()},{id:'p2',data:await photo()}];
 let asked=null;
 // The second check rejects the first jeans option, so the second option is used.
 const check=async({context})=>({results:context.lines.map(l=>({id:l.id,ok:l.line!=='one of your 300 pairs of cream jeans'}))});
 const result=await readFit({photos,facts:[{item:'cream jeans',n:12}],name:'Jack',interpret:check,env:{},judges:async input=>{asked=input;return answer();}});
 assert.equal(result.status,'built');
 const card=result.card;
 assert.equal(card.source_id,'p2');assert.deepEqual(asked.photos.map(p=>p.id),['p1','p2']);
 assert.deepEqual(card.callouts.map(c=>c.text),['patch cap: merch from a dive bar you’ve never been to','track jacket that has never once seen a track','cream jeans in the city and somehow still clean'],
  'the cap (headwear) may sit on the head; the face callout, the AI phrase, the crowded point and the rejected option are dropped');
 assert.ok(card.callouts.every(c=>c.shared&&!/\byou/.test(c.shared)));
 assert.equal(card.scores.length,3);assert.ok(card.scores.every(s=>READ_CATEGORIES.includes(s.label)));
 assert.deepEqual(asked.categories,card.scores.map(s=>s.label),'the judges score the categories code drew');
 assert.equal(card.band,'strong');assert.equal(card.verdict,undefined,'the judges’ verdict is on their own card');
 assert.equal(card.closer,'clean, sporty and a little smug, and the judges allow it');assert.equal(card.written,true);
 for(const c of card.callouts){assert.ok(c.x>=FRAME.x&&c.x<=FRAME.x+FRAME.w&&c.y>=FRAME.y&&c.y<=FRAME.y+FRAME.h);assert.ok([12,230].includes(c.lx));}
});

test('a photo that cannot be read asks again, a bad closer falls back to the bank, and nothing shows without the check',async()=>{
 const photos=[{id:'p2',data:await photo()}];
 assert.deepEqual(await readFit({photos,interpret:allOk,env:{},judges:async()=>answer({photo_id:null,problem:'several_people'})}),{status:'unusable',problem:'several_people'});
 assert.deepEqual(await readFit({photos,interpret:allOk,env:{},judges:async()=>answer({person:{x0:450,y0:400,x1:500,y1:600}})}),{status:'unusable',problem:'too_small'});
 const fallback=await readFit({photos,name:'Jack',interpret:allOk,env:{},judges:async()=>answer({scores:[3,2,4],closer:{line:'the vibes are elevated',shared:'the vibes are elevated'}})});
 const band=READ_BANDS.find(b=>b.band==='disaster');
 assert.equal(fallback.card.written,false);assert.ok(band.closers.some(c=>c[0]===fallback.card.closer));
 assert.ok(!/\byou/.test(fallback.card.closer_shared));
 await assert.rejects(readFit({photos,interpret:async()=>{throw Error('down');},env:{},judges:async()=>answer()}),/check failed/);
});

test('the photo is served cropped to the card frame',async()=>{
 const data=await photo(),store={styleSource:async()=>({id:'p2',data})};
 const url=await readPhoto(store,owner,{source_id:'p2',crop:{left:100,top:50,width:600,height:800}});
 const out=await sharp(Buffer.from(url.split(',')[1],'base64')).metadata();
 assert.deepEqual([out.width,out.height],[632,840]);
 assert.equal(await readPhoto(store,owner,{source_id:'p2',crop:{left:500,top:50,width:600,height:800}}),null,'a crop outside the photo is refused');
});

// A small history and a store with outfit photos, for the report and texting paths.
let seq=0;
const buy=values=>purchaseEvidence({event_id:`m${++seq}:0`,kind:'purchased',source_id:`m${seq}`,at:Date.UTC(2025,1,seq),evidence:'line',category:'clothing',
 values:{merchant:'Shop',order_reference:'O'+seq,sku:null,brand:null,color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+seq,recipient:{value:'self',quote:'Ship to Jack'}});
async function fixture({photos=[]}={}){
 const rows=[...Array.from({length:6},(_,k)=>buy({product:'Muscle Crop Top '+k,merchant:'John Elliott'})),...Array.from({length:4},(_,k)=>buy({product:'Overshirt '+k,merchant:'SSENSE',brand:'Our Legacy'}))];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),...(/Crop/.test(i.product)?{item_type:'muscle half crop top',group:'tops',color_family:'black'}:{item_type:'overshirt',group:'shirts',color_family:'black'})}]));
 let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',data:{job:{status:'ready'},sources:[],questions:[],item_tags:tags}},busy=false;
 const sources=[];for(const id of photos)sources.push({id,kind:'outfit',mime_type:'image/jpeg',data:await photo()});
 const ops=new Map(),sent=[];
 return {get row(){return row;},sources,ops,sent,
  gmailImport:async()=>structuredClone(row),evidence:async()=>structuredClone(rows),signupFirstName:async()=>'Jack',
  reportByShareToken:async token=>row.data.style_report?.share?.token===token?{conversation_id:owner,report:structuredClone(row.data.style_report)}:null,
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async(o,revision,data,token)=>{if(revision!==row.revision)return false;busy=false;row={...row,data:structuredClone(data),token_ciphertext:token};return true;},
  styleSources:async()=>sources.map(({data,...s})=>s),styleSource:async(o,id)=>sources.find(s=>s.id===id)??null,
  conversation:async()=>({id:owner,line:'+15550000000',sender_id:'+15551111111'}),createSignInLink:async()=>'tok',
  reserve:async(c,operation,body)=>{if(ops.has(operation))return false;ops.set(operation,{conversation_id:owner,status:'reserved',body});return true;},
  operation:async op=>ops.get(op)??null,finish:async(op,status)=>{ops.get(op).status=status;},prepareAI:async()=>{}};
}
const writer=async request=>request.schema.properties?.results?allOk(request):request.schema.properties?.scores?{scores:[8,8,9]}:request.schema.properties?.line?{line:'you got to Our Legacy early',shared:'Jack got to Our Legacy early'}:{total:'one colour and a crop top habit'};
const env={STYLE_ENABLED:'true',SITE_ORIGIN:'https://jules.example'};
const judges=async()=>answer({photo_id:'o2'});

test('the report reads the newest outfit photo, keeps the read across rebuilds, and locks the card without a photo',async()=>{
 const none=await fixture();
 await buildReport(none,owner,env,{interpret:writer});
 const lock=none.row.data.style_report.cards.find(c=>c.type==='locked'&&c.card==='read');
 assert.ok(lock,'no photo: a locked Read card invites one');assert.match(lock.why,/photo/);
 const store=await fixture({photos:['o1','o2']});
 const {buildRead}=await import('../lib/style-report.js');
 const built=await buildRead(store,owner,env,{interpret:writer,judges});
 assert.equal(built.status,'built');assert.equal(built.card.source_id,'o2');
 // buildReport reads through the same path; a rebuild keeps the card while its photo is still there.
 store.row.data.style_report={cards:[built.card],feedback:[],hidden:{}};
 await buildReport(store,owner,env,{interpret:writer});
 const cards=store.row.data.style_report.cards;
 assert.equal(cards.find(c=>c.type==='read').source_id,'o2');
 assert.ok(!cards.some(c=>c.type==='locked'&&c.card==='read'));
 const at=cards.findIndex(c=>c.type==='read'),spectrumAt=cards.findIndex(c=>c.type==='spectrum');
 if(spectrumAt>=0)assert.ok(at<spectrumAt,'the read comes before the closing Spectrum card');
 const last=cards.at(-1);
 assert.equal(last.type,'judges','the judges close the report');assert.ok(at<cards.indexOf(last));
 assert.ok(store.row.data.style_report.read_seen.includes(last.verdict),'their verdict is remembered so the next build differs');
});

test('a rebuild reads the photo again when the kept read is from the four-judge format',async()=>{
 const store=await fixture({photos:['o1','o2']});
 const {buildRead}=await import('../lib/style-report.js');
 const {card}=await buildRead(store,owner,env,{interpret:writer,judges});
 const old={...card,scores:[...card.scores,{label:'Drip',n:8}]};
 store.row.data.style_report={cards:[old],feedback:[],hidden:{}};
 let asked=0;
 await buildReport(store,owner,env,{interpret:writer,judges:async(...args)=>{asked++;return judges(...args);}});
 const read=store.row.data.style_report.cards.find(c=>c.type==='read');
 assert.equal(asked,1,'the old card was read again');
 assert.equal(read.scores.length,3);
});

test('a failed re-read keeps the earlier read, and with none to keep the locked card says to try again',async()=>{
 const store=await fixture({photos:['o1','o2']});
 const {buildRead}=await import('../lib/style-report.js');
 const {card}=await buildRead(store,owner,env,{interpret:writer,judges});
 const failing=async()=>{throw Error('Read request failed');};
 // An old-format read is re-read; when that fails the old card stays rather than vanishing.
 const old={...card,scores:[...card.scores,{label:'Drip',n:8}]};
 store.row.data.style_report={cards:[old],feedback:[],hidden:{}};
 await buildReport(store,owner,env,{interpret:writer,judges:failing});
 let cards=store.row.data.style_report.cards;
 assert.equal(cards.find(c=>c.type==='read')?.scores.length,4,'the earlier read is kept');
 assert.ok(!cards.some(c=>c.type==='locked'&&c.card==='read'));
 // No earlier read to keep: a locked card, not a missing one.
 store.row.data.style_report={cards:[],feedback:[],hidden:{}};
 await buildReport(store,owner,env,{interpret:writer,judges:failing});
 cards=store.row.data.style_report.cards;
 assert.ok(!cards.some(c=>c.type==='read'));
 const lock=cards.find(c=>c.type==='locked'&&c.card==='read');
 assert.ok(lock,'the Read is locked, not dropped');assert.match(lock.why,/again/);
 // The next build tries again and the read appears.
 await buildReport(store,owner,env,{interpret:writer,judges});
 assert.equal(store.row.data.style_report.cards.find(c=>c.type==='read')?.scores.length,3);
});

test('a shared read shows the photo and third-person lines only, and drops the card if the photo is gone',async()=>{
 const store=await fixture({photos:['o2']});
 const {buildRead}=await import('../lib/style-report.js');
 const {card}=await buildRead(store,owner,env,{interpret:writer,judges});
 const report={id:'r',built_at:'2026-10-16T00:00:00Z',cards:[card],feedback:[],hidden:{},share:{token:'a'.repeat(22)}};
 const view=await withReadPhoto(sharedView(report,'Jack'),report,store,owner);
 const shared=view.cards.find(c=>c.type==='read');
 assert.match(shared.photo,/^data:image\/jpeg;base64,/);
 assert.ok(shared.callouts.every(c=>!/\byou/.test(c.text)));assert.ok(!/\byou/.test(shared.closer));
 for(const secret of ['source_id','crop','written','band'])assert.ok(!(secret in shared),secret);
 report.feedback.push({card:'read',vote:'down',reason:'wont_share'});
 assert.ok(!sharedView(report,'Jack').cards.some(c=>c.type==='read'),'“Wouldn’t share” takes it out of the link');
 store.sources.length=0;
 const gone=await withReadPhoto(reportView(report,'Jack'),report,store,owner);
 assert.ok(!gone.cards.some(c=>c.type==='read'),'no photo, no card');
});

test('texted outfit photos are read into the report and Jules texts the link once; an unreadable one gets an ask-again',async()=>{
 const store=await fixture({photos:['o1','o2']});
 await buildReport(store,owner,{SITE_ORIGIN:'https://jules.example'},{interpret:writer});
 const texts=[],send=async(target,body)=>{texts.push(body);return {id:'x'};};
 const {buildRead}=await import('../lib/style-report.js');
 const build=(s,o,e,options)=>buildRead(s,o,e,{...options,interpret:writer,judges});
 await readAfterOutfits(store,owner,env,{photoIds:['o2'],send,build});
 const cards=store.row.data.style_report.cards;
 assert.equal(cards.find(c=>c.type==='read').source_id,'o2');
 assert.match(texts[0],/judges have read your fit.*\/report#signin=tok/);
 await readAfterOutfits(store,owner,env,{photoIds:['o2'],send,build});
 assert.equal(texts.length,1,'the same photo is not texted about twice');
 const unusable=(s,o,e,options)=>buildRead(s,o,e,{...options,interpret:writer,judges:async()=>answer({photo_id:null,problem:'several_people'})});
 await readAfterOutfits(store,owner,env,{photoIds:['o1'],send,build:unusable});
 assert.match(texts[1],/just you/);
 assert.equal(store.row.data.style_report.cards.find(c=>c.type==='read').source_id,'o2','an unreadable photo keeps the earlier read');
 assert.equal(await readAfterOutfits(await fixture({photos:['o1']}),owner,env,{photoIds:['o1'],send,build}),null,'no report yet: the profile flow handles the photos');
});

test('sending the report link also asks for a fit photo once, while the Read is still locked',async()=>{
 const store=await fixture();
 await buildReport(store,owner,env,{interpret:writer});
 const texts=[],send=async(target,body)=>{texts.push(body);return {id:'x'};};
 await sendReportLink(store,owner,env,send);
 assert.equal(texts.length,2);assert.equal(texts[1],READ_ASK);
 await sendReportLink(store,owner,env,send);
 assert.equal(texts.length,2,'asked once');
});

// The Read in the thumbs loop (COPY_CARDS.read, lib/report-copy.js): each callout, the closer and the
// verdict is logged as its own line; votes on callouts and closers teach READ_PROMPT, and votes on the
// pre-written verdicts and closers weight and retire the bank.
test('every Read line is logged on its own: callouts and a written closer as generated; the judges’ verdict as pre-written on their card',async()=>{
 const store=await fixture({photos:['o2']});
 const {buildRead}=await import('../lib/style-report.js');
 store.row.data.style_report={cards:[(await buildRead(store,owner,env,{interpret:writer,judges})).card],feedback:[],hidden:{}};
 await buildReport(store,owner,env,{interpret:writer});
 const report=store.row.data.style_report,card=report.cards.find(c=>c.type==='read');
 const lines=report.copy_log.filter(l=>l.card==='read'&&l.report_id===report.id);
 assert.deepEqual(lines.map(l=>l.slot),[...card.callouts.map((c,k)=>`callout${k+1}`),'closer']);
 assert.deepEqual(lines.map(l=>l.source),[...card.callouts.map(()=>'generated'),'generated']);
 assert.deepEqual(lines.slice(0,card.callouts.length).map(l=>l.fact),card.callouts.map(c=>c.item),'a callout states the item it reads');
 assert.match(lines.at(-1).fact,/^strong fit, scored \w/);
 assert.ok(lines.every(l=>l.prompt===promptVersion(READ_PROMPT)));
 // The judges' verdict is its own card's one line; 👎 on it counts against it alone.
 const panel=report.cards.find(c=>c.type==='judges'),[verdict]=report.copy_log.filter(l=>l.card==='judges'&&l.report_id===report.id);
 assert.equal(verdict.slot,'verdict');assert.equal(verdict.source,'prewritten');assert.equal(verdict.text,panel.verdict);
 assert.match(verdict.fact,/^\w+ style, scored \w/);assert.equal(verdict.prompt,promptVersion(JUDGES_PROMPT));
 assert.deepEqual(reportView(report).copy.read.map(l=>l.text),lines.map(l=>l.text));
 await updateReport(store,owner,{action:'report-feedback',card:'judges',vote:'down',reason:'not_funny',lines:[verdict.id]});
 const after=store.row.data.style_report,votes=lineVotes([{conversation_id:owner,copy:after.copy_log,feedback:after.feedback}]);
 assert.equal([...votes.values()].find(a=>a.text===verdict.text).downs,1);
 assert.ok([...votes.values()].filter(a=>a.card==='read').every(a=>a.downs===0));
 // A fallback closer is logged as pre-written.
 const fallback=COPY_CARDS.read.lines({...card,closer:'great idea, wrong decade',written:false,closer_source:undefined});
 assert.equal(fallback.find(l=>l.slot==='closer').source,'prewritten');
});

// Read lines shown to several people, and their votes, as the store returns them.
const AT='2026-10-16T10:00:00.000Z';
function readRows(shown,votes){
 return Object.entries(votes).map(([person,v])=>{
  const copy=shown.map(([slot,text,source])=>shownLine({report_id:'r-'+person,card:'read',slot,text,source,fact:slot.startsWith('callout')?'track jacket':'strong fit',check:{counts:[]},at:AT}));
  const named=(v.lines??[]).map(t=>copy.find(l=>l.text===t).id);
  return {conversation_id:person,copy,feedback:[{report_id:'r-'+person,card:'read',vote:v.vote,at:AT,...(named.length?{lines:named}:{})}]};
 });
}
const lessonsFor=(rows,person=null)=>cardLessons(lineVotes(rows),'read',{person,recheck:COPY_CARDS.read.recheck,teaches:COPY_CARDS.read.teaches});
const askWith=async lessons=>{
 let instructions=null;
 await askJudges({photos:[],categories:['Rizz','Nerve','Class','Aura'],facts:[],name:'Jack',lessons},{OPENAI_API_KEY:'test'},async(url,init)=>{instructions=JSON.parse(init.body).instructions;
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{}'}]}]})};});
 return instructions;
};

test('liked callouts and closers join READ_PROMPT after the ★ examples, misses go in as "don’t write like this", verdicts never do',async()=>{
 const shown=[['callout1','track jacket that has never once seen a track','generated'],['callout2','the jacket is doing the heavy lifting','generated'],
  ['closer','great idea, wrong decade','prewritten'],['verdict','Strong showing','prewritten']];
 const liked=readRows(shown,{a:{vote:'up'},b:{vote:'up'}});
 const prompt=await askWith(lessonsFor(liked));
 assert.ok(prompt.startsWith(READ_PROMPT),'the base prompt, with every founder example, always comes first');
 for(const line of READ_EXAMPLES)assert.ok(prompt.includes(line),line);
 assert.match(prompt,/Lines people liked on this card[^]*"track jacket" → "track jacket that has never once seen a track"/);
 assert.match(prompt,/Lines people liked[^]*"great idea, wrong decade"/,'a liked pre-written closer teaches the model’s closer');
 assert.ok(!prompt.slice(READ_PROMPT.length).includes('heavy lifting'),'a liked line that fails the Read checks is left out');
 assert.ok(!prompt.includes('Strong showing'),'verdicts are never the model’s to write');
 // A third person names the closer and the verdict as misses.
 const missed=[...liked,...readRows(shown,{c:{vote:'down',lines:['great idea, wrong decade','Strong showing']}})];
 const after=await askWith(lessonsFor(missed));
 assert.match(after,/Don't write like this:\n- "strong fit" → "great idea, wrong decade"/);
 assert.ok(!/Lines people liked[^]*great idea/.test(after.split("Don't write like this")[0]),'a missed line is no longer an example');
 assert.ok(!after.includes('Strong showing'));
 for(const line of READ_EXAMPLES)assert.ok(after.includes(line));
 // Without votes the prompt is the base prompt, unchanged.
 assert.equal(await askWith(lessonsFor([])),READ_PROMPT);
});

test('a callout the person voted down is never shown to them again, and the judges get the lessons',async()=>{
 const cap='patch cap: merch from a dive bar you’ve never been to';
 const lessons=lessonsFor(readRows([['callout1',cap,'generated']],{c:{vote:'down',lines:[cap]}}),'c');
 let asked=null;
 const result=await readFit({photos:[{id:'p2',data:await photo()}],facts:[{item:'cream jeans',n:12}],name:'Jack',lessons,interpret:allOk,env:{},judges:async input=>{asked=input;return answer();}});
 assert.equal(asked.lessons,lessons);
 assert.ok(!result.card.callouts.some(c=>c.text===cap));
 assert.equal(result.card.callouts.length,2);
});

const strong=READ_BANDS.find(b=>b.band==='strong'),draw=(list,lessons,seen=[])=>Array.from({length:200},(_,k)=>pickLine(list,'verdict:p'+k,seen,'Jack',lessons)?.line);
test('pre-written verdicts and closers are weighted by votes and retired when people keep voting them down',()=>{
 const base=draw(strong.verdicts,lessonsFor([]));
 assert.ok(strong.verdicts.every(v=>base.includes(v)),'without votes every verdict can come up');
 // 👍 from several people: drawn much more often.
 const ups=Object.fromEntries(['a','b','c','d','e','f','g'].map(p=>[p,{vote:'up'}]));
 const liked=draw(strong.verdicts,lessonsFor(readRows([['verdict','Solid eights','prewritten']],ups)));
 assert.ok(liked.filter(v=>v==='Solid eights').length>base.filter(v=>v==='Solid eights').length*2,'a liked verdict is drawn more often');
 // Named 👎 from RETIRE_PEOPLE people, more 👎 than 👍: retired for everyone.
 const downs=text=>Object.fromEntries(Array.from({length:RETIRE_PEOPLE},(_,k)=>['p'+k,{vote:'down',lines:[text]}]));
 const retired=draw(strong.verdicts,lessonsFor([...readRows([['verdict','Minor notes','prewritten']],downs('Minor notes')),...readRows([['verdict','Minor notes','prewritten']],{u:{vote:'up'}})],'someone-else'));
 assert.ok(!retired.includes('Minor notes'));
 // One person's 👎 doesn't retire it for others, but that person never gets it again.
 const one=readRows([['verdict','Minor notes','prewritten']],{a:{vote:'down',lines:['Minor notes']}});
 assert.ok(draw(strong.verdicts,lessonsFor(one,'b')).includes('Minor notes'));
 assert.ok(!draw(strong.verdicts,lessonsFor(one,'a')).includes('Minor notes'));
 // Closers learn the same way.
 const closer=strong.closers[0][0];
 assert.ok(!draw(strong.closers,lessonsFor(readRows([['closer',closer,'prewritten']],downs(closer)))).includes(closer));
});

test('when the whole bank is retired, the card states the score plainly and logs it as a fact',async()=>{
 const shown=[...strong.verdicts.map(v=>['verdict',v,'prewritten']),...strong.closers.map(([c])=>['closer',c,'prewritten'])];
 const all=shown.map(([,t])=>t),downs=Object.fromEntries(Array.from({length:RETIRE_PEOPLE},(_,k)=>['p'+k,{vote:'down',lines:all}]));
 const lessons=lessonsFor(readRows(shown,downs));
 const {card}=await readFit({photos:[{id:'p2',data:await photo()}],facts:[{item:'cream jeans',n:12}],name:'Jack',lessons,interpret:allOk,env:{},
  judges:async()=>answer({closer:{line:'the vibes are elevated',shared:'the vibes are elevated'}})});
 assert.equal(card.band,'strong');
 assert.equal(card.closer,'three judges, 8 on average');
 assert.equal(COPY_CARDS.read.lines(card).find(l=>l.slot==='closer').source,'fact');
 // The judges card draws its verdict from the same bank, as its own card: retired there, it says the average.
 const verdictDowns=Object.fromEntries(Object.keys(downs).map(p=>[p,{vote:'down',lines:strong.verdicts}]));
 const judged=readRows(strong.verdicts.map(v=>['verdict',v,'prewritten']),verdictDowns).map(r=>({...r,copy:r.copy.map(l=>({...l,card:'judges'})),feedback:r.feedback.map(f=>({...f,card:'judges'}))}));
 const panel=await judgeStyle({purchases:['tops: 6']},{interpret:async()=>({scores:[8,8,8]}),seed:owner,
  lessons:cardLessons(lineVotes(judged),'judges',{teaches:COPY_CARDS.judges.teaches})});
 assert.equal(panel.verdict,'Averaged 8');assert.equal(COPY_CARDS.judges.lines(panel)[0].source,'fact');
});

test('only one callout leans on a purchase count; the others take an option about the photo',async()=>{
 const photos=[{id:'p2',data:await photo()}];
 const counts=answer({callouts:[
  {item:'shirt',kind:'clothing',x:500,y:350,options:[{line:'one of your 12 shirts, picnic blanket with buttons',shared:'one of Jack’s 12 shirts, picnic blanket with buttons'}]},
  {item:'shorts',kind:'clothing',x:500,y:600,options:[{line:'one of your 12 shorts, tennis club without the tennis',shared:'one of Jack’s 12 shorts, tennis club without the tennis'},{line:'shorts for a tennis club without the tennis',shared:'shorts for a tennis club without the tennis'}]},
  {item:'socks',kind:'clothing',x:480,y:880,options:[{line:'one of your 12 pairs of ribbed socks, gym class deluxe',shared:'one of Jack’s 12 pairs of ribbed socks, gym class deluxe'}]}]});
 const {card}=await readFit({photos,facts:[{item:'shirts',n:12}],name:'Jack',interpret:allOk,env:{},judges:async()=>counts});
 assert.deepEqual(card.callouts.map(c=>c.text),['one of your 12 shirts, picnic blanket with buttons','shorts for a tennis club without the tennis','one of your 12 pairs of ribbed socks, gym class deluxe'],
  'a later point with only a count option keeps it rather than losing the callout');
});

test('“Try another photo” reads the next outfit photo, skips one that can’t be read, and keeps the read when none can',async()=>{
 const store=await fixture({photos:['o1','o2','o3']});
 const {buildRead}=await import('../lib/style-report.js');
 const asked=[];
 const reading=(ok)=>(s,o,e,options)=>{asked.push(options.photoIds[0]);return buildRead(s,o,e,{...options,interpret:writer,judges:async()=>ok(options.photoIds[0])?answer({photo_id:options.photoIds[0]}):answer({photo_id:null,problem:'several_people'})});};
 await buildReport(store,owner,{SITE_ORIGIN:'https://jules.example'},{interpret:writer});
 await readAfterOutfits(store,owner,env,{photoIds:['o3'],send:async()=>({id:'x'}),build:reading(()=>true)});
 const read=()=>store.row.data.style_report.cards.find(c=>c.type==='read');
 const first=read().source_id;asked.length=0;
 // Newest first, wrapping round: from o3 the next is o2; o2 can't be read, so o1.
 await shuffleRead(store,owner,env,{build:reading(id=>id!=='o2')});
 assert.equal(first,'o3');assert.deepEqual(asked,['o2','o1']);assert.equal(read().source_id,'o1');
 assert.equal(store.row.data.style_report.cards.filter(c=>c.type==='read').length,1,'one Read card');
 await assert.rejects(shuffleRead(store,owner,env,{build:reading(()=>false)}),e=>e.status===422);
 assert.equal(read().source_id,'o1','the current read stays when nothing else can be read');
 const one=await fixture({photos:['o1']});
 await assert.rejects(shuffleRead(one,owner,env),e=>e.status===409);
});

// The judges (lib/style-judges.js): the report's last card scores the person's style as a whole from
// the facts the other cards counted, never a photo, and never sees private lines.
test('the judges score the whole report from its counted facts, close the deck, and share in the third person',async()=>{
 const facts=judgesFacts({receipt:{lines:[{label:'TOPS',n:6},{label:'RETURNS',n:3,private:true}]},gate:{eligible:false},
  then:{eligible:true,then:2023,now:2025,in:[{fact:'Arket: new',private:false},{fact:'sent back 40%',private:true}],out:[]}});
 assert.deepEqual(facts.purchases,['TOPS: 6']);assert.deepEqual(facts.changes.in,['Arket: new']);
 assert.ok(!JSON.stringify(facts).includes('sent back')&&!JSON.stringify(facts).includes('RETURNS'),'private lines stay out');
 let asked=null;
 const card=await judgeStyle(facts,{interpret:async r=>{asked=r;return {scores:[9,10,10]};},seed:owner,name:'Jack'});
 assert.equal(asked.instructions,JUDGES_PROMPT);assert.deepEqual(asked.context.categories,card.scores.map(s=>s.label));
 assert.ok(!('photos' in asked.context),'no photo');
 assert.equal(card.band,'perfect');assert.ok(READ_BANDS.find(b=>b.band==='perfect').verdicts.flat().includes(card.verdict));
 assert.equal(await judgeStyle(facts,{interpret:async()=>({scores:[9,11]}),seed:owner}),null,'bad scores: no card');
 assert.equal(await judgeStyle(facts,{interpret:async()=>{throw Error('down');},seed:owner}),null);
 // In a built report they're last, even after locked cards, and a friend sees the third-person verdict.
 const store=await fixture();
 await buildReport(store,owner,env,{interpret:writer});
 const report=store.row.data.style_report;
 assert.equal(report.cards.at(-1).type,'judges');
 const shared=sharedView(report,'Jack').cards.find(c=>c.type==='judges');
 assert.deepEqual(Object.keys(shared).sort(),['scores','type','verdict']);assert.ok(!/\byou\b/i.test(shared.verdict));
});
