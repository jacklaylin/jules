import {createHash,randomBytes} from 'node:crypto';

// How the jokes get better (Style Report canvas, project/ReadCopy.dc.html; founder, 16 Oct 2026: every
// card with joke copy uses this loop, including cards built later). The steps:
// 1 · Log: every line a person is shown is saved on their report's copy log with its card, the fact
//     it states, whether it was generated or pre-written, and the prompt version.
// 2 · Vote: 👍 counts for every line on the card. 👎 can name the lines that missed; an unnamed 👎
//     counts half, spread across the card's lines.
// 3 · Learn: a line with 👍 from EXAMPLE_PEOPLE+ different people and no 👎 joins its card's examples
//     in the writer prompt (newest EXAMPLES_MAX), and the newest MISSES_MAX missed lines go in as
//     "don't write like this". Each learned line is re-checked by its card's validator first.
// 4 · A person never sees a line they voted down again.
// Votes change what the writer sees, never the rules or validators. No new table: the log and votes
// live on each person's report (gmail_imports.data.style_report), and a build reads every person's.
export const EXAMPLE_PEOPLE=2,EXAMPLES_MAX=24,MISSES_MAX=12,LOG_MAX=300;
// A miss is a named line, or a whole unnamed 👎 on a one-line card. An unnamed 👎 spread across
// several lines blocks them as examples but doesn't teach "don't write like this" by itself.
const MISS=0.5;

// The prompt version is the base prompt's own fingerprint, so a prompt edit is a new version without
// anyone remembering to bump a number.
export const promptVersion=text=>createHash('sha256').update(String(text)).digest('hex').slice(0,8);
const norm=text=>String(text??'').toLowerCase().replace(/\s+/g,' ').trim();
export const lineKey=(card,text)=>card+'|'+norm(text);

// One shown line. source: 'generated' (the writer's line), 'prewritten' (our fallback copy) or
// 'fact' (a plain fact shown because no joke passed; it's data, not copy, so it never teaches).
// check is what the card's validator needs to re-check the line on its own; names are the stores and
// brands on that card, so another person's names can't be copied into someone else's line.
export function shownLine({report_id,card,slot,text,fact,source,prompt=null,check=null,names=[],at}){
 return {id:randomBytes(6).toString('base64url'),report_id,card,slot,text,fact,source,prompt,check,names:[...new Set(names)].slice(0,12),at};
}

// Every person's votes, per line. rows: [{conversation_id, copy, feedback}] from the store. Only the
// latest vote per report and card counts (a person can change their mind). since: ISO time, to count
// only recent votes (the admin week).
export function lineVotes(rows,{since=null}={}){
 const lines=new Map();
 for(const row of rows??[]){
  const person=row.conversation_id,copy=Array.isArray(row.copy)?row.copy:[],feedback=Array.isArray(row.feedback)?row.feedback:[];
  const entry=line=>{const key=lineKey(line.card,line.text);if(!lines.has(key))lines.set(key,{key,card:line.card,slot:line.slot,text:line.text,fact:line.fact,source:line.source,prompt:line.prompt,check:line.check,names:line.names??[],
   ups:new Set(),down_people:new Set(),downs:0,reasons:{},shown:new Set(),last_up:null,last_down:null,seen_at:line.at});
   const a=lines.get(key);if((line.at??'')>=(a.seen_at??'')){Object.assign(a,{slot:line.slot,fact:line.fact,source:line.source,prompt:line.prompt,check:line.check,names:line.names??[],seen_at:line.at});}
   return a;};
  for(const line of copy)if(line?.card&&typeof line.text==='string')entry(line).shown.add(person);
  const latest=new Map();
  for(const f of feedback)if(f?.report_id&&f.card&&(!since||(f.at??'')>=since))latest.set(f.report_id+'|'+f.card,f);
  for(const f of latest.values()){
   const on=copy.filter(l=>l?.report_id===f.report_id&&l.card===f.card&&typeof l.text==='string');
   if(!on.length)continue;
   const named=f.vote==='down'&&Array.isArray(f.lines)&&f.lines.length?new Set(f.lines):null;
   for(const line of on){
    const a=entry(line);
    if(f.vote==='up'){a.ups.add(person);if((f.at??'')>(a.last_up??''))a.last_up=f.at;continue;}
    if(f.vote!=='down'||(named&&!named.has(line.id)))continue;
    a.downs+=named?1:MISS/on.length;a.down_people.add(person);
    if(f.reason)a.reasons[f.reason]=(a.reasons[f.reason]??0)+1;
    if((f.at??'')>(a.last_down??''))a.last_down=f.at;
   }
  }
 }
 return lines;
}

