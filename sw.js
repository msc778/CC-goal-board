/* CC的工作台 Service Worker — offline app shell */
const CACHE='cc-workbench-v1';
const SHELL=['/','/index.html','/manifest.webmanifest','/icons/icon-512.png','/icons/icon-192.png','/icons/icon-180.png'];
self.addEventListener('install',e=>{
e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
if(e.request.method!=='GET')return;
const url=new URL(e.request.url);
if(url.origin!==location.origin)return;
e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
if(res&&(res.ok||res.type==='opaque')){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
return res;
}).catch(()=>{
if(e.request.mode==='navigate')return caches.match('/index.html');
return Response.error();
})));
});