import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {publicURL} from './public-url.js';

// Unknown stores/CDNs are readable, but must never reach local/private services.
// Pin the checked DNS address to the actual connection to prevent DNS rebinding.
export function publicAddress(address){
 if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19].includes(b));}
 if(isIP(address)===6)return /^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)/i.test(address)&&!/^2002:/i.test(address);
 return false;
}
export async function publicFetch(value,{signal,redirect='manual'}={}, {resolve=lookup,connect=request}={}){
 const url=publicURL(value);if(!url)throw Error('Unsupported public URL');
 const addresses=await resolve(new URL(url).hostname,{all:true});
 signal?.throwIfAborted();
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Non-public destination');
 const chosen=addresses[0];
 return new Promise((resolve,reject)=>{
  const req=connect(url,{signal,headers:{'User-Agent':'Mozilla/5.0 (compatible; Jules/0.1)','Accept':'text/html,image/*;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>callback(null,...(options.all?[[chosen]]:[chosen.address,chosen.family]))},res=>{
   if(redirect==='error'&&res.statusCode>=300&&res.statusCode<400){res.destroy();reject(Error('Unexpected redirect'));return;}
   const headers=new Headers();for(const [key,values] of Object.entries(res.headers))for(const v of [].concat(values??[]))headers.append(key,v);
   resolve(new Response([204,304].includes(res.statusCode)?null:Readable.toWeb(res),{status:res.statusCode,headers}));
  });
  req.on('error',reject);req.end();
 });
}
