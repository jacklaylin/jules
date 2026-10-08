import {cardTheme,drawSymbol} from './style-visuals.js';
// The web card and flat image use the same approved copy. No external image URLs.
export function cardText(card,tone) {return card.correction||card.variants[tone]||card.variants.balanced;}
export function wrapText(ctx,text,width) {
  const lines=[];
  for(const paragraph of text.split('\n')) {
    if(!paragraph){lines.push('');continue;}
    let line='';
    for(const word of paragraph.split(/\s+/)) {
      if(ctx.measureText(word).width>width) {
        if(line){lines.push(line);line='';}
        for(const char of word){if(ctx.measureText(line+char).width>width&&line){lines.push(line);line='';}line+=char;}
      } else if(ctx.measureText(line?line+' '+word:word).width<=width)line=line?line+' '+word:word;
      else{lines.push(line);line=word;}
    }
    if(line)lines.push(line);
  }
  return lines;
}
function drawLines(ctx,lines,x,y,lineHeight) {for(const line of lines){ctx.fillText(line,x,y);y+=lineHeight;}return y;}
// Freeform anchors scale to the space left by the copy, rather than fixed rows.
export function shareCollageLayout(items,{x=84,y,width=912,height}){
 const anchors=items.length===1?[[.5,.48,.94,.88,-3]]:items.length===2?[[.34,.45,.69,.90,-4],[.73,.64,.49,.57,6]]:items.length===3?[[.32,.45,.62,.88,-4],[.77,.25,.43,.48,5],[.72,.76,.50,.36,-6]]:[[.30,.41,.59,.73,-5],[.78,.19,.39,.36,6],[.76,.57,.46,.44,-4],[.28,.85,.42,.23,4],[.73,.88,.32,.20,7],[.53,.32,.29,.23,-8]];
 return items.map((item,i)=>{
  const [ax,ay,aw,ah,turn]=anchors[i],angle=turn*Math.PI/180;
  const aspect=item.image?item.image.naturalWidth/item.image.naturalHeight:item.kind==='color'?1:1.5;
  let w=Math.min(width*aw,(height*ah-54)*aspect),h=w/aspect;
  const c=Math.abs(Math.cos(angle)),sn=Math.abs(Math.sin(angle));
  const fit=Math.min(1,(width-20)/(w*c+(h+54)*sn),(height-20)/(w*sn+(h+54)*c));w*=fit;h*=fit;
  const halfW=(w*c+(h+54)*sn)/2,halfH=(w*sn+(h+54)*c)/2;
  return {item,x:x+Math.max(halfW+10,Math.min(width-halfW-10,width*ax)),y:y+Math.max(halfH+10,Math.min(height-halfH-10,height*ay)),width:w,height:h,angle};
 });
}

export function renderShareCard({card,tone,crops=[],ingredients=[],signupURL,canvas=document.createElement('canvas')}) {
  canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Image export is not supported in this browser.');
  const theme=cardTheme(card),bg=ctx.createLinearGradient(0,0,1080,1920);bg.addColorStop(0,theme.a);bg.addColorStop(1,theme.b);ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1920);
  ctx.fillStyle='#161616';ctx.textBaseline='top';
  ctx.font='24px Arial';ctx.fillText(card.type==='starter'?'MY STARTER PACK / JULES':'MY STYLE / JULES',84,105);
  let titleSize=90,titleLines;
  do{ctx.font=`${titleSize}px "${theme.font}"`;titleLines=wrapText(ctx,card.title,912);titleSize-=4;}while(titleLines.length>3&&titleSize>48);
  let y=drawLines(ctx,titleLines,84,210,(titleSize+4)*1.12)+52;
  const copy=cardText(card,tone);
  let bodySize=48,bodyLines,available=1730-y-(crops.length||ingredients.length?820:0);
  do{ctx.font=`${bodySize}px Arial`;bodyLines=wrapText(ctx,copy,912);if(bodyLines.length*bodySize*1.4<=available)break;bodySize-=2;}while(bodySize>26);
  if(bodyLines.length*bodySize*1.4>available)throw new Error('This card is too long to export. Shorten your correction first.');
  y=drawLines(ctx,bodyLines,84,y,bodySize*1.4)+48;
  const items=[...crops.slice(0,6).map(c=>({...c,kind:'photo'})),...ingredients].slice(0,6);
  if(items.length){
    const layout=shareCollageLayout(items,{y,height:1720-y});
    for(const {item,x,y:cy,width,height,angle} of layout){
      ctx.save();ctx.translate(x,cy);ctx.rotate(angle);
      if(item.image){ctx.shadowColor='#0003';ctx.shadowBlur=20;ctx.shadowOffsetY=12;ctx.drawImage(item.image,-width/2,-height/2,width,height);}
      else if(item.kind==='color'){ctx.fillStyle=item.color||theme.b;ctx.fillRect(-width/2,-height/2,width,height);}
      else if(item.kind==='brand'||item.icon==='none'){ctx.fillStyle='#161616';ctx.font=`${Math.min(70,width/item.label.length*1.6)}px Arial`;drawLines(ctx,wrapText(ctx,item.label,width),-width/2,-height/4,60);}
      else drawSymbol(ctx,item.icon,-width/2,-height/2,width,height);
      ctx.restore();
    }
    // Labels follow the actual asset edge and remain readable above overlaps.
    for(const {item,x,y:cy,width,height,angle} of layout){
      ctx.save();ctx.translate(x,cy);ctx.rotate(angle);ctx.fillStyle='#161616';ctx.font='22px Arial';
      const lines=wrapText(ctx,item.label,Math.max(width,150)).slice(0,2),labelWidth=Math.max(...lines.map(line=>ctx.measureText(line).width));
      ctx.fillStyle='#fffC';ctx.fillRect(-width/2-5,height/2+8,labelWidth+10,lines.length*25+4);ctx.fillStyle='#161616';drawLines(ctx,lines,-width/2,height/2+12,25);ctx.restore();
    }
  }
  ctx.strokeStyle='#eee';ctx.beginPath();ctx.moveTo(84,1760);ctx.lineTo(996,1760);ctx.stroke();
  const gradient=ctx.createLinearGradient(84,1800,270,1872);gradient.addColorStop(0,'#ad00a6');gradient.addColorStop(1,'#007c85');ctx.fillStyle=gradient;ctx.font='72px Mongule, Arial';ctx.fillText('jules',84,1800);
  ctx.fillStyle='#161616';ctx.font='22px Arial';ctx.fillText('Want your own style read?',330,1808);
  if(signupURL){const u=new URL(signupURL);ctx.fillText(u.host+u.pathname,330,1840);}
  return canvas;
}
export const canvasBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not export this image.')),'image/png'));
