const CACHE_KEY='COACH_HOME_CACHE_V1';
const CACHE_TIME='COACH_HOME_CACHE_TIME_V1';
const IDS=['pendingList','recentList'];

function saveHomeCache(){
  const data={};
  let has=false;
  for(const id of IDS){const el=document.getElementById(id);if(el&&el.innerHTML.trim()){data[id]=el.innerHTML;has=true}}
  if(!has)return;
  try{localStorage.setItem(CACHE_KEY,JSON.stringify(data));localStorage.setItem(CACHE_TIME,String(Date.now()))}catch{}
}

function restoreHomeCache(){
  try{
    const data=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');
    for(const id of IDS){const el=document.getElementById(id);if(el&&data[id]&&!el.innerHTML.trim())el.innerHTML=data[id]}
  }catch{}
}

function toast(msg){
  let t=document.getElementById('coachSyncToast');
  if(!t){t=document.createElement('div');t.id='coachSyncToast';t.style.cssText='position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:99999;background:#0f172a;color:#fff;padding:11px 16px;border-radius:12px;font-weight:800;box-shadow:0 8px 24px #0003';document.body.appendChild(t)}
  t.textContent=msg;t.style.display='block';clearTimeout(t._tm);t._tm=setTimeout(()=>t.style.display='none',1800);
}

function addSyncButton(){
  if(document.getElementById('coachHomeSync'))return;
  const home=document.getElementById('homeView')||document.querySelector('[data-view="home"]')||document.body;
  const firstCard=home.querySelector('.card');
  if(!firstCard)return;
  const title=firstCard.querySelector('.sectionTitle')||firstCard.firstElementChild;
  const btn=document.createElement('button');
  btn.id='coachHomeSync';btn.type='button';btn.className='btn secondary';btn.innerHTML='↻ Sync';
  btn.style.cssText='margin-left:auto;white-space:nowrap';
  btn.onclick=async()=>{
    btn.disabled=true;btn.innerHTML='↻ Syncing...';
    try{
      if(!navigator.onLine){restoreHomeCache();toast('Offline · showing saved HOME');return}
      // Firestore listeners are live; a reload forces a fresh server/app state while HOME remains cached for fallback.
      saveHomeCache();
      const u=new URL(location.href);u.searchParams.set('_sync',Date.now());location.replace(u.toString());
    }finally{setTimeout(()=>{btn.disabled=false;btn.innerHTML='↻ Sync'},1500)}
  };
  if(title?.parentElement){const p=title.parentElement;p.style.display='flex';p.style.alignItems='center';p.style.gap='10px';p.appendChild(btn)}else firstCard.prepend(btn);
}

function watch(){
  restoreHomeCache();addSyncButton();
  for(const id of IDS){const el=document.getElementById(id);if(el&&!el.dataset.homeCacheWatch){el.dataset.homeCacheWatch='1';new MutationObserver(()=>saveHomeCache()).observe(el,{childList:true,subtree:true,characterData:true})}}
  saveHomeCache();
}

document.addEventListener('DOMContentLoaded',watch);
window.addEventListener('online',()=>toast('Connection restored · tap Sync'));
setInterval(watch,1200);
watch();
