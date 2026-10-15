import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {receiptHTML} from '../lib/receipt-email.js';
import {orderMedia,exclusiveMedia,shopCandidates,modelSource,mediaCounts} from '../lib/order-media.js';
import {fetchOrderPhoto,orderPhotoEvidence,photoItems} from '../lib/order-photos.js';
import {reconcileReceipt,emptyReceiptState,mediaRecords,applyReceiptRecord} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback} from '../lib/receipt-feedback.js';
import {applyProposal} from '../lib/purchase-sources.js';
import {orderSource} from '../lib/shop-orders.js';
import {wardrobeView,handleWardrobe} from '../lib/wardrobe.js';

const fact=value=>({value,quote:value});
const TEXT='Kith Order #1001 thank you for your order Williams III Hoodie Black L LAX Tee White M';
const purchase=(product,color,size,extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'thank you for your order'},category:'clothing',existing_item_id:null,evidence:product,
 merchant:fact('Kith'),order_reference:fact('#1001'),product:fact(product),sku:fact(null),brand:fact('Kith'),color:fact(color),size_label:fact(size),size_system:fact(null),quantity:fact(null),units_per_pack:fact(null),
 unit_price:fact(null),currency:fact(null),recipient:{value:'unknown',quote:null},photo_ref:null,link_ref:null,...extra});
const candidates=[
 {ref:0,image:'https://cdn.kith.example/hoodie.jpg',alt:'Williams III Hoodie',link:'https://kith.example/products/williams-iii-hoodie'},
 {ref:1,image:'https://cdn.kith.example/tee.jpg',alt:'LAX Tee',link:null},
 {ref:2,alt:'Track your order',link:'https://kith.example/account/orders/1001'},
];
const source={id:'m1',date:Date.parse('2026-05-01'),text:TEXT,media:{source:'order_email',candidates}};

const ORDER_HTML=`<html><head><style>.x{}</style></head><body><table>
<tr><td><img src="https://track.example/open.gif?u=123" width="1" height="1"></td></tr>
<tr><td><img src="https://cdn.kith.example/logo.png" alt="Kith" width="120" height="30"></td></tr>
<tr><td><a href="https://kith.example/products/williams-iii-hoodie?variant=42&utm_source=email&utm_medium=order"><img src="https://cdn.kith.example/hoodie.jpg?v=1&utm_campaign=x" alt="Williams III Hoodie" width="120"></a></td><td>Williams III Hoodie | Black | L</td></tr>
<tr><td><table><tr><td><img src="https://cdn.kith.example/tee.jpg" alt="LAX Tee"></td></tr><tr><td><a href="https://kith.example/products/lax-tee">LAX Tee</a></td></tr></table></td></tr>
<tr><td><img src="http://insecure.example/plain.jpg" alt="insecure"><img src="data:image/png;base64,AAAA" alt="inline"></td></tr>
<tr><td><a href="https://kith.example/account?order=1001">View order</a></td></tr>
</table></body></html>`;

test('order emails keep https product images with their links; pixels, icons, http and inline images are dropped',()=>{
 const html=receiptHTML(ORDER_HTML);
 const images=html.candidates.filter(c=>c.image);
 assert.deepEqual(images.map(c=>c.image),['https://cdn.kith.example/hoodie.jpg?v=1','https://cdn.kith.example/tee.jpg']);
 // The enclosing link, without its tracking parameters; a nested row's single link for the tee.
 assert.equal(images[0].link,'https://kith.example/products/williams-iii-hoodie?variant=42');
 assert.equal(images[1].link,'https://kith.example/products/lax-tee');
 // Each picture is marked in place so the model can see which line it sits on.
 assert.match(html.text,/\[image 0: Williams III Hoodie\][\s|]*Williams III Hoodie \| Black \| L/);
 // Text links that repeat an image's link are not offered twice; other text links are.
 assert.deepEqual(html.candidates.filter(c=>!c.image).map(c=>c.alt),['View order']);
 assert.equal(new Set(html.candidates.map(c=>c.ref)).size,html.candidates.length);
 assert.deepEqual(html.link_references,[{label:'order',value:'1001'}]);
 // Refs continue across a second HTML body in the same email.
 assert.ok(receiptHTML(ORDER_HTML,html.next).candidates.every(c=>c.ref>=html.next));
});

test('the model sees refs, text and page paths, never a URL it could copy',()=>{
 const sent=JSON.stringify(modelSource(source));
 assert.ok(!sent.includes('https://'));
 assert.match(sent,/"ref":0,"kind":"image","text":"Williams III Hoodie","link":"kith.example\/products\/williams-iii-hoodie"/);
});

test('a chosen ref must name an existing candidate of the right kind; anything else is rejected',()=>{
 assert.deepEqual(orderMedia(source,{photo_ref:0,link_ref:0}),{photo:{url:candidates[0].image,source:'order_email',source_id:'m1'},link:candidates[0].link,rejected:[]});
 // A ref the source never offered, a non-integer, and a link-only candidate used as a photo.
 assert.deepEqual(orderMedia(source,{photo_ref:9,link_ref:'0'}),{photo:null,link:null,rejected:['photo_ref','link_ref']});
 assert.deepEqual(orderMedia(source,{photo_ref:2,link_ref:1}).rejected,['photo_ref','link_ref']);
 // An http URL never passes, even if a candidate somehow carried one.
 const insecure={...source,media:{source:'order_email',candidates:[{ref:0,image:'http://cdn.kith.example/a.jpg',alt:'',link:'http://kith.example/p'}]}};
 assert.deepEqual(orderMedia(insecure,{photo_ref:0,link_ref:0}),{photo:null,link:null,rejected:['photo_ref','link_ref']});
 // No candidates: any ref is invented.
 assert.deepEqual(orderMedia({id:'m2',text:''},{photo_ref:0,link_ref:null}).rejected,['photo_ref']);
 assert.deepEqual(orderMedia(source,{photo_ref:null,link_ref:null}),{photo:null,link:null,rejected:[]});
});

test('one picture pointed at by two different line items goes to neither; a repeated line keeps it',()=>{
 const shared=exclusiveMedia({events:[purchase('Williams III Hoodie','Black','L',{photo_ref:0}),purchase('LAX Tee','White','M',{photo_ref:0})]});
 assert.deepEqual(shared.events.map(e=>e.photo_ref),[null,null]);
 const repeated=exclusiveMedia({events:[purchase('Williams III Hoodie','Black','L',{photo_ref:0}),{...purchase('Williams III Hoodie','Black','L',{photo_ref:0}),kind:'shipped'}]});
 assert.deepEqual(repeated.events.map(e=>e.photo_ref),[0,0]);
});

test('extracted items carry the validated photo and link; a re-import never replaces them or a correction',()=>{
 const applied=applyProposal(emptyReceiptState('owner'),source,{events:[purchase('Williams III Hoodie','Black','L',{photo_ref:0,link_ref:0}),purchase('LAX Tee','White','M',{photo_ref:1,link_ref:7})]});
 const [hoodie,tee]=applied.state.items;
 assert.deepEqual(hoodie.order_photo,{url:candidates[0].image,source:'order_email',source_id:'m1'});
 assert.equal(hoodie.product_link,candidates[0].link);
 assert.equal(tee.order_photo.url,candidates[1].image);assert.equal(tee.product_link,undefined);
 assert.deepEqual(applied.records[1].withheld_fields,['link_ref']);
 assert.deepEqual(mediaCounts(applied.state),{items:2,order_photo:2,product_link:1,neither:0});
 // The person fixes the colour; a later email offers another picture for the same item.
 let state=applyReceiptFeedback(applied.state,{id:'fix-1',owner_id:'owner',source:'closet_edit',at:'2026-06-01T00:00:00Z',item_ids:[hoodie.id],action:'correct_fields',values:{color:'Washed Black'}});
 applyReceiptRecord(state,[],{...applied.records[0],event_id:'m9:0',source_id:'m9',photo:{url:'https://cdn.kith.example/other.jpg',source:'order_email',source_id:'m9'},link:'https://kith.example/other'});
 const after=state.items.find(i=>i.id===hoodie.id);
 assert.equal(after.order_photo.url,candidates[0].image);assert.equal(after.product_link,candidates[0].link);assert.equal(after.color,'Washed Black');
});

test('a photo re-read of an email already in the history attaches media without adding items or events',()=>{
 const plain={...source,media:undefined};
 const base=reconcileReceipt(emptyReceiptState('owner'),plain,{events:[purchase('Williams III Hoodie','Black','L')]}).state;
 const events=base.items[0].source_events.length;
 const {state,records}=mediaRecords(structuredClone(base),source,{events:[purchase('Williams III Hoodie','Black','L',{photo_ref:0,link_ref:0}),purchase('Unrelated Cap','Red','OS',{photo_ref:1})]});
 assert.equal(state.items.length,1);assert.equal(records.length,1);
 assert.equal(state.items[0].order_photo.url,candidates[0].image);assert.equal(state.items[0].source_events.length,events);
 // Replaying the stored record rebuilds the same media.
 const replay=structuredClone(base);applyReceiptRecord(replay,[],records[0]);
 assert.equal(replay.items[0].product_link,candidates[0].link);
});

