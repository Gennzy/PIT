const CACHE='pit-v6-static-1';
const ASSETS=['/assets/ui.css','/assets/shared.js','/assets/app.js','/assets/fonts/fonts.css','/assets/fonts/Onest-cyrillic.woff2','/assets/fonts/Onest-latin.woff2','/assets/fonts/AlumniSans-cyrillic.woff2','/assets/fonts/AlumniSans-latin.woff2','/assets/icons/icon-192.png','/assets/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('pit-')&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
// Never cache private data, account pages, camera URLs or shared histories.
if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/admin/')||u.pathname.startsWith('/history/')||u.pathname==='/qr')return;
if(u.pathname.startsWith('/assets/'))e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>caches.match(e.request)));
else if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>new Response('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><title>Нет соединения</title><body style="background:#08090b;color:#fff;font:18px system-ui;padding:32px"><h1>Нет связи с сервером</h1><p>Запись и изменения недоступны без сети. Подключитесь и обновите страницу. Мы не показываем выдуманные данные и не обещаем, что запись сохранена.</p><button onclick="location.reload()">Повторить</button></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}})));
});