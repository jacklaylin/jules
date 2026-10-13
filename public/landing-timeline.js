export const DEMO_DURATION=20.6;
const typingWindows=[[3.6,5],[6.2,8.6],[10,11],[13,14.4],[18.4,19.6]];
export function bubbleProgress(time,at){return Math.max(0,Math.min(1,(time-at)/.45));}
export function approachDemoTime(current,target,{touch=false,deltaSeconds=1/60}={}){
 const distance=target-current;
 if(Math.abs(distance)<.005)return target;
 const step=distance*.18;
 // The shortest typing interval lasts 1.1 timeline seconds. At 4x maximum
 // touch speed it stays visible for at least 275ms even after a fast flick.
 const limit=touch?4*deltaSeconds:Infinity;
 return current+Math.sign(step)*Math.min(Math.abs(step),limit);
}
export function demoState(time,reducedMotion=false){
 const t=reducedMotion?DEMO_DURATION:Math.max(0,Math.min(DEMO_DURATION,Number(time)||0));
 const window=typingWindows.find(([start,end])=>t>=start&&t<end);
 return {time:t,typing:Boolean(window),typingProgress:window?Math.min(1,(t-window[0])/.35):0,chapter:t<5?0:t<17.4?1:2,progress:t/DEMO_DURATION};
}
