import{getApp}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import{getFirestore,collection,onSnapshot,doc,updateDoc}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const STATIONS={DJX3:{deadline:'21:00',assumedStop5:'13:30',serviceAreaId:'c599503f-5de9-4035-8532-125fcbc09b03'},DJX4:{deadline:'20:00',assumedStop5:'11:15',serviceAreaId:'fbf527d0-7ba7-4768-b452-ef8522843889'}};
function todayEastern(){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),o=Object.fromEntries(p.map(x=>[x.type,x.value]));
 return o.year+'-'+o.month+'-'+o.day;
}
function itineraryUrl(st){
 const cfg=STATIONS[st]||STATIONS.DJX3,u=new URL('https://logistics.amazon.com/operations/execution/itineraries');
 u.searchParams.set('provider','ALL_DRIVERS');u.searchParams.set('selectedDay',todayEastern());u.searchParams.set('serviceAreaId',cfg.serviceAreaId);return u.toString();
}
const sleep=m=>new Promise(r=>setTimeout(r,m));
async function dbReady(){for(let i=0;i<60;i++){try{return getFirestore(getApp())}catch{}await sleep(100)}}
function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function mins(t){const [h,m]=String(t).split(':').map(Number);return h*60+m}
function clockMinutes12(v){const m=String(v||'').match(/(\d{1,2}):(\d{2})\s*([ap]m)/i);if(!m)return null;let h=Number(m[1])%12;if(m[3].toLowerCase()==='pm')h+=12;return h*60+Number(m[2])}
function fmtMin(n){n=Math.round(n);const h=Math.floor(n/60)%24,m=n%60;return new Date(2000,0,1,h,m).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}
function driverKey(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,100)||'unknown'}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function easternClock(ms=Date.now()){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(ms));
 const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return (Number(o.hour)%24)*60+Number(o.minute);
}
function easternDay(ms=Date.now()){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return o.year+'-'+o.month+'-'+o.day;
}
function routeDuration(h){
 if(!h?.finishedAtMs||!Number.isFinite(Number(h.stop5AtMinutes)))return null;
 const finish=easternClock(Number(h.finishedAtMs));let x=finish-Number(h.stop5AtMinutes);if(x<0)x+=1440;return x>0&&x<900?x:null;
}
let HISTORY=[],SAVED_ROUTES=[],RESCUE_HISTORY=[];
function nameTokens(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]}
function twoNamesMatch(a,b){
 const A=nameTokens(a),B=nameTokens(b),used=new Set();let matches=0;
 for(const x of A){const i=B.findIndex((y,j)=>y===x&&!used.has(j));if(i>=0){used.add(i);matches++;if(matches>=2)return true}}
 return false;
}
function completedPriorHistory(st,day,driverName){
 return HISTORY.filter(h=>String(h.station||'').toUpperCase()===String(st||'').toUpperCase()&&String(h.day||h.dateKey||'')!==String(day)&&h.completed&&twoNamesMatch(driverName,h.driverName)).sort((a,b)=>String(b.day||b.dateKey||'').localeCompare(String(a.day||a.dateKey||''))).slice(0,20);
}
function usablePriorHistory(st,day,driverName){
 return completedPriorHistory(st,day,driverName).map(h=>{
   if(routeDuration(h))return h;
   const sr=SAVED_ROUTES.find(x=>x.dateKey===h.day&&twoNamesMatch(driverName,x.driverName)&&(!x.station||String(x.station).toUpperCase()===st));
   const sm=Number(sr?.stop5AtMinutes);
   return Number.isFinite(sm)?{...h,stop5AtMinutes:sm,stop5AtText:sr?.stop5AtText||h.stop5AtText,totalPackages:Number(h.totalPackages)||Number(sr?.totalPackages)||0,packagesPerStop:Number(h.packagesPerStop)||Number(sr?.packagesPerStop)||0}:h;
 }).filter(h=>routeDuration(h)).sort((a,b)=>String(b.day).localeCompare(String(a.day))).slice(0,20);
}
function historyFor(r,st){
 const key=r.driverKey||driverKey(r.name),day=String(r.day||easternDay()),route=String(r.route||'').toUpperCase();
 const stationHistory=HISTORY.filter(h=>h.station===st);
 // Driver identity rule: exactly the rule requested for COACH history matching —
 // any TWO name tokens in common are enough; CX/route does not need to match across days.
 const sameDriver=h=>twoNamesMatch(r.name,h.driverName);
 const byName=stationHistory.filter(sameDriver);
 const candidates=byName.filter(h=>h.day===day&&String(h.route||'').toUpperCase()===route);
 const current=candidates.find(h=>Number(h.routeLoadedMs)>0)||candidates[0]||byName.find(h=>h.day===day)||null;
 const savedRoute=SAVED_ROUTES.find(x=>{
   if(x.dateKey!==day||!twoNamesMatch(r.name,x.driverName))return false;
   const savedCx=String(x.routeCode||((String(x.raw||'').match(/\bCX\d+\b/i)||[])[0])||'').toUpperCase();
   const savedStation=String(x.station||((String(x.raw||'').match(/\b(DJX3|DJX4)\b/i)||[])[1])||'').toUpperCase();
   return savedCx===route&&(!savedStation||savedStation===st);
 });
 const routeStop5Minutes=Number(savedRoute?.stop5AtMinutes),routeStop5Text=savedRoute?.stop5AtText||null;
 const mergedCurrent=current?{...current}:null;
 if(savedRoute&&Number.isFinite(routeStop5Minutes)){
   if(mergedCurrent){mergedCurrent.stop5AtMinutes=routeStop5Minutes;mergedCurrent.stop5AtText=routeStop5Text||mergedCurrent.stop5AtText}
   else{
     const synthetic={driverName:savedRoute.driverName,driverKey:driverKey(savedRoute.driverName),station:st,day,route,totalStops:savedRoute.totalStops,totalPackages:savedRoute.totalPackages,packagesPerStop:savedRoute.packagesPerStop,stop5AtMinutes:routeStop5Minutes,stop5AtText:routeStop5Text,routeLoadedMs:1};
     const prior=usablePriorHistory(st,day,savedRoute.driverName);
     return{current:synthetic,prior,key:synthetic.driverKey,routeLoaded:true,savedRoute};
   }
 }
 const historyName=savedRoute?.driverName||r.name;
 const prior=usablePriorHistory(st,day,historyName);
 return{current:mergedCurrent,prior,key:driverKey(historyName)||key,routeLoaded:!!savedRoute||Number(mergedCurrent?.routeLoadedMs)>0,savedRoute};
}
function predict(r,deadline,st){
 const done=Number(r.done||0),total=Number(r.total||0),nowM=easternClock(),{current}=historyFor(r,st);
 const matchedPrior=completedPriorHistory(st,String(r.day||easternDay()),r.name);
 const prior=usablePriorHistory(st,String(r.day||easternDay()),r.name);
 const realStop5=Number(current?.stop5AtMinutes),assumedStop5Text=localStorage.getItem('coach_stop5_'+st)||STATIONS[st].assumedStop5,assumedStop5=mins(assumedStop5Text),stop5=Number.isFinite(realStop5)?realStop5:assumedStop5,usingAssumedStop5=!Number.isFinite(realStop5),pkg=Number(current?.totalPackages)||0,pps=pkg&&total?pkg/total:null;
 let currentPace=0;
 if(Number.isFinite(stop5)&&done>5){let elapsed=nowM-stop5;if(elapsed<0)elapsed+=1440;if(elapsed>0)currentPace=(done-5)/(elapsed/60)}
 let histDur=null;
 if(prior.length){
   let sw=0,sd=0;
   prior.forEach((h,i)=>{
     const dur=routeDuration(h),ht=Math.max(6,Number(h.totalStops)||total),hp=Number(h.packagesPerStop)||((Number(h.totalPackages)||0)/ht)||null;
     let adjusted=dur*(Math.max(1,total-5)/Math.max(1,ht-5));
     if(pps&&hp)adjusted*=clamp(Math.pow(pps/hp,.25),.85,1.20);
     const stopSimilarity=1/(1+Math.abs(ht-total)/Math.max(40,total));
     const pkgSimilarity=pps&&hp?1/(1+Math.abs(hp-pps)/Math.max(.5,pps)):1;
     const recency=Math.max(.55,1-i*.025),w=stopSimilarity*pkgSimilarity*recency;
     sd+=adjusted*w;sw+=w;
   });
   histDur=sw?sd/sw:null;
 }
 let eta=null,model='Live pace';
 // Every completed matching route can help: prefer its saved recent pace, then Amazon average.
 // This lets 1 route work as 1 route; if 30 exist, completedPriorHistory already limits us to the latest 20.
 let histPace=null;
 const paceRows=matchedPrior.map(h=>Number(h.recentPace)||Number(h.amazonAvg)||0).filter(x=>x>0&&x<100);
 if(paceRows.length){let sw=0,sp=0;paceRows.forEach((p,i)=>{const w=Math.max(.55,1-i*.025);sp+=p*w;sw+=w});histPace=sw?sp/sw:null}
 if(histDur&&Number.isFinite(stop5)){
   let predictedDur=histDur;
   if(!usingAssumedStop5&&currentPace>0&&done>8){
     let elapsed=nowM-stop5;if(elapsed<0)elapsed+=1440;
     const actualFrac=(done-5)/Math.max(1,total-5),expectedFrac=elapsed/histDur,perf=expectedFrac>0?clamp(actualFrac/expectedFrac,.70,1.35):1;
     predictedDur=histDur/Math.pow(perf,.65);
   }
   eta=stop5+predictedDur;model=usingAssumedStop5?'Personal history · assumed Stop 5':'Personal history';
 }else{
   const pace=currentPace||histPace||Number(r.recentPace||r.amazonAvg||0);
   // Before real progress/route timing is available, estimate from the station's editable assumed Stop 5.
   eta=pace>0?(usingAssumedStop5?stop5+Math.max(0,total-5)/pace*60:nowM+Math.max(0,total-done)/pace*60):null;
   if(histPace)model=usingAssumedStop5?'Personal history · assumed Stop 5':'Personal history';
 }
 const pace=currentPace||histPace||Number(r.recentPace||r.amazonAvg||0),late=eta==null?0:eta-mins(deadline),behind=late>0&&pace>0?Math.ceil(late/60*pace):0;
 return{pace,eta,late,behind,current,routeLoaded:!!(current?.routeLoadedMs)||!!historyFor(r,st).savedRoute,historyCount:matchedPrior.length,etaHistoryCount:matchedPrior.length,model,packages:pkg,packagesPerStop:pps,usingAssumedStop5,stop5UsedText:usingAssumedStop5?assumedStop5Text:(current?.stop5AtText||null)};
}
function ensureUI(){
 if(document.getElementById('live'))return;
 const app=document.getElementById('app'),nav=document.querySelector('.nav'),main=document.querySelector('main.shell');if(!app||!nav||!main)return;
 nav.style.gridTemplateColumns='repeat(6,1fr)';
 const b=document.createElement('button');b.dataset.page='live';b.innerHTML='<span class="ni">📊</span><span>Live</span>';const anchor=document.getElementById('liveNavAnchor');if(anchor)anchor.after(b);else nav.appendChild(b);
 const historyBtn=document.createElement('button');historyBtn.dataset.page='driverHistory';historyBtn.innerHTML='<span class="ni">📈</span><span>History</span>';const driversBtn=nav.querySelector('button[data-page="drivers"]');if(driversBtn)driversBtn.after(historyBtn);else nav.appendChild(historyBtn);
 const s=document.createElement('section');s.id='live';s.className='page';s.innerHTML=`
 <div class="card"><div class="row between"><h3 class="sectionTitle"><span class="sectionIcon">📊</span>LIVE Routes</h3><span class="muted" id="liveUpdated">Waiting for Chrome data</span></div>
 <div class="row" style="margin-top:14px"><button class="btn blue liveStation" data-st="DJX3">DJX3</button><button class="btn soft liveStation" data-st="DJX4">DJX4</button><button class="btn soft" id="liveSettings">⚙ Deadlines</button><button class="btn soft" id="liveStartSettings">⏱ Stop 5 time</button><button class="btn soft" id="liveOpenAmazon">🔗 Open today's itinerary</button></div>
 <div id="liveSummary" class="stats" style="margin-top:14px"></div><div id="liveList" class="list" style="margin-top:14px"></div></div>`;main.appendChild(s);
 const hs=document.createElement('section');hs.id='driverHistory';hs.className='page';hs.innerHTML=`
 <div class="card">
   <div class="row between"><div><h3 class="sectionTitle"><span class="sectionIcon">📈</span>Driver Delivery History</h3><div class="muted" style="margin-top:6px">Shows what COACH has actually saved for each driver and whether each route can be used for ETA.</div></div><span class="pill">2-name matching</span></div>
   <div class="field" style="margin-top:16px"><input id="historyDriverSearch" type="search" placeholder="Search driver..." autocomplete="off"></div>
   <div id="historyDriverChoices" class="row" style="margin:0 0 14px"></div>
   <div id="historyDriverSummary"></div>
   <div id="historyDateChoices" class="row" style="margin:14px 0"></div>
   <div id="historyDriverList" class="list" style="margin-top:14px"></div>
 </div>`;main.appendChild(hs);
 document.querySelectorAll('.nav button').forEach(x=>x.addEventListener('click',()=>{document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav button').forEach(q=>q.classList.remove('on'));document.getElementById(x.dataset.page)?.classList.add('on');x.classList.add('on');if(x.dataset.page==='driverHistory')renderDriverHistory()}));
 document.getElementById('historyDriverSearch')?.addEventListener('input',renderDriverHistory);
 document.querySelectorAll('.liveStation').forEach(x=>x.onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();window._coachStation=x.dataset.st;document.querySelectorAll('.liveStation').forEach(y=>{const active=y.dataset.st===window._coachStation;y.classList.toggle('blue',active);y.classList.toggle('soft',!active)});requestAnimationFrame(render)});
 document.getElementById('liveOpenAmazon').onclick=()=>{const st=window._coachStation||'DJX3',url=itineraryUrl(st);localStorage.setItem('coach_itinerary_'+st,url);window.open(url,'_blank','noopener')};
 for(const st of Object.keys(STATIONS))localStorage.setItem('coach_itinerary_'+st,itineraryUrl(st));
 document.getElementById('liveSettings').onclick=async()=>{const st=window._coachStation||'DJX3',cur=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline,v=prompt(st+' route deadline (24-hour HH:MM)',cur);if(/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')){localStorage.setItem('coach_deadline_'+st,v);render()}};
 document.getElementById('liveStartSettings').onclick=()=>{const st=window._coachStation||'DJX3',cur=localStorage.getItem('coach_stop5_'+st)||STATIONS[st].assumedStop5,v=prompt(st+' assumed Stop 5 time until real route timing is available (24-hour HH:MM)',cur);if(/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')){localStorage.setItem('coach_stop5_'+st,v);render()}};
 renderDriverHistory();
}
function savedRouteForHistory(h,name){
 return SAVED_ROUTES.find(x=>x.dateKey===h.day&&twoNamesMatch(name||h.driverName,x.driverName)&&(!x.station||String(x.station).toUpperCase()===String(h.station||'').toUpperCase()));
}
function historyMergedRow(h,name){
 const sr=savedRouteForHistory(h,name),sm=Number(h.stop5AtMinutes),rm=Number(sr?.stop5AtMinutes),stop5=Number.isFinite(sm)?sm:(Number.isFinite(rm)?rm:null),stop5Text=h.stop5AtText||sr?.stop5AtText||null;
 const merged={...h,stop5AtMinutes:stop5,stop5AtText,totalPackages:Number(h.totalPackages)||Number(sr?.totalPackages)||0,packagesPerStop:Number(h.packagesPerStop)||Number(sr?.packagesPerStop)||0};
 const dur=routeDuration(merged),valid=!!(h.completed&&dur);
 let reason='Ready for ETA history';
 if(!h.completed)reason='Not marked completed';
 else if(!Number.isFinite(Number(stop5)))reason='Stop 5 real time missing';
 else if(!h.finishedAtMs)reason='Finish time missing';
 else if(!dur)reason='Duration invalid';
 return{h:merged,sr,dur,valid,reason};
}
function renderDriverHistory(){
 const choices=document.getElementById('historyDriverChoices'),dates=document.getElementById('historyDateChoices'),list=document.getElementById('historyDriverList'),summary=document.getElementById('historyDriverSummary');if(!choices||!dates||!list||!summary)return;
 const q=String(document.getElementById('historyDriverSearch')?.value||'').trim().toLowerCase();
 const fmtDay=k=>{const m=String(k).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return k;return new Date(Number(m[1]),Number(m[2])-1,Number(m[3])).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})};
 const fmtClock=m=>Number.isFinite(Number(m))?(()=>{let x=Math.round(Number(m))%1440,h=Math.floor(x/60),mm=x%60,ap=h>=12?'PM':'AM';return ((h%12)||12)+':'+String(mm).padStart(2,'0')+' '+ap})():'MISSING';
 const parseClock=v=>{let x=clockMinutes12(v);if(Number.isFinite(x))return x;const m=String(v||'').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);return m?Number(m[1])*60+Number(m[2]):null};
 const groups=[];
 for(const h of HISTORY.filter(x=>x.completed)){const n=String(h.driverName||'').trim();if(!n)continue;let g=groups.find(x=>twoNamesMatch(x.name,n));if(!g){g={name:n,aliases:new Set(),rows:[]};groups.push(g)}g.aliases.add(n);g.rows.push(h)}
 groups.forEach(g=>g.rows.sort((a,b)=>String(b.day||b.dateKey||'').localeCompare(String(a.day||a.dateKey||''))||Number(b.finishedAtMs||b.lastSeenMs||0)-Number(a.finishedAtMs||a.lastSeenMs||0)));groups.sort((a,b)=>a.name.localeCompare(b.name));
 const filtered=groups.filter(g=>!q||g.name.toLowerCase().includes(q)||[...g.aliases].some(a=>a.toLowerCase().includes(q)));
 choices.style.display='grid';choices.style.gridTemplateColumns='repeat(auto-fit,minmax(260px,1fr))';choices.style.gap='10px';
 choices.innerHTML=filtered.map((g,i)=>{const last=g.rows[0],on=window._coachHistoryDriver&&twoNamesMatch(g.name,window._coachHistoryDriver);return `<button class="coachHistoryDriver item" data-i="${i}" style="text-align:left;cursor:pointer;border:2px solid ${on?'#1495f5':'#d6e5f1'};background:${on?'#eef8ff':'#fff'};padding:14px;border-radius:16px"><div class="row between"><div><div class="drivername">${esc(g.name)}</div><div class="muted" style="margin-top:4px">${g.rows.length} completed route${g.rows.length===1?'':'s'} · last ${esc(fmtDay(last?.day||last?.dateKey||''))}</div></div><span class="pill">${on?'▲ Open':'▼ Details'}</span></div></button>`}).join('')||'<div class="empty" style="grid-column:1/-1">No drivers with completed route history yet.</div>';
 choices.querySelectorAll('.coachHistoryDriver').forEach(b=>b.onclick=()=>{const g=filtered[Number(b.dataset.i)];if(!g)return;window._coachHistoryDriver=g.name;window._coachHistoryDay='';renderDriverHistory();requestAnimationFrame(()=>document.getElementById('historyDriverSummary')?.scrollIntoView({behavior:'smooth',block:'start'}))});
 let selected=String(window._coachHistoryDriver||'').trim(),selectedGroup=groups.find(g=>twoNamesMatch(g.name,selected)||[...g.aliases].some(a=>twoNamesMatch(a,selected)));
 if(!selectedGroup){summary.innerHTML='<div class="muted" style="margin-top:8px">Select a driver above to view the last 20 completed routes.</div>';dates.innerHTML='';list.innerHTML='';return}
 selected=selectedGroup.name;window._coachHistoryDriver=selected;const hist=selectedGroup.rows.slice(0,20),aliases=[...selectedGroup.aliases],mergedAll=hist.map(h=>historyMergedRow(h,selected)),valid=mergedAll.filter(x=>x.valid).length;
 summary.innerHTML=`<div class="stats"><div class="card stat"><span class="label">LAST ROUTES</span><b>${hist.length}</b></div><div class="card stat"><span class="label">ETA READY</span><b>${valid}</b></div><div class="card stat"><span class="label">ALIASES</span><b>${aliases.length}</b></div></div><div class="muted" style="margin:8px 2px 0"><b>${esc(selected)}</b> · ${aliases.map(esc).join(' · ')}</div>`;
 const dayMap=new Map();for(const h of hist){const d=String(h.day||h.dateKey||'Unknown date');if(!dayMap.has(d))dayMap.set(d,[]);dayMap.get(d).push(h)}
 const dayKeys=[...dayMap.keys()].sort((a,b)=>String(b).localeCompare(String(a))).slice(0,20);let selectedDay=String(window._coachHistoryDay||'');if(!dayKeys.includes(selectedDay))selectedDay=dayKeys[0]||'';window._coachHistoryDay=selectedDay;
 dates.innerHTML=dayKeys.map((d,i)=>`<button class="btn ${d===selectedDay?'blue':'soft'} coachHistoryDay" data-i="${i}" style="padding:8px 11px">${esc(fmtDay(d))}</button>`).join('');dates.querySelectorAll('.coachHistoryDay').forEach(b=>b.onclick=()=>{window._coachHistoryDay=dayKeys[Number(b.dataset.i)]||'';renderDriverHistory();requestAnimationFrame(()=>document.getElementById('historyDriverList')?.scrollIntoView({behavior:'smooth',block:'start'}))});
 const dayRows=(dayMap.get(selectedDay)||[]).map(h=>historyMergedRow(h,selected));
 list.innerHTML=dayRows.map((x,i)=>{const h=x.h,stop5=Number(h.stop5AtMinutes),finishM=h.finishedAtMs?easternClock(Number(h.finishedAtMs)):clockMinutes12(h.performanceEndAt||h.lastDelivery),stops=Number(h.totalStops)||Number(x.sr?.totalStops)||0,packages=Number(h.totalPackages)||Number(x.sr?.totalPackages)||0,route=h.route||x.sr?.routeCode||'',badStop5=!Number.isFinite(stop5),badFinish=!Number.isFinite(finishM),badStops=!stops,badPackages=!packages,badRoute=!route;
 const field=(label,val,bad)=>`<div style="min-width:150px;flex:1;padding:10px 12px;border-radius:12px;border:1px solid ${bad?'#ef4444':'#cfe0ed'};background:${bad?'#fff1f2':'#f9fcff'}"><div class="label" style="color:${bad?'#dc2626':''}">${label}${bad?' ⚠':''}</div><b style="color:${bad?'#b91c1c':''}">${esc(val||'MISSING')}</b></div>`;
 return `<div class="item" style="border:1px solid ${(badStop5||badFinish||badStops||badPackages||badRoute)?'#ef4444':'#86d7a5'}"><div class="row between"><div><div class="drivername">${esc(h.driverName||selected)}</div><div class="muted">${esc(fmtDay(selectedDay))} · ${esc(h.station||x.sr?.station||'?')}</div></div><button class="btn soft coachEditHistory" data-i="${i}">✏ Edit</button></div><div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">${field('ROUTE',route,badRoute)}${field('STOP 5 START',fmtClock(stop5),badStop5)}${field('LAST DELIVERY',fmtClock(finishM),badFinish)}${field('STOPS',stops||'',badStops)}${field('PACKAGES',packages||'',badPackages)}</div>${(badStop5||badFinish||badStops||badPackages||badRoute)?'<div style="margin-top:9px;color:#b91c1c;font-weight:700">⚠ COACH could not interpret one or more fields correctly. Review the red values.</div>':''}</div>`}).join('');
 list.querySelectorAll('.coachEditHistory').forEach(btn=>btn.onclick=async()=>{const x=dayRows[Number(btn.dataset.i)],h=x?.h;if(!h?.id)return alert('This history record cannot be edited because its document ID is missing.');
   const route=prompt('Route / CX',h.route||x.sr?.routeCode||'');if(route===null)return;
   const s5=prompt('Stop 5 start time (example 1:30 PM or 13:30)',fmtClock(Number(h.stop5AtMinutes)));if(s5===null)return;const s5m=parseClock(s5);
   const oldFinish=h.finishedAtMs?fmtClock(easternClock(Number(h.finishedAtMs))):String(h.performanceEndAt||h.lastDelivery||'');const fin=prompt('Last delivery time (example 6:45 PM or 18:45)',oldFinish);if(fin===null)return;const fm=parseClock(fin);
   const stops=prompt('Total stops',String(Number(h.totalStops)||Number(x.sr?.totalStops)||''));if(stops===null)return;const packages=prompt('Total packages',String(Number(h.totalPackages)||Number(x.sr?.totalPackages)||''));if(packages===null)return;
   if(!Number.isFinite(s5m)||!Number.isFinite(fm)||!Number.isFinite(Number(stops))||!Number.isFinite(Number(packages)))return alert('Check the red/missing values. Times must be like 1:30 PM or 13:30, and stops/packages must be numbers.');
   const day=String(h.day||h.dateKey||selectedDay),parts=day.split('-').map(Number),base=new Date(Date.UTC(parts[0],parts[1]-1,parts[2],5,0,0));let finishMs=base.getTime()+fm*60000;if(fm<s5m)finishMs+=86400000;
   try{await updateDoc(doc(db,'driverRouteHistory',h.id),{route:String(route).trim().toUpperCase(),stop5AtMinutes:s5m,stop5AtText:fmtClock(s5m),finishedAtMs:finishMs,performanceEndAt:fmtClock(fm),lastDelivery:fmtClock(fm),totalStops:Number(stops),totalPackages:Number(packages),historyManualEdit:true,historyManualEditAt:Date.now()});}catch(e){alert('Could not save: '+(e?.message||e))}
 })}
let LIVE={DJX3:[],DJX4:[]},RESCUES={DJX3:[],DJX4:[]};
function rescueOverrideKey(st,r){return 'coach_not_rescue_'+st+'_'+driverKey(r.name)}
function isRescueRow(st,r){
 const multi=!!r.isRescue||Number(r.routeCount||0)>1||(Array.isArray(r.routes)&&r.routes.length>1);
 return multi&&!localStorage.getItem(rescueOverrideKey(st,r));
}
function getData(st){
 const day=todayEastern(),normal=(LIVE[st]||[]).filter(r=>String(r.day||'')===day),rescues=(RESCUES[st]||[]).filter(r=>String(r.day||'')===day),byName=new Map();
 for(const r of normal){
   const k=driverKey(r.name),old=byName.get(k);
   const rMulti=!!r.isRescue||Number(r.routeCount||0)>1||(Array.isArray(r.routes)&&r.routes.length>1);
   const oldMulti=old&&(!!old.isRescue||Number(old.routeCount||0)>1||(Array.isArray(old.routes)&&old.routes.length>1));
   if(!old||rMulti||!oldMulti)byName.set(k,r);
 }
 for(const r of rescues){
   const k=driverKey(r.name),old=byName.get(k);
   if(old)byName.set(k,{...old,...r,routes:(r.routes&&r.routes.length?r.routes:old.routes),routeCount:Number(r.routeCount||old.routeCount||0),isRescue:!!(r.isRescue||old.isRescue)});
   else byName.set(k,r);
 }
 return [...byName.values()];
}
let rendering=false;
function render(){
 if(rendering)return; rendering=true;
 ensureUI();const st=window._coachStation||'DJX3',deadline=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline;
 const rows=getData(st);
 const calc=rows.map(r=>({...r,_isRescue:isRescueRow(st,r),_p:predict(r,deadline,st)}));
 const normal=calc.filter(r=>!r._isRescue),activeDrivers=normal.filter(r=>!(Number(r.total)>0&&Number(r.done)>=Number(r.total))).length;
 const pkgRows=normal.filter(r=>Number(r.totalPackages)>0&&Number.isFinite(Number(r.deliveredPackages)));
 const deliveredPkgs=pkgRows.reduce((a,r)=>a+Number(r.deliveredPackages||0),0),totalPkgs=pkgRows.reduce((a,r)=>a+Number(r.totalPackages||0),0);
 const deliveredPct=totalPkgs>0?Math.round(deliveredPkgs/totalPkgs*100):null;
 const projectedReturns=normal.reduce((sum,r)=>{
   if(Number(r.total)>0&&Number(r.done)>=Number(r.total))return sum;
   const totalPackages=Number(r.totalPackages)||0,delivered=Number(r.deliveredPackages)||0;
   if(totalPackages<=0)return sum;
   const remainingPackages=Math.max(0,totalPackages-delivered);
   const behindStops=Math.max(0,Number(r._p.behind)||0),remainingStops=Math.max(0,Number(r.total||0)-Number(r.done||0));
   if(!behindStops||!remainingStops)return sum;
   return sum+Math.min(remainingPackages,Math.ceil(remainingPackages*(behindStops/remainingStops)));
 },0);
 document.getElementById('liveSummary').innerHTML=`<div class="card stat"><span class="label">PACKAGES DELIVERED</span><b>${deliveredPct==null?'—':deliveredPct+'%'}</b></div><div class="card stat"><span class="label">PROJECTED RETURNS</span><b>${projectedReturns}</b></div><div class="card stat"><span class="label">DRIVERS STILL ON ROUTE</span><b>${activeDrivers}</b></div>`;
 document.getElementById('liveList').innerHTML=calc.length?calc.sort((a,b)=>{
 if(a._isRescue!==b._isRescue)return a._isRescue?-1:1;
 const af=Number(a.total)>0&&Number(a.done)>=Number(a.total),bf=Number(b.total)>0&&Number(b.done)>=Number(b.total);
 if(af!==bf)return af?1:-1;
 if(!af&&!bf)return (b._p.eta??-Infinity)-(a._p.eta??-Infinity);
 const al=clockMinutes12(a.lastDelivery||a._p.current?.lastDelivery),bl=clockMinutes12(b.lastDelivery||b._p.current?.lastDelivery);
 return (bl??-Infinity)-(al??-Infinity);
}).map(r=>{const finished=Number(r.total)>0&&Number(r.done)>=Number(r.total),last=r.lastDelivery||r._p.current?.lastDelivery||null,rescue=r._isRescue,routes=(r.routes||[r.route]).join(', ');const pct=Math.max(0,Math.min(100,Number(r.total)>0?(Number(r.done||0)/Number(r.total))*100:0)),tone=finished?{line:'#22c55e',fill:'rgba(34,197,94,.18)',base:'#f0fdf4'}:(rescue?{line:'#8b5cf6',fill:'rgba(139,92,246,.18)',base:'#faf7ff'}:(r._p.behind?{line:'#ef4444',fill:'rgba(239,68,68,.16)',base:'#fff8f8'}:{line:'#3b82f6',fill:'rgba(59,130,246,.15)',base:'#f8fbff'}));return `<div class="item coachRouteProgress" style="border:2px solid ${tone.line};background:linear-gradient(90deg,${tone.fill} 0%,${tone.fill} ${pct}%,${tone.base} ${pct}%,${tone.base} 100%);transition:background .45s ease,border-color .25s ease"><div class="row between"><div><div class="drivername">${esc(r.name)}</div><div class="muted">${rescue?'🚑 RESCUE · '+esc(routes):esc(r.route||'')} · ${st}</div></div><span class="pill" style="${finished?'background:#dcfce7;color:#15803d':''}">${r.done||0}/${r.total||0} stops</span></div>${rescue?'<div class="row" style="margin-top:8px"><span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#8b5cf6;color:white;font-size:11px;font-weight:900">🚑 RESCUE DRIVER</span><button class="btn soft coachNotRescue" data-st="'+st+'" data-key="'+esc(driverKey(r.name))+'" style="padding:6px 10px;font-size:11px">Not Rescue — move to drivers</button></div>':''}${finished?'<div style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#22c55e;color:white;font-size:11px;font-weight:900">✓ ROUTE COMPLETED</div>':(!r._p.routeLoaded?'<div style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#f59e0b;color:white;font-size:11px;font-weight:900">⚠ ROUTE NOT LOADED</div>':'')}${!finished&&r._p.routeLoaded&&!Number.isFinite(Number(r._p.current?.stop5AtMinutes))?'<div style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#dc2626;color:white;font-size:11px;font-weight:900">⚠ STOP 5 REAL TIME NOT FOUND</div>':''}<div class="addr" style="margin-top:10px">${finished?'COACH FINISH: '+esc(last||'Completed'):'COACH ETA: '+(r._p.eta?fmtMin(r._p.eta):'Learning...')}</div><div class="muted">Deadline ${fmtMin(mins(deadline))} · ${Number.isFinite(Number(r._p.current?.stop5AtMinutes))?'Pace since Stop 5 '+(r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data'):'Live pace '+(r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data')}${r._p.packages?' · '+r._p.packages+' packages':''}${!finished&&r._p.behind?' · 🔴 ~'+r._p.behind+' stops behind':''}</div><div class="muted" style="margin-top:4px">${r._p.model} · ${r._p.historyCount}/20 previous routes${r._p.historyCount!==r._p.etaHistoryCount?' · '+r._p.etaHistoryCount+' ETA-ready':''}${r._p.current?.stop5AtText?' · Stop 5 '+esc(r._p.current.stop5AtText):''}</div></div>`}).join(''):'<div class="empty">No LIVE data yet. The Chrome collector will feed this station here.</div>';
 document.querySelectorAll('.coachNotRescue').forEach(b=>b.onclick=()=>{localStorage.setItem('coach_not_rescue_'+b.dataset.st+'_'+b.dataset.key,'1');render()});

 rendering=false;
}

function rescueHistoryFor(r,st){
 const key=r.driverKey||driverKey(r.name),prior=RESCUE_HISTORY.filter(h=>h.station===st&&h.driverKey===key&&h.day!==r.day).sort((a,b)=>String(b.day).localeCompare(String(a.day))).slice(0,20);
 return prior;
}
function rescuePredict(r){
 const now=easternClock(),remaining=Math.max(0,Number(r.total||0)-Number(r.done||0)),prior=rescueHistoryFor(r,r.station);
 const histPaces=prior.map(h=>Number(h.recentPace||h.amazonAvg||0)).filter(x=>x>0);
 const personal=histPaces.length?histPaces.reduce((a,b)=>a+b,0)/histPaces.length:0;
 const live=Number(r.recentPace||r.amazonAvg||0),pace=personal&&live?personal*.55+live*.45:(personal||live);
 return{pace,eta:pace?now+remaining/pace*60:null,historyCount:prior.length};
}
function renderRescue(st,deadline){
 const rows=RESCUES[st]||[],calc=rows.map(r=>({...r,_p:rescuePredict(r)})).sort((a,b)=>(b._p.eta||0)-(a._p.eta||0));
 document.getElementById('liveSummary').innerHTML=`<div class="card stat"><span class="label">Rescue drivers</span><b>${rows.length}</b></div><div class="card stat"><span class="label">Active rescue stops</span><b>${rows.reduce((a,r)=>a+Math.max(0,Number(r.total||0)-Number(r.done||0)),0)}</b></div><div class="card stat"><span class="label">History</span><b>20 days</b></div>`;
 document.getElementById('liveList').innerHTML=calc.length?calc.map(r=>{const finished=Number(r.total)>0&&Number(r.done)>=Number(r.total),routes=(r.routes||[r.route]).join(', ');return `<div class="item" style="${finished?'border:2px solid #22c55e;background:#f0fdf4':'border:2px solid #8b5cf6;background:#faf5ff'}"><div class="row between"><div><div class="drivername">${esc(r.name)}</div><div class="muted">🚑 RESCUE · ${esc(routes)} · ${st}</div></div><span class="pill">${r.done||0}/${r.total||0} stops</span></div><div class="addr" style="margin-top:10px">${finished?'RESCUE FINISH: '+esc(r.lastDelivery||'Completed'):'RESCUE ETA: '+(r._p.eta?fmtMin(r._p.eta):'Learning...')}</div><div class="muted">Pending ${Math.max(0,Number(r.total||0)-Number(r.done||0))} stops · Pace ${r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data'} · ${r._p.historyCount}/20 previous rescue days</div></div>`}).join(''):'<div class="empty">No rescue drivers detected. Drivers with more than one CX will appear here automatically.</div>';
}
async function start(){ensureUI();render();const db=await dbReady();if(db){onSnapshot(collection(db,'liveRoutes'),snap=>{LIVE={DJX3:[],DJX4:[]};snap.forEach(x=>{const d=x.data();if(LIVE[d.station])LIVE[d.station].push(d)});const st=window._coachStation||'DJX3',rows=(LIVE[st]||[]).filter(r=>String(r.day||'')===todayEastern());const newest=Math.max(0,...rows.map(r=>Number(r.capturedMs)||0));const e=document.getElementById('liveUpdated');if(e)e.textContent=newest?'Updated '+new Date(newest).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Waiting for Chrome data';render()});onSnapshot(collection(db,'driverRouteHistory'),snap=>{HISTORY=snap.docs.map(x=>({id:x.id,...x.data()}));render();renderDriverHistory()});onSnapshot(collection(db,'routes'),snap=>{SAVED_ROUTES=snap.docs.map(x=>({id:x.id,...x.data()}));render();renderDriverHistory()});onSnapshot(collection(db,'liveRescues'),snap=>{RESCUES={DJX3:[],DJX4:[]};snap.forEach(x=>{const d=x.data();if(RESCUES[d.station])RESCUES[d.station].push(d)});render()})}setInterval(render,15000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
