// Order emails often link a small rendition of the product photo (a 90-160px thumbnail). The image
// hosts below serve the same picture at any size from the same address with a different size part, so
// asking for a large copy is the identical photo, sharper: no search and no lookalike. Returns null for
// any other host, or when the address has no size part to change.
const LARGE=1200;
export function largerPhotoURL(value){
 let url;try{url=new URL(value);}catch{return null;}
 if(url.protocol!=='https:')return null;
 const host=url.hostname.toLowerCase(),path=url.pathname;
 // Shopify: name_compact_cropped.jpg, name_160x160.jpg, name_small.jpg -> name.jpg?width=1200
 if(host==='cdn.shopify.com'||path.startsWith('/cdn/shop/')){
  const original=path.replace(/(?:_(?:pico|icon|thumb|small|compact|medium|large|grande|master|\d+x\d*|x\d+))+(?:_cropped)?(?:@\d+x)?(?=\.[a-z0-9]+$)/i,'').replace(/_cropped(?=\.[a-z0-9]+$)/i,'');
  const next=new URL(url);next.pathname=original;next.searchParams.delete('height');next.searchParams.delete('crop');next.searchParams.set('width',String(LARGE));
  return next.href===url.href?null:next.href;
 }
 // Amazon: 71PhaJKAaYL.SS90_.jpg or ._AC_SX90_.jpg -> 71PhaJKAaYL._SL1200_.jpg
 if(/(^|\.)media-amazon\.com$|(^|\.)ssl-images-amazon\.com$/.test(host)&&path.startsWith('/images/I/')){
  const m=path.match(/^(\/images\/I\/[A-Za-z0-9+%-]+)\.[^/]*_\.(jpe?g|png|webp)$/i);
  return m?`${url.origin}${m[1]}._SL${LARGE}_.${m[2]}`:null;
 }
 // Scene7 (Dick's, J.Crew's image facade): ?$preset$ -> ?wid=1200&hei=1200
 if(host.endsWith('.scene7.com')&&path.startsWith('/is/image/')||path.startsWith('/s7-img-facade/')){
  const next=new URL(url);next.search=`?wid=${LARGE}&hei=${LARGE}`+(host.endsWith('.scene7.com')?'&fmt=jpg':'');
  return next.href===url.href?null:next.href;
 }
 // YNAP (Mr Porter, Net-a-Porter): /in/w100_a3-4.jpg -> /in/w2000_q60.jpg
 if(/(^|\.)(mrporter|net-a-porter|theoutnet)\.com$/.test(host)&&/\/variants\/images\/\d+\/[a-z]+\/w\d+[^/]*\.jpg$/i.test(path)){
  const next=new URL(url);next.pathname=path.replace(/w\d+[^/]*\.jpg$/i,'w2000_q60.jpg');
  return next.href===url.href?null:next.href;
 }
 // Cloudinary-style sizes in the path (SSENSE, END.): w_470,h_706/c_scale,h_480 -> scaled up together.
 if(host==='res.cloudinary.com'||host==='media.endclothing.com'){
  const sizes=[...path.matchAll(/\b[wh]_(\d+)\b/g)].map(m=>Number(m[1]));
  if(!sizes.length||Math.max(...sizes)>=LARGE)return null;
  const k=LARGE/Math.max(...sizes),next=new URL(url);
  next.pathname=path.replace(/\b([wh])_(\d+)\b/g,(_,d,n)=>`${d}_${Math.round(Number(n)*k)}`);
  return next.href;
 }
 // An image service sized by a width setting in the address (Salomon's asset store and similar).
 const width=['width','w'].find(k=>/^\d+$/.test(url.searchParams.get(k)??''));
 if(width&&Number(url.searchParams.get(width))<LARGE&&/\.(jpe?g|png|webp)$/i.test(path)){
  const next=new URL(url);next.searchParams.set(width,String(LARGE));for(const k of ['height','h'])next.searchParams.delete(k);
  return next.href;
 }
 return null;
}
