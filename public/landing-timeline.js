export const DEMO_DURATION=22.4;
const typingWindows=[[3.6,5.2],[9.7,10.8],[13.9,15.5],[19.8,21.5]];
export function demoState(time,reducedMotion=false){
 const t=reducedMotion?DEMO_DURATION:Math.max(0,Math.min(DEMO_DURATION,Number(time)||0));
 return {time:t,typing:typingWindows.some(([start,end])=>t>=start&&t<end),chapter:t<4.8?0:t<15.5?1:2,progress:t/DEMO_DURATION};
}
