export async function structuredVision(instructions,content,schema,env,fetcher=fetch) {
  const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_MODEL||'gpt-4.1-mini',instructions,input:[{role:'user',content}],text:{format:{type:'json_schema',name:'visual_result',strict:true,schema}},max_output_tokens:2200,store:false}),signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=new Error('Visual model request failed');error.provider_status=response.status;throw error;}
  const data=await response.json();if(data.status!=='completed')throw new Error('Incomplete visual result');
  const text=(data.output??[]).filter(o=>o.type==='message'&&o.role==='assistant').flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  return JSON.parse(text);
}
export const inlineImage=image=>({type:'input_image',image_url:`data:${image.mime_type};base64,${image.data}`,detail:'high'});
