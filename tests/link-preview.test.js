import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {splitLinkPreview} from '../lib/link-preview.js';
import {sendGreeting} from '../lib/photon.js';
const env={SITE_ORIGIN:'https://jules.example'};
test('supported public destinations receive cards without changing the conversation or losing the link',()=>{
 for(const [path,kind] of [['/style','style'],['/wishlist','collection'],['/','general']]){
  const body=`Take a look: ${env.SITE_ORIGIN}${path}`;
  assert.deepEqual(splitLinkPreview(body,env),{body,preview:env.SITE_ORIGIN+path,kind});
 }
 const body='See (https://jules.example/style).';assert.equal(splitLinkPreview(body,env).preview,env.SITE_ORIGIN+'/style');
 for(const body of ['https://other.example/style','https://jules.example.evil/style','https://user:password@jules.example/style','https://jules.example/style?token=private','https://jules.example/style#private','https://jules.example/login','https://jules.example/style and https://jules.example/wishlist','No link here'])assert.deepEqual(splitLinkPreview(body,env),{body});
 assert.deepEqual(splitLinkPreview('https://jules.example/style',{}),{body:'https://jules.example/style'});
});
test('style link is delivered even when the rich card fails, without claiming a reading exists',async()=>{
 for(const fail of [false,true]){
  const body='Add outfits here: https://jules.example/style',sent=[],logs=[];
  const conversation={send:async input=>{const content=typeof input==='string'?{type:'text',text:input}:await input.build();sent.push(content);if(fail&&content.type==='richlink')throw Error('Transport interrupted');return {id:'message'};}};
  const result=await sendGreeting({space:{phone:'test-only'},message:{sender:{id:'test-only'}}},body,env,{connect:async()=>({stop:async()=>{}}),provider:Object.assign(()=>({user:async()=>({}),space:{create:async()=>conversation}}),{config:()=>({})}),log:line=>logs.push(JSON.parse(line))});
  assert.equal(result.id,'message');assert.deepEqual(sent,[{type:'text',text:body},{type:'richlink',url:env.SITE_ORIGIN+'/style'}]);
  assert.equal(logs[0].event,fail?'link_rich_preview_failed':'link_rich_preview_sent');assert.equal(logs[0].kind,'style');
 }
});
test('public cards have correct titles and bundled, compact 1200×630 artwork',async()=>{
 for(const [page,title,art] of [['index','Have to have it? Text Jules.','fallback'],['wishlist','Your wishlist','fallback'],['style','Your style reading','style']]){
  const html=await readFile(new URL(`../public/${page}.html`,import.meta.url),'utf8');
  assert.ok(html.includes(`<meta property="og:title" content="${title}">`));
  assert.ok(html.includes(`https://textjules.com/brand/previews/${art}-v1.png`));
  const bytes=await readFile(new URL(`../public/brand/previews/${art}-v1.png`,import.meta.url));
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,630);assert.ok(bytes.length<600000);
 }
});
