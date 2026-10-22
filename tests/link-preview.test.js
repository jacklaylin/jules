import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {splitLinkPreview,withoutPageLink} from '../lib/link-preview.js';
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
const deliver=async(body,fail)=>{
 const sent=[],logs=[];
 const conversation={send:async input=>{const content=typeof input==='string'?{type:'text',text:input}:await input.build();sent.push(content);if(fail&&content.type==='richlink')throw Error('Transport interrupted');return {id:'message'};}};
 const result=await sendGreeting({space:{phone:'test-only'},message:{sender:{id:'test-only'}}},body,env,{connect:async()=>({stop:async()=>{}}),provider:Object.assign(()=>({user:async()=>({}),space:{create:async()=>conversation}}),{config:()=>({})}),log:line=>logs.push(JSON.parse(line))});
 return {result,sent,logs,text:sent.filter(c=>c.type==='text').map(c=>c.text)};
};
test('a site link with its own card leaves the text, and is sent as text when the card fails',async()=>{
 for(const fail of [false,true]){
  const {result,sent,logs,text}=await deliver('Add outfits here: https://jules.example/style',fail);
  assert.equal(result.id,'message');assert.equal(text[0],'Add outfits here:');
  assert.deepEqual(sent.find(c=>c.type==='richlink'),{type:'richlink',url:env.SITE_ORIGIN+'/style'});
  assert.equal(logs[0].event,fail?'link_rich_preview_failed':'link_rich_preview_sent');assert.equal(logs[0].kind,'style');
  // The link is never lost: the card carries it, or it follows as its own text.
  assert.equal(JSON.stringify(sent.slice(2)).includes(env.SITE_ORIGIN+'/style'),fail);
  if(fail)assert.equal(logs[1].event,'page_link_sent');
 }
});
test('a save confirmation names the items once: the wishlist link is the card, not also a line of text (October 21)',async()=>{
 // Wherever the writer put the link (its own line mid-message, after a sentence, before punctuation).
 for(const body of ['i saved the belt and the derbys to your wishlist.\nhttps://jules.example/wishlist\nanything else to add or find?',
  'i saved the belt and the derbys to your wishlist: https://jules.example/wishlist\n\nanything else to add or find?',
  'saved 2 items to your wishlist. https://jules.example/wishlist.']){
  const {sent,text}=await deliver(body,false);
  assert.ok(!text.join('\n').includes('https://'),'no wishlist link left in the text');
  assert.match(text[0],/saved/);assert.deepEqual(sent.filter(c=>c.type==='richlink'),[{type:'richlink',url:env.SITE_ORIGIN+'/wishlist'}]);
 }
 // A message that is only the link stays a message; other links, and two site links, are left as they are.
 assert.equal(withoutPageLink('https://jules.example/wishlist','https://jules.example/wishlist'),'https://jules.example/wishlist');
 assert.equal(withoutPageLink('see https://jules.example/wishlist-old and https://jules.example/wishlist','https://jules.example/wishlist'),'see https://jules.example/wishlist-old and');
 const two='https://jules.example/style and https://jules.example/wishlist';assert.deepEqual((await deliver(two,false)).text,[two]);
});
test('public cards have correct titles and bundled, compact 1200×630 artwork',async()=>{
 for(const [page,title,art] of [['index','Have to have it? Text Jules.','home'],['wishlist','Your wishlist','wishlist'],['style','Your style reading','style']]){
  const html=await readFile(new URL(`../public/${page}.html`,import.meta.url),'utf8');
  assert.ok(html.includes(`<meta property="og:title" content="${title}">`));
  assert.ok(html.includes(`https://textjules.com/brand/previews/${art}-v2.png`));
  const bytes=await readFile(new URL(`../public/brand/previews/${art}-v2.png`,import.meta.url));
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,630);assert.ok(bytes.length<600000);
 }
});
test('every LinkPreview surface is built, 1200×630 and compact, and its haze redraws the same way',async()=>{
 const {SURFACES,HAZES,haze}=await import('../scripts/link-preview-template.js');
 for(const {file,haze:key} of SURFACES){
  assert.ok(HAZES[key],file);
  const bytes=await readFile(new URL(`../public/brand/previews/${file}`,import.meta.url));
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,630);assert.ok(bytes.length<600000,file);
 }
 assert.deepEqual(haze('butter'),haze('butter'));
});
