import {readFile} from 'node:fs/promises';
import opentype from 'opentype.js';

// Draws a LinkPreview headline (DESIGN-SYSTEM.md › Rich link previews) as SVG outlines from the bundled
// Instrument Serif, so the server needs no installed fonts. Same rules as the template: 112px, line height
// 0.9, letter-spacing -0.04em, a 590px column at (72, 64), balanced lines. Longer text steps the size
// down until it fits in three lines; a word too long for the column shrinks the size further.
export const COLUMN={x:72,y:64,width:590,maxLines:3};
const SIZES=[112,100,88,76,64],SMALLEST=40;
let loading=null;
export const loadFont=()=>loading??=readFile(new URL('../public/fonts/instrument-serif.ttf',import.meta.url)).then(bytes=>opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));

// Whether the font has every character (emoji and most non-Latin scripts it doesn't).
export const covers=(font,text)=>[...text].every(c=>/\s/.test(c)||font.charToGlyphIndex(c)>0);

// Glyph positions for one line at a size: advance, kerning and the -0.04em tracking.
function place(font,text,size){
 const scale=size/font.unitsPerEm,glyphs=font.stringToGlyphs(text),out=[];let x=0;
 glyphs.forEach((glyph,i)=>{out.push({glyph,x});x+=glyph.advanceWidth*scale-0.04*size;if(glyphs[i+1])x+=font.getKerningValue(glyph,glyphs[i+1])*scale;});
 return {glyphs:out,width:x+0.04*size};
}
const width=(font,text,size)=>place(font,text,size).width;

// The fewest lines (≤ max) that fit, with breaks chosen to make the longest line as short as possible
// (CSS text-wrap: balance). Null when no break gives lines that all fit.
function balance(font,words,size,max){
 for(let n=1;n<=Math.min(max,words.length);n++){
  let best=null;
  const pick=(start,left,lines)=>{
   if(left===1){const line=words.slice(start).join(' ');const all=[...lines,line],w=Math.max(...all.map(l=>width(font,l,size)));if(w<=COLUMN.width&&(!best||w<best.w))best={w,lines:all};return;}
   for(let end=start+1;end<=words.length-(left-1);end++)pick(end,left-1,[...lines,words.slice(start,end).join(' ')]);
  };
  pick(0,n,[]);if(best)return best.lines;
 }
 return null;
}

export function layout(font,text){
 const words=text.trim().split(/\s+/);
 for(const size of SIZES){const lines=balance(font,words,size,COLUMN.maxLines);if(lines)return {size,lines};}
 // One word too wide for the column at every step: size it so the widest word fits.
 const widest=Math.max(...words.map(w=>width(font,w,SIZES.at(-1))));
 const size=Math.max(SMALLEST,Math.floor(SIZES.at(-1)*COLUMN.width/widest));
 const lines=balance(font,words,size,COLUMN.maxLines);
 return lines?{size,lines}:null;
}

// The headline as an SVG overlay for a 1200×630 frame, or null when it can't be drawn in the column.
export function headlineSvg(font,text){
 if(!covers(font,text))return null;
 const fit=layout(font,text);if(!fit)return null;
 const {size,lines}=fit,scale=size/font.unitsPerEm;
 // CSS line box: line height 0.9em, the font's ascent/descent centred in it.
 const first=COLUMN.y+((0.9*font.unitsPerEm-(font.ascender-font.descender))/2+font.ascender)*scale;
 const paths=lines.map((line,i)=>place(font,line,size).glyphs.map(({glyph,x})=>glyph.getPath(COLUMN.x+x,first+i*0.9*size,size).toPathData(2)).join('')).join('');
 return {size,lines,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><path fill="#17120f" d="${paths}"/></svg>`};
}

// The style report share headline: the sharer's first name when the font can draw it.
export const reportHeadline=name=>name?`${name}’s style report is in`:'A style report is in';
