import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listingProduct} from '../lib/product-photos.js';
import {verifyListing} from '../lib/listings.js';
import {structuredJSON,pradaProductDetails,productShoppingRange} from '../lib/structured-product.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
const name='Speedrock leather and mesh fabric sneakers';
const sku='2EE468_3ZM0_F0002_F_G000';
const url='https://www.prada.com/us/en/p/speedrock-leather-and-mesh-fabric-sneakers/'+sku;
const navy=url.replace('F0002','F0008');
// Minimal regression fixture from the public Prada page's representation,
// retaining facts/structure only, not the full storefront or marketing copy.
const product={'@type':'Product',name,sku,url,offers:{price:'1170',availability:'http://schema.org/InStock'}};
const html='<script type="application/ld+json">'+JSON.stringify(product).replaceAll('"','&quot;')+'</script>'+
  `<a href="${url}" title="Black" data-element="colorpicker-dot"></a><a href="${navy}" title="Navy" data-element="colorpicker-dot"></a>`+
  '<script id="__NUXT_DATA__" type="application/json">[{"currentIso":1},"USD"]</script>';
test('product-bound seasonal department metadata identifies womenswear independently of navigation',()=>{
  const page='https://www.driesvannoten.com/en-us/products/262-010932-4210';
  assert.equal(productShoppingRange('<nav>MEN WOMEN</nav>',page,{name:'Crepe skirt pants',brand:'AW26 WOMEN'}),'women');
  assert.equal(productShoppingRange('<nav>WOMEN</nav>',page,{name:'Cotton trousers',brand:{name:'AW26 MEN'}}),'men');
  assert.equal(productShoppingRange('<nav>WOMEN</nav>',page,{name:'Cotton trousers',brand:'Dries Van Noten'}),null);
});
test('entity-encoded Prada product metadata is parsed without weakening product-page checks',()=>{
  assert.equal(listingProduct(html,name).sku,sku);
  assert.ok(!listingProduct(html,'Unrelated hiking boots'));
  assert.equal(listingProduct(html+'<script type="application/ld+json">{"@type":"CollectionPage"}</script>',name),null);
  assert.equal(structuredJSON('{"name":"A &amp; B"}').name,'A &amp; B');
  assert.equal(structuredJSON('{&#34;name&#34;:&#34;A&#34;}').name,'A');
});
test('Prada live-page facts yield selected color and explicit currency; mismatched models and unknown currencies remain unknown',async()=>{
  const check=await verifyListing(url,name,async()=>new Response(html,{headers:{'content-type':'text/html'}}));
  assert.equal(check.status,'verified');assert.equal(check.color,'Black');assert.equal(check.price_snapshot.amount,1170);assert.equal(check.price_snapshot.currency,'USD');
  assert.equal(check.color_options[1].url,navy);
  const missing=await verifyListing(url,name,async()=>new Response(html.replace('"USD"','"unknown"'),{headers:{'content-type':'text/html'}}));
  assert.equal(missing.price_snapshot,null);
  assert.deepEqual(pradaProductDetails(html,url.replace(sku,'different'),product),{});
  const hostile=html+`<a href="https://evil.example/${sku}" title="Brown" data-element="colorpicker-dot"></a>`+`<a href="${url.replace('2EE468','2EE469')}" title="Brown" data-element="colorpicker-dot"></a>`;
  assert.equal(pradaProductDetails(hostile,url,product).color_options.length,2);
});
test('text wishlist expands only retailer-provided, independently verified color links',async()=>{
  const primary={brand:'Prada',name,url,match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',color:'Black',color_options:[{url:navy,color:'Navy'}]}};
  let state,seen=[];
  const body=await textWishlistAction({action:'start',query:'Prada Speed Rock sneakers'},{env:{},record:async r=>{state=r.text_wishlist_state;},search:async()=>({products:[primary]}),verify:async link=>{seen.push(link);return {status:'verified',url:link,color:'Navy'};}});
  assert.deepEqual(seen,[navy]);assert.equal(state.options.length,2);assert.match(body,/Navy/);
});
test('failed retailer checks are retained for diagnosis and do not blame the user’s model spelling',async()=>{
  let recorded;
  const body=await textWishlistAction({action:'start',query:'Prada Speedrock'},{env:{},record:async r=>{recorded=r;},search:async()=>({status:'identified_no_store',products:[{url,match:'likely_match',sourcing_status:'store_not_found',listing_checks:[{status:'not_product'}]}]})});
  assert.doesNotMatch(body,/double-check|https:/);assert.equal(recorded.text_wishlist_state,null);assert.equal(recorded.text_wishlist_diagnostics.candidates[0].checks[0].status,'not_product');
});
