// Social posting on autopilot (docs/social/README.md). A plan file holds a week of carousel posts; this
// checks them, renders the slides and schedules them on TikTok and Instagram through Zernio.
//   node scripts/social/run.js check docs/social/plans/2026-10-26.json      # rules only
//   node scripts/social/run.js render docs/social/plans/2026-10-26.json     # + slides to docs/social/out/
//   node scripts/social/run.js schedule docs/social/plans/2026-10-26.json --dry   # + the requests, unsent
//   node --env-file=.env.local scripts/social/run.js schedule <plan>        # uploads and schedules
//   node --env-file=.env.local scripts/social/run.js stats --days 14        # results per post and pillar
//   node --env-file=.env.local scripts/social/run.js accounts               # connected accounts
// Scheduling writes <plan>.scheduled.json (our post id → Zernio post id) so stats can join results to
// pillars and hooks, and so a rerun skips posts already scheduled.
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {checkPlan,zernioPost} from './plan.js';
import {renderPost,chromePath} from './slides.js';
import {zernio,pickAccounts,analyticsRows} from './zernio.js';

const [command,file]=process.argv.slice(2);
const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const flag=name=>process.argv.includes(name);
const env=process.env;
const client=()=>{
 if(!env.ZERNIO_API_KEY&&env.ZERNIO_INJECTED!=='1'){console.error('Set ZERNIO_API_KEY (or ZERNIO_INJECTED=1 when the environment adds it). See docs/social/README.md.');process.exit(1);}
 return zernio({key:env.ZERNIO_API_KEY||null});
};
const loadPlan=()=>{if(!file){console.error('Give a plan file.');process.exit(1);}return JSON.parse(readFileSync(file,'utf8'));};

async function render(plan){
 const outDir=path.resolve(option('--out')??'docs/social/out');
 mkdirSync(outDir,{recursive:true});
 const {default:puppeteer}=await import('puppeteer-core');
 const browser=await puppeteer.launch({executablePath:chromePath(),args:['--no-sandbox','--allow-file-access-from-files']});
 try{
  const files={};
  for(const post of plan.posts){files[post.id]=await renderPost(post,outDir,{browser});console.log(`rendered ${post.id}: ${post.slides.length} slides × 2 formats`);}
  return files;
 }finally{await browser.close();}
}

function check(plan){
 const problems=checkPlan(plan,{now:flag('--any-time')?0:Date.now()});
 if(problems.length){console.error(`${problems.length} problem(s):\n- ${problems.join('\n- ')}`);process.exit(1);}
 console.log(`${plan.posts.length} posts pass the checks.`);
}

if(command==='check'){check(loadPlan());}
else if(command==='render'){const plan=loadPlan();check(plan);await render(plan);}
else if(command==='schedule'){
 const plan=loadPlan();check(plan);
 const ledgerFile=file.replace(/\.json$/,'.scheduled.json'),ledger=existsSync(ledgerFile)?JSON.parse(readFileSync(ledgerFile,'utf8')):{};
 const todo=plan.posts.filter(p=>!ledger[p.id]);
 if(!todo.length){console.log('Every post in this plan is already scheduled.');process.exit(0);}
 const files=await render({...plan,posts:todo});
 if(flag('--dry')){
  const fake=f=>f.map(p=>`https://example.invalid/${path.basename(p)}`);
  for(const post of todo)console.log(JSON.stringify(zernioPost(post,{tiktok:'TIKTOK_ACCOUNT_ID',instagram:'INSTAGRAM_ACCOUNT_ID'},{tiktok:fake(files[post.id].tiktok),instagram:fake(files[post.id].instagram)}),null,1));
  process.exit(0);
 }
 const api=client(),accounts=pickAccounts(await api.accounts());
 if(!accounts.tiktok&&!accounts.instagram){console.error('No TikTok or Instagram account is connected in Zernio.');process.exit(1);}
 console.log(`posting to: ${Object.entries(accounts).filter(([,id])=>id).map(([p])=>p).join(', ')}`);
 for(const post of todo){
  const media={};
  for(const format of ['tiktok','instagram'])media[format]=await Promise.all(files[post.id][format].map(f=>api.upload(readFileSync(f),path.basename(f))));
  const {status,data}=await api.createPost(zernioPost(post,accounts,media),`jules-social-${post.id}`);
  const id=data?.post?._id??data?._id??data?.existingPostId??null;
  ledger[post.id]={zernio:id,publishAt:post.publishAt,pillar:post.pillar,hook:post.hook,status:status===409?'duplicate':'scheduled'};
  writeFileSync(ledgerFile,JSON.stringify(ledger,null,1)+'\n');
  console.log(`${status===409?'already there':'scheduled'} ${post.id} for ${post.publishAt} (${id})`);
 }
}
else if(command==='stats'){
 const days=Number(option('--days')??14),fromDate=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
 const api=client(),rows=[];
 for(let page=1;page<=5;page++){const data=await api.analytics({fromDate,page});const batch=analyticsRows(data);rows.push(...batch);if(batch.length<100)break;}
 // Join to the plans' ledgers for pillar and hook.
 const dir=option('--plans')??'docs/social/plans',byZernio={};
 if(existsSync(dir))for(const f of readdirSync(dir).filter(f=>f.endsWith('.scheduled.json')))for(const [id,v] of Object.entries(JSON.parse(readFileSync(path.join(dir,f),'utf8'))))if(v.zernio)byZernio[v.zernio]={id,...v};
 const out=rows.map(r=>({...r,id:byZernio[r.post]?.id??null,pillar:byZernio[r.post]?.pillar??null,hook:byZernio[r.post]?.hook??null}));
 if(flag('--json')){console.log(JSON.stringify(out,null,1));process.exit(0);}
 console.log(`| published | platform | post | pillar | hook | views | likes | comments | shares | saves |\n|---|---|---|---|---|---|---|---|---|---|`);
 for(const r of out.sort((a,b)=>b.views-a.views))console.log(`| ${(r.published??'').slice(0,10)} | ${r.platform} | ${r.id??r.content} | ${r.pillar??''} | ${r.hook??''} | ${r.views} | ${r.likes} | ${r.comments} | ${r.shares} | ${r.saves} |`);
 const pillars={};for(const r of out){const k=r.pillar??'unknown';(pillars[k]??=[]).push(r);}
 console.log('\n| pillar | posts | median views | shares+saves per 1k views |\n|---|---|---|---|');
 for(const [k,rs] of Object.entries(pillars)){const v=rs.map(r=>r.views).sort((a,b)=>a-b),views=v.reduce((a,b)=>a+b,0),ss=rs.reduce((a,r)=>a+r.shares+r.saves,0);console.log(`| ${k} | ${rs.length} | ${v[Math.floor(v.length/2)]} | ${views?(ss*1000/views).toFixed(1):'-'} |`);}
}
else if(command==='accounts'){for(const a of await client().accounts())console.log(`${a.platform.padEnd(10)} ${a._id}  @${a.username??a.displayName??''}`);}
else{console.log('Commands: check | render | schedule [--dry] | stats [--days N] [--json] | accounts. See docs/social/README.md.');}