const png=(width,height)=>sharp({create:{width,height,channels:3,background:'#fff'}}).png().toBuffer();
const imageFetcher=bytes=>async()=>new Response(bytes,{status:200,headers:{'Content-Type':'image/png'}});
test('downloaded order photos are resized JPEGs; pixel-sized and banner-shaped images are rejected',async()=>{
 const photo=await fetchOrderPhoto('https://cdn.kith.example/hoodie.jpg',imageFetcher(await png(1200,1500)));
 assert.equal(photo.mime_type,'image/jpeg');assert.ok(photo.width<=900&&photo.height===900);
 await assert.rejects(fetchOrderPhoto('https://track.example/open.gif',imageFetcher(await png(1,1))),/too small/);
 await assert.rejects(fetchOrderPhoto('https://cdn.kith.example/banner.png',imageFetcher(await png(1200,200))),/shape/);
 await assert.rejects(fetchOrderPhoto('http://cdn.kith.example/a.png',imageFetcher(await png(400,400))),/Unsupported/);
});

test('each item that gained an order photo is stored once, keyed to the item',async()=>{
 const applied=applyProposal(emptyReceiptState('owner'),source,{events:[purchase('Williams III Hoodie','Black','L',{photo_ref:0}),purchase('LAX Tee','White','M',{photo_ref:1})]});
 const fetcher=async url=>url.includes('tee')?new Response('nope',{status:404}):new Response(await png(400,500),{status:200,headers:{'Content-Type':'image/png'}});
 const rows=await orderPhotoEvidence(photoItems(emptyReceiptState('owner')),applied.state,{origin:'gmail',source_type:'gmail_message',fetcher});
 const hoodie=applied.state.items[0];
 assert.deepEqual(rows.map(r=>[r.id,r.kind,r.origin,r.source.id,r.data.item_id,r.data.photo_source]),[['order_photo:'+hoodie.id,'photo_observation','gmail','m1',hoodie.id,'order_email']]);
 // Items that already had their photo are not fetched again.
 assert.deepEqual(await orderPhotoEvidence(photoItems(applied.state),applied.state,{origin:'gmail',source_type:'gmail_message',fetcher:()=>assert.fail()}),[]);
});

test('Shop records offer line-item images and product links as candidates',()=>{
 const order={id:'gid://shop/Order/1',name:'#1001',shop:{name:'Kith'},line_items:[
  {title:'LAX Tee',variant_title:'White / M',image:{url:'https://cdn.shopify.com/s/files/tee.jpg?utm_source=shop',altText:'LAX Tee'},product_url:'https://kith.example/products/lax-tee'},
  {title:'Gift Card',image_url:'http://cdn.shopify.com/card.png'}]};
 assert.deepEqual(shopCandidates(order),[{ref:0,image:'https://cdn.shopify.com/s/files/tee.jpg',alt:'LAX Tee',link:'https://kith.example/products/lax-tee'}]);
 const prepared=orderSource(order);
 assert.equal(prepared.media.source,'shop_order');assert.equal(prepared.media.candidates.length,1);
 assert.equal(orderSource({id:'2',line_items:[{title:'Tee'}]}).media,undefined);
});

test('the wardrobe flags items with a stored order photo and serves it only to its owner',async()=>{
 const applied=applyProposal(emptyReceiptState('owner'),source,{events:[purchase('Williams III Hoodie','Black','L',{photo_ref:0}),purchase('LAX Tee','White','M')]});
 const [hoodie,tee]=applied.state.items;
 const view=wardrobeView(applied.state,{photos:new Map([[hoodie.id,'order_email']])});
 const flag=id=>{const i=view.items.find(i=>i.id===id);return [i.photo,i.photo_source];};
 assert.deepEqual(flag(hoodie.id),[true,'order_email']);assert.deepEqual(flag(tee.id),[false,null]);
 // A chosen but not-yet-stored photo is not claimed.
 assert.deepEqual(wardrobeView(applied.state).items.map(i=>i.photo),[false,false]);
 const jpeg=(await sharp(await png(50,50)).jpeg().toBuffer()).toString('base64');
 const store={purchasePhoto:async(owner,item)=>owner==='owner'&&item===hoodie.id?{mime_type:'image/jpeg',data:jpeg}:null};
 const call=async(url,conversation='owner')=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
  await handleWardrobe({method:'GET',url,headers:{}},res,{store,env:{},auth:async()=>({status:200,conversation})});return res;};
 const ok=await call('/api/wishlist?wardrobe=1&photo='+encodeURIComponent(hoodie.id));
 assert.equal(ok.statusCode,200);assert.equal(ok.headers['Content-Type'],'image/jpeg');assert.equal(ok.headers['Cache-Control'],'no-store');
 assert.equal((await call('/api/wishlist?wardrobe=1&photo='+encodeURIComponent(hoodie.id),'someone-else')).statusCode,404);
 assert.equal((await call('/api/wishlist?wardrobe=1&photo=..%2Fx%3Fy')).statusCode,400);
});
