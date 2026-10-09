// Keep technical URL validation independent of shopping and image dependencies.
export function publicURL(value) {
  try {const u=new URL(value); if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/\.(local|internal|test|invalid)$/i.test(u.hostname))return null;u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key))u.searchParams.delete(key);return u.href;}catch{return null;}
}
