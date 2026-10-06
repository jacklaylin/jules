import sharp from 'sharp';
import { publicURL } from './search.js';

export function cropPixels(box,width,height) {
  if(!Array.isArray(box)||box.length!==4||box.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Invalid garment crop');
  const [x,y,w,h]=box;
  if(w<0.05||h<0.05||x+w>1.001||y+h>1.001)throw new Error('Invalid garment crop');
  const left=Math.floor(x*width),top=Math.floor(y*height);
  return {left,top,width:Math.min(width-left,Math.max(1,Math.ceil(w*width))),height:Math.min(height-top,Math.max(1,Math.ceil(h*height)))};
}
export async function searchImage(image,box) {
  const bytes=Buffer.from(image.data,'base64');
  const rotated=await sharp(bytes,{limitInputPixels:25000000}).rotate().toBuffer();
  const {width,height}=await sharp(rotated).metadata();
  const crop=cropPixels(box,width,height);
  for(const [size,quality] of [[1200,82],[900,72],[650,60]]){
    const output=await sharp(rotated).extract(crop).resize(size,size,{fit:'inside',withoutEnlargement:true}).jpeg({quality}).toBuffer();
    if(output.length<=490000)return {mime_type:'image/jpeg',data:output.toString('base64')};
  }
  throw new Error('Visual upload too large');
}
export function candidateImage(value) {
  const url=publicURL(value);if(!url)return null;
  // Google Lens thumbnails only: prevents arbitrary image URLs being fetched by the model.
  const host=new URL(url).hostname;
  return /^encrypted-tbn\d*\.gstatic\.com$/.test(host)?url:null;
}
export function lensCandidates(data) {
  if(data.search_metadata?.status==='Success'&&data.error==="Google Lens hasn't returned any results for this query.")return [];
  if(data.error||data.search_metadata?.status!=='Success')throw new Error('Visual search failed');
  const seen=new Set(),items=[];
  for(const item of data.visual_matches??[]){
    const url=publicURL(item.link),image=candidateImage(item.thumbnail);
    if(!url||url.length>1200||!image||image.length>1200||seen.has(url)||typeof item.title!=='string')continue;
    if(/(^|\.)(instagram|pinterest|youtube|reddit|facebook|tiktok|google|bing)\./i.test(new URL(url).hostname))continue;
    seen.add(url);items.push({id:String(items.length+1),url,image,title:item.title.slice(0,250)});
    if(items.length===8)break;
  }
  return items;
}
export async function lensSearch(image,query,env,fetcher=fetch) {
  if(!env.SERPAPI_API_KEY||env.SERPAPI_API_KEY.startsWith('replace-with'))throw new Error('Visual search not configured');
  const form=new FormData();form.set('api_key',env.SERPAPI_API_KEY);form.set('image',new Blob([Buffer.from(image.data,'base64')],{type:image.mime_type}),'garment.jpg');
  const uploaded=await fetcher('https://serpapi.com/image',{method:'POST',body:form,signal:AbortSignal.timeout(12000)});
  if(!uploaded.ok){const error=new Error('Visual upload failed');error.provider_status=uploaded.status;throw error;}
  const upload=await uploaded.json();if(upload.error||typeof upload.image_id!=='string')throw new Error('Visual upload failed');
  const params=new URLSearchParams({engine:'google_lens',image_id:upload.image_id,api_key:env.SERPAPI_API_KEY,type:'visual_matches',hl:'en',country:'us',auto_crop:'false'});
  const response=await fetcher('https://serpapi.com/search?'+params,{signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=new Error('Visual search failed');error.provider_status=response.status;throw error;}
  const candidates=lensCandidates(await response.json());
  console.log(JSON.stringify({event:'visual_candidates',count:candidates.length}));
  return candidates;
}
