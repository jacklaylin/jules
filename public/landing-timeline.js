export const DEMO_DURATION=21.6;
const typingWindows=[[2.8,4.2],[5.4,7.4],[8.6,9.6],[12.8,14.2],[15,16.4],[19.6,20.8]];
export function bubbleProgress(time,at){return Math.max(0,Math.min(1,(time-at)/.45));}
export function demoState(time,reducedMotion=false){
 const t=reducedMotion?DEMO_DURATION:Math.max(0,Math.min(DEMO_DURATION,Number(time)||0));
 const window=typingWindows.find(([start,end])=>t>=start&&t<end);
 return {time:t,typing:Boolean(window),typingProgress:window?Math.min(1,(t-window[0])/.35):0,chapter:t<4.2?0:t<18.8?1:2,progress:t/DEMO_DURATION};
}
