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
export function renderShareCard({card,tone,crops=[],signupURL,canvas=document.createElement('canvas')}) {
  canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Image export is not supported in this browser.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,1080,1920);
  ctx.fillStyle='#161616';ctx.textBaseline='top';
  ctx.font='24px Arial';ctx.fillText('MY STYLE / JULES',84,105);
  let titleSize=90,titleLines;
  do{ctx.font=`${titleSize}px Arial`;titleLines=wrapText(ctx,card.title,912);titleSize-=4;}while(titleLines.length>3&&titleSize>48);
  let y=drawLines(ctx,titleLines,84,210,(titleSize+4)*1.12)+52;
  const copy=cardText(card,tone);
  let bodySize=48,bodyLines,available=1730-y-(crops.length?660:0);
  do{ctx.font=`${bodySize}px Arial`;bodyLines=wrapText(ctx,copy,912);if(bodyLines.length*bodySize*1.4<=available)break;bodySize-=2;}while(bodySize>26);
  if(bodyLines.length*bodySize*1.4>available)throw new Error('This card is too long to export. Shorten your correction first.');
  y=drawLines(ctx,bodyLines,84,y,bodySize*1.4)+48;
  if(crops.length) {
    const w=288,h=244,gap=24;
    crops.slice(0,6).forEach(({image,label},index)=>{
      const x=84+(index%3)*(w+gap),top=y+Math.floor(index/3)*314;
      ctx.fillStyle='#fafafa';ctx.fillRect(x,top,w,h);
      const ratio=Math.min((w-24)/image.naturalWidth,(h-24)/image.naturalHeight),iw=image.naturalWidth*ratio,ih=image.naturalHeight*ratio;
      ctx.drawImage(image,x+(w-iw)/2,top+(h-ih)/2,iw,ih);
      ctx.fillStyle='#161616';ctx.font='22px Arial';drawLines(ctx,wrapText(ctx,label,w).slice(0,2),x,top+h+12,27);
    });
  }
  ctx.strokeStyle='#eee';ctx.beginPath();ctx.moveTo(84,1760);ctx.lineTo(996,1760);ctx.stroke();
  const gradient=ctx.createLinearGradient(84,1800,270,1872);gradient.addColorStop(0,'#ad00a6');gradient.addColorStop(1,'#007c85');ctx.fillStyle=gradient;ctx.font='72px Mongule, Arial';ctx.fillText('jules',84,1800);
  ctx.fillStyle='#161616';ctx.font='22px Arial';ctx.fillText('Want your own style read?',330,1808);
  if(signupURL){const u=new URL(signupURL);ctx.fillText(u.host+u.pathname,330,1840);}
  return canvas;
}
export const canvasBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not export this image.')),'image/png'));
