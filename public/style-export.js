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
    const columns=items.length>4?3:2,rows=Math.ceil(items.length/columns),width=912/columns,height=Math.min(640/rows,300);
    items.forEach((item,index)=>{
      const x=84+(index%columns)*width,top=y+Math.floor(index/columns)*(height+42);
      ctx.save();ctx.translate(x+width/2,top+height/2);ctx.rotate((index%2?-5:6)*Math.PI/180);
      if(item.image){const img=item.image,ratio=Math.min((width-30)/img.naturalWidth,(height-35)/img.naturalHeight),iw=img.naturalWidth*ratio,ih=img.naturalHeight*ratio;ctx.shadowColor='#0002';ctx.shadowBlur=12;ctx.drawImage(img,-iw/2,-ih/2,iw,ih);}
      else if(item.kind==='color'){ctx.fillStyle=item.color||theme.b;ctx.fillRect(-width*.33,-height*.3,width*.66,height*.6);}
      else if(item.kind==='brand'||item.icon==='none'){ctx.fillStyle='#161616';ctx.font=`${Math.min(38,430/item.label.length)}px Arial`;drawLines(ctx,wrapText(ctx,item.label,width-30),-width/2+15,-25,42);}
      else drawSymbol(ctx,item.icon,-width*.42,-height*.4,width*.84,height*.8);
      ctx.restore();ctx.fillStyle='#161616';ctx.font='22px Arial';drawLines(ctx,wrapText(ctx,item.label,width-26).slice(0,2),x+12,top+height,25);
    });
  }
  ctx.strokeStyle='#eee';ctx.beginPath();ctx.moveTo(84,1760);ctx.lineTo(996,1760);ctx.stroke();
  const gradient=ctx.createLinearGradient(84,1800,270,1872);gradient.addColorStop(0,'#ad00a6');gradient.addColorStop(1,'#007c85');ctx.fillStyle=gradient;ctx.font='72px Mongule, Arial';ctx.fillText('jules',84,1800);
  ctx.fillStyle='#161616';ctx.font='22px Arial';ctx.fillText('Want your own style read?',330,1808);
  if(signupURL){const u=new URL(signupURL);ctx.fillText(u.host+u.pathname,330,1840);}
  return canvas;
}
export const canvasBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not export this image.')),'image/png'));
