// Wishlist filters: one at a time, each matching a state the card already shows.
// Bought items (marked "I bought this") are hidden by default: All and the other chips count only what
// is still wanted, and the Bought chip shows the rest.
const wanted=item=>!item.bought;
export const FILTERS=[
 {id:'alerts',label:'Alerts on',matches:item=>wanted(item)&&Boolean(item.price_alert?.active)},
 {id:'sold-out',label:'Sold out',matches:item=>wanted(item)&&item.stock?.status==='sold_out'},
 {id:'bought',label:'Bought',matches:item=>Boolean(item.bought)},
];
const find=id=>FILTERS.find(f=>f.id===id);
export const matchesFilter=(item,id)=>id==='all'?wanted(item):Boolean(find(id)?.matches(item));
export const filterLabel=id=>find(id)?.label??'All';
// A chip shows only when it has items, except the selected one, which stays (at 0) until the person leaves it.
// With no state chips there is nothing to filter, so no row.
export function filterChips(items,selected='all'){
 const chips=[{id:'all',label:'All',count:items.filter(wanted).length}];
 for(const f of FILTERS){const count=items.filter(f.matches).length;if(count||f.id===selected)chips.push({id:f.id,label:f.label,count});}
 return chips.length>1?chips:[];
}
// Tapping the selected chip turns it off and shows everything again.
export const nextFilter=(current,clicked)=>clicked===current?'all':clicked;
export const filterFromURL=search=>{const id=new URLSearchParams(search).get('filter');return find(id)?id:'all';};
export function filterURL(href,id){const url=new URL(href);if(id==='all')url.searchParams.delete('filter');else url.searchParams.set('filter',id);return url.pathname+url.search;}
const count=n=>`${n} ${n===1?'item':'items'}`;
// total is the wanted items; the Bought view counts itself.
export function countLabel(shown,total,filter='all'){
 if(filter==='bought')return `${shown} bought`;
 return filter!=='all'?`${shown} of ${count(total)}`:count(total);
}
export const wantedCount=items=>items.filter(wanted).length;
