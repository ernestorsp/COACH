const DAY_KEY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const PREFIX='COACH_HOME_DAY_V2_';
const IDS=['pendingList','recentList'];
const EXTRA_IDS=['stComplaints','stDrivers','stPending','todayLabel'];

function key(){return PREFIX+DAY_KEY()}
function saveHomeCache(){
  const data={day:DAY_KEY(),savedAt:Date.now(),html:{},text:{}};
  let has=false;
  for(const id of IDS){const el=document.getElementById(id);if(el&&el.innerHTML.trim()){data.html[id]=el.innerHTML;has=true}}
  for(const id of EXTRA_IDS){const el=document.getElementById(id);if(el){data.text[id]=el.textContent;has=true}}
  if(!has)return;
  try{
    localStorage.setItem(key(),JSON.stringify(data));
    for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k&&k.startsWith(PREFIX)&&k!==key())localStorage.removeItem(k)}
  }catch{}
}
function restoreHomeCache(){
  try{
    const data=JSON.parse(localStorage.getItem(key())||'null');
    if(!data||data.day!==DAY_KEY())return false;
    for(const id of IDS){const el=document.getElementById(id);if(el&&data.html?.[id]&&!el.innerHTML.trim())el.innerHTML=data.html[id]}
    for(const id of EXTRA_IDS){const el=document.getElementById(id);if(el&&data.text?.[id]!=null&&!el.textContent.trim())el.textContent=data.text[id]}
    return true;
  }catch{return false}
}
function toast(msg){
  let t=document.getElementById('coachSyncToast');
  if(!t){t=document.createElement('div');t.id='coachSyncToast';t.style.cssText='position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:99999;background:#0f172a;color:#fff;padding:11px 16px;border-radius:12px;font-weight:800;box-shadow:0 8px 24px #0003';document.body.appendChild(t)}
  t.textContent=msg;t.style.display='block';clearTimeout(t._tm);t._tm=setTimeout(()=>t.style.display='none',1800);
}
function addSyncButton(){
  if(document.getElementById('coachHomeSync'))return;
  const home=document.getElementById('home');
  if(!home)return;
  const pending=document.getElementById('pendingList')?.closest('.card');
  if(!pending)return;
  const head=pending.querySelector('.row.between');
  if(!head)return;
  const btn=document.createElement('button');
  btn.id='coachHomeSync';btn.type='button';btn.className='btn soft';btn.innerHTML='↻ Sync';
  btn.style.cssText='white-space:nowrap';
  btn.onclick=()=>{
    btn.disabled=true;btn.innerHTML='↻ Syncing...';saveHomeCache();
    if(!navigator.onLine){restoreHomeCache();toast('Offline · showing today’s saved HOME');btn.disabled=false;btn.innerHTML='↻ Sync';return}
    const u=new URL(location.href);u.searchParams.set('_sync',Date.now());location.replace(u.toString());
  };
  head.appendChild(btn);
}
function watch(){
  restoreHomeCache();addSyncButton();
  for(const id of IDS){const el=document.getElementById(id);if(el&&!el.dataset.homeDayCache){el.dataset.homeDayCache='1';new MutationObserver(saveHomeCache).observe(el,{childList:true,subtree:true,characterData:true})}}
  saveHomeCache();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch);else watch();
window.addEventListener('pagehide',saveHomeCache);
window.addEventListener('offline',()=>{restoreHomeCache();toast('Offline · HOME saved for today')});
window.addEventListener('online',()=>toast('Connection restored · tap Sync'));
setInterval(watch,1200);
