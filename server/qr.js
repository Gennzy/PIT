'use strict';
// QR Model 2, version 5-L, byte mode, fixed mask 0. 106 UTF-8 bytes.
module.exports=function qr(text){
 const bytes=Buffer.from(text,'utf8');if(bytes.length>106)throw new Error('QR: ссылка длиннее 106 байт. Используйте короткий PUBLIC_ORIGIN.');
 const bits=[];const put=(v,n)=>{for(let i=n-1;i>=0;i--)bits.push((v>>>i)&1);};put(4,4);put(bytes.length,8);for(const b of bytes)put(b,8);for(let i=0,n=Math.min(4,864-bits.length);i<n;i++)bits.push(0);while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((v,b)=>v*2+b,0));for(let i=0;data.length<108;i++)data.push(i%2?0x11:0xec);
 const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}return z;};
 let generator=[1],root=1;for(let i=0;i<26;i++){const next=Array(generator.length+1).fill(0);for(let j=0;j<generator.length;j++){next[j]^=generator[j];next[j+1]^=mul(generator[j],root);}generator=next;root=mul(root,2);}
 const rem=Array(26).fill(0);for(const b of data){const f=b^rem.shift();rem.push(0);for(let j=0;j<26;j++)rem[j]^=mul(generator[j+1],f);}
 const stream=[];for(const b of data.concat(rem))for(let i=7;i>=0;i--)stream.push((b>>>i)&1);
 const n=37,m=Array.from({length:n},()=>Array(n).fill(false)),reserved=Array.from({length:n},()=>Array(n).fill(false));const set=(x,y,v)=>{if(x>=0&&y>=0&&x<n&&y<n){m[y][x]=!!v;reserved[y][x]=true;}};
 function finder(cx,cy){for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,d!==2&&d!==4);}}finder(3,3);finder(n-4,3);finder(3,n-4);
 for(let i=8;i<n-8;i++){set(i,6,i%2===0);set(6,i,i%2===0);}for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(30+dx,30+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 const value=8;let r=value;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const format=((value<<10)|r)^0x5412;const f=i=>(format>>>i)&1;
 for(let i=0;i<=5;i++)set(8,i,f(i));set(8,7,f(6));set(8,8,f(7));set(7,8,f(8));for(let i=9;i<15;i++)set(14-i,8,f(i));for(let i=0;i<8;i++)set(n-1-i,8,f(i));for(let i=8;i<15;i++)set(8,n-15+i,f(i));set(8,n-8,1);
 let k=0;for(let right=n-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<n;vert++){const y=((right+1)&2)===0?n-1-vert:vert;for(let j=0;j<2;j++){const x=right-j;if(!reserved[y][x]){m[y][x]=!!((stream[k++]||0)^((x+y)%2===0?1:0));}}}}
 let d='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(m[y][x])d+=`M${x+4},${y+4}h1v1h-1z`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+8} ${n+8}" width="360" height="360" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="black"/></svg>`;
};
