import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, uuid } from '../lib/http.js';
export function createImageHandler({auth=authorize,storeFactory=createStore,env=process.env}={}) {
  return async (req,res) => {
    try {
      const access=await auth(req.headers,env);
      if (access!==200) return json(res,access,{error:'Please sign in with the owner account.'});
      if (req.method!=='GET') { res.setHeader('Allow','GET'); return json(res,405,{error:'Method not allowed.'}); }
      const id=new URL(req.url,'https://local.invalid').searchParams.get('id');
      if (!uuid(id)) return json(res,400,{error:'Invalid image.'});
      const image=await storeFactory(env).image(id);
      if (!image) return json(res,404,{error:'Image not found.'});
      res.setHeader('Cache-Control','private, no-store'); res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Type',image.mime_type); res.statusCode=200; res.end(Buffer.from(image.data,'base64'));
    } catch { return json(res,503,{error:'Could not load image.'}); }
  };
}
export default createImageHandler();
