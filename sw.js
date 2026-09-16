const CACHE='coach-shell-v8';

self.addEventListener('install',event=>{
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  // Installed COACH is online-first: app files always come from the current Firebase deployment.
  if(event.request.mode==='navigate' || /\.(?:html|js|css|json)$/i.test(url.pathname) || url.pathname==='/'){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }

  // Static images may use normal browser caching.
  event.respondWith(fetch(event.request,{cache:'no-cache'}));
});
