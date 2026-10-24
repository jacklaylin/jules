// Minimal Zernio API client (https://docs.zernio.com): the four calls the social scripts use. The key is
// ZERNIO_API_KEY, or none when the cloud environment adds it as a network secret (ZERNIO_INJECTED=1).
const BASE='https://zernio.com/api/v1';

export function zernio({key,fetch:f=fetch}={}){
 async function call(method,path,body,headers={}){
  const res=await f(BASE+path,{method,headers:{...(key?{Authorization:`Bearer ${key}`}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const text=await res.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
  // 409 on create means this post (same content) already exists: report it, don't post twice.
  if(!res.ok&&res.status!==409)throw Object.assign(Error(`Zernio ${method} ${path} → ${res.status}: ${(data?.error??data?.message??text).toString().slice(0,300)}`),{status:res.status});
  return {status:res.status,data};
 }
 return {
  accounts:async()=>(await call('GET','/accounts?status=connected')).data?.accounts??[],
  // Presign, then PUT the bytes straight to storage (no auth header there). Returns the public URL.
  async upload(bytes,filename,contentType='image/jpeg'){
   const {data}=await call('POST','/media/presign',{filename,contentType,size:bytes.length});
   const put=await f(data.uploadUrl,{method:'PUT',headers:{'Content-Type':contentType},body:bytes});
   if(!put.ok)throw Error(`Upload of ${filename} failed: ${put.status}`);
   return data.publicUrl;
  },
  createPost:(body,idempotencyKey)=>call('POST','/posts',body,idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}),
  async analytics({fromDate,page=1}={}){
   const q=new URLSearchParams({source:'late',limit:'100',page:String(page),...(fromDate?{fromDate}:{})});
   return (await call('GET','/analytics?'+q)).data;
  },
 };
}

// Account ids by platform from GET /accounts. ZERNIO_TIKTOK_ACCOUNT / ZERNIO_INSTAGRAM_ACCOUNT pick one
// when more than one is connected.
export function pickAccounts(accounts,env=process.env){
 const pick=platform=>{
  const all=accounts.filter(a=>a.platform===platform),want=env[`ZERNIO_${platform.toUpperCase()}_ACCOUNT`];
  return (want?all.find(a=>a._id===want||a.username===want):all[0])?._id??null;
 };
 return {tiktok:pick('tiktok'),instagram:pick('instagram')};
}

// One row per published post from GET /analytics, with the numbers that matter for a carousel.
export function analyticsRows(data){
 const posts=data?.posts??data?.data??(Array.isArray(data)?data:[]);
 return posts.flatMap(p=>(p.platformAnalytics?.length?p.platformAnalytics:[{platform:p.platform,analytics:p.analytics,platformPostUrl:p.platformPostUrl}]).map(pa=>{
  const a=pa.analytics??{};
  return {post:p.latePostId??p.postId,published:p.publishedAt,platform:pa.platform,url:pa.platformPostUrl??null,content:(p.content??'').split('\n')[0].slice(0,80),
   views:a.views??a.impressions??0,reach:a.reach??0,likes:a.likes??0,comments:a.comments??0,shares:a.shares??0,saves:a.saves??0,clicks:a.clicks??0};
 }));
}
