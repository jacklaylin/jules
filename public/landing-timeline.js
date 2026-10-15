// Each conversation's typing windows end exactly when the next Jules message appears in index.html.
export const DEMOS={
 hoka:{duration:21.6,typing:[[2.8,4.2],[5.4,7.4],[8.6,9.6],[12.8,14.2],[15,16.4],[19.6,20.8]]},
 rodeo:{duration:23.4,typing:[[2.8,4.2],[5.4,7.0],[8.2,9.6],[11,12.2],[15.2,17],[18.4,19.8],[20.8,22.4]]}
};
export const DEMO_IDS=Object.keys(DEMOS);
export const DEMO_DURATION=DEMOS.hoka.duration;
export function bubbleProgress(time,at){return Math.max(0,Math.min(1,(time-at)/.45));}
export function demoState(time,reducedMotion=false,id='hoka'){
 const {duration,typing}=DEMOS[id]||DEMOS.hoka;
 const t=reducedMotion?duration:Math.max(0,Math.min(duration,Number(time)||0));
 const window=typing.find(([start,end])=>t>=start&&t<end);
 return {time:t,duration,typing:Boolean(window),typingProgress:window?Math.min(1,(t-window[0])/.35):0,progress:t/duration,done:t>=duration};
}
// Picks a conversation at random, never repeating the current one when another exists.
export function pickDemo(current=null,random=Math.random){
 const options=DEMO_IDS.filter(id=>id!==current);
 const pool=options.length?options:DEMO_IDS;
 return pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];
}
