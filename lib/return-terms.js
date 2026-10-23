// Technical parsing of quoted return terms (lib/return-windows.js). No imports, so receipt reading can use it.
const DAY=86400000;
// Technical date parsing of a quoted date. Returns 'YYYY-MM-DD' or null. A date printed without a year is
// the first such day on or after the email's date (within 6 months). Purely numeric dates are read only
// when unambiguous (ISO, or a day above 12); "03/04" could be March or April, so it stays unknown.
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const month=word=>{const i=MONTHS.indexOf(String(word).slice(0,3).toLowerCase());return i<0?null:i+1;};
const iso=(y,m,d)=>{const t=Date.UTC(y,m-1,d),dt=new Date(t);return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?dt.toISOString().slice(0,10):null;};
function withYear(m,d,y,referenceMs){
 if(y)return iso(y<100?2000+y:y,m,d);
 if(!Number.isFinite(referenceMs))return null;
 const ref=new Date(referenceMs),from=Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth(),ref.getUTCDate());
 for(const year of [ref.getUTCFullYear(),ref.getUTCFullYear()+1]){const day=iso(year,m,d);if(day&&Date.parse(day)>=from&&Date.parse(day)-from<=183*DAY)return day;}
 return null;
}
export function parseStatedDate(text,referenceMs=null){
 if(typeof text!=='string')return null;
 const s=text.replace(/(\d)(st|nd|rd|th)\b/gi,'$1').replace(/[,]/g,' ').replace(/\s+/g,' ').trim();
 let m;
 if((m=s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)))return iso(+m[1],+m[2],+m[3]);
 if((m=s.match(/\b([A-Za-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?\b/))&&month(m[1]))return withYear(month(m[1]),+m[2],m[3]?+m[3]:null,referenceMs);
 if((m=s.match(/\b(\d{1,2}) ([A-Za-z]{3,9})\.?(?: (\d{4}))?\b/))&&month(m[2]))return withYear(month(m[2]),+m[1],m[3]?+m[3]:null,referenceMs);
 if((m=s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})\b/))){
  const a=+m[1],b=+m[2],y=+m[3];
  if(a>12&&b<=12)return withYear(b,a,y,referenceMs);
  if(b>12&&a<=12)return withYear(a,b,y,referenceMs);
  return a===b?withYear(a,b,y,referenceMs):null;
 }
 return null;
}

// Technical parsing of a quoted window: "30 days", "30-day", "thirty (30) days", "two weeks", "1 month".
// Returns {days} or {months}, or null.
const NUMBERS={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fourteen:14,fifteen:15,twenty:20,'twenty-one':21,'twenty one':21,thirty:30,'forty-five':45,'forty five':45,sixty:60,ninety:90};
export function parseWindow(text){
 if(typeof text!=='string')return null;
 const s=text.toLowerCase().replace(/\(\s*\d+\s*\)/g,' ').replace(/\s+/g,' ');
 const m=s.match(/\b(\d{1,3}|twenty[- ]one|forty[- ]five|[a-z]+)[- ]?(?:calendar |business |working )?(day|week|month)s?\b/);
 if(!m)return null;
 if(/business|working/.test(s.slice(m.index,m.index+m[0].length)))return null;// business days need a holiday calendar: unknown
 const n=/^\d+$/.test(m[1])?Number(m[1]):NUMBERS[m[1]];
 if(!Number.isInteger(n)||n<1)return null;
 if(m[2]==='day')return n<=365?{days:n}:null;
 if(m[2]==='week')return n<=52?{days:n*7}:null;
 return n<=12?{months:n}:null;
}
