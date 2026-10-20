import { callModel } from './model-call.js';
export async function structuredVision(instructions,content,schema,env,fetcher=fetch) {
  return callModel({role:'extract',env,fetcher,timeout:20000,instructions,input:[{role:'user',content}],name:'visual_result',schema,maxOutputTokens:2200,
    failed:response=>Object.assign(new Error('Visual model request failed'),{provider_status:response.status}),incomplete:'Incomplete visual result'});
}
export const inlineImage=image=>({type:'input_image',image_url:`data:${image.mime_type};base64,${image.data}`,detail:'high'});
