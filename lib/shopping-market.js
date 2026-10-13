import {prevails} from './memory.js';
export function shoppingMarket(facts=[],env={}){
 // Beliefs resolve by basis, then recency (see memory.js).
 const pick=field=>facts.filter(f=>!f.deleted&&f.field===field&&f.key==='primary').sort((a,b)=>prevails(a,b)?-1:prevails(b,a)?1:0)[0]?.value;
 const country=pick('country')??env.SHOPPING_COUNTRY??'US';
 const currency=pick('currency')??env.SHOPPING_CURRENCY??({US:'USD',CA:'CAD',GB:'GBP',AU:'AUD'}[country]??null);
 return {country:/^[A-Z]{2}$/.test(country)?country:'US',currency:currency&&/^[A-Z]{3}$/.test(currency)?currency:null};
}
export const marketEnvironment=(facts,env)=>{const m=shoppingMarket(facts,env);return {...env,SHOPPING_COUNTRY:m.country,SHOPPING_CURRENCY:m.currency};};

