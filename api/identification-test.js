import { createHash } from 'node:crypto';
import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { visualSearchProducts } from '../lib/visual-search.js';
import { wishlistProducts } from '../lib/wishlist.js';
import { imageType, MAX_IMAGE_BYTES } from '../lib/images.js';
import { json, readJson, uuid } from '../lib/http.js';

export const config = { api: { bodyParser: false }, maxDuration: 120 };
export function createIdentificationTestHandler({env=process.env,auth=authorize,storeFactory=createStore,search=visualSearchProducts,prepare=wishlistProducts}={}) {
  return async (req,res) => {
    let stage='authorization';
    try {
      const access=await auth(req.headers,env);
      if(access!==200)return json(res,access,{error:'Owner sign-in required.'});
      if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
      if(env.WISHLIST_ENABLED!=='true'||!env.OPENAI_API_KEY||!env.SERPAPI_API_KEY)return json(res,503,{error:'Identification and wishlist must be configured.'});
      const input=await readJson(req,4300000);
      if(!uuid(input.operation)||typeof input.query!=='string'||!input.query.trim()||input.query.length>1000||input.provider_sharing!==true||typeof input.image!=='string'||!input.image||input.image.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))return json(res,400,{error:'Provide an operation, request, image, and provider-sharing approval.'});
      const bytes=Buffer.from(input.image,'base64');
      if(bytes.length>MAX_IMAGE_BYTES)return json(res,413,{error:'Image must be under 3 MB.'});
      let mime;try{mime=imageType(bytes);}catch{return json(res,400,{error:'Use JPEG, PNG, or WebP.'});}
      const store=storeFactory(env);
      const member=await store.wishlistMember(env.ADMIN_EMAIL.toLowerCase());
      if(!member)return json(res,409,{error:'The owner email needs an existing wishlist membership.'});
      const query=input.query.trim();
      const hash=createHash('sha256').update(query).update(bytes).digest('hex');
      const key=`identification-test:${input.operation}`;
      const image={mime_type:mime,data:bytes.toString('base64')};
      stage='reservation';
      const reservation=await store.reserveIdentificationTest(member.conversation_id,key,query,hash);
      let record=reservation.record;
      if(record.conversation_id!==member.conversation_id||record.search_result?.test_hash!==hash)return json(res,409,{error:'Operation belongs to a different test.'});
      if(reservation.created) {
        stage='source_image';
        await store.saveImages(key,[image]);
        stage='search';
        const result=await search(query,[image],env);
        stage='search_persistence';
        await store.finishIdentificationTest(record.id,{...result,test_hash:hash,test_status:'complete'});
        record={...record,search_result:{...result,test_hash:hash,test_status:'complete'}};
      } else if(record.search_result?.test_status!=='complete') {
        return json(res,409,{error:'This test started but has not completed. Do not retry it with a new operation unless you intend another paid search.'});
      }
      const result=record.search_result;
      stage='wishlist_prepare';
      const sources=await store.identificationTestImages(record.id);
      const body=(result.products??[]).flatMap(p=>[p.url,...(p.merchant_options??[]).map(m=>m.url)]).join('\n');
      let payload=record.wishlist_payload;
      if(!payload) {
        payload=await prepare(result,body,sources,store);
        await store.identificationTestPayload(record.id,payload);
      }
      stage='wishlist_import';
      await store.importIdentificationTest(member.conversation_id,record.id,payload,result.checked_at);
      console.log(JSON.stringify({event:'identification_test_imported',operation:input.operation,products:payload.length}));
      return json(res,200,{result,saved:payload.length});
    } catch(error) {
      const known=['Database request failed','Invalid visual plan','Invalid visual target','Invalid visual crop','Visual model request failed','Incomplete visual result','Visual search failed'];
      const reason=known.includes(error.message)?error.message:'request_failed';
      console.log(JSON.stringify({event:'identification_test_failed',stage,reason}));
      return json(res,503,{error:`Test failed at ${stage} (${reason}). Retry with the same operation to recover a completed result without another search.`});
    }
  };
}
export default createIdentificationTestHandler();
