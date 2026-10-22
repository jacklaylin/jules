import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {loadFont,layout,headlineSvg,reportHeadline,covers,COLUMN} from '../lib/link-preview-headline.js';
import {handleReportPreview} from '../lib/report-preview.js';
import {createImageHandler} from '../api/image.js';

const token='AbCdEfGhIjKlMnOpQrStUv';
const store=(name,{shared=true}={})=>({
 reportByShareToken:async t=>t===token?{conversation_id:'c1',report:{share:{token:shared?token:'SomethingElse_12345678'}}}:null,
 profile:async()=>null,signupFirstName:async()=>name
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
const get=async(s,url=`/api/image?share_preview=${token}&v=1`)=>{const res=response();await handleReportPreview({method:'GET',url,headers:{}},res,{store:s});return res;};

test('a name headline keeps the template size when it fits and steps down for long names, never wider than the column',async()=>{
 const font=await loadFont();
 assert.deepEqual(layout(font,reportHeadline('William')),{size:112,lines:['William’s style','report is in']});
 assert.equal(layout(font,reportHeadline(null)).size,112);
 let last=112;
 for(const name of ['Jo','Maximiliana','Christopher-Alexander','Bartholomewssonsdottirsen','Wolfeschlegelsteinhausenbergerdorff']){
  const {size,lines}=layout(font,reportHeadline(name));
  assert.ok(lines.length<=COLUMN.maxLines,name);
  assert.ok(lines.join(' ')===reportHeadline(name),'no words are dropped: '+name);
  if(name.length>12){assert.ok(size<112,name);assert.ok(size<=last,name);last=size;}
  const drawn=headlineSvg(font,reportHeadline(name));
  assert.ok(drawn,name);
 }
});

test('a name the font can’t draw falls back to the generic headline',async()=>{
 const font=await loadFont();
 assert.equal(covers(font,reportHeadline('李')),false);
 assert.equal(covers(font,reportHeadline('Zoë')),true);
 assert.equal(headlineSvg(font,reportHeadline('🦄')),null);
});

test('the preview image is 1200×630, named and cached for a live share, and generic for a link that is off',async()=>{
 const named=await get(store('William'));
 assert.equal(named.statusCode,200);assert.equal(named.headers['Content-Type'],'image/png');
 const meta=await sharp(named.body).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,630);
 assert.match(named.headers['Cache-Control'],/s-maxage=86400/);
 for(const s of [store('William',{shared:false}),store(null),store('🦄'),store('x'.repeat(41))]){
  const res=await get(s);assert.equal(res.statusCode,200);assert.match(res.headers['Cache-Control'],/s-maxage=60\b/);
 }
 // The off link and the no-name link draw the same generic image.
 assert.ok((await get(store('William',{shared:false}))).body.equals((await get(store(null))).body));
 assert.ok(!named.body.equals((await get(store(null))).body));
 assert.equal((await get(store('William'),'/api/image?share_preview=nope')).statusCode,404);
});

test('the image endpoint serves the share preview without sign-in',async()=>{
 const handler=createImageHandler({auth:async()=>403,storeFactory:()=>store('William'),previewHandler:()=>assert.fail()});
 const res=response();await handler({method:'GET',url:`/api/image?share_preview=${token}&v=1`,headers:{}},res);
 assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/png');
});
