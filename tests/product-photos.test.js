import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fetchProductPhoto, productPhotoURL, listingPhotos, fetchListingPhotos } from '../lib/product-photos.js';
import { sendGreeting } from '../lib/photon.js';
import { receiveInInbox } from '../lib/inbox.js';

const photoURL = 'https://encrypted-tbn0.gstatic.com/images?q=test';
test('SSENSE photo sourcing uses observed Open Graph images instead of unresolved CDN templates',async()=>{
  const url='https://www.ssense.com/en-us/men/product/satisfy/gray-mothtech-waffle-long-t-shirt/19506071';
  const image='https://img.ssensemedia.com/images/w_640/262733M213012_1/satisfy-gray-mothtech-waffle-long-t-shirt.jpg';
  const product={'@type':'Product',name:'Gray MothTech Waffle Long T-shirt',brand:{name:'Satisfy'},url,image:image.replace('w_640','__IMAGE_PARAMS__')};
  const html='<script type="application/ld+json">'+JSON.stringify(product)+'</script><meta property="og:image" content="'+image+'">';
  assert.deepEqual(listingPhotos(html,'Satisfy Gray MothTech Waffle Long T-shirt',url),[image]);
  assert.deepEqual(listingPhotos(html,'Leather Running Shorts',url),[]);
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).jpeg().toBuffer();
  const images=await fetchListingPhotos(url,product.name,async target=>target===url?new Response(html,{headers:{'content-type':'text/html'}}):new Response(bytes,{headers:{'content-type':'image/jpeg'}}));
  assert.equal(images.length,1);assert.equal(images[0].asset_url,image);assert.equal(images[0].source_url,url);
});
test('a successful HTTP response without product metadata recovers photos through rendering',async()=>{
  const url='https://www.ssense.com/en-us/men/product/satisfy/gray-mothtech-waffle-long-t-shirt/19506071';
  const image='https://img.ssensemedia.com/images/w_640/262733M213012_1/satisfy-gray-mothtech-waffle-long-t-shirt.jpg';
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Gray MothTech Waffle Long T-shirt',url,image})+'</script>';
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).jpeg().toBuffer();
  let rendered=0;
  const images=await fetchListingPhotos(url,'Gray MothTech Waffle Long T-shirt',async target=>target===url?new Response('<html>Loading...</html>',{headers:{'content-type':'text/html'}}):new Response(bytes,{headers:{'content-type':'image/jpeg'}}),async target=>{rendered++;assert.equal(target,url);return {html,url};});
  assert.equal(rendered,1);assert.equal(images[0].asset_url,image);
});
test('product photos allow only compared Google thumbnails and reject unsafe, oversized, and invalid downloads', async () => {
  for (const url of ['http://encrypted-tbn0.gstatic.com/a', 'https://encrypted-tbn0.gstatic.com.evil.test/a', 'https://user@encrypted-tbn0.gstatic.com/a', 'https://127.0.0.1/a']) {
    assert.equal(productPhotoURL(url), null);
    await assert.rejects(fetchProductPhoto(url, () => assert.fail('Unsafe URL fetched')));
  }
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  const bytes = await fetchProductPhoto(photoURL, async (url, options) => {
    assert.equal(url, photoURL); assert.equal(options.redirect, 'error');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  assert.equal((await sharp(bytes).metadata()).format, 'jpeg');
  for (const response of [new Response('not an image', { headers: { 'content-type': 'text/html' } }),
    new Response('bad bytes', { headers: { 'content-type': 'image/jpeg' } }),
    new Response(Buffer.alloc(1000001), { headers: { 'content-type': 'image/jpeg' } })]) {
    await assert.rejects(fetchProductPhoto(photoURL, async () => response));
  }
});

function transport({ failText = false } = {}) {
  const sent = [], logs = []; let stopped = false;
  const provider = () => ({ user: async () => ({}), space: { create: async () => ({ send: async input => {
    const content = typeof input === 'string' ? { type: 'text', text: input } : await input.build();
    sent.push(content);
    if (failText) throw new Error('Ambiguous send');
    return { id: `test-sent-${sent.length}`, content };
  } }) } });
  provider.config = () => ({});
  return { sent, logs, stopped: () => stopped, options: {
    provider, connect: async () => ({ stop: async () => { stopped = true; } }),
    log: value => logs.push(JSON.parse(value)),
  } };
}
const delivery = { space: { phone: 'test-line' }, message: {
  id: 'test-image', sender: { id: 'test-user' }, content: { type: 'attachment' }, attachments: [{}],
} };
test('answer threads to the original image; numbered photo label and photo follow without claiming exact identity', async () => {
  const sdk = transport();
  await sendGreeting(delivery, 'Possible jacket match\nhttps://example.com/jacket', {}, {
    ...sdk.options, replyTarget: delivery.message,
    products: [{ name: 'Test jacket', match: 'likely_match', candidate_image: photoURL }],
    loadPhoto: async () => Buffer.from('test-photo'),
  });
  assert.equal(sdk.sent[0].type, 'reply'); assert.equal(sdk.sent[0].target.id, 'test-image');
  assert.match(sdk.sent[1].content.text, /Product photo 1: Test jacket\. Possible match/);
  assert.equal(sdk.sent[1].target.id, 'test-sent-1');
  assert.equal(sdk.sent[2].content.type, 'attachment'); assert.equal(sdk.sent[2].target.id, 'test-sent-2');
  assert.equal(sdk.stopped(), true);
});
test('unavailable photos preserve the text reply; ambiguous text sends never retry or send photos', async () => {
  const sdk = transport();
  await sendGreeting(delivery, 'Answer', {}, { ...sdk.options, replyTarget: delivery.message,
    products: [{ candidate_image: photoURL }], loadPhoto: async () => { throw new Error('offline'); } });
  assert.equal(sdk.sent.length, 1); assert.equal(sdk.logs[0].stage, 'download');
  const failed = transport({ failText: true });
  await assert.rejects(sendGreeting(delivery, 'Answer', {}, { ...failed.options, replyTarget: delivery.message,
    products: [{ candidate_image: photoURL }], loadPhoto: async () => assert.fail() }));
  assert.equal(failed.sent.length, 1); assert.equal(failed.stopped(), true);
});
test('follow-up searches retain the original provider image ID and pass only saved visual results to delivery', async () => {
  let reserved = false, calls = 0;
  const products = [{ name: 'Test jacket', candidate_image: photoURL }];
  const store = { receive: async () => 'test-conversation', claimAI: async () => { if (reserved) return false; reserved = true; return true; },
    context: async () => [{ id: 'test-db-image', provider_id: 'test-original-image', direction: 'inbound', message_images: [{}] }],
    imagesForMessage: async id => { assert.equal(id, 'test-db-image'); return [{}]; }, searchResult: async () => {},
    prepareAI: async () => {}, finish: async () => {} };
  const options = { store, progress: async () => async () => {}, generate: async (context, env, fetcher, memory) => {
    await memory.loadImages(); await memory.recordSearch({ identification_policy: 'visual_comparison', products }); return 'Answer';
  }, send: async (received, body, env, rich) => {
    calls++; assert.equal(rich.replyTarget.id, 'test-original-image'); assert.deepEqual(rich.products, products);
  } };
  const followup = { ...delivery, message: { ...delivery.message, id: 'test-followup', attachments: [] } };
  await receiveInInbox(followup, { AI_ENABLED: 'true' }, options);
  await receiveInInbox(followup, { AI_ENABLED: 'true' }, options);
  assert.equal(calls, 1);
});

test('website photos require matching structured product data and trusted asset URLs',async()=>{
 const make=data=>'<script type="application/ld+json">'+JSON.stringify(data)+'</script>';
 const data={'@type':'Product',name:'Transport Windowpane Waxed Jacket',image:['https://www.barbour.com/jacket.jpg','https://127.0.0.1/private']};
 assert.deepEqual(listingPhotos(make(data),'Transport Windowpane Waxed Jacket'),['https://www.barbour.com/jacket.jpg']);
 assert.deepEqual(listingPhotos(make({...data,name:'Other jacket'}),'Transport Windowpane Waxed Jacket'),[]);
 assert.deepEqual(listingPhotos('<meta property="og:image" content="https://www.barbour.com/category.jpg">','Jacket'),[]);
 await assert.rejects(fetchListingPhotos('https://barbour.com.evil.invalid/a','Jacket',()=>assert.fail()));
 const png=await sharp({create:{width:500,height:700,channels:3,background:'white'}}).png().toBuffer();
 const images=await fetchListingPhotos('https://www.barbour.com/jacket','Transport Windowpane Waxed Jacket',async(url,options)=>{
 assert.equal(options.redirect,url.endsWith('.jpg')?'manual':'error');return url.endsWith('.jpg')?new Response(png,{headers:{'content-type':'image/png'}}):new Response(make(data),{headers:{'content-type':'text/html'}});
 });
 assert.equal(images.length,1);assert.equal(images[0].source_url,'https://www.barbour.com/jacket');assert.equal((await sharp(Buffer.from(images[0].data,'base64')).metadata()).width,500);
});
