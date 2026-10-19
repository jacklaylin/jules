// Shared by the signup page and the server, so the chat can re-ask for a number the server would reject.
// This checks a technical format only.
export function normalizeSignupPhone(value){
 if(typeof value!=='string'||value.length>32||!/^[+\d\s().-]+$/.test(value))return null;
 let phone=value.replace(/[\s().-]/g,'');
 if(!phone.startsWith('+')){if(/^\d{10}$/.test(phone))phone='+1'+phone;else if(/^1\d{10}$/.test(phone))phone='+'+phone;else return null;}
 return /^\+[1-9]\d{7,14}$/.test(phone)?phone:null;
}
