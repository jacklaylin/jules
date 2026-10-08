import {authorize} from '../lib/auth.js';
import {json,readJson} from '../lib/http.js';
import {simulateTurn,validateSimulation} from '../lib/chat-simulator.js';
import {createStore} from '../lib/store.js';
export const config={api:{bodyParser:false},maxDuration:120};
export function createSimulatorHandler({env=process.env,auth=authorize,simulate=simulateTurn,storeFactory=createStore}={}){
  return async(req,res)=>{
    try{
      const access=await auth(req.headers,env);
      if(access!==200)return json(res,access,{error:'Owner sign-in required.'});
      if(req.method==='GET')return json(res,200,{owner:true});
      if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
      if(!env.OPENAI_API_KEY)return json(res,503,{error:'Conversation model is not configured.'});
      const input=await readJson(req,4300000);
      input.snapshot=validateSimulation(input).snapshot;
      if(!input.snapshot.profile_seeded&&env.ADMIN_EMAIL&&env.SUPABASE_URL){
        const store=storeFactory(env),member=await store.wishlistMember(env.ADMIN_EMAIL.toLowerCase());
        if(member){
          const saved=await store.profile(member.conversation_id),overrides=input.snapshot.profile.facts;
          input.snapshot.profile.facts=[...saved.facts.filter(f=>!overrides.some(o=>o.field===f.field&&o.key===f.key)),...overrides];
          input.snapshot.profile_seeded=true;
        }
      }
      return json(res,200,await simulate(input,env));
    }catch(error){return json(res,error.status??503,{error:error.status===400||error.status===413?error.message:'Simulator could not finish this turn. The prior conversation is preserved; no production action occurred.'});}
  };
}
export default createSimulatorHandler();
