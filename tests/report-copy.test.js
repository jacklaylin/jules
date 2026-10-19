import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport,updateReport,reportView,FALLBACK_FINE,validEmojiCaption,writeEmojiCaptions,writeGateLine,gateFallback,plainGateLine,COPY_CARDS} from '../lib/style-report.js';
import {lineVotes,cardLessons,teach,allows,copyWeek,shownLine,lineKey,promptVersion,EXAMPLES_MAX,MISSES_MAX,NO_LESSONS} from '../lib/report-copy.js';
import {createAdminHandler} from '../api/admin.js';
import {JUDGES_PROMPT} from '../lib/style-judges.js';
import {tagFingerprint} from '../lib/item-tags.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';

// The jokes learning loop (lib/report-copy.js): votes from several people change what each card's
// writer sees on the next build, and a person never sees a line they voted down again.
const people=['a','b','c'].map((x,k)=>`00000000-0000-4000-8000-00000000000${k+1}`);
const [A,B,C]=people;
function historyFor(owner){
 let seq=0;
 const buy=(values,at)=>[purchaseEvidence({event_id:`m${++seq}:0`,kind:'purchased',source_id:`m${seq}`,at,evidence:'line',category:'clothing',
  values:{merchant:'Shop',order_reference:'O'+seq,sku:null,brand:null,color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+seq,recipient:{value:'self',quote:'Ship to me'}})];
 const rows=[
  ...Array.from({length:6},(_,k)=>buy({product:'Muscle Crop Top '+k,merchant:'John Elliott',order_reference:'JE'+k},Date.UTC(2025,k,1))).flat(),
  ...Array.from({length:4},(_,k)=>buy({product:'Overshirt '+k,merchant:'SSENSE',brand:'Our Legacy',order_reference:'SS'+k},Date.UTC(2023,k,1))).flat(),
 ];
 const state=projectReceiptEvidence(owner,rows).state;
 const tags=Object.fromEntries(state.items.map(i=>[i.id,{fp:tagFingerprint(i),...(/Crop/.test(i.product)?{item_type:'muscle half crop top',group:'tops',color_family:'black',resale:false}:{item_type:'overshirt',group:'shirts',color_family:'black',resale:false})}]));
 return {rows,tags};
}
// Three testers sharing one database, like production: each build can read everyone's votes.
function world(){
 const rows=new Map(),evidence=new Map(),busy=new Set();
 for(const p of people){const h=historyFor(p);evidence.set(p,h.rows);rows.set(p,{conversation_id:p,revision:1,token_ciphertext:'sealed',data:{job:{status:'ready'},sources:[],questions:[],item_tags:h.tags}});}
 return {rows,
  gmailImport:async p=>structuredClone(rows.get(p)),evidence:async p=>structuredClone(evidence.get(p)),signupFirstName:async()=>null,
  claimGmailImport:async p=>{if(busy.has(p))return null;busy.add(p);rows.get(p).revision++;return structuredClone(rows.get(p));},
  finishGmailImport:async(p,revision,data,token)=>{if(revision!==rows.get(p).revision)return false;busy.delete(p);rows.set(p,{...rows.get(p),data:structuredClone(data),token_ciphertext:token});return true;},
  reportCopyRows:async()=>[...rows.values()].map(r=>({conversation_id:r.conversation_id,copy:r.data.style_report?.copy_log??null,feedback:r.data.style_report?.feedback??null}))};
}
// A writer that always offers the same total and remembers the instructions it was given (last: the
// latest writer's, not the judges', who only score).
function writer(total='one colour and a crop top habit'){
 const seen=[];
 const fn=async request=>{seen.push(request.instructions);return {names:[],fine:total};};
 fn.seen=seen;fn.last=()=>seen.filter(s=>s!==JUDGES_PROMPT).at(-1);return fn;
}
const report=(store,p)=>store.rows.get(p).data.style_report;
const vote=(store,p,input)=>updateReport(store,p,{action:'report-feedback',card:'receipt',...input});

test('every shown line is logged with its card, fact, source and prompt version, and the log survives rebuilds',async()=>{
 const store=world(),w=writer();
 await buildReport(store,A,{},{interpret:w});
 const first=report(store,A),line=first.copy_log.find(l=>l.card==='receipt');
 assert.equal(line.text,'ONE COLOUR AND A CROP TOP HABIT');
 assert.equal(line.source,'generated');assert.equal(line.slot,'fine');assert.equal(line.report_id,first.id);
 assert.equal(line.prompt,promptVersion(COPY_CARDS.receipt.prompt));
 assert.match(line.fact,/MUSCLE HALF CROP TOPS ×6/);
 assert.ok(line.names.includes('John Elliott'),'names on the card are kept so they cannot leak into someone else’s line');
 await buildReport(store,A,{},{interpret:async()=>({names:[],fine:'your favourite store'})});
 const second=report(store,A);
 assert.equal(second.copy_log.length,first.copy_log.length*2,'earlier lines stay, so old votes still land');
 assert.equal(second.copy_log.at(-1).source,'prewritten');assert.equal(second.copy_log.at(-1).text,FALLBACK_FINE);
 // The page gets this build's lines for "which one missed?", and a rebuilt card starts unvoted.
 const view=reportView(second);
 assert.deepEqual(view.copy.receipt.map(l=>l.text),[FALLBACK_FINE]);
 assert.equal(view.votes.receipt,null);
});

test('one 👍 puts a line in the writer prompt on the next build; a 👎 swaps it to "don’t write like this"',async()=>{
 const store=world(),w=writer();
 for(const p of people)await buildReport(store,p,{},{interpret:w});
 assert.ok(!w.last().includes('Lines people liked'),'nothing learned yet');
 await vote(store,A,{vote:'up'});
 await buildReport(store,C,{},{interpret:w});
 assert.match(w.last(),/Lines people liked on this card[^]*"ONE COLOUR AND A CROP TOP HABIT"/);
 assert.match(w.last(),/never reuse their facts/);
 // C votes the same line down on their latest report: it can't be an example any more, and it's a miss.
 await vote(store,C,{vote:'down',reason:'not_funny'});
 await buildReport(store,A,{},{interpret:w});
 assert.ok(!w.last().includes('Lines people liked'));
 assert.match(w.last(),/Don't write like this:\n- "[^"]*" → "ONE COLOUR AND A CROP TOP HABIT"/);
 assert.equal(report(store,A).cards[0].fine,'ONE COLOUR AND A CROP TOP HABIT','A never voted it down, so A can still get it');
});

test('a person never sees a line they voted down again, including the pre-written one',async()=>{
 const store=world(),w=writer();
 await buildReport(store,C,{},{interpret:w});
 await vote(store,C,{vote:'down',reason:'not_funny'});
 await buildReport(store,C,{},{interpret:w});
 assert.equal(report(store,C).cards[0].fine,FALLBACK_FINE,'the writer offered the same line twice; both were refused');
 await vote(store,C,{vote:'down',reason:'not_funny'});
 await buildReport(store,C,{},{interpret:w});
 assert.equal(report(store,C).cards[0].fine,null,'no fine print rather than a line they turned down');
});

test('👎 can name the lines that missed; unnamed it counts half, spread across the card',()=>{
 const at='2026-10-16T10:00:00.000Z';
 const caption=(person,emoji,text,fact)=>shownLine({report_id:'r-'+person,card:'emoji',slot:emoji,text,fact:`${emoji} ${fact}`,source:'generated',check:{fact},at});
 const lines=p=>[caption(p,'🖤','82% black and still shopping for black','82% black'),caption(p,'👟','6 pairs of sneakers, one pair of feet','6 pairs of sneakers'),
  caption(p,'🧥','5 coats and jackets for one winter','5 coats and jackets'),caption(p,'🧶','7 knits and a sweater drawer that won’t close','7 knits')];
 const [la,lb]=[lines(A),lines(B)];
 const rows=[{conversation_id:A,copy:la,feedback:[{card:'emoji',vote:'down',reason:'not_funny',lines:[la[1].id],report_id:'r-'+A,at}]},
  {conversation_id:B,copy:lb,feedback:[{card:'emoji',vote:'down',reason:'not_funny',report_id:'r-'+B,at}]}];
 const votes=lineVotes(rows),get=text=>votes.get(lineKey('emoji',text));
 assert.equal(get('6 pairs of sneakers, one pair of feet').downs,1+0.125,'named by A, plus B’s spread share');
 assert.equal(get('82% black and still shopping for black').downs,0.125);
 const forA=cardLessons(votes,'emoji',{person:A,recheck:COPY_CARDS.emoji.recheck});
 assert.deepEqual(forA.misses.map(m=>m.text),['6 pairs of sneakers, one pair of feet'],'a spread share alone is not a miss');
 assert.ok(forA.avoid.has(lineKey('emoji','6 pairs of sneakers, one pair of feet'))&&!forA.avoid.has(lineKey('emoji','7 knits and a sweater drawer that won’t close')),'A only avoids the line A named');
 const forB=cardLessons(votes,'emoji',{person:B,recheck:COPY_CARDS.emoji.recheck});
 assert.equal(forB.avoid.size,4,'B voted the whole card down, so B sees none of its lines again');
 assert.equal(forB.examples.length,0);
});

test('learned lines must still pass their card’s validator, and the banks are capped with the newest kept',()=>{
 const rows=[];
 for(let k=0;k<EXAMPLES_MAX+5;k++){
  const at=new Date(Date.UTC(2026,9,1,k)).toISOString(),fact=`${k+3} knits`;
  for(const p of [A,B]){const line=shownLine({report_id:`r${k}-${p}`,card:'emoji',slot:'🧶',text:`${k+3} knits, one busy drawer`,fact:`🧶 ${fact}`,source:'generated',check:{fact},at});
   rows.push({conversation_id:p,copy:[line],feedback:[{card:'emoji',vote:'up',report_id:line.report_id,at}]});}
 }
 // A liked line whose number no longer matches its fact fails validEmojiCaption and is left out.
 const bad=shownLine({report_id:'bad',card:'emoji',slot:'👜',text:'9 bags for 2 keys',fact:'👜 3 bags',source:'generated',check:{fact:'3 bags'},at:'2026-10-02T00:00:00Z'});
 for(const p of [A,B])rows.push({conversation_id:p,copy:[bad],feedback:[{card:'emoji',vote:'up',report_id:'bad',at:'2026-10-03T00:00:00Z'}]});
 assert.equal(validEmojiCaption(bad.text,'3 bags'),null);
 const lessons=cardLessons(lineVotes(rows),'emoji',{recheck:COPY_CARDS.emoji.recheck});
 assert.equal(lessons.examples.length,EXAMPLES_MAX);
 assert.equal(lessons.examples[0].text,`${EXAMPLES_MAX+7} knits, one busy drawer`,'newest first');
 assert.ok(!lessons.examples.some(e=>e.text==='3 knits, one busy drawer'),'the oldest rotated out');
 assert.ok(!lessons.examples.some(e=>e.text===bad.text));
 // Facts shown in place of a joke never teach.
 const fact=shownLine({report_id:'f',card:'emoji',slot:'🧶',text:'7 knits',fact:'🧶 7 knits',source:'fact',check:{fact:'7 knits'},at:'2026-10-02T00:00:00Z'});
 const misses=[];for(let k=0;k<MISSES_MAX+3;k++){const line=shownLine({report_id:'m'+k,card:'receipt',slot:'fine',text:`MISS ${k}`,fact:'',source:'generated',check:{lines:[]},at:'2026-10-01T00:00:00Z'});misses.push({conversation_id:A,copy:[line],feedback:[{card:'receipt',vote:'down',report_id:'m'+k,at:new Date(Date.UTC(2026,9,1,k)).toISOString()}]});}
 const receipt=cardLessons(lineVotes([...misses,{conversation_id:B,copy:[fact],feedback:[{card:'emoji',vote:'down',report_id:'f',at:'2026-10-02T00:00:00Z'}]}]),'receipt');
 assert.equal(receipt.misses.length,MISSES_MAX);assert.equal(receipt.misses[0].text,`MISS ${MISSES_MAX+2}`);
 assert.equal(cardLessons(lineVotes([{conversation_id:B,copy:[fact],feedback:[{card:'emoji',vote:'down',report_id:'f',at:'2026-10-02T00:00:00Z'}]}]),'emoji',{person:B}).misses.length,0);
});

test('other people’s names in learned lines can’t reach this person’s copy',async()=>{
 const lessons={...NO_LESSONS,examples:[{fact:'MAAP ×4',text:'4 MAAP ORDERS AND NO BIKE'}],foreign:['MAAP']};
 assert.equal(allows('receipt','MAAP OR NOTHING',lessons,['COS']),false);
 assert.equal(allows('receipt','MAAP OR NOTHING',lessons,['MAAP']),true,'fine when it is their own store too');
 const prompt=teach('BASE',lessons);
 assert.match(prompt,/^BASE\nLines people liked/);
 // A writer that copies the example's brand falls back to the plain fact.
 const picks=[{emoji:'🧥',fact:'5 coats and jackets'}];
 const [caption]=await writeEmojiCaptions(picks,async()=>({captions:[{emoji:'🧥',caption:'5 coats and jackets, all from MAAP',shared:'x'}]}),['COS'],null,lessons);
 assert.equal(caption.caption,'5 coats and jackets');assert.equal(caption.written,false);
 // And a downvoted Gatekeeper fallback becomes the plain line.
 const gate={score:40,verdict:'Early-ish adopter',matched:5,brands:[{name:'Our Legacy',niche:60}]};
 const avoid={...NO_LESSONS,avoid:new Set([lineKey('gatekeeper',gateFallback(40))])};
 const out=await writeGateLine(gate,async()=>{throw Error('down');},null,avoid);
 assert.equal(out.line,plainGateLine(gate));assert.equal(out.written,false);
});

test('named lines are validated: only this card’s lines, only with 👎',async()=>{
 const store=world();
 await buildReport(store,A,{},{interpret:writer()});
 const before=structuredClone(report(store,A)),id=reportView(before).copy.receipt[0].id;
 for(const input of [{vote:'up',lines:[id]},{vote:'down',lines:['nope']},{vote:'down',lines:'x'},{vote:'down',lines:[id],card:'gatekeeper'}])
  await assert.rejects(vote(store,A,input),e=>e.status===400,JSON.stringify(input));
 assert.deepEqual(report(store,A).feedback,before.feedback);
 await vote(store,A,{vote:'down',reason:'wrong',lines:[id]});
 assert.deepEqual(report(store,A).feedback.at(-1).lines,[id]);
 assert.equal(reportView(report(store,A)).votes.receipt,'down');
});

test('admin shows the week’s best and worst lines and each prompt version',async()=>{
 const store=world(),w=writer();
 for(const p of people)await buildReport(store,p,{},{interpret:w});
 await vote(store,A,{vote:'up'});await vote(store,B,{vote:'up'});
 const week=copyWeek(await store.reportCopyRows());
 assert.equal(week.best[0].text,'ONE COLOUR AND A CROP TOP HABIT');assert.equal(week.best[0].ups,2);assert.equal(week.best[0].shown,3);
 assert.equal(week.worst.length,0);
 await vote(store,C,{vote:'down',reason:'wont_share'});
 const after=copyWeek(await store.reportCopyRows());
 assert.equal(after.best.length,0);assert.equal(after.worst[0].text,'ONE COLOUR AND A CROP TOP HABIT');assert.deepEqual(after.worst[0].reasons,{wont_share:1});
 assert.deepEqual(after.prompts.find(p=>p.card==='receipt'),{card:'receipt',prompt:promptVersion(COPY_CARDS.receipt.prompt),shown:3,generated:3,ups:2,downs:0.5});
 // Votes older than a week drop out.
 assert.equal(copyWeek(await store.reportCopyRows(),new Date(Date.now()+8*864e5)).worst.length,0);
 // Through the admin API, owner only.
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
 await createAdminHandler({auth:async()=>200,storeFactory:()=>store,env:{}})({method:'GET',url:'/api/admin?view=report-copy',headers:{}},res);
 assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).worst[0].card,'receipt');
});
