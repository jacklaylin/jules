// One watched link per product page. Tracking parameters and a leading locale segment
// (/us/, /en-us/) do not make a different page; any other path or parameter does.
function pageKey(value){
  try{
    const u=new URL(value);u.hash='';
    for(const k of [...u.searchParams.keys()])if(/^(utm_|gclid$|fbclid$)/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();
    const path=u.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'').replace(/\/$/,'');
    return u.hostname.toLowerCase().replace(/^www\./,'')+path+(u.search?'?'+u.searchParams:'');
  }catch{return null;}
}
export function uniqueAlertLinks(links){
  const kept=new Map();
  for(const link of links??[]){
    const key=pageKey(link?.url)??link?.url;
    const prior=kept.get(key);
    if(!prior){kept.set(key,link);continue;}
    // Keep the first link and merge evidence the duplicate carried.
    const sizes=[...new Set([...(prior.requested_sizes??[]),...(link.requested_sizes??[])])];
    const mappings=[...(prior.verified_size_mappings??[]),...(link.verified_size_mappings??[])];
    kept.set(key,{...link,...prior,...(sizes.length?{requested_sizes:sizes}:{}),...(mappings.length?{verified_size_mappings:mappings}:{})});
  }
  return [...kept.values()];
}
