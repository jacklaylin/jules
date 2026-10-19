// Wishlist filters: one at a time, each matching a state the card already shows.
export const FILTERS=[
 {id:'alerts',label:'Alerts on',matches:item=>Boolean(item.price_alert?.active)},
 {id:'sold-out',label:'Sold out',matches:item=>item.stock?.status==='sold_out'},
];
const find=id=>FILTERS.find(f=>f.id===id);
export const matchesFilter=(item,id)=>id==='all'||Boolean(find(id)?.matches(item));
export const filterLabel=id=>find(id)?.label??'All';
// A chip shows only when it has items, except the selected one, which stays (at 0) until the person leaves it.
// With no state chips there is nothing to filter, so no row.
export function filterChips(items,selected='all'){
 const chips=[{id:'all',label:'All',count:items.length}];
 for(const f of FILTERS){const count=items.filter(f.matches).length;if(count||f.id===selected)chips.push({id:f.id,label:f.label,count});}
 return chips.length>1?chips:[];
}
export const filterFromURL=search=>{const id=new URLSearchParams(search).get('filter');return find(id)?id:'all';};
export function filterURL(href,id){const url=new URL(href);if(id==='all')url.searchParams.delete('filter');else url.searchParams.set('filter',id);return url.pathname+url.search;}
const items=n=>`${n} ${n===1?'item':'items'}`;
export const countLabel=(shown,total,filtered)=>filtered?`${shown} of ${items(total)}`:items(total);
