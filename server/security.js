"use strict";
const crypto = require("node:crypto"), {isIP}=require("node:net");
const production = () => process.env.NODE_ENV === "production" || !!process.env.VERCEL;
const secureCookie = () => production() || process.env.COOKIE_SECURE === "true";
const mfaRequired = () => production() || process.env.PLATFORM_MFA_REQUIRED === "true" || !!process.env.PLATFORM_TOTP_SECRET;
function decodeBase32(value){
 const text=String(value||"").replace(/\s/g,"").toUpperCase();
 if(!/^[A-Z2-7]+$/.test(text))throw Error("Invalid Base32 seed");
 let acc=0,bits=0;const out=[];
 for(const c of text){acc=(acc<<5)|"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c);bits+=5;if(bits>=8){bits-=8;out.push((acc>>>bits)&255);acc&=(1<<bits)-1;}}
 if(bits&&acc!==0)throw Error("Noncanonical Base32 seed");
 const bytes=Buffer.from(out);if(bytes.length<16)throw Error("TOTP seed needs at least 128 bits");return bytes;
}
function encodeBase32(bytes){let acc=0,bits=0,out="";for(const b of bytes){acc=(acc<<8)|b;bits+=8;while(bits>=5){bits-=5;out+="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(acc>>>bits)&31];}acc&=(1<<bits)-1;}if(bits)out+="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(acc<<(5-bits))&31];return out;}
function mfaSettings(){
 if(!mfaRequired())return {required:false,secret:null,canonical:""};
 const secret=decodeBase32(process.env.PLATFORM_TOTP_SECRET);
 return {required:true,secret,canonical:encodeBase32(secret)};
}
function totp(secret,step){
 if(!Number.isSafeInteger(step)||step<0)throw Error("Invalid TOTP counter");
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
 const h=crypto.createHmac("sha1",secret).update(counter).digest(),offset=h[h.length-1]&15;
 return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
function matchTotp(secret,code,at=Date.now()){
 if(typeof code!=="string"||!/^\d{6}$/.test(code))return null;
 const step=Math.floor(at/30000);let matched=null;
 for(const n of [step-1,step,step+1])if(n>=0&&crypto.timingSafeEqual(Buffer.from(totp(secret,n)),Buffer.from(code)))matched=n;
 return matched;
}
function clientAddress(req){
 // Never trust user-controlled proxy headers on a direct/self-hosted connection.
 const forwarded=production()&&!!process.env.VERCEL?String(req.headers?.["x-vercel-forwarded-for"]||"").split(",")[0].trim():"";
 return isIP(forwarded)?forwarded:String(req.socket?.remoteAddress||"unknown");
}
function createLimiter({get,testing,clock=Date.now}){
 const local=new Map();
 async function consume(key,max,res){
  let hits;
  if(testing){const at=clock();let old=local.get(key);if(!old||at-old.at>=600000)old={at,hits:0};hits=++old.hits;local.set(key,old);if(local.size>10000)for(const [k,v] of local)if(at-v.at>=600000)local.delete(k);}
  else {const result=await get("SELECT pit.consume_rate_limit(?) AS hits",key);hits=Number(result?.hits);if(!["number","string"].includes(typeof result?.hits)||!Number.isSafeInteger(hits)||hits<1)throw Object.assign(Error("Защита входа временно недоступна"),{status:503});}
  if(hits>max){res?.setHeader?.("Retry-After","600");throw Object.assign(Error("Слишком много попыток входа. Повторите через 10 минут"),{status:429});}
 }
 return async function limit(req,account,scope="tenant",res){
  const admin=scope==="platform",kind=account===undefined?"ip":"account";
  const identity=account===undefined?clientAddress(req):String(account).trim().toLowerCase();
  // Separate scopes prevent users in one company locking the same email in another.
  const seed=process.env.AUTH_RATE_SECRET||process.env.PLATFORM_ADMIN_SECRET||process.env.OWNER_PASSWORD||"test-only";
  const key=crypto.createHmac("sha256",seed).update("v43:"+kind+":"+scope+":"+identity).digest("hex");
  await consume(key,kind==="ip"?(admin?20:60):(admin?8:15),res);
 };
}
module.exports={production,secureCookie,mfaRequired,mfaSettings,decodeBase32,encodeBase32,totp,matchTotp,clientAddress,createLimiter};
