import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateReply,consentCheck} from '../lib/ai.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {agentTurn,tool,toolOutputs,isConsentCheck,isAgentRequest} from './helpers/agent.js';

// A durable fact about the user (their name) arriving while a save/alert waits for a size. The
// earlier approval stays, but only a message that continues it (gives the size) may resume it.
// The model's readings are mocked; the agent loop, the consent gate and the wishlist executor are
// real. Tests assert state, persistence and the profile change, not reply wording.
const chino={brand:'Our Legacy',name:'Beige Still Chino Trousers',url:'https://www.ssense.com/en-us/men/product/our-legacy/beige-still-chino-trousers/1',
  sourcing_status:'store_found',reference_provenance:'user_link',listing_check:{status:'verified',shopping_range:'men',product_name:'Beige Still Chino Trousers',product_brand:'OUR LEGACY'}};
// Where the live conversation stood: alerts approved ("add to my wishlist and set an alert"), size unknown.
const waiting={stage:'size_set',query:'Our Legacy beige pleated khakis',options:[chino],selected_set:[chino],offered_urls:[chino.url],confirmed_consent:'wishlist_alerts',
  size_options:[{url:chino.url,color:null,sizes:[]}]};
const sizeQuestion='which retailer size should i watch? Beige Still Chino Trousers: size availability not verified.';
const env={OPENAI_API_KEY:'test',SEARCH_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'};
const inspect=async links=>({sizes:['30','32','34'],checks:[{offers:[{size:'32',key:'32',amount:590,currency:'USD',available:true,url:links[0].url}]}]});
const name=(value,quote,action='remember')=>tool('update_profile',{changes:[{action,field:'name',key:'first',value,quote}],acknowledgment:`Got it, ${value}.`});
// The consent check's reading of the newest message, as the small model would return it.
const reading=(answers,authorizes)=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({newest_message_answers:answers,asks_itself:false,authorizes})}]}]})});
const noProfileChange={ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"changes":[]}'}]}]})};

function conversation(){
  let state=waiting,facts=[{field:'size',key:'shoes/eu',value:'45',basis:'stated'}];
  const history=[{direction:'inbound',status:'received',body:'Yes that’s what I want. Add to my wishlist and set an alert'},{direction:'outbound',status:'sent',body:sizeQuestion}];
  const log={executed:[],checks:[],confirmed:[]};
  // first: the agent's first-round tools. consent: the consent check's reading, when one is asked.
  const say=async(text,first,consent)=>{
    history.push({direction:'inbound',status:'received',body:text});
    let recorded;
    const fetcher=async(_url,request)=>{
      const body=JSON.parse(request.body);
      if(isConsentCheck(request)){log.checks.push(JSON.parse(body.input));return reading(...consent);}
      if(!isAgentRequest(request))return noProfileChange;
      const outputs=toolOutputs(request);
      if(!outputs.length)return agentTurn(...first);
      // After the tools ran: restate a draft if an action produced one, else acknowledge.
      const done=outputs.find(o=>o.status==='done'&&typeof o.result==='string');
      return agentTurn(tool('conversation_reply',{response:done?done.result:'Got it.',claims:{saved_now:false,alerts_turned_on:false,alerts_turned_off:false},answers_message_ids:[]}));
    };
    const body=await generateReply([...history],env,fetcher,{facts,wishlistState:state,
      wishlistAction:(args,current)=>{log.executed.push(args);return textWishlistAction(args,{state:current,facts,env,inspect,record:async r=>{recorded=r;},search:()=>assert.fail('No search in these turns')});},
      shoppingState:()=>recorded&&'text_wishlist_state' in recorded?recorded.text_wishlist_state:undefined,
      shoppingConfirmed:()=>recorded?.user_confirmed===true,
      profileAction:async args=>{
        for(const c of args.changes)facts=[...facts.filter(f=>!(f.field===c.field&&f.key===c.key)),...(c.action==='forget'?[]:[{field:c.field,key:c.key,value:c.value,basis:'stated'}])];
        return {facts,saved:args.changes.length};
      }});
    if(recorded?.user_confirmed)log.confirmed.push(recorded);
    if(recorded&&'text_wishlist_state' in recorded)state=recorded.text_wishlist_state;
    history.push({direction:'outbound',status:'sent',body});
    return body;
  };
  return {say,log,get state(){return state;},get facts(){return facts;}};
}
const firstName=facts=>facts.find(f=>f.field==='name'&&f.key==='first')?.value;

