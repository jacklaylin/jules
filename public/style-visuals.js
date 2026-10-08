// One visual vocabulary for private stories and exported images.
export const HEADER_FONTS=['Clash Display','Panchang','Comico','Array','Styro','Boxing','Teko'];
const themes={style:['#e5e4fc','#f2cbb9',0],starter:['#fff0bf','#d4e8d9',0],brands:['#edcbe0','#ded8ff',2],colors:['#e7cbb5','#c8d8ba',3],formula:['#d0e2fb','#f2d5ca',6],modes:['#ffdfab','#f0c9e6',4],gap:['#dcf0bd','#c6e5ec',5]};
export function cardTheme(card){const [a,b,index]=themes[card.type]||['#f2d9bd','#e3d9f5',1];return {a,b,font:HEADER_FONTS[index]};}
export function cardVisuals(report,card){
 const observations=report.analysis.observations.filter(o=>card.observation_ids.includes(o.id));
 const ids=new Set(observations.flatMap(o=>o.source_ids));
 let crops=report.analysis.crops.map((c,index)=>({...c,index})).filter(c=>card.type==='starter'||(c.observation_ids?c.observation_ids.some(id=>card.observation_ids.includes(id)):ids.has(c.source_id)));
 if(['style','formula'].includes(card.type))crops=crops.filter(c=>!(report.analysis.outfit_contexts||[]).some(context=>context.source_id===c.source_id&&context.dedicated));
 if(card.type==='colors'){const words=(card.title+' '+card.variants.balanced+' '+observations.map(o=>o.text).join(' ')).toLowerCase();const colors=['brown','khaki','olive','green','beige','black','white','navy','blue','pink','red','orange','yellow','purple','cream','gray','grey','tan','rust','burgundy'].filter(c=>new RegExp('\\b'+c+'(?:s)?\\b').test(words));const score=c=>colors.filter(color=>new RegExp('\\b'+color+'(?:s)?\\b').test(c.label.toLowerCase())).length;crops.sort((a,b)=>score(b)-score(a)||a.index-b.index);}
 crops=crops.slice(0,card.type==='starter'?6:3);
 let ingredients=(report.analysis.ingredients||[]).filter(i=>card.type==='starter'||(card.type==='brands'?i.kind==='brand':i.observation_ids.some(id=>card.observation_ids.includes(id))));
 if(card.type==='starter'||card.type==='brands'){
  const brands=report.analysis.observations.filter(o=>o.preference?.field==='brand');
  for(const o of brands.filter(o=>/likes?|loves?|prefers?|favou?rite/i.test(o.preference.value)&&!/avoid|dislike|doesn.t|not |don.t/i.test(o.preference.value)))if(!ingredients.some(i=>i.kind==='brand'&&i.label.toLowerCase()===o.preference.key.toLowerCase()))ingredients.push({kind:'brand',label:o.preference.key,icon:'none',observation_ids:[o.id]});
 }
 if(card.type==='starter'){ingredients=ingredients.slice(0,5);crops=crops.slice(0,Math.max(1,6-ingredients.length));}
 return {crops,ingredients:ingredients.slice(0,card.type==='starter'?6-crops.length:3)};
}
// Symbolic illustrations, never product identification or an assertion of ownership.
export function drawSymbol(ctx,icon,x,y,w,h){
 ctx.save();ctx.translate(x,y);ctx.scale(w/200,h/130);ctx.strokeStyle='#222';ctx.fillStyle='#222';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
 const line=(points)=>{ctx.beginPath();points.forEach(([a,b],i)=>i?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.stroke();};
 const circle=(a,b,r)=>{ctx.beginPath();ctx.arc(a,b,r,0,Math.PI*2);ctx.stroke();};
 if(icon==='bike'){circle(40,95,29);circle(165,95,29);line([[40,95],[77,37],[108,95],[40,95],[132,37],[165,95]]);line([[68,32],[92,32]]);line([[108,95],[132,37],[148,30],[144,22]]);}
 else if(icon==='coffee'){ctx.strokeRect(45,35,94,65);circle(150,63,20);line([[35,112],[157,112]]);line([[65,20],[70,4]]);line([[100,20],[105,4]]);}
 else if(icon==='camera'){ctx.strokeRect(25,30,150,90);ctx.strokeRect(52,16,47,14);circle(105,74,30);circle(153,47,5);}
 else if(icon==='book'){line([[100,25],[30,15],[30,108],[100,120],[170,108],[170,15],[100,25],[100,120]]);}
 else if(icon==='tennis'){circle(100,48,33);line([[100,81],[100,122]]);line([[80,24],[80,72]]);line([[100,16],[100,80]]);line([[120,24],[120,72]]);line([[70,37],[130,37]]);line([[70,58],[130,58]]);}
 else if(icon==='music'){line([[76,97],[76,30],[140,15],[140,85]]);circle(60,100,16);circle(124,89,16);}
 else if(icon==='travel'){ctx.strokeRect(45,30,110,85);ctx.strokeRect(83,15,34,15);line([[70,30],[70,115]]);line([[130,30],[130,115]]);}
 else{circle(100,60,38);line([[100,13],[100,107]]);line([[53,60],[147,60]]);}
 ctx.restore();
}
export function symbolCanvas(icon){const c=document.createElement('canvas');c.width=400;c.height=260;drawSymbol(c.getContext('2d'),icon,0,0,400,260);return c;}
