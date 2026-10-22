import {structuredColorOptions} from '../lib/product-variants.js';
import {listingProduct} from '../lib/product-photos.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fetchProductPhoto, productPhotoURL, listingPhotos, fetchListingPhotos, ynapPhotoURLs } from '../lib/product-photos.js';
import { sendGreeting, withoutLinks } from '../lib/photon.js';
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
test('Mr Porter photos come from the product number in the link when the store blocks its page',async()=>{
  const url='https://www.mrporter.com/en-us/mens/product/maison-margiela/clothing/lightweight-waterproof-jackets/mesh-trimmed-shell-jacket/46376663163148077';
  assert.deepEqual(ynapPhotoURLs(url),['in','fr','bk'].map(v=>`https://www.mrporter.com/variants/images/46376663163148077/${v}/w2000_q60.jpg`));
  assert.equal(ynapPhotoURLs('https://www.net-a-porter.com/en-us/shop/product/khaite/clothing/jeans/danielle-jeans/1647597312345678')[0],'https://www.net-a-porter.com/variants/images/1647597312345678/in/w2000_q60.jpg');
  assert.deepEqual(ynapPhotoURLs('https://www.mrporter.com/en-us/mens/designer/maison-margiela'),[]);
  assert.deepEqual(ynapPhotoURLs('https://www.ssense.com/en-us/men/product/satisfy/shirt/19506071'),[]);
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).jpeg().toBuffer();
  const requested=[];
  const images=await fetchListingPhotos(url,'Mesh-Trimmed Shell Jacket',async target=>{requested.push(target);return target===url?new Response('Forbidden',{status:403}):new Response(bytes,{headers:{'content-type':'image/jpeg'}});},()=>assert.fail('no render needed'));
  assert.equal(images.length,3);assert.equal(images[0].source_url,url);assert.match(images[0].asset_url,/\/46376663163148077\/in\//);
  assert.ok(!requested.includes(url));
});
test('a wrong Mr Porter product number falls back to reading the page',async()=>{
  const url='https://www.mrporter.com/en-us/mens/product/a/b/c/123456789';
  let rendered=0;
  await assert.rejects(fetchListingPhotos(url,'Jacket',async target=>target===url?new Response('Forbidden',{status:403}):new Response('Not found',{status:404}),async()=>{rendered++;throw Error('blocked');}));
  assert.equal(rendered,1);
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
test('transparent product photos get a white background, not black',async()=>{
  const clear=await sharp({create:{width:8,height:8,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  const bytes=await fetchProductPhoto(photoURL,async()=>new Response(clear,{headers:{'content-type':'image/png'}}));
  const {data}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
  assert.ok(data.subarray(0,3).every(v=>v>=250));
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

function transport({ failText = false, failCard = false } = {}) {
  const sent = [], logs = []; let stopped = false;
  const provider = () => ({ user: async () => ({}), space: { create: async () => ({ send: async input => {
    const content = typeof input === 'string' ? { type: 'text', text: input } : await input.build();
    sent.push(content);
    if (failText) throw new Error('Ambiguous send');
    if (failCard && (content.type === 'richlink' || content.content?.type === 'richlink')) throw new Error('Card failed');
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
  assert.match(sdk.sent[1].content.text, /Option 1: Test jacket\. Possible match/);
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

test('website photos read schema.org ImageObject contentUrl and skip entries without a URL',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Transport Windowpane Waxed Jacket',image:[{'@type':'ImageObject',contentUrl:'https://www.barbour.com/front.jpg'},{'@type':'ImageObject'},{'@type':'ImageObject',url:'https://www.barbour.com/back.jpg'}]})+'</script>';
 assert.deepEqual(listingPhotos(html,'Transport Windowpane Waxed Jacket','https://www.barbour.com/products/jacket'),['https://www.barbour.com/front.jpg','https://www.barbour.com/back.jpg']);
});

test('a canonical multi-color ProductGroup establishes identity without assigning one variant price or stock',()=>{
 const url='https://visionaryoptics.com/products/romi';
 const group={'@type':'ProductGroup','@id':'/products/romi#product',name:'Jacques Marie Mage Romi Sunglasses',brand:{name:'Jacques Marie Mage'},hasVariant:[{'@type':'Product',name:'Jacques Marie Mage Romi Sunglasses - 6D Agar Yellow',color:'6D Agar Yellow',url:url+'?variant=1',offers:{price:'960',priceCurrency:'USD'}},{'@type':'Product',name:'Jacques Marie Mage Romi Sunglasses - Black',color:'Black',url:url+'?variant=2',offers:{price:'990',priceCurrency:'USD'}}]};
 const html='<script type="application/ld+json">'+JSON.stringify(group)+'</script>';
 const product=listingProduct(html,'Jacques Marie Mage Romi Sunglasses 6D Agar Yellow',url);
 assert.equal(product.name,group.name);assert.deepEqual(product.offers,[]);assert.equal(product.color,null);assert.equal(product.hasVariant.length,2);assert.deepEqual(structuredColorOptions(product,url).map(c=>c.color),['6D Agar Yellow','Black']);
 assert.equal(structuredColorOptions({...group,hasVariant:[{color:'Fake',url:'https://other.example/products/romi?variant=3'}]},url).length,0);
 assert.equal(listingProduct(html,'Romi Sunglasses',url+'?variant=unlisted'),null);
});

const card = 'https://jules.example/go/token.0.sig';
const cardOf = content => content.type === 'richlink' ? content : content.content?.type === 'richlink' ? content.content : null;
test('a text-search product goes out as its own preview card after the answer', async () => {
  const sdk = transport();
  await sendGreeting(delivery, 'Two picks https://jules.example/go/a https://jules.example/go/b', {}, { ...sdk.options,
    products: [{ name: 'Muscle Tee', preview_url: card }, { name: 'Ripped tee', preview_url: card.replace('.0.', '.1.') }], loadPhoto: assert.fail });
  assert.equal(sdk.sent.length, 3, 'answer + one card per product, no captions or photos');
  assert.equal(sdk.sent[0].text.includes('Two picks'), true);
  assert.equal(cardOf(sdk.sent[1]).url, card); assert.equal(sdk.sent[1].type, 'richlink', 'not threaded without a caption');
  assert.deepEqual(sdk.logs.map(l => l.event), ['product_rich_preview_sent', 'product_rich_preview_sent']);
});
test('a photo-search product gets its caption with the card in place of the photo', async () => {
  const sdk = transport();
  await sendGreeting(delivery, 'Possible jacket match', {}, { ...sdk.options, replyTarget: delivery.message,
    products: [{ name: 'Test jacket', caption: 'Closest match: same collar.', candidate_image: photoURL, preview_url: card }], loadPhoto: assert.fail });
  assert.equal(sdk.sent.length, 3);
  assert.equal(sdk.sent[1].content.text, 'Closest match: same collar.'); assert.equal(sdk.sent[1].target.id, 'test-sent-1');
  assert.equal(cardOf(sdk.sent[2]).url, card); assert.equal(sdk.sent[2].target.id, 'test-sent-2', 'the card threads under its caption');
  const plain = transport();
  await sendGreeting(delivery, 'Possible jacket match', {}, { ...plain.options, products: [{ name: 'Test jacket', match: 'similar', candidate_image: photoURL, preview_url: card }], loadPhoto: assert.fail });
  assert.match(plain.sent[1].content.text, /Option 1: Test jacket\. Similar alternative/, 'without a caption the card still says it is not the exact item');
});
test('a failed card falls back to the photo under the same caption; the answer is never resent', async () => {
  const sdk = transport({ failCard: true });
  await sendGreeting(delivery, 'Possible jacket match', {}, { ...sdk.options, replyTarget: delivery.message,
    products: [{ name: 'Test jacket', caption: 'Closest match.', candidate_image: photoURL, preview_url: card }], loadPhoto: async () => Buffer.from('photo') });
  const kinds = sdk.sent.map(c => cardOf(c) ? 'card' : c.content?.type ?? c.type);
  assert.deepEqual(kinds, ['text', 'text', 'card', 'attachment']);
  assert.equal(sdk.sent[3].target.id, 'test-sent-2', 'the photo goes under the caption already sent, which is not repeated');
  assert.deepEqual(sdk.logs.map(l => l.event), ['product_rich_preview_failed', 'imessage_product_photo_sent']);
  const text = transport({ failCard: true });
  const sent = await sendGreeting(delivery, 'Picks https://jules.example/go/a', {}, { ...text.options, products: [{ name: 'Muscle Tee', preview_url: card }], loadPhoto: assert.fail });
  assert.equal(sent.id, 'test-sent-1'); assert.equal(text.sent.length, 2, 'no photo to fall back to: the text link stands');
});
test('a product with its own card is not also linked in the answer; a failed card sends the link instead', async () => {
  const second = card.replace('.0.', '.1.');
  const sdk = transport();
  await sendGreeting(delivery, `Two picks:\n\n1. Muscle tee, $40\n${card}\n\n2. Ripped tee, $55\n${second}\n\nWhich one?`, {}, { ...sdk.options,
    products: [{ name: 'Muscle Tee', preview_url: card }, { name: 'Ripped tee', preview_url: second }], loadPhoto: assert.fail });
  assert.equal(sdk.sent[0].text, 'Two picks:\n\n1. Muscle tee, $40\n\n2. Ripped tee, $55\n\nWhich one?');
  assert.deepEqual(sdk.sent.slice(1).map(c => cardOf(c)?.url), [card, second]);
  const failing = transport({ failCard: true });
  await sendGreeting(delivery, `Pick:\n1. Muscle tee\n${card}`, {}, { ...failing.options, products: [{ name: 'Muscle Tee', preview_url: card }], loadPhoto: assert.fail });
  assert.equal(failing.sent[0].text, 'Pick:\n1. Muscle tee');
  assert.equal(failing.sent.at(-1).content.text, card, 'the link goes out on its own, under the answer');
  assert.equal(failing.sent.at(-1).target.id, 'test-sent-1');
  assert.deepEqual(failing.logs.map(l => l.event), ['product_rich_preview_failed', 'product_link_sent']);
  // A product link without a card, and other links, stay in the text.
  assert.equal(withoutLinks('See https://textjules.com/wishlist', [card]), 'See https://textjules.com/wishlist');
  assert.equal(withoutLinks(card, [card]), card, 'an answer that is only the link keeps it');
});
