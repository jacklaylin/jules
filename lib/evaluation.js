export function scoreIdentification(grades) {
 if(!Array.isArray(grades)||!grades.length||new Set(grades.map(g=>g.id)).size!==grades.length)throw new Error('Invalid evaluation grades');
 for(const g of grades)if(![g.claimed,g.correct,g.identifiable].every(n=>Number.isInteger(n)&&n>=0)||g.correct>g.claimed||g.correct>g.identifiable||typeof g.abstained!=='boolean'||typeof g.expected_abstention!=='boolean')throw new Error('Invalid evaluation grade');
 const sum=key=>grades.reduce((n,g)=>n+g[key],0),claimed=sum('claimed'),correct=sum('correct'),identifiable=sum('identifiable');
 const abstentions=grades.filter(g=>g.expected_abstention),retailers=grades.filter(g=>typeof g.retailer_pass==='boolean');
 return {graded_cases:grades.length,claimed,correct,wrong:claimed-correct,precision:claimed?correct/claimed:null,coverage:identifiable?correct/identifiable:null,false_match_rate:claimed?(claimed-correct)/claimed:null,appropriate_abstention:abstentions.length?abstentions.filter(g=>g.abstained).length/abstentions.length:null,retailer_pass_rate:retailers.length?retailers.filter(g=>g.retailer_pass).length/retailers.length:null};
}
