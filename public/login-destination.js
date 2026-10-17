// Where login lands when the link didn't name a page (founder, 17 Oct): an invited tester who hasn't
// connected Gmail or Shop yet goes to onboarding to do that; everyone else to the wishlist, as before.
// Any doubt (not invited, a failed check) keeps the wishlist, so login never gets stuck on this.
export const NAMED=['onboarding','style','account','report','wardrobe'];
export function namedDestination(search){const next=new URLSearchParams(search).get('next');return NAMED.includes(next)?next:null;}
export function needsOnboarding(status){
 if(!status||typeof status!=='object')return false;
 const sources=Object.values(status.connections??{});
 return !status.connected&&!status.last_import_at&&(status.status??'not_started')==='not_started'&&!sources.some(s=>s?.connected||(s?.status&&s.status!=='not_connected'));
}
export async function landing(search,token,fetcher=fetch){
 const named=namedDestination(search);if(named)return named;
 try{
  const response=await fetcher('/api/wishlist?gmail=1',{headers:{Authorization:`Bearer ${token}`}});
  return response.ok&&needsOnboarding(await response.json())?'onboarding':'wishlist';
 }catch{return 'wishlist';}
}
