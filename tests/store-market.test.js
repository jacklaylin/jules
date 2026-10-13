import test from 'node:test';
import assert from 'node:assert/strict';
import {pageMarket,urlMarket,marketAlternates,alternateFor,shipsTo,marketRank,marketLabel} from '../lib/store-market.js';
import {verifyListing} from '../lib/listings.js';

const product=(currency,price,extra={})=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'GEL-KAYANO 14',brand:{name:'ASICS'},offers:{price,priceCurrency:currency,availability:'https://schema.org/InStock',...extra}})+'</script>';
const ca='https://www.asics.com/ca/en-ca/gel-kayano-14/p/1202A056-021.html',us='https://www.asics.com/us/en-us/gel-kayano-14/p/1202A056-021.html';
const alternates='<link rel="alternate" hreflang="en-ca" href="'+ca+'"><link rel="alternate" hreflang="en-us" href="'+us+'"><link rel="alternate" hreflang="fr-ca" href="https://www.asics.com/ca/fr-ca/x">';

test('store market comes from what the page and URL declare, never from the shopper',()=>{
  assert.equal(urlMarket(ca),'CA');assert.equal(urlMarket('https://www.jdsports.it/product/x/1'),null);assert.equal(urlMarket('https://shop.example/en/products/x'),null);
  assert.equal(urlMarket('https://shop.example/it-it/products/x'),'IT');assert.equal(urlMarket('https://shop.example/uk/products/x'),'GB');
  assert.deepEqual(pageMarket('<script>Shopify.country = "IT";</script>','https://shop.example/products/x',[{priceCurrency:'EUR'}]),{country:'IT',currency:'EUR',basis:'shopify'});
  assert.equal(pageMarket('<html lang="it-IT">','https://www.jdsports.it/product/x',[]).country,'IT');
  assert.equal(pageMarket('<html lang="en">','https://shop.example/products/x',[]).country,null);
  const alts=marketAlternates(alternates,ca);assert.equal(alternateFor(alts,'US').url,us);assert.equal(alternateFor(alts,'CA').hreflang,'en-ca');assert.equal(alternateFor(alts,'IT'),null);
});
test('shipping evidence comes only from structured shipping destinations',()=>{
  const offer=countries=>({shippingDetails:{shippingDestination:countries.map(c=>({addressCountry:c}))}});
  assert.equal(shipsTo([offer(['US','CA'])],'US'),true);assert.equal(shipsTo([offer(['IT','FR'])],'US'),false);assert.equal(shipsTo([{price:1}],'US'),null);
});
test('a foreign page that declares a US version is checked there; otherwise it is kept and labeled truthfully',async()=>{
  const pages={[ca]:'<html lang="en-CA">'+alternates+product('CAD','230'),[us]:'<html lang="en-US">'+alternates+product('USD','165')};
  const fetcher=async url=>new Response(pages[url]??'',{status:pages[url]?200:404,headers:{'content-type':'text/html'}});
  const resolved=await verifyListing(ca,'GEL-KAYANO 14',fetcher,async()=>{throw Error('no browser');},{SHOPPING_COUNTRY:'US'});
  assert.equal(resolved.status,'verified');assert.equal(resolved.url,us);assert.equal(resolved.market_match,true);assert.equal(resolved.market_resolved_from,ca);assert.equal(resolved.price_snapshot.amount,165);
  // No US version: keep it, record the real market and its own-currency price, never claim US shipping.
  const it='https://www.jdsports.it/product/asics-gel-kayano-14/19739636/';
  const foreign=await verifyListing(it,'GEL-KAYANO 14',async()=>new Response('<html lang="it-IT">'+product('EUR','160'),{headers:{'content-type':'text/html'}}),async()=>{throw Error('no browser');},{SHOPPING_COUNTRY:'US'});
  assert.equal(foreign.market_match,false);assert.equal(foreign.store_market.country,'IT');assert.equal(foreign.price_snapshot,null);
  assert.deepEqual(foreign.foreign_price,{amount:160,currency:'EUR'});assert.equal(foreign.ships_to_shopper,null);assert.equal(foreign.market_country,'US');
  assert.equal(marketLabel(foreign,'US'),' · Italy store, €160.00, US shipping unconfirmed');
});
test('ranking prefers the shopper’s market, then foreign stores with shipping evidence; nothing is dropped',()=>{
  const local={market_match:true},unknown={market_match:null},ships={market_match:false,ships_to_shopper:true},unconfirmed={market_match:false,ships_to_shopper:null},no={market_match:false,ships_to_shopper:false};
  assert.deepEqual([no,unconfirmed,ships,unknown,local].sort((a,b)=>marketRank(a)-marketRank(b)),[local,ships,unknown,unconfirmed,no]);
  assert.equal(marketLabel(local,'US'),'');assert.match(marketLabel({...ships,store_market:{country:'CA'}},'US'),/Canada store, ships to the US/);
});
