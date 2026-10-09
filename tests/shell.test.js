'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
test('41 public startup shell loads without a database configuration',async()=>{
 const env={...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'5315'};delete env.DATABASE_URL;delete env.TEST_SQLITE_FILE;delete env.OWNER_EMAIL;delete env.OWNER_PASSWORD;
 const child=spawn(process.execPath,['server/server.js'],{cwd:require('node:path').resolve(__dirname,'..'),env,stdio:'ignore'});
 try {let ready=false;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,30));try{if((await fetch('http://127.0.0.1:5315/api/health')).ok){ready=true;break;}}catch{}}assert(ready);
 for(const route of ['/','/app/pit','/admin/pit']){const r=await fetch('http://127.0.0.1:5315'+route);assert.equal(r.status,200);const text=await r.text();assert(text.includes('boot-screen'));assert(text.includes('Подключаем ваш сервис'));assert(!text.includes('Подключаемся к серверу…'));}
 }finally{child.kill('SIGTERM');}
});