export const NO_LESSONS=Object.freeze({examples:[],misses:[],avoid:new Set(),foreign:[],bank:new Map()});
// What one card's writer learns before writing for one person. recheck(text, check) is the card's own
// validator; a learned line that no longer passes it is left out. teaches(line) says which lines the
// writer writes, so only those go in its prompt (The Read's verdicts are pre-written only).
export function cardLessons(votes,card,{person=null,recheck=()=>true,teaches=()=>true}={}){
 const all=[...votes.values()].filter(a=>a.card===card&&a.source!=='fact'),mine=all.filter(teaches);
 const passes=a=>{try{return Boolean(recheck(a.text,a.check??{}));}catch{return false;}};
 const examples=mine.filter(a=>a.ups.size>=EXAMPLE_PEOPLE&&!a.down_people.size&&passes(a)).sort((a,b)=>(b.last_up??'').localeCompare(a.last_up??'')).slice(0,EXAMPLES_MAX);
 const misses=mine.filter(a=>a.downs>=MISS).sort((a,b)=>(b.last_down??'').localeCompare(a.last_down??'')).slice(0,MISSES_MAX);
 // Everything on a card this person voted down, including facts shown in place of a joke.
 const avoid=new Set([...votes.values()].filter(a=>a.card===card&&person&&a.down_people.has(person)&&a.source!=='fact').map(a=>a.key));
 return {examples:examples.map(({fact,text})=>({fact,text})),misses:misses.map(({fact,text})=>({fact,text})),avoid,
  foreign:[...new Set([...examples,...misses].flatMap(a=>a.names))],
  // Everyone's votes on the card's pre-written lines, for banks with several to choose from.
  bank:new Map(all.filter(a=>a.source==='prewritten').map(a=>[a.key,{ups:a.ups.size,downs:a.downs,down_people:a.down_people.size}]))};
}

// A bank of pre-written lines (The Read's verdicts and closers) learns from votes too. Each line is
// drawn with weight (1 + 👍 people) / (1 + 👎), and a line that RETIRE_PEOPLE+ different people voted
// down, with more 👎 than 👍, is retired for everyone. The person's own 👎 still rules it out for them.
export const RETIRE_PEOPLE=2;
const tally=(lessons,card,text)=>lessons.bank?.get(lineKey(card,text))??{ups:0,downs:0,down_people:0};
export const retired=(lessons,card,text)=>{const t=tally(lessons,card,text);return t.down_people>=RETIRE_PEOPLE&&t.downs>t.ups;};
export const bankWeight=(lessons,card,text)=>{const t=tally(lessons,card,text);return (1+t.ups)/(1+t.downs);};

// The writer prompt with what the card has learned. Lessons are other people's lines, so the prompt
// says never to reuse their facts; code enforces that with allows().
const quote=l=>`- ${JSON.stringify(String(l.fact??''))} → ${JSON.stringify(l.text)}`;
export function teach(prompt,lessons=NO_LESSONS){
 const parts=[prompt];
 if(lessons.examples.length)parts.push(`Lines people liked on this card, each with the facts it was written for (other people's, not this person's). Match their voice and shape; never reuse their facts, numbers, names or items:\n${lessons.examples.map(quote).join('\n')}`);
 if(lessons.misses.length)parts.push(`Lines that missed on this card. Don't write like this:\n${lessons.misses.map(quote).join('\n')}`);
 return parts.join('\n');
}

const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const names=(text,name)=>name.length>=3&&new RegExp(`(^|[^\\p{L}])${escape(name.toLowerCase())}($|[^\\p{L}])`,'u').test(String(text).toLowerCase());
// Whether a line may be shown to this person: not one they voted down, and naming no store or brand
// that only came from someone else's learned line. own: names on this person's card.
export function allows(card,text,lessons=NO_LESSONS,own=[]){
 if(typeof text!=='string'||lessons.avoid.has(lineKey(card,text)))return false;
 const ownSet=new Set(own.map(n=>String(n).toLowerCase()));
 return !lessons.foreign.some(n=>!ownSet.has(String(n).toLowerCase())&&names(text,n));
}
// The names from a list that a line or its fact mentions, for shownLine's names.
export const namesIn=(list,...texts)=>[...new Set((list??[]).filter(n=>typeof n==='string'&&texts.some(t=>t&&names(t,n))))];

// The admin view: the week's best and worst lines, and how each prompt version is doing.
export function copyWeek(rows,now=new Date()){
 const since=new Date(now.getTime()-7*864e5).toISOString(),votes=lineVotes(rows,{since});
 const view=a=>({card:a.card,slot:a.slot,text:a.text,fact:a.fact,source:a.source,prompt:a.prompt,ups:a.ups.size,downs:Math.round(a.downs*100)/100,down_people:a.down_people.size,reasons:a.reasons,shown:a.shown.size});
 const voted=[...votes.values()].filter(a=>a.ups.size||a.down_people.size);
 const best=voted.filter(a=>a.ups.size&&!a.down_people.size).sort((a,b)=>b.ups.size-a.ups.size||(b.last_up??'').localeCompare(a.last_up??'')).slice(0,15).map(view);
 const worst=voted.filter(a=>a.down_people.size).sort((a,b)=>b.downs-a.downs||b.down_people.size-a.down_people.size||(b.last_down??'').localeCompare(a.last_down??'')).slice(0,15).map(view);
 const prompts={};
 for(const row of rows??[])for(const l of Array.isArray(row.copy)?row.copy:[])if(l?.card&&(l.at??'')>=since){const k=`${l.card}|${l.prompt??'none'}`;prompts[k]??={card:l.card,prompt:l.prompt??null,shown:0,generated:0,ups:0,downs:0};prompts[k].shown++;if(l.source==='generated')prompts[k].generated++;}
 for(const a of voted){const p=prompts[`${a.card}|${a.prompt??'none'}`];if(p){p.ups+=a.ups.size;p.downs+=a.downs;}}
 return {since,best,worst,prompts:Object.values(prompts).map(p=>({...p,downs:Math.round(p.downs*100)/100})).sort((a,b)=>a.card.localeCompare(b.card)||b.shown-a.shown)};
}
