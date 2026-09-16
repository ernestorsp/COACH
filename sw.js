const CACHE='coach-shell-v9';

self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));await self.clients.claim()})());
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      const response=await fetch(event.request,{cache:'no-store'});
      const type=response.headers.get('content-type')||'';
      if(!type.includes('text/html'))return response;
      let html=await response.text();
      const stamp=Date.now();
      const scripts=[
        ['users-admin.js',false],
        ['driver-sync.js',true],
        ['repeat-priority.js',true],
        ['home-cache.js',false]
      ];
      for(const [name,module] of scripts){
        if(!html.includes('/'+name)&&!html.includes('"'+name)&&!html.includes("'"+name)){
          html=html.replace('</body>',`<script ${module?'type="module" ':''}src="/${name}?v=${stamp}"></script></body>`);
        }
      }
      return new Response(html,{status:response.status,statusText:response.statusText,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0'}});
    })());
    return;
  }
  if(/\.(?:html|js|css|json)$/i.test(url.pathname)||url.pathname==='/'){
    event.respondWith(fetch(event.request,{cache:'no-store'}));return;
  }
  event.respondWith(fetch(event.request,{cache:'no-cache'}));
});
