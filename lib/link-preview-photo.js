import sharp from 'sharp';
import {readFile} from 'node:fs/promises';

// The single-save LinkPreview (DESIGN-SYSTEM.md › Rich link previews): "Added to your wishlist" on the
// Bubblegum haze with the saved product's photo in the front card. The card is drawn once into
// saved-photo-bg-v1.png with an empty white photo slot; this places the photo in that slot.
// scripts/link-preview-template.js draws the card from the same numbers.
export const PHOTO_CARD={left:810,top:72,width:340,height:500,padding:18,rotate:5,slotHeight:350,radius:16};
let background=null;
const loadBackground=()=>background??=readFile(new URL('../public/brand/previews/saved-photo-bg-v1.png',import.meta.url));

// Product photos keep their whole image (contain) on white, rounded like the slot, then turn with the
// card about the card's centre (CSS rotate), so the photo lands exactly over the slot.
export async function savedPhotoPreview(photo){
 const c=PHOTO_CARD,w=c.width-2*c.padding,h=c.slotHeight;
 const mask=Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${c.radius}" fill="#fff"/></svg>`);
 const fitted=await sharp(photo,{limitInputPixels:25000000}).rotate().resize(w,h,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'})
  .composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
 const turned=await sharp(fitted).rotate(c.rotate,{background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer({resolveWithObject:true});
 const a=c.rotate*Math.PI/180,cx=c.left+c.width/2,cy=c.top+c.height/2;
 const dx=0,dy=c.padding+h/2-c.height/2; // slot centre relative to the card centre, before turning
 const x=cx+dx*Math.cos(a)-dy*Math.sin(a),y=cy+dx*Math.sin(a)+dy*Math.cos(a);
 return sharp(await loadBackground()).composite([{input:turned.data,left:Math.round(x-turned.info.width/2),top:Math.round(y-turned.info.height/2)}])
  .flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
}
