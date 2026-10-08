import { createStore } from '../lib/store.js';
import { wishlistUser } from '../lib/wishlist.js';
import { json, readJson, uuid } from '../lib/http.js';
import { ensureCoreCards, TONES, prepareSource, analyzeStyle, confirmReport, reportFacts, cropSource, fail } from '../lib/style.js';

export const config={api:{bodyParser:false},maxDuration:120};
export function createStyleHandler({env=process.env,storeFactory=createStore,auth=wishlistUser,analyze=analyzeStyle,prepare=prepareSource,crop=cropSource,fetcher=fetch}={}) {
  return async(req,res)=>{
    let store,owner,reservation;
    try {
      if(env.STYLE_ENABLED!=='true')return json(res,503,{error:'Style analysis is not available yet.'});
      if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return json(res,405,{error:'Method not allowed.'});}
      store=storeFactory(env);
      const access=await auth(req.headers,env,store,fetcher);
      if(access.status!==200)return json(res,access.status,{error:'Please sign in with your invited email.'});
      owner=access.conversation;
      const state=await store.styleSession(owner);
      if(state.data.report?.status==='confirmed')state.data.report=ensureCoreCards(state.data.report);
      if(req.method==='GET') {
        const query=new URL(req.url,'https://local.invalid').searchParams;
        if(query.has('source')||query.has('crop')) {
          let source,bytes;
          if(query.has('source')) {
            if(!uuid(query.get('source')))throw fail('Image not found.',404);
            source=await store.styleSource(owner,query.get('source'));
            if(!source)throw fail('Image not found.',404);
            bytes=Buffer.from(source.data,'base64');
          } else {
            const index=query.get('crop');
            if(!/^[0-5]$/.test(index??''))throw fail('Image not found.',404);
            const entry=state.data.report?.analysis.crops[Number(index)];
            if(!entry||query.get('report')!==state.data.report.id)throw fail('This report changed. Reload before exporting.',409);
            source=await store.styleSource(owner,entry.source_id);
            if(!source||source.kind!=='outfit'||source.mime_type!=='image/jpeg')throw fail('Image not found.',404);
            bytes=await crop(source,entry.box);
          }
          res.statusCode=200;res.setHeader('Content-Type',source.mime_type);res.setHeader('Cache-Control','no-store');
          res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',source.mime_type==='application/pdf'?'attachment; filename="receipt.pdf"':'inline');
          res.end(bytes);return;
        }
        return json(res,200,{...state,sources:await store.styleSources(owner),signup_url:signupURL(env)});
      }
      const input=await readJson(req,4300000);
      if(!input||!Number.isInteger(input.revision)||input.revision!==state.revision)throw fail('Your style inputs changed. Reload before continuing.',409);
      if(input.action==='event') {
        const card=state.data.report?.cards.find(c=>c.id===input.card&&c.accepted&&!c.hidden);
        if(state.data.report?.status!=='confirmed'||!card||!['download_requested','share_requested'].includes(input.name))throw fail('Share card not found.',404);
        console.log(JSON.stringify({event:'style_'+input.name,card_type:card.type,tone:state.data.tone}));
        return json(res,200,{ok:true});
      }
      const write=async(data,options)=>{
        if(!await store.writeStyle(owner,state.revision,data,options))throw fail('Your style inputs changed. Reload before continuing.',409);
        return json(res,200,{revision:state.revision+1,data,sources:await store.styleSources(owner),signup_url:signupURL(env)});
      };
      // Deletion is allowed during analysis and invalidates the in-flight reservation.
      if(input.action==='delete') {
        if(!await store.deleteStyle(owner,state.revision))throw fail('Reload before deleting your style data.',409);
        console.log(JSON.stringify({event:'style_deleted'}));
        return json(res,200,{revision:state.revision+1,data:{notes:'',tone:'balanced',report:null},sources:[],signup_url:signupURL(env)});
      }
      if(state.data.busy_until && Date.parse(state.data.busy_until)>Date.now())throw fail('Your analysis is still running. Give it a moment, then reload.',409);
      if(input.action==='upload') {
        if(input.consent!==true)throw fail('Approve private storage and OpenAI analysis before uploading.');
        const source=await prepare(input);
        const data={...state.data,report:null,busy_until:null,consent_at:new Date().toISOString()};
        console.log(JSON.stringify({event:'style_source_added',kind:source.kind}));
        return write(data,{source,facts:[]});
      }
      if(input.action==='remove') {
        if(!uuid(input.source)||!await store.styleSource(owner,input.source))throw fail('Source not found.',404);
        return write({...state.data,report:null,busy_until:null},{remove:input.source,facts:[]});
      }
      if(input.action==='context') {
        if(typeof input.notes!=='string'||input.notes.length>2000)throw fail('Keep your style notes under 2,000 characters.');
        return write({...state.data,notes:input.notes.trim(),report:null,busy_until:null},{facts:[]});
      }
      if(input.action==='tone') {
        if(!TONES.includes(input.tone))throw fail('Choose a tone.');
        return write({...state.data,tone:input.tone,busy_until:null});
      }
      if(input.action==='analyze') {
        if(input.consent!==true||!state.data.consent_at)throw fail('Approve sharing your inputs with OpenAI for this analysis.');
        const sources=await store.styleSources(owner,true);
        if(!sources.some(s=>s.kind==='outfit'))throw fail('Add at least one personal outfit photo to start.');
        const pending={...state.data,busy_until:new Date(Date.now()+150000).toISOString()};
        if(!await store.writeStyle(owner,state.revision,pending))throw fail('Your inputs changed. Reload before analyzing.',409);
        reservation={revision:state.revision+1,data:state.data};
        const profile=env.MEMORY_ENABLED==='true'&&store.profile?await store.profile(owner):{facts:[]};
        const facts=(profile.facts??[]).filter(f=>!f.deleted&&f.source!=='style_report'&&['style','brand','category','budget','size'].includes(f.field)).map(({field,key,value})=>({field,key,value}));
        const report=await analyze(sources,state.data.notes,env,fetcher,facts);
        const data={...state.data,report,busy_until:null};
        if(!await store.writeStyle(owner,reservation.revision,data))throw fail('Your inputs changed during analysis. Reload to see the current version.',409);
        reservation=null;
        return json(res,200,{revision:state.revision+2,data,sources:sources.map(({data,...s})=>s),signup_url:signupURL(env)});
      }
      if(input.action==='confirm') {
        const report=confirmReport(state.data.report,input.reviews);
        const facts=reportFacts(report);
        console.log(JSON.stringify({event:'style_confirmation',cards:report.cards.filter(c=>c.accepted).length,preferences:facts.length}));
        return write({...state.data,report,busy_until:null},{facts});
      }
      if(input.action==='hide') {
        const report=state.data.report;
        if(report?.status!=='confirmed'||typeof input.hidden!=='boolean'||!report.cards.some(c=>c.id===input.card))throw fail('Card not found.',404);
        return write({...state.data,report:{...report,cards:report.cards.map(c=>c.id===input.card?{...c,hidden:input.hidden}:c)}});
      }
      throw fail('Unknown action.');
    } catch(error) {
      if(reservation) {
        try{await store.writeStyle(owner,reservation.revision,{...reservation.data,busy_until:null});}catch{/* Expired lock is recoverable. */}
      }
      console.log(JSON.stringify({event:'style_request_failed',status:error.status??503,...(error.code?{reason:error.code}:{})}));
      return json(res,error.status??503,{error:error.status?error.message:'Could not finish that step. Your saved inputs are intact; reload before trying again.',...(error.code?{code:error.code}:{})});
    }
  };
}
function signupURL(env) {
  try{const u=new URL(env.SITE_ORIGIN);return u.protocol==='https:'&&!u.username&&!u.password?u.origin+'/style':null;}catch{return null;}
}
export default createStyleHandler();
