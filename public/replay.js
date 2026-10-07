import {mountHeader} from './design-system.js';
import {createSession} from './wishlist-session.js';
mountHeader('replay');
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const $=id=>document.getElementById(id);
let cases=[],reports=[],stopping=false;
async function request(input){
 const token=await session.token()||sessionStorage.getItem('jules_wishlist_token')||sessionStorage.getItem('jules_token');
 if(!token)throw Error('Sign in through the private inbox or wishlist first.');
 const response=await fetch('/api/identification-test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input)});
 const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
function show(report){
 reports.push(report);$('download').disabled=false;
 const article=document.createElement('article'),heading=document.createElement('h3'),body=document.createElement('pre'),detail=document.createElement('p');
 heading.textContent=`${report.passed?'PASS':'FAIL'} · ${report.name}`;
 detail.textContent=`${(report.elapsed_ms/1000).toFixed(1)} seconds · ${report.links} links${report.failures.length?' · '+report.failures.join(', '):''}`;
 body.textContent=report.body;article.append(heading,detail,body);$('results').append(article);
}
async function run(inputs){
 stopping=false;const buttons=['run-case','run-suite','capture','run-saved'];buttons.forEach(id=>$(id).disabled=true);$('stop').disabled=false;
 try{
  let done=0;const repeats=Number($('runs').value);
  for(const input of inputs)for(let i=0;i<repeats&&!stopping;i++){
   $('status').textContent=`Running ${input.case_id}, repeat ${i+1}/${repeats}…`;
   const started=Date.now();
   try{show((await request({action:'replay',...input})).report);done++;}
   catch(error){show({id:input.case_id,name:cases.find(c=>c.id===input.case_id)?.name||input.case_id,passed:false,failures:['replay_request_failed'],elapsed_ms:Date.now()-started,links:0,body:'Replay request failed. No response was available to grade.',repeat:i+1});stopping=true;throw error;}
  }
  $('status').textContent=`${stopping?'Stopped. ':''}${done} runs completed. ${reports.filter(r=>r.passed).length}/${reports.length} passed across this report. Nothing sent or saved.`;
 }catch(error){$('status').textContent=error.message;}finally{buttons.forEach(id=>$(id).disabled=false);$('stop').disabled=true;}
}
$('run-case').onclick=()=>run([{case_id:$('case').value}]);
$('run-suite').onclick=()=>run(cases.map(c=>({case_id:c.id})));
$('stop').onclick=()=>{stopping=true;};
$('capture').onclick=()=>run([{case_id:'latest_failure',brand:$('brand').value,model:$('model').value}]);
$('run-saved').onclick=async()=>{
 try{const file=$('saved').files[0];if(!file||file.size>1000000)throw Error('Choose a replay report under 1 MB.');const data=JSON.parse(await file.text());const saved=data.reports?.findLast(r=>r.id==='latest_failure'||r.id==='saved_failure');if(!saved?.snapshot)throw Error('No captured bug snapshot in this report.');await run([{case_id:'saved_failure',snapshot:saved.snapshot}]);}catch(error){$('status').textContent=error.message;}
};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({created_at:new Date().toISOString(),reports},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='jules-private-replay-report.json';a.click();URL.revokeObjectURL(url);};
try{cases=(await request({action:'replay_manifest'})).cases;for(const item of cases){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;$('case').append(option);}$('status').textContent='Ready. Choose a case or run the suite.';}catch(error){$('status').textContent=error.message;}
