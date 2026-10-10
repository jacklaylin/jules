import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeBackground,matchPhotoBackground} from '../public/photo-background.js';

function image(background,edgeOverride){
 const width=32,height=32,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const edge=x===0||y===0||x===width-1||y===height-1;
  data.set(edge?(edgeOverride?.(x,y)??background):[15,10,5,255],(y*width+x)*4);
 }
 return {width,height,data};
}
test('white backdrop stays white around a dark product',()=>{
 assert.equal(edgeBackground(image([255,255,255,255])),'rgb(255, 255, 255)');
});
test('matches colored and dark backdrops without tinting the photograph',()=>{
 for(const color of [[240,232,218],[25,30,40]])assert.equal(edgeBackground(image([...color,255])),`rgb(${color.join(', ')})`);
});
test('ignores a product touching part of the border and tolerates compression noise',()=>{
 const result=edgeBackground(image([247,246,245,255],(x,y)=>x===0&&y>10&&y<22?[20,20,20,255]:[247+x%3,246,245,255]));
 assert.match(result,/^rgb\(248, 246, 245\)$/);
});
test('busy edges fall back to white instead of guessing a scene color',()=>{
 assert.equal(edgeBackground(image([255,255,255,255],(x,y)=>[(x*31+y*71)%256,(x*17+y*43)%256,(x*97+y*11)%256,255])),'#fff');
});
test('transparent edges use white, regardless of hidden pixel color',()=>{
 assert.equal(edgeBackground(image([0,0,0,0])),'rgb(255, 255, 255)');
});
test('unreadable canvas falls back without breaking image display',()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:()=>({getContext:()=>({drawImage(){throw new Error('SecurityError');}})})};
 try{const frame={style:{}};matchPhotoBackground(frame,{});assert.equal(frame.style.backgroundColor,'#fff');}
 finally{globalThis.document=previous;}
});
