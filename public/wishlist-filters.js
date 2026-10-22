// Wishlist filters: two groups, one pick in each, combined. Category is what the item is (the wardrobe's
// categories, from its tag); state is what's happening with it (a card's alert or stock, or Bought).
// Bought items (marked "I bought this") are hidden by default: All and the other chips count only what
// is still wanted, and the Bought chip shows the rest.
import {CATEGORY_LABELS} from './categories.js';
const wanted=item=>!item.bought;
export const FILTERS=[
 {id:'alerts',label:'Alerts on',matches:item=>wanted(item)&&Boolean(item.price_alert?.active)},
 {id:'sold-out',label:'Sold out',matches:item=>wanted(item)&&item.stock?.status==='sold_out'},
 {id:'bought',label:'Bought',matches:item=>Boolean(item.bought)},
];
export const ALL={category:'all',filter:'all'};
const find=id=>FILTERS.find(f=>f.id===id);
const inCategory=(item,category)=>category==='all'||item.category===category;
const inState=(item,id)=>id==='all'?wanted(item):Boolean(find(id)?.matches(item));
export const matchesFilter=(item,{category='all',filter='all'}=ALL)=>inState(item,filter)&&inCategory(item,category);
export const isAll=selection=>selection.category==='all'&&selection.filter==='all';
// "Shoes · Alerts on"; "All" when nothing is picked.
export const filterLabel=selection=>[CATEGORY_LABELS[selection.category],find(selection.filter)?.label].filter(Boolean).join(' · ')||'All';
// Each chip counts its own items, whatever else is on, so the row doesn't shift while you tap; the row's count
// says what the combination shows. A chip shows only when it has items, except a selected one, which stays (at 0)
// until the person leaves it. Categories show only when one would narrow the list (an untagged item is only in All).
export function filterChips(items,selection=ALL){
 const kept=items.filter(wanted);
 const categories=Object.entries(CATEGORY_LABELS).map(([id,label])=>({id,label,group:'category',count:kept.filter(i=>i.category===id).length}))
  .filter(c=>c.count||c.id===selection.category);
 const narrows=categories.some(c=>c.count<kept.length)||selection.category!=='all';
 const states=FILTERS.map(f=>({id:f.id,label:f.label,group:'state',count:items.filter(f.matches).length})).filter(c=>c.count||c.id===selection.filter);
 const chips=[...(narrows?categories:[]),...states];
 return chips.length?[{id:'all',label:'All',group:'all',count:kept.length},...chips]:[];
}
// All clears both groups. Tapping a selected chip clears only its own group; another chip in a group replaces its pick.
export function nextFilter(selection,chip){
 if(chip.group==='all')return {...ALL};
 const key=chip.group==='category'?'category':'filter';
 return {...selection,[key]:selection[key]===chip.id?'all':chip.id};
}
export function filterFromURL(search){
 const query=new URLSearchParams(search),category=query.get('category'),filter=query.get('filter');
 return {category:Object.hasOwn(CATEGORY_LABELS,category??'')?category:'all',filter:find(filter)?filter:'all'};
}
export function filterURL(href,selection){
 const url=new URL(href);
 for(const [key,value] of [['category',selection.category],['filter',selection.filter]]){if(value==='all')url.searchParams.delete(key);else url.searchParams.set(key,value);}
 return url.pathname+url.search;
}
const count=n=>`${n} ${n===1?'item':'items'}`;
// total is the wanted items; the Bought view counts itself.
export function countLabel(shown,total,selection=ALL){
 if(selection.filter==='bought')return `${shown} bought`;
 return isAll(selection)?count(total):`${shown} of ${count(total)}`;
}
export const wantedCount=items=>items.filter(wanted).length;
