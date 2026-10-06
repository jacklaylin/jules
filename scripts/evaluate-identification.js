import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {visualSearchProducts} from '../lib/visual-search.js';
import {lensSearch} from '../lib/lens.js';
import {compareCandidates} from '../lib/visual-search.js';
import {imageType} from '../lib/images.js';
if(!process.argv[2]||!process.env.SERPAPI_API_KEY||!process.env.OPENAI_API_KEY)throw new Error('Provide a private manifest path and credentials in environment variables.');
const cases=JSON.parse(await readFile(process.argv[2],'utf8'));
const output=resolve('.eval-local',new Date().toISOString().replaceAll(':','-'));
await mkdir(output,{recursive:true,mode:0o700});
for(const c of cases){
 if(!/^case-\d+$/.test(c.id)||!Array.isArray(c.image_paths)||c.image_paths.length<1||c.image_paths.length>3)throw new Error('Invalid evaluation case');
 const images=await Promise.all(c.image_paths.map(async path=>{const bytes=await readFile(path);if(bytes.length>3*1024*1024)throw new Error('Image too large');return {mime_type:imageType(bytes),data:bytes.toString('base64')};}));
 const started=Date.now();let result;const traces=[];
 try{result=await visualSearchProducts(c.query,images,process.env,fetch,{retrieve:async(...args)=>{const candidates=await lensSearch(...args);traces.push({stage:'retrieval',candidates});return candidates;},compare:async(...args)=>{const comparison=await compareCandidates(...args);traces.push({stage:'comparison',target:args[0].label,comparison});return comparison;}});}catch{result={status:'failed',products:[]};}
 await writeFile(resolve(output,c.id+'.json'),JSON.stringify({id:c.id,query:c.query,expected:c.expected,traces,elapsed_ms:Date.now()-started,model:process.env.OPENAI_MODEL||'gpt-4.1-mini',result},null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({id:c.id,status:result.status,elapsed_ms:Date.now()-started}));
}
console.log('Private results saved to '+output);
