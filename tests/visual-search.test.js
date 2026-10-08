import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {cropPixels,searchImage,lensCandidates,lensSearch} from '../lib/lens.js';
import {validatePlan,assessCandidates,visualSearchProducts} from '../lib/visual-search.js';
import {rankSources,retailerFor} from '../lib/retailers.js';
import {formatSearch} from '../lib/search.js';
const thumb='https://encrypted-tbn0.gstatic.com/images?q=example';
const candidates=[{id:'1',title:'Barbour Checked Jacket',url:'https://barbour.com/jacket',image:thumb},{id:'2',title:'Barbour Checked Jacket',url:'https://farfetch.com/jacket',image:thumb},{id:'3',title:'Barbour Checked Jacket',url:'https://deeceestyle.ch/jacket',image:thumb}];
const assessment=id=>({id,brand:'Barbour',name:'Checked Jacket',product_key:'barbour-checked-dark',is_product_listing:true,matched_details:['collar shape','two flap pockets','short silhouette'],distinctive_details:['check alignment at placket','unusual angled flap seam'],contradictions:[],unseen_details:[],reason:'A dark check with a short shape.'});
const target={label:'jacket',image_index:0,box:[0,0,1,1],features:['check pattern']};
test('ambiguous image reference asks a question without searching; explicit outfits preserve separate pieces',async()=>{
 let searched=false;
 const result=await visualSearchProducts('Find this',[{}],{},null,{plan:async()=>({scope:'ambiguous',question:'The jacket or trousers?',items:[]}),retrieve:async()=>{searched=true;}});
 assert.equal(searched,false);assert.equal(formatSearch(result),'The jacket or trousers?');
 assert.equal(validatePlan({scope:'outfit',question:'',items:[target,{...target,label:'trousers'}],omitted:['bag']},1).items.length,2);
 assert.throws(()=>validatePlan({scope:'item',items:[target,target],omitted:[]},1));
 assert.throws(()=>validatePlan({scope:'item',items:[{...target,image_index:1}],omitted:[]},1));
});
test('crop bounds are validated and actual encoded search images fit provider upload limit',async()=>{
 assert.deepEqual(cropPixels([0.25,0.25,0.5,0.5],100,80),{left:25,top:20,width:50,height:40});
 assert.throws(()=>cropPixels([0.8,0,0.5,1],100,80));
 const original=await sharp({create:{width:2000,height:1000,channels:3,background:'#445544'}}).png().toBuffer();
 const image=await searchImage({mime_type:'image/png',data:original.toString('base64')},[0.5,0,0.5,1]);
 const bytes=Buffer.from(image.data,'base64');assert.ok(bytes.length<500000);
 const dimensions=await sharp(bytes).metadata();assert.equal(dimensions.width,dimensions.height);assert.equal(dimensions.format,'jpeg');
});
test('Lens uploads private bytes rather than creating a public image URL and filters unsafe candidate images',async()=>{
 let calls=0;
 const found=await lensSearch({mime_type:'image/jpeg',data:Buffer.from('test').toString('base64')},'jacket',{SERPAPI_API_KEY:'fake'},async(url,options)=>{
  if(++calls===1){assert.equal(url,'https://serpapi.com/image');assert.equal(options.body.get('api_key'),'fake');assert.ok(options.body.get('image') instanceof Blob);return {ok:true,json:async()=>({image_id:'temporary'})};}
  const params=new URL(url).searchParams;assert.equal(params.get('image_id'),'temporary');assert.equal(params.has('url'),false);assert.equal(params.has('q'),false);assert.equal(params.get('auto_crop'),'false');
  return {ok:true,json:async()=>({search_metadata:{status:'Success'},visual_matches:[{link:candidates[0].url,title:'Jacket',thumbnail:thumb},{link:'https://retailer.example/other',title:'Other',thumbnail:'https://127.0.0.1/image'},{link:'https://instagram.com/post',title:'Post',thumbnail:thumb}]})};
 });
 assert.equal(found.length,2);assert.equal(calls,2);
 assert.throws(()=>lensCandidates({error:'provider private diagnostic'}));
 assert.deepEqual(lensCandidates({search_metadata:{status:'Success'},error:"Google Lens hasn't returned any results for this query."}),[]);
});
test('candidate photo contradictions reject identification even at an official retailer; generic similarity cannot establish identity',()=>{
 const wrong={...assessment('1'),contradictions:['Different pocket layout']};
 assert.equal(assessCandidates(candidates,{candidates:[wrong]}).length,0);
 assert.equal(assessCandidates(candidates,{candidates:[{...assessment('1'),distinctive_details:[]}]}).length,0);
 assert.equal(assessCandidates(candidates,{candidates:[{...assessment('1'),unseen_details:['pockets hidden','pattern too small']}]}).length,0);
 assert.equal(assessCandidates(candidates,{candidates:[wrong]},true)[0].match,'similar');
 assert.equal(assessCandidates(candidates,{candidates:[{...assessment('1'),id:'invented'}]}).length,0);
});
test('merchant ranking prefers official then preferred then unreviewed only within valid product matches',()=>{
 const products=assessCandidates(candidates,{candidates:[assessment('3'),assessment('2'),assessment('1')]});
 assert.deepEqual(products.map(p=>p.retailer.tier),['official','preferred','unreviewed']);
 assert.equal(retailerFor('https://barbour.com.evil.example/item','Barbour').tier,'unreviewed');
 assert.equal(retailerFor('https://barbour.com/item','Prada').tier,'unreviewed');
 const ranked=rankSources([{brand:'Barbour',url:candidates[0].url,match:'similar'},{brand:'Barbour',url:candidates[2].url,match:'likely_match'}]);
 assert.equal(ranked[0].url,candidates[2].url);
});
test('whole outfit searches pieces independently, groups equivalent sellers, and reports unmatched pieces',async()=>{
 const result=await visualSearchProducts('Find the whole outfit',[{mime_type:'image/jpeg',data:'fake'}],{},null,{
  plan:async()=>({scope:'outfit',items:[target,{...target,label:'trousers'}],omitted:['shoes']}),verifyListing:async url=>({status:'verified',url,checked_at:'2026-10-06T00:00:00Z',price_snapshot:null}),crop:async()=>({}),retrieve:async()=>candidates,
  compare:async t=>({candidates:t.label==='jacket'?[assessment('3'),assessment('2'),assessment('1')]:[]})
 });
 assert.equal(result.products.length,1);assert.equal(result.products[0].url,candidates[0].url);assert.equal(result.products[0].merchant_options.length,1);
 assert.equal(result.status,'needs_review');assert.deepEqual(result.missing,['trousers']);assert.match(formatSearch(result),/haven’t searched the shoes/);
});
import {scoreIdentification} from '../lib/evaluation.js';
test('evaluation separates false matches, coverage, and correct abstentions; all-abstain cannot appear perfectly accurate',()=>{
 const base={id:'case-01',claimed:0,correct:0,identifiable:1,abstained:true,expected_abstention:false};
 assert.equal(scoreIdentification([base]).precision,null);assert.equal(scoreIdentification([base]).coverage,0);
 const scores=scoreIdentification([{...base,claimed:1,correct:1,abstained:false},{...base,id:'case-02',claimed:1,abstained:false},{...base,id:'case-03',identifiable:0,expected_abstention:true}]);
 assert.equal(scores.precision,0.5);assert.equal(scores.wrong,1);assert.equal(scores.appropriate_abstention,1);
 assert.throws(()=>scoreIdentification([base,base]));
});
test('higher product evidence selects identity before an official retailer for a different model',async()=>{
 const result=await visualSearchProducts('Find the jacket',[{}],{},null,{plan:async()=>({scope:'item',items:[target],omitted:[]}),verifyListing:async url=>({status:'verified',url,checked_at:'2026-10-06T00:00:00Z',price_snapshot:null}),crop:async()=>({}),retrieve:async()=>candidates,compare:async()=>({candidates:[{...assessment('1'),product_key:'wrong-other-model'}, {...assessment('2'),distinctive_details:['unique flap angle','specific pattern alignment','double closure seam'],product_key:'correct-model'}]})});
 assert.equal(result.products[0].url,candidates[1].url);assert.equal(result.products[0].merchant_options.length,0);
});

