// Keep technical URL validation independent of shopping and image dependencies.
// Ad and analytics click identifiers never change which product a link shows.
const TRACKING=/^(?:utm_.*|srsltid|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_gl|_ga|yclid|dclid|igshid)$/i;
export function publicURL(value) {
  try {const u=new URL(value); if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/^\d+(?:\.\d+){3}$/.test(u.hostname)||/\.(local|internal|test|invalid)$/i.test(u.hostname))return null;u.hash='';for(const key of [...u.searchParams.keys()])if(TRACKING.test(key))u.searchParams.delete(key);return u.href;}catch{return null;}
}
