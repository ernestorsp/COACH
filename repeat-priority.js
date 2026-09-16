import{addressKey,store,recent}from'./analytics-core.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
let timer=0;
const ud=(y,m,d)=>new Date(Date.UTC(y,m-1,d,12));
function isoWeek(d){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())),q=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-q);const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil((((x-y)/86400000)+1)/7)}
function eventWeek(e){let k=e.assignedWeekStart||e.dateKey||'';const p=String(k).split('-').map(Number);if(!p[0]||!p[1]||!p[2])return null;let d=ud(p[0],p[1],p[2]);if(!e.assignedWeekStart)d=new Date(d.getTime()-d.getUTCDay()*86400000);const end=new Date(d.getTime()+6*86400000);return isoWeek(end)}
function hitWeek(h){const p=String(h.dateKey||'').split('-').map(Number);if(!p[0]||!p[1]||!p[2])return null;const d=ud(p[0],p[1],p[2]);return isoWeek(d)}

function statsFor(address){
  const k=addressKey(address);
  if(!k)return{count:0,drivers:[],weeks:[]};
  const events=recent(store.events).filter(e=>e.addressKey===k);
  const count=events.length;
  const wm=new Map();
  for(const e of events){const w=eventWeek(e);if(w)wm.set(w,(wm.get(w)||0)+1)}
  const weeks=[...wm.entries()].sort((a,b)=>b[0]-a[0]);
  const hits=recent(store.hits).filter(h=>h.addressKey===k);
  const dm=new Map();
  for(const h of hits){
    const name=(h.driverName||'').trim();
    if(!name)continue;
    if(!dm.has(name))dm.set(name,{count:0,weeks:new Map()});
    const d=dm.get(name);d.count++;
    const w=hitWeek(h);if(w)d.weeks.set(w,(d.weeks.get(w)||0)+1);
  }
  const drivers=[...dm.entries()].map(([name,d])=>[name,d.count,[...d.weeks.entries()].sort((a,b)=>a[0]-b[0])]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return{count,drivers,weeks};
}

function driverText(drivers,empty='No driver route appearances yet'){
  return drivers.length?drivers.map(([name,count,weeks])=>`${esc(name)} ×${count}${weeks?.length?' · '+weeks.map(([w,n])=>`W${w}×${n}`).join(' · '):''}`).join('<br>'):empty;
}

function complaintForAddress(address){
  const k=addressKey(address);
  return store.complaints.find(c=>addressKey(c.address)===k);
}

function decorateDatabase(){
  const list=document.getElementById('complaintsList');
  if(!list)return;
  const rows=[];
  for(const edit of list.querySelectorAll('[data-complaint]')){
    const item=edit.closest('.item');
    const c=store.complaints.find(x=>x.id===edit.dataset.complaint);
    if(!item||!c)continue;
    const s=statsFor(c.address);
    item.dataset.repeatCount=String(s.count);
    rows.push({item,count:s.count,address:c.address||''});
  }
  rows.sort((a,b)=>b.count-a.count||a.address.localeCompare(b.address));
  for(const r of rows)list.appendChild(r.item);
}

function decoratePending(){
  const list=document.getElementById('pendingList');
  if(!list)return;
  const rows=[];
  for(const item of [...list.querySelectorAll('.item')]){
    const addrEl=item.querySelector('.addr');
    if(!addrEl)continue;
    let address=addrEl.textContent.trim().replace(/^STOP\s*\d+\s*/i,'').trim();
    const c=complaintForAddress(address);
    if(!c)continue;
    const s=statsFor(c.address);
    item.dataset.repeatCount=String(s.count);
    let box=item.querySelector('[data-repeat-home]');
    if(!box){box=document.createElement('div');box.dataset.repeatHome='1';box.style.cssText='margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap';item.appendChild(box)}
    const weekText=s.weeks.length?s.weeks.map(([w,n])=>`W${w}×${n}`).join(' · '):'';
    box.innerHTML=`<span class="pill">Entered ×${s.count}</span>${weekText?`<span class="muted" style="font-weight:800">${weekText}</span>`:''}<span class="muted" style="font-weight:800">Drivers: ${driverText(s.drivers,'No previous drivers recorded')}</span>`;
    rows.push({item,count:s.count,address:c.address||''});
  }
  rows.sort((a,b)=>b.count-a.count||a.address.localeCompare(b.address));
  for(const r of rows)list.appendChild(r.item);
}

function renderMostRepeated(){
  const list=document.getElementById('recentList');
  if(!list)return;
  const card=list.closest('.card');
  const title=card?.querySelector('.sectionTitle');
  if(title)title.innerHTML='<span class="sectionIcon">🔁</span>Most repeated addresses';
  const rows=store.complaints.map(c=>({c,s:statsFor(c.address)})).filter(x=>x.s.count>0).sort((a,b)=>b.s.count-a.s.count||(a.c.address||'').localeCompare(b.c.address||''));
  list.innerHTML=rows.length?rows.map(({c,s})=>{
    const weeks=s.weeks.length?s.weeks.map(([w,n])=>`<span class="pill">W${w}×${n}</span>`).join(' '):'';
    return `<div class="item"><div class="row between"><div><div class="addr">${esc(c.address||'')}</div>${c.notes?`<div class="notes">${esc(c.notes)}</div>`:''}</div><span class="pill">×${s.count}</span></div>${weeks?`<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${weeks}</div>`:''}<div class="muted" style="margin-top:8px;font-weight:800">Drivers: ${driverText(s.drivers)}</div></div>`;
  }).join(''):'<div class="empty">No repeated-address history recorded yet.</div>';
}

function run(){decorateDatabase();decoratePending();renderMostRepeated()}
function schedule(){clearTimeout(timer);timer=setTimeout(run,80)}
for(const id of ['complaintsList','pendingList']){const el=document.getElementById(id);if(el)new MutationObserver(schedule).observe(el,{childList:true,subtree:true})}
setInterval(run,1500);
run();