test('a specific identity survives without a recommended merchant, while contradictions still reject it',async()=>{
 const deps={plan:async()=>({scope:'item',items:[target],omitted:[]}),verifyListing:async url=>({status:'verified',url,checked_at:'2026-10-06T00:00:00Z',price_snapshot:null}),crop:async()=>({}),retrieve:async()=>[candidates[2]],compare:async()=>({candidates:[{...assessment('3'),is_product_listing:false}]})};
 const result=await visualSearchProducts('Find this jacket',[{}],{},null,deps);
 assert.equal(result.status,'identified_no_store');assert.equal(result.products[0].sourcing_status,'store_not_found');assert.deepEqual(result.products[0].merchant_options,[]);assert.match(formatSearch(result),/Identification source/);
 assert.equal(assessCandidates(candidates,{candidates:[{...assessment('3'),is_product_listing:false,contradictions:['wrong closure']}]},false,true).length,0);
});

test('readable screenshot product text is sourced before a garment-only Lens search',async()=>{
 const named={...target,visible_product_text:'Example Brand Model 12 White',search_mode:'exact'};
 const found={brand:'Example Brand',name:'Model 12',url:'https://barbour.com/item',match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified'}};
 const result=await visualSearchProducts('Find this',[{}],{},null,{plan:async()=>({scope:'item',items:[named],omitted:[]}),
 searchText:async query=>{assert.equal(query,named.visible_product_text);return {products:[found]};},corroborate:async(t,original,products)=>{assert.equal(t,named);return products;},retrieve:()=>assert.fail('Must use existing screenshot information first'),verifyListing:async url=>({status:'verified',url})});
 assert.equal(result.products[0].garment,'jacket');assert.equal(result.diagnostics[0].recovery,'screenshot_text');
});
test('failed screenshot retrieval falls back to Lens without discarding a supported identity',async()=>{
 const result=await visualSearchProducts('Find this',[{}],{},null,{plan:async()=>({scope:'item',items:[{...target,visible_product_text:'Example model',search_mode:'exact'}],omitted:[]}),
 searchText:async()=>{throw Error('unavailable');},crop:async()=>({}),retrieve:async()=>candidates,compare:async()=>({candidates:[assessment('1')]}),verifyListing:async url=>({status:'verified',url})});
 assert.equal(result.products.length,1);assert.equal(result.products[0].url,candidates[0].url);
});
test('identified products without a buying link trigger a bounded alternate merchant search',async()=>{
 let searched=0;
 const found={brand:'Barbour',name:'Checked Jacket',url:candidates[0].url,match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified'}};
 const result=await visualSearchProducts('Find this',[{}],{},null,{plan:async()=>({scope:'item',items:[target],omitted:[]}),crop:async()=>({}),retrieve:async()=>[candidates[2]],compare:async()=>({candidates:[{...assessment('3'),is_product_listing:false}]}),
 searchText:async()=>{searched++;return {products:[found]};},corroborate:async(_t,_i,products)=>products,verifyListing:async url=>({status:'verified',url})});
 assert.equal(searched,1);assert.equal(result.products[0].url,candidates[0].url);assert.equal(result.diagnostics[0].recovery,'merchant_search');
});

import {corroborateTextSources,planVisualSearch} from '../lib/visual-search.js';
test('planning reads product text outside the crop and uses model-interpreted alternative permission',async()=>{
 const expected={scope:'item',question:'',items:[{...target,description:'white waffle long sleeve',visible_product_text:'Example Brand Model 12',search_mode:'exact'}],omitted:[]};
 const plan=await planVisualSearch('Could you locate this?',[{mime_type:'image/png',data:'synthetic'}],{},async(_u,o)=>{
  const body=JSON.parse(o.body);assert.ok(body.instructions.includes('outside the garment'));assert.ok(body.input[0].content.some(c=>c.type==='input_image'));
  assert.ok(body.text.format.schema.properties.items.items.required.includes('visible_product_text'));
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(expected)}]}]})};
 });
 assert.equal(plan.items[0].visible_product_text,expected.items[0].visible_product_text);
 assert.throws(()=>validatePlan({...expected,items:[{...expected.items[0],visible_product_text:'x'.repeat(501)}]},1));
});
test('screenshot corroboration rejects invented references, contradictions and unrequested substitutes',async()=>{
 const products=[{brand:'Example',name:'Model 12',url:candidates[0].url,sourcing_status:'store_found',listing_check:{status:'verified'}}];
 const response=matches=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({matches})}]}]})});
 const match={index:0,match:'likely_match',visible_evidence:'Example Model 12',contradictions:[]};
 for(const bad of [{...match,index:8},{...match,visible_evidence:''},{...match,contradictions:['different model']},{...match,match:'similar'}])assert.equal((await corroborateTextSources({...target,search_mode:'exact'},{mime_type:'image/png',data:'synthetic'},products,{},response([bad]))).length,0);
 assert.equal((await corroborateTextSources({...target,search_mode:'exact'},{mime_type:'image/png',data:'synthetic'},products,{},response([match,match]))).length,1);
 assert.equal((await corroborateTextSources({...target,search_mode:'similar'},{mime_type:'image/png',data:'synthetic'},products,{},response([{...match,match:'similar'}])))[0].match,'similar');
});
