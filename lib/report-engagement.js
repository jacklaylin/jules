// Style report engagement (db/049 events, lib/report-events.js): how a person's report was opened, shared,
// opened by friends and voted on. Pure; the reads are in lib/person-adoption.js. No text or viewer identity.

export const REPORT_KINDS=['report_viewed','report_shared','report_share_opened'];

// The latest vote per card per report: changing a vote on a card is one vote, not two.
export function reportVotes(feedback=[]){
 const latest=new Map();
 for(const f of Array.isArray(feedback)?feedback:[])if(f&&['up','down'].includes(f.vote))latest.set(`${f.report_id}|${f.card}`,f.vote);
 const votes=[...latest.values()];
 return {up:votes.filter(v=>v==='up').length,down:votes.filter(v=>v==='down').length};
}

// report: {id, built_at, share_at, feedback} from the history row, or null when none was built.
// events: this person's report events. signups: people who signed up through their shared links.
export function reportEngagement({report=null,events=[],signups=0}){
 if(!report?.id)return {built:false};
 const of=kind=>events.filter(e=>e.kind===kind);
 const viewed=of('report_viewed'),shared=of('report_shared');
 const channels={};for(const e of shared)if(e.detail)channels[e.detail]=(channels[e.detail]??0)+1;
 return {built:true,built_at:report.built_at??null,share_link_at:report.share_at??null,
  opened:viewed.length,last_opened_at:viewed.map(e=>e.created_at).sort().at(-1)??null,
  shared:shared.length,channels,link_opened:of('report_share_opened').length,signups,
  votes:reportVotes(report.feedback)};
}
