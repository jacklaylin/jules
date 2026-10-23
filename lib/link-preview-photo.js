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

// A save of several items: one card per saved item, up to three, fanned like the wishlist art. Each card
// is a frame drawn once (card-front-v1.png, card-back-v1.png: the card with an empty white slot and its
// shadow, unturned) with its item's photo placed in the slot, then turned and laid back to front onto
// saved-set-bg-v1.png (the haze, headline and logo). Only the items in this save appear.
export const FRAME_MARGIN=90;
export const FRAMES={front:{file:'card-front-v1.png',width:340,height:500,padding:18,slotHeight:350},back:{file:'card-back-v1.png',width:300,height:440,padding:16,slotHeight:300}};
// Back to front; a save of n items uses the last n.
export const SET_CARDS=[{left:700,top:170,rotate:-10,frame:'back'},{left:800,top:96,rotate:-1,frame:'back'},{left:880,top:140,rotate:8,frame:'front'}];
const files=new Map();
const asset=name=>{if(!files.has(name))files.set(name,readFile(new URL(`../public/brand/previews/${name}`,import.meta.url)));return files.get(name);};

async function slotImage(photo,w,h){
 const mask=Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="16" fill="#fff"/></svg>`);
 const base=photo?sharp(photo,{limitInputPixels:25000000}).rotate().resize(w,h,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'})
  :sharp({create:{width:w,height:h,channels:3,background:'#f3f1ee'}});
 return base.composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
}

// Cards run off the frame's edges (and their shadows reach past it); keep the part inside the 1200×630 frame.
async function clipped({data,info},left,top){
 const x=Math.max(0,-left),y=Math.max(0,-top),w=Math.min(info.width,1200-left)-x,h=Math.min(info.height,630-top)-y;
 return {input:await sharp(data).extract({left:x,top:y,width:w,height:h}).png().toBuffer(),left:left+x,top:top+y};
}

// photos: the saved items' product photos in save order (null where an item has none); 2 or 3.
export async function savedSetPreview(photos){
 const shown=photos.slice(0,SET_CARDS.length),cards=SET_CARDS.slice(SET_CARDS.length-shown.length);
 const layers=[];
 for(const [i,card] of cards.entries()){
  const frame=FRAMES[card.frame],photo=shown[shown.length-1-i]; // the first item saved is the front card
  const slot=await slotImage(photo,frame.width-2*frame.padding,frame.slotHeight);
  const filled=await sharp(await asset(frame.file)).composite([{input:slot,left:FRAME_MARGIN+frame.padding,top:FRAME_MARGIN+frame.padding}]).png().toBuffer();
  const turned=await sharp(filled).rotate(card.rotate,{background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer({resolveWithObject:true});
  layers.push(await clipped(turned,Math.round(card.left+frame.width/2-turned.info.width/2),Math.round(card.top+frame.height/2-turned.info.height/2)));
 }
 return sharp(await asset('saved-set-bg-v1.png')).composite(layers).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
}
