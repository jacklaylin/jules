// Checks a week's social plan before anything is rendered or scheduled, and turns a checked post into a
// Zernio create-post request (docs/social/README.md). The checks are the brand and honesty rules that
// code can enforce: format limits, no "AI" branding, a dated source behind every price, and a label on
// any conversation that didn't really happen. The weekly routine writes the copy; this is its backstop.
import {GROUND_NAMES} from './slides.js';

export const PILLARS=['wrapped','text-it','hunt','how-to','real'];
const KINDS=['hook','card','list','chat','photo','cta'];
// GTM.md: sell the outcome, never the technology.
const TECH_WORDS=/\b(ai|a\.i\.|artificial intelligence|agent|agentic|chatbot|chat ?gpt|gpt|llm|algorithm|machine learning)\b/i;
// A price or a discount is a fact about a store, so it needs a source and a date (AGENTS.md: never
// fabricate prices).
const MONEY=/[$€£]\s?\d|\b\d+\s?% off\b|\b\d+\s?(dollars|bucks)\b/i;
const DAY=86400000;

const copyOf=slide=>[slide.text,slide.sub,slide.label,slide.title,slide.body,slide.caption,...(slide.items??[]),...(slide.messages??[]).map(m=>m.text)].filter(Boolean);

export function checkPost(post,{now=Date.now()}={}){
 const problems=[],add=m=>problems.push(`${post?.id??'(no id)'}: ${m}`);
 if(!post||typeof post!=='object')return ['A post must be an object.'];
 if(!/^[a-z0-9-]{3,60}$/.test(post.id??''))add('id must be 3-60 lowercase letters, digits or dashes');
 if(!PILLARS.includes(post.pillar))add(`pillar must be one of ${PILLARS.join(', ')}`);
 if(typeof post.hook!=='string'||!post.hook.trim())add('hook (a short name for the angle, used to compare results) is required');
 const at=Date.parse(post.publishAt);
 if(!/[zZ]|[+-]\d\d:\d\d$/.test(post.publishAt??'')||Number.isNaN(at))add('publishAt must be an ISO time with an offset, e.g. 2026-10-27T19:00:00-04:00');
 // Scheduled at least 12 hours out, so a person can look at the week and delete a post first.
 else if(at-now<12*3600000)add('publishAt must be at least 12 hours from now (review window)');
 const slides=Array.isArray(post.slides)?post.slides:[];
 if(slides.length<3||slides.length>10)add('a carousel needs 3-10 slides (Instagram allows 10)');
 if(slides.length&&slides.at(-1).kind!=='cta')add('the last slide must be the cta slide');
 for(const [i,s] of slides.entries()){
  const where=`slide ${i+1}`;
  if(!KINDS.includes(s?.kind)){add(`${where}: kind must be one of ${KINDS.join(', ')}`);continue;}
  if(s.ground&&!GROUND_NAMES.includes(s.ground))add(`${where}: ground must be one of ${GROUND_NAMES.join(', ')}`);
  if(s.kind==='hook'&&!s.text)add(`${where}: hook needs text`);
  if((s.kind==='card'||s.kind==='list')&&!s.title)add(`${where}: ${s.kind} needs a title`);
  if(s.kind==='list'&&(!Array.isArray(s.items)||s.items.length<2||s.items.length>5))add(`${where}: list needs 2-5 items`);
  if(s.kind==='photo'&&!s.image)add(`${where}: photo needs an image path`);
  if(s.kind==='chat'){
   if(!Array.isArray(s.messages)||!s.messages.length||s.messages.some(m=>!['me','jules'].includes(m.from)||!m.text))add(`${where}: chat needs messages from "me" or "jules"`);
   // A conversation is either a real one (a screenshot or transcript to point to) or labeled as an example.
   if(!s.illustrative&&!s.evidence)add(`${where}: chat must be marked illustrative or cite evidence (a real conversation)`);
  }
  for(const line of copyOf(s))if(line.length>240)add(`${where}: a line over 240 characters won't fit a slide`);
 }
 const caption=post.caption??'';
 if(!caption.trim())add('caption is required');
 if(caption.length>2000)add('caption must stay under 2,000 characters');
 if(!Array.isArray(post.hashtags)||post.hashtags.length>5||post.hashtags.some(h=>!/^[a-z0-9_]{2,40}$/i.test(h)))add('hashtags: up to 5, letters/digits only, no #');
 if(post.title&&post.title.length>90)add('title (TikTok) must be 90 characters or fewer');
 const all=[post.title,caption,...slides.flatMap(copyOf)].filter(Boolean);
 for(const line of all)if(TECH_WORDS.test(line))add(`no technology branding ("${line.match(TECH_WORDS)[0]}"): sell the outcome`);
 if(all.some(l=>MONEY.test(l))){
  const sources=Array.isArray(post.sources)?post.sources:[];
  if(!sources.length)add('a price or discount needs sources: [{claim, url, asOf}]');
  for(const s of sources){
   if(!/^https:\/\//.test(s?.url??'')||!s?.claim)add('each source needs a claim and an https url');
   const seen=Date.parse(s?.asOf);
   if(Number.isNaN(seen))add('each source needs asOf (the date the price was seen)');
   else if(!Number.isNaN(at)&&at-seen>14*DAY)add(`source "${s.claim}" was seen more than 14 days before posting; recheck it`);
  }
  if(!/as of|prices? (seen|checked)/i.test(caption))add('a post with prices must say "prices as of <date>" in the caption');
 }
 return problems;
}

export function checkPlan(plan,options){
 if(!Array.isArray(plan?.posts)||!plan.posts.length)return ['A plan needs a posts array.'];
 const problems=plan.posts.flatMap(p=>checkPost(p,options));
 const ids=plan.posts.map(p=>p.id);
 for(const id of new Set(ids.filter((id,i)=>ids.indexOf(id)!==i)))problems.push(`${id}: duplicate id`);
 return problems;
}

const withTags=(caption,tags)=>tags?.length?`${caption}\n\n${tags.map(t=>'#'+t).join(' ')}`:caption;

// accounts: {tiktok:'<zernio account id>',instagram:'<id>'}; media: {tiktok:[urls],instagram:[urls]}.
// Instagram gets the 4:5 slides and the caption; TikTok gets the 9:16 slides, the title, the caption as
// its description and TikTok's own "your brand" disclosure, since this is Jules promoting itself.
export function zernioPost(post,accounts,media,{timezone='America/New_York'}={}){
 const caption=withTags(post.caption,post.hashtags),platforms=[];
 if(accounts.tiktok)platforms.push({platform:'tiktok',accountId:accounts.tiktok,customContent:post.title||post.slides[0].text?.replace(/\*/g,'').slice(0,90)||post.hook,customMedia:media.tiktok.map(url=>({type:'image',url})),
  platformSpecificData:{tiktokSettings:{privacy_level:'PUBLIC_TO_EVERYONE',allow_comment:true,content_preview_confirmed:true,express_consent_given:true,media_type:'photo',photo_cover_index:0,auto_add_music:true,description:caption,commercialContentType:'brand_organic'}}});
 if(accounts.instagram)platforms.push({platform:'instagram',accountId:accounts.instagram,customContent:caption,customMedia:media.instagram.map(url=>({type:'image',url}))});
 return {content:caption,scheduledFor:post.publishAt,timezone,platforms,tags:['jules-social',post.pillar,post.id],metadata:{pillar:post.pillar,hook:post.hook,slides:post.slides.length}};
}
