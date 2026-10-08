import {authorize} from '../lib/auth.js';
import {json,readJson} from '../lib/http.js';
import {simulateTurn} from '../lib/chat-simulator.js';
export const config={api:{bodyParser:false},maxDuration:120};
export function createSimulatorHandler({env=process.env,auth=authorize,simulate=simulateTurn}={}){
  return async(req,res)=>{
    try{
      const access=await auth(req.headers,env);
      if(access!==200)return json(res,access,{error:'Owner sign-in required.'});
      if(req.method==='GET')return json(res,200,{owner:true});
      if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
      if(!env.OPENAI_API_KEY)return json(res,503,{error:'Conversation model is not configured.'});
      const input=await readJson(req,4300000);
      return json(res,200,await simulate(input,env));
    }catch(error){return json(res,error.status??503,{error:error.status===400||error.status===413?error.message:'Simulator could not finish this turn. The prior conversation is preserved; no production action occurred.'});}
  };
}
export default createSimulatorHandler();
