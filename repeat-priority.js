import{addressKey,store,recent}from'./analytics-core.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]));
let timer=0;

function statsFor(address){
  const k=addressKey(address);
  if(!k)return{count:0,drivers:[]};
  const count=recent(store.events).filter(e=>e.addressKey===k).length;
  const hits=recent(store.hits).filter(h=>h.addressKey===k);
  const dm=new Map();
  for(const h of hits){
    const name=(h.driverName||'').trim();
    if(!name)continue;
    dm.set(name,(dm.get(name)||0)+1);
  }
  const drivers=[...dm.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return{count,drivers};
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
    const driverText=s.drivers.length?s.drivers.map(([n,nc])=>`${esc(n)} ×${nc}`).join(' · '):'No previous drivers recorded';
    box.innerHTML=`<span class="pill">Entered ×${s.count}</span><span class="muted" style="font-weight:800">Drivers: ${driverText}</span>`;
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
    const drivers=s.drivers.length?s.drivers.map(([name,count])=>`${esc(name)} ×${count}`).join(' · '):'No driver route appearances yet';
    return `<div class="item"><div class="row between"><div><div class="addr">${esc(c.address||'')}</div>${c.notes?`<div class="notes">${esc(c.notes)}</div>`:''}</div><span class="pill">×${s.count}</span></div><div class="muted" style="margin-top:8px;font-weight:800">Drivers: ${drivers}</div></div>`;
  }).join(''):'<div class="empty">No repeated-address history recorded yet.</div>';
}

function run(){decorateDatabase();decoratePending();renderMostRepeated()}
function schedule(){clearTimeout(timer);timer=setTimeout(run,80)}
for(const id of ['complaintsList','pendingList']){const el=document.getElementById(id);if(el)new MutationObserver(schedule).observe(el,{childList:true,subtree:true})}
setInterval(run,1500);
run();
