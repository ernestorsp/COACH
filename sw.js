const CACHE='coach-shell-v7';
const OFFLINE_ASSETS=['/coach-logo.jpg','/manifest.json'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(OFFLINE_ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  // Always use the newest app HTML and JavaScript. Never serve an old app build.
  if(event.request.mode==='navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname==='/'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(event.request.mode!=='navigate') return response;
        const type=response.headers.get('content-type')||'';
        if(!type.includes('text/html')) return response;
        let html=await response.text();
        const stamp=Date.now();
        if(!html.includes('/users-admin.js')) html=html.replace('</body>',`<script src="/users-admin.js?v=${stamp}"></script></body>`);
        if(!html.includes('/driver-sync.js')) html=html.replace('</body>',`<script type="module" src="/driver-sync.js?v=${stamp}"></script></body>`);
        if(!html.includes('/repeat-priority.js')) html=html.replace('</body>',`<script type="module" src="/repeat-priority.js?v=${stamp}"></script></body>`);
        return new Response(html,{status:response.status,statusText:response.statusText,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache','Expires':'0'}});
      }catch(e){
        return new Response('COACH needs an internet connection to load the latest version.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
    })());
    return;
  }

  // Images/manifest may use cache, but network wins whenever available.
  event.respondWith(
    fetch(event.request,{cache:'no-cache'})
      .then(response=>{
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
