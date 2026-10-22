// One-time move of saved size keys onto the fixed categories (lib/relevance.js SIZE_CATEGORIES, October 22).
// Dry run by default: prints each change. --apply saves them. --delete=<conversation>:<key> soft-deletes a size
// the founder confirmed was not a lasting size. Old facts are kept as deleted, so every change can be undone.
//   node --env-file=.env.local scripts/size-key-migration.js [--apply] [--delete=<id>:<key>]
import {createStore} from '../lib/store.js';
import {SIZE_CATEGORIES,sizeKeyShape} from '../lib/relevance.js';

// A fixed vocabulary of how kinds of items were written before the list existed; not a reading of intent.
const CATEGORY={top:'tops',tops:'tops',shirt:'tops',shirts:'tops',tee:'tops',knitwear:'tops',bottom:'bottoms',bottoms:'bottoms',trousers:'bottoms',pants:'bottoms',jeans:'bottoms',
 jacket:'outerwear',jackets:'outerwear',coat:'outerwear',outerwear:'outerwear',suit:'suits',suits:'suits',dress:'dresses',dresses:'dresses',shoe:'shoes',shoes:'shoes',sneakers:'shoes',boots:'shoes'};
const DEPARTMENTS=['women','men','womens','mens'];
const SYSTEMS=['us','eu','uk','it','fr','jp','us_men','us_women','letter','waist','collar','numeric'];
const LETTER=/^(xxs|xs|s|m|l|xl|xxl|xxxl|small|medium|large|x-large|extra large)$/i;
export function migrateKey(fact){
  if(sizeKeyShape(fact.key))return null;
  let parts=String(fact.key).toLowerCase().split('/').map(p=>p.trim()).filter(Boolean),women=false;
  if(DEPARTMENTS.includes(parts[0])){women=parts[0].startsWith('women');parts=parts.slice(1);}
  const category=CATEGORY[parts[0]];
  if(!category||!SIZE_CATEGORIES.includes(category))return null;
  let [, system, brand]=parts;
  // jacket/lemaire: the second part is a brand, not a size system.
  if(system&&!SYSTEMS.includes(system)){brand=system;system=null;}
  if(!system)system=LETTER.test(String(fact.value).trim())?'letter':null;
  if(!system)return null;
  if(women&&category==='shoes'&&system==='us')system='us_women';
  return [category,system,brand].filter(Boolean).join('/');
}

if(import.meta.url===`file://${process.argv[1]}`){
  const apply=process.argv.includes('--apply'),deletes=process.argv.filter(a=>a.startsWith('--delete=')).map(a=>a.slice(9));
  const store=createStore(process.env),u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rows=await (await fetch(`${u}/rest/v1/taste_profiles?select=conversation_id`,{headers:{apikey:k,authorization:`Bearer ${k}`}})).json();
  const at=new Date().toISOString();
  for(const {conversation_id:id} of rows){
    const profile=await store.profile(id);let changed=false;const facts=[];
    for(const f of profile.facts){
      if(f.deleted||f.field!=='size'||sizeKeyShape(f.key)){facts.push(f);continue;}
      if(deletes.includes(`${id}:${f.key}`)){console.log(id.slice(0,8),'delete',f.key,'=',f.value);facts.push({...f,deleted:true,updated_at:at,deleted_reason:'one item in one request, not a lasting size (founder, October 22)'});changed=true;continue;}
      const key=migrateKey(f);
      if(!key||profile.facts.some(o=>!o.deleted&&o.field==='size'&&o.key===key)){console.log(id.slice(0,8),'left for Jules to ask',f.key,'=',f.value);facts.push(f);continue;}
      console.log(id.slice(0,8),f.key,'→',key,'=',f.value);
      facts.push({...f,deleted:true,updated_at:at,deleted_reason:`moved to ${key}`},{...f,key,updated_at:at,migrated_from:f.key});changed=true;
    }
    if(changed&&apply)console.log(id.slice(0,8),'saved:',await store.saveProfile(id,profile.version,facts));
  }
  if(!apply)console.log('Dry run: nothing saved. Add --apply to save.');
}
