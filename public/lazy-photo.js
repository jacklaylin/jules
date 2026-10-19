// Starts a photo load only when its frame comes near the screen, so a long grid doesn't request
// every photo at once. The margin starts the next rows before they scroll into view.
let observer;
const waiting=new WeakMap();
export function whenNear(frame,start){
 if(typeof IntersectionObserver!=='function')return start();
 observer??=new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   observer.unobserve(entry.target);
   const run=waiting.get(entry.target);waiting.delete(entry.target);run?.();
  }
 },{rootMargin:'800px 0px'});
 waiting.set(frame,start);observer.observe(frame);
}
