// Smaller purchase-history saves (db/051_history_patch.sql). A save after a chat answer changes a few KB of a
// history row that can be ~600 KB (style report, read emails, tags), yet finish_gmail_import sends it all back:
// about 2.6s per answer (October 23). This sends only the top-level keys that changed, with the same lease,
// revision and evidence handling. Until the migration runs, it falls back to the full save.
let unavailable=false;
export function dataChanges(before,after){
 const set={},remove=[];
 for(const [key,value] of Object.entries(after??{}))if(JSON.stringify(value)!==JSON.stringify(before?.[key]))set[key]=value;
 for(const key of Object.keys(before??{}))if(!(key in (after??{})))remove.push(key);
 return {set,remove};
}
// row: the claimed row (its data is what is stored now). Returns what finishGmailImport returns.
export async function finishChanges(store,owner,row,data,evidence=[]){
 if(store.patchGmailImport&&!unavailable){
  const {set,remove}=dataChanges(row.data,data);
  try{return await store.patchGmailImport(owner,row.revision,set,remove,evidence);}
  catch(error){
   // The function is missing until db/051 runs (PostgREST answers 404): use the full save from now on.
   if(error?.database_status!==404)throw error;
   unavailable=true;console.log(JSON.stringify({event:'history_patch_unavailable'}));
  }
 }
 return store.finishGmailImport(owner,row.revision,data,row.token_ciphertext,evidence);
}
export const resetPatchAvailability=()=>{unavailable=false;};
