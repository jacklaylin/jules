import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {wishlistSetPreviewURL,validWishlistPreview,splitWishlistPreview} from '../lib/wishlist-preview.js';
import {createPreviewHandler} from '../lib/wishlist-preview-handler.js';

// Rich previews step 4 (October 22): a save of several items gets one signed link whose card shows each item.
const env={SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'test-only-key'};
const [first,second,third,fourth]=['1','2','3','4'].map(n=>`${n}2345678-1234-1234-1234-123456789abc`);
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
const request=async(read,path)=>{const res=response();await createPreviewHandler({env,read})({method:'GET',url:path,headers:{}},res);return res;};

test('a save of several items gets one signed set link that can’t be altered',()=>{
 const set=wishlistSetPreviewURL([first,second,third,fourth],env),parsed=new URL(set);
 assert.equal(parsed.searchParams.get('items'),[first,second,third].join(','),'only the first three');
 assert.ok(validWishlistPreview(parsed,env));assert.equal(splitWishlistPreview('saved all three.\n'+set,env).preview,set);
 const swapped=new URL(set);swapped.searchParams.set('items',[first,second].join(','));assert.equal(validWishlistPreview(swapped,env),false);
 const mixed=new URL(set);mixed.searchParams.set('item',first);assert.equal(validWishlistPreview(mixed,env),false);
 for(const ids of [[first],[first,first],[first,'not-a-uuid']])assert.equal(wishlistSetPreviewURL(ids,env),null);
 assert.equal(wishlistSetPreviewURL([first,second],{SITE_ORIGIN:env.SITE_ORIGIN}),null);
});

test('a set link shows one card per saved item with its own photo, never private images, and drops removed items',async()=>{
 const photo=async colour=>({image_kind:'product',image:{mime_type:'image/jpeg',data:(await sharp({create:{width:40,height:40,channels:3,background:colour}}).jpeg().toBuffer()).toString('base64')}});
 const products={[first]:{name:'Speedgoat',brand:'HOKA',...await photo('#ffff00')},[second]:{name:'Derby',brand:'Our Legacy',...await photo('#0000ff')},
  [third]:{name:'Belt',image_kind:'outfit_crop',image:{mime_type:'image/jpeg',data:'PRIVATE'}}};
 const path=wishlistSetPreviewURL([first,second,third],env).replace(env.SITE_ORIGIN,'');
 const page=await request(async id=>products[id],path);
 assert.equal(page.statusCode,200);assert.match(page.body,/Saved: HOKA Speedgoat, Our Legacy Derby and Belt/);assert.match(page.body,/href="\/wishlist"/);
 const res=await request(async id=>products[id],path+'&image=1');assert.equal(res.statusCode,200);
 const {data,info}=await sharp(res.body).raw().toBuffer({resolveWithObject:true});assert.deepEqual([info.width,info.height],[1200,630]);
 const at=(x,y)=>[...data.subarray((y*1200+x)*info.channels,(y*1200+x)*info.channels+3)];
 const [r,g,b]=at(1040,330);assert.ok(r>200&&g>200&&b<80,'the first item saved is the front card');
 assert.match(res.headers['Cache-Control'],/s-maxage=60\b/,'an item without a product photo keeps the cache short');
 // A removed item leaves the others; every item removed is gone.
 assert.equal((await request(async id=>id===second?{wishlist_removed:true}:products[id],path+'&image=1')).statusCode,200);
 assert.equal((await request(async()=>({wishlist_removed:true}),path)).statusCode,404);
});