test('stating a name while an approved alert waits for a size saves the name and leaves the alert waiting',async()=>{
  // Varied wording, and the misreadings the agent can make: resuming the alert, or "interest" in
  // the approved set (which the wishlist executor would turn back into the approved alert).
  const misreadings=[
    ['Call me jack',tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'answer_to_offer'})],
    ['btw I go by Jack',tool('respond_to_options',{decision:'interest',option_indices:[0]})],
    ['you can just call me Jack',tool('save_to_wishlist',{option_indices:[0],consent_context:'answer_to_offer'})],
  ];
  for(const [text,misread] of misreadings){
    const c=conversation();
    const reply=await c.say(text,[name('Jack',text),misread],['nothing_in_particular',false]);
    assert.equal(firstName(c.facts),'Jack',text);
    // The independent check saw the earlier approval and the newest message, and refused to resume.
    assert.equal(c.log.checks.length,1,text);
    assert.equal(c.log.checks[0].newest_user_message,text);
    assert.equal(c.log.checks[0].approved_earlier.approved,'save and set price alerts');
    assert.equal(c.log.executed.length,0,text);assert.equal(c.log.confirmed.length,0,text);
    // Nothing moved: the same approval still waits for the same size, and the question is not repeated.
    assert.equal(c.state,waiting,text);
    assert.notEqual(reply,sizeQuestion);assert.ok(!reply.includes('size availability not verified'),text);
  }
  // The intended reading: the profile change plus a short reply; no consent question is even asked.
  const c=conversation();
  await c.say('Call me Jack',[name('Jack','Call me Jack'),tool('conversation_reply',{response:'Got it, Jack.',claims:{saved_now:false,alerts_turned_on:false,alerts_turned_off:false},answers_message_ids:[]})],null);
  assert.equal(firstName(c.facts),'Jack');assert.equal(c.log.checks.length,0);assert.equal(c.log.executed.length,0);assert.equal(c.state,waiting);
});

test('a name and a real answer to the waiting size question in one message do both',async()=>{
  for(const [text,size] of [['I’m Jack, and a 32 works',  '32'],['32 please — and call me Jack','32']]){
    const c=conversation();
    await c.say(text,[name('Jack',text),tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'answer_to_offer',size_choices:[{option_index:0,size}]})],['the_detail_for_the_approved_action',true]);
    assert.equal(firstName(c.facts),'Jack',text);
    assert.equal(c.log.confirmed.length,1,text);
    const [confirmed]=c.log.confirmed;
    assert.deepEqual(confirmed.products.map(p=>p.url),[chino.url]);
    assert.equal(confirmed.alert_requests.length,1);assert.equal(confirmed.alert_requests[0].size,size);
  }
});

test('correcting the name later updates it, and the waiting alert still resumes on the size',async()=>{
  const c=conversation();
  await c.say('call me jack',[name('Jack','call me jack'),tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'answer_to_offer'})],['nothing_in_particular',false]);
  assert.equal(firstName(c.facts),'Jack');assert.equal(c.state,waiting);
  await c.say('sorry, it’s Jackson actually',[name('Jackson','it’s Jackson actually','correct'),tool('respond_to_options',{decision:'interest',option_indices:[0]})],['nothing_in_particular',false]);
  assert.equal(firstName(c.facts),'Jackson');assert.equal(c.facts.filter(f=>f.field==='name').length,1);
  assert.equal(c.state,waiting);assert.equal(c.log.executed.length,0);
  // The approval survived both turns: the size alone finishes it without asking for consent again.
  await c.say('32',[tool('manage_price_alerts',{operation:'create',option_indices:[0],consent_context:'answer_to_offer',size_choices:[{option_index:0,size:'32'}]})],['the_detail_for_the_approved_action',true]);
  assert.equal(c.log.confirmed.length,1);assert.equal(c.log.confirmed[0].alert_requests[0].size,'32');
});

test('continuing an approval needs an approval that covers the action',async()=>{
  const ask=answers=>async()=>reading(answers,true);
  const alert={name:'manage_price_alerts',args:{operation:'create',option_indices:[0]}};
  const messages=[{direction:'inbound',body:'32'}];
  // No earlier approval: "continuing" one cannot authorize.
  assert.equal(await consentCheck(messages,alert,{stage:'choice',options:[chino]},env,ask('the_detail_for_the_approved_action')),false);
  // An approval to save only does not cover alerts.
  assert.equal(await consentCheck(messages,alert,{...waiting,confirmed_consent:'wishlist'},env,ask('the_detail_for_the_approved_action')),false);
  assert.equal(await consentCheck(messages,alert,waiting,env,ask('the_detail_for_the_approved_action')),true);
});
