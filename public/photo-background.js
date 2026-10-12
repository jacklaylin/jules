// Match plain retailer backdrops without changing or cropping the photograph.
export function edgeBackground({data,width,height}) {
 const samples=[];
 const sample=(x,y)=>{
  const i=(y*width+x)*4,alpha=data[i+3]/255;
  samples.push([0,1,2].map(c=>Math.round(data[i+c]*alpha+255*(1-alpha))));
 };
 for(let x=0;x<width;x++){sample(x,0);if(height>1)sample(x,height-1);}
 for(let y=1;y<height-1;y++){sample(0,y);if(width>1)sample(width-1,y);}
 if(!samples.length)return '#fff';
 const near=(a,b)=>a.every((v,c)=>Math.abs(v-b[c])<=12);
 let best=[];
 for(const candidate of samples){const cluster=samples.filter(color=>near(candidate,color));if(cluster.length>best.length)best=cluster;}
 // Do not mistake a model, scene, or product touching an edge for a backdrop.
 if(best.length/samples.length<0.7)return '#fff';
 const color=[0,1,2].map(c=>{const values=best.map(s=>s[c]).sort((a,b)=>a-b);return values[Math.floor(values.length/2)];});
 return `rgb(${color.join(', ')})`;
}

export function matchPhotoBackground(frame,img) {
 let color='#fff';
 try{
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=32;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(img,0,0,32,32);
  color=edgeBackground(context.getImageData(0,0,32,32));
 }catch{/* Cross-origin previews may not allow pixel reads. Keep the full photo. */}
 frame.style.backgroundColor=color;
}
