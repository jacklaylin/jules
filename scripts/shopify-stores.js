// Refreshes lib/shopify-stores.json: which registry stores (lib/source-registry.js) Shop's catalog
// carries, so a request for that brand can search its own store directly. Run monthly or after
// editing the registry:  node scripts/shopify-stores.js
// A store counts only when Shop returns products whose seller is that exact domain.
import {writeFile} from 'node:fs/promises';
import {RETAILERS} from '../lib/retailers.js';
import {searchShop} from '../lib/shop.js';

const env={SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}};
const stores={},checked=[];
for(const r of RETAILERS){
 try{
  const {offers}=await searchShop(r.name,{env,shops:[r.domain],limit:3});
  const own=offers.filter(o=>host(o.seller.url)===r.domain||host(o.url)===r.domain);
  checked.push({domain:r.domain,on_shop:own.length>0});
  if(own.length)stores[r.domain]={name:r.name,tier:r.tier,brands:r.brands,shop_domain:own[0].seller.domain};
 }catch(error){checked.push({domain:r.domain,on_shop:null,error:error.code??'failed'});}
 await new Promise(resolve=>setTimeout(resolve,250));
}
await writeFile(new URL('../lib/shopify-stores.json',import.meta.url),JSON.stringify({checked_at:new Date().toISOString().slice(0,10),stores},null,1)+'\n');
const failed=checked.filter(c=>c.on_shop===null);
console.log(`${Object.keys(stores).length} of ${RETAILERS.length} registry stores are in Shop's catalog.${failed.length?` ${failed.length} could not be checked: ${failed.map(f=>f.domain).join(', ')}`:''}`);
