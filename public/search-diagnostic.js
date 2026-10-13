import {mountAdminShell,adminJson} from './admin-console.js';
mountAdminShell('search');
for(const button of document.querySelectorAll('main button[data-mode]'))button.onclick=async()=>{
 const status=document.getElementById('status'),output=document.getElementById('result');
 button.disabled=true;status.textContent='Running live search…';output.textContent='';
 try{
  const data=await adminJson('/api/identification-test',{method:'POST',body:JSON.stringify({action:'text_search_diagnostic',mode:button.dataset.mode})});
  status.textContent='Search completed.';output.textContent=JSON.stringify(data,null,2);
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
