// What a shopper is willing to pay, as a price band for one request. The model reads the shopper's
// words: memory saves budgets (key scope/currency, value MIN-MAX) and spending facts (prefers_lower,
// quality), and the search plan names which saved budget fits this item or the limit stated for it.
// Code only parses those stored values and compares verified prices against the band. A band is a
// soft signal except for its ceiling: a verified price above it never takes a slot an in-budget
// option could fill. An unknown price stays unknown and is never judged.
import {shoppingMarket} from './shopping-market.js';
import {quoted} from './memory.js';
export {SPENDING_KEYS} from './memory.js';
const ISO=/^[A-Z]{3}$/;
// Far below the band reads as a quality concern, never a filter: under half a stated floor, or, when
// the shopper likes quality pieces and set no floor, under a tenth of their ceiling ($50 for $500).
const BELOW_FLOOR=0.5,BELOW_CEILING=0.1;
const number=text=>{const n=Number(String(text).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;};
// A saved budget value is "MIN-MAX", "-MAX" or "MIN-". Facts saved before October 19 used free
// text ("400-500", "$300"); their numbers are read the same way. One number is a ceiling.
export function parseBudget(value){
  const text=String(value??'').trim();
  const canonical=text.match(/^(\d[\d,]*(?:\.\d+)?)?\s*-\s*(\d[\d,]*(?:\.\d+)?)?$/);
  if(canonical&&(canonical[1]||canonical[2])){
    const min=canonical[1]?number(canonical[1]):null,max=canonical[2]?number(canonical[2]):null;
    return min!==null&&max!==null&&min>max?{min:max,max:min}:{min,max};
  }
  const found=[...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m=>number(m[0])).filter(n=>n!==null);
  if(found.length===1)return {min:null,max:found[0]};
  if(found.length===2)return {min:Math.min(...found),max:Math.max(...found)};
  return null;
}
// Budgets saved before October 19 have no format mark: free text whose key often ended in the literal
// word "currency", and a spoken range ("up to 400-500" saved as 400-500). They keep only their
// ceiling: the lower number was where the ceiling sits, not a floor the shopper asked for. A key
// without an ISO currency means the shopper's market currency.
const keyCurrency=key=>{const c=String(key??'').split('/')[1]?.trim().toUpperCase();return ISO.test(c??'')?c:null;};
const legacy=fact=>fact.format!=='range';
export function savedBudgets(facts=[]){
  return facts.filter(f=>!f.deleted&&f.field==='budget'&&f.key).flatMap(f=>{
    const range=parseBudget(f.value);if(!range)return [];
    const old=legacy(f);
    return [{key:f.key,scope:String(f.key).split('/')[0],min:old?null:range.min,max:range.max,currency:keyCurrency(f.key),evidence_ids:f.evidence_ids??[],legacy:old}];
  });
}
const spending=(facts,key)=>facts.find(f=>!f.deleted&&f.field==='spending'&&f.key===key)??null;
// The band for this request. A price stated for this request wins; otherwise the saved budget the
// plan names (validated against saved keys), else the only saved budget, else the widest ceiling so
// nothing within any stated budget is hidden. Purchase history never sets a band. A request for
// someone else uses only what was stated for it: the shopper's own stance is about their own pieces.
// Wanting lower prices for this request without an amount (plan.price.stance) leans cheaper like the
// saved prefers_lower stance: no ceiling, nothing left out.
export function priceBand({facts=[],plan=null,forSomeoneElse=false,env={}}={}){
  const market=shoppingMarket(facts,env).currency;
  const stated=plan?.price,statedRange=stated&&(Number.isFinite(stated.max)||Number.isFinite(stated.min))?{min:Number.isFinite(stated.min)&&stated.min>=0?stated.min:null,max:Number.isFinite(stated.max)&&stated.max>0?stated.max:null}:null;
  const prefers=forSomeoneElse?null:spending(facts,'prefers_lower'),quality=forSomeoneElse?null:spending(facts,'quality'),requestLower=stated?.stance==='prefers_lower';
  const stance={prefers_lower:Boolean(prefers)||requestLower,quality:Boolean(quality),evidence_ids:[prefers,quality].flatMap(f=>f?.evidence_ids??[])};
  if(statedRange&&(statedRange.min!==null||statedRange.max!==null))
    return {...statedRange,currency:ISO.test(stated.currency??'')?stated.currency:market,source:'request',scope:null,...stance};
  if(forSomeoneElse)return requestLower?{min:null,max:null,currency:market,source:'stance',scope:null,...stance}:null;
  const budgets=savedBudgets(facts);
  const chosen=budgets.find(b=>b.key===stated?.budget_key)??(budgets.length===1?budgets[0]:budgets.filter(b=>b.max!==null).sort((a,b)=>b.max-a.max)[0]);
  if(!chosen&&!stance.prefers_lower&&!stance.quality)return null;
  return {min:chosen?.min??null,max:chosen?.max??null,currency:chosen?.currency??market,source:chosen?'saved':'stance',scope:chosen?.scope??null,budget_key:chosen?.key??null,...stance,evidence_ids:[...(chosen?.evidence_ids??[]),...stance.evidence_ids]};
}
// An amount on the plan must be the user's: its amount_quote is found in one of their messages and
// states an amount (its numerals are the plan's amounts, or it spells one out), or it is the amount
// already on the plan this request continues. Otherwise it is dropped and logged, so a ceiling the
// model picked can never filter results or be called the user's budget (October 21: "cool shirts
// that aren't expensive" became a $50 ceiling). The stance it read stays.
const SPELLED=/\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|grand)\b/i;
const statesAmount=(quote,price)=>{
  const numerals=[...quote.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi)].map(m=>number(m[1])*(m[2]?1000:1));
  if(!numerals.length)return SPELLED.test(quote);
  return ['min','max'].every(k=>!Number.isFinite(price[k])||numerals.includes(price[k]));
};
export function supportedPrice(plan,messages=[],previous=null){
  const price=plan?.price;
  if(!price||!['min','max'].some(k=>Number.isFinite(price[k])))return plan;
  const kept=plan.continuation===true&&['min','max'].every(k=>!Number.isFinite(price[k])||price[k]===previous?.[k]);
  const quote=typeof price.amount_quote==='string'?price.amount_quote.trim():'';
  if(kept||quote&&statesAmount(quote,price)&&messages.some(m=>m?.direction==='inbound'&&quoted(m.body,quote)))return plan;
  console.log(JSON.stringify({event:'price_amount_unsupported',min:price.min??null,max:price.max??null,quote:quote||null}));
  return {...plan,price:{...price,min:null,max:null,currency:null,unsupported_amount:{min:price.min??null,max:price.max??null,quote:quote||null}}};
}
// A listing's verified price for comparison: its one price, else the lowest of its size/color range.
export function verifiedPrice(p){
  const s=p?.price_snapshot;
  if(s&&Number.isFinite(s.amount)&&ISO.test(s.currency??''))return {amount:s.amount,currency:s.currency};
  const r=p?.listing_check?.price_range;
  if(r&&Number.isFinite(r.min)&&ISO.test(r.currency??''))return {amount:r.min,currency:r.currency};
  return null;
}
// in_band, over (verified above the ceiling), below (far under the band), or unknown (no verified
// price, or one in another currency: prices are never converted).
export function priceFit(p,band){
  if(!band)return 'unknown';
  const price=verifiedPrice(p);
  if(!price||price.currency!==band.currency)return 'unknown';
  if(band.max!==null&&price.amount>band.max)return 'over';
  const floor=band.min!==null&&band.min>0?band.min*BELOW_FLOOR:band.quality&&band.max!==null?band.max*BELOW_CEILING:null;
  if(floor!==null&&price.amount<floor)return 'below';
  return 'in_band';
}
// Selection order: far-below listings after the rest; with prefers_lower, cheaper in-band listings
// first. Stable, so the earlier order (market, search) decides ties.
export function priceOrder(band){
  const tier=p=>priceFit(p,band)==='below'?1:0;
  return (a,b)=>tier(a)-tier(b)||(band?.prefers_lower&&priceFit(a,band)==='in_band'&&priceFit(b,band)==='in_band'?verifiedPrice(a).amount-verifiedPrice(b).amount:0);
}
export const moneyText=(amount,currency)=>{try{return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:Number.isInteger(amount)?0:2}).format(amount);}catch{return `${amount} ${currency}`;}};
// Plain description of the band for search briefs, the stylist and the ranker.
export function bandSummary(band){
  if(!band)return null;
  const range=band.min!==null&&band.max!==null?`${moneyText(band.min,band.currency)}–${moneyText(band.max,band.currency)}`:band.max!==null?`up to ${moneyText(band.max,band.currency)}`:band.min!==null?`from ${moneyText(band.min,band.currency)}`:null;
  return {range,currency:band.currency,scope:band.scope,source:band.source,prefers_lower:band.prefers_lower,quality:band.quality};
}
