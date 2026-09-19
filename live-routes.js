import{getApp}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import{getFirestore,collection,onSnapshot}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const STATIONS={DJX3:{deadline:'21:00',serviceAreaId:'c599503f-5de9-4035-8532-125fcbc09b03'},DJX4:{deadline:'20:00',serviceAreaId:'fbf527d0-7ba7-4768-b452-ef8522843889'}};
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
function historyFor(r,st){
 const key=r.driverKey||driverKey(r.name),day=String(r.day||easternDay()),route=String(r.route||'').toUpperCase();
 const stationHistory=HISTORY.filter(h=>h.station===st);
 const byName=stationHistory.filter(h=>h.driverKey===key);
 const candidates=stationHistory.filter(h=>h.day===day&&String(h.route||'').toUpperCase()===route&&twoNamesMatch(r.name,h.driverName));
 const current=candidates.find(h=>Number(h.routeLoadedMs)>0)||candidates[0]||byName.find(h=>h.day===day&&String(h.route||'').toUpperCase()===route)||null;
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
     const historyKey=synthetic.driverKey||key;
     const prior=stationHistory.filter(h=>h.driverKey===historyKey&&h.day!==day&&h.completed&&routeDuration(h)).sort((a,b)=>String(b.day).localeCompare(String(a.day))).slice(0,20);
     return{current:synthetic,prior,key:historyKey,routeLoaded:true,savedRoute};
   }
 }
 const historyKey=mergedCurrent?.driverKey||driverKey(savedRoute?.driverName||r.name)||key;
 const prior=stationHistory.filter(h=>h.driverKey===historyKey&&h.day!==day&&h.completed&&routeDuration(h)).sort((a,b)=>String(b.day).localeCompare(String(a.day))).slice(0,20);
 return{current:mergedCurrent,prior,key:historyKey,routeLoaded:!!savedRoute||Number(mergedCurrent?.routeLoadedMs)>0,savedRoute};
}
function predict(r,deadline,st){
 const done=Number(r.done||0),total=Number(r.total||0),nowM=easternClock(),{current,prior}=historyFor(r,st);
 const stop5=Number(current?.stop5AtMinutes),pkg=Number(current?.totalPackages)||0,pps=pkg&&total?pkg/total:null;
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
 if(histDur&&Number.isFinite(stop5)){
   let predictedDur=histDur;
   if(currentPace>0&&done>8){
     let elapsed=nowM-stop5;if(elapsed<0)elapsed+=1440;
     const actualFrac=(done-5)/Math.max(1,total-5),expectedFrac=elapsed/histDur,perf=expectedFrac>0?clamp(actualFrac/expectedFrac,.70,1.35):1;
     predictedDur=histDur/Math.pow(perf,.65);
   }
   eta=stop5+predictedDur;model='Personal history';
 }else{
   const pace=currentPace||Number(r.recentPace||r.amazonAvg||0);
   eta=pace>0?nowM+Math.max(0,total-done)/pace*60:null;
 }
 const pace=currentPace||Number(r.recentPace||r.amazonAvg||0),late=eta==null?0:eta-mins(deadline),behind=late>0&&pace>0?Math.ceil(late/60*pace):0;
 return{pace,eta,late,behind,current,routeLoaded:!!(current?.routeLoadedMs)||!!historyFor(r,st).savedRoute,historyCount:prior.length,model,packages:pkg,packagesPerStop:pps};
}
function ensureUI(){
 if(document.getElementById('live'))return;
 const app=document.getElementById('app'),nav=document.querySelector('.nav'),main=document.querySelector('main.shell');if(!app||!nav||!main)return;
 nav.style.gridTemplateColumns='repeat(5,1fr)';
 const b=document.createElement('button');b.dataset.page='live';b.innerHTML='<span class="ni">📊</span><span>Live</span>';const anchor=document.getElementById('liveNavAnchor');if(anchor)anchor.after(b);else nav.appendChild(b);
 const s=document.createElement('section');s.id='live';s.className='page';s.innerHTML=`
 <div class="card"><div class="row between"><h3 class="sectionTitle"><span class="sectionIcon">📊</span>LIVE Routes</h3><span class="muted" id="liveUpdated">Waiting for Chrome data</span></div>
 <div class="row" style="margin-top:14px"><button class="btn blue liveStation" data-st="DJX3">DJX3</button><button class="btn soft liveStation" data-st="DJX4">DJX4</button><button class="btn soft" id="liveSettings">⚙ Deadlines</button><button class="btn soft" id="liveOpenAmazon">🔗 Open today's itinerary</button></div>
 <div id="liveSummary" class="stats" style="margin-top:14px"></div><div id="liveList" class="list" style="margin-top:14px"></div></div>`;main.appendChild(s);
 document.querySelectorAll('.nav button').forEach(x=>x.addEventListener('click',()=>{document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav button').forEach(q=>q.classList.remove('on'));document.getElementById(x.dataset.page)?.classList.add('on');x.classList.add('on')}));
 document.querySelectorAll('.liveStation').forEach(x=>x.onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();window._coachStation=x.dataset.st;document.querySelectorAll('.liveStation').forEach(y=>{const active=y.dataset.st===window._coachStation;y.classList.toggle('blue',active);y.classList.toggle('soft',!active)});requestAnimationFrame(render)});
 document.getElementById('liveOpenAmazon').onclick=()=>{const st=window._coachStation||'DJX3',url=itineraryUrl(st);localStorage.setItem('coach_itinerary_'+st,url);window.open(url,'_blank','noopener')};
 for(const st of Object.keys(STATIONS))localStorage.setItem('coach_itinerary_'+st,itineraryUrl(st));
 document.getElementById('liveSettings').onclick=async()=>{const st=window._coachStation||'DJX3',cur=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline,v=prompt(st+' route deadline (24-hour HH:MM)',cur);if(/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')){localStorage.setItem('coach_deadline_'+st,v);render()}};
}
let LIVE={DJX3:[],DJX4:[]},RESCUES={DJX3:[],DJX4:[]};
function rescueOverrideKey(st,r){return 'coach_not_rescue_'+st+'_'+driverKey(r.name)}
function isRescueRow(st,r){
 const multi=!!r.isRescue||Number(r.routeCount||0)>1||(Array.isArray(r.routes)&&r.routes.length>1);
 return multi&&!localStorage.getItem(rescueOverrideKey(st,r));
}
function getData(st){
 const normal=LIVE[st]||[],rescues=RESCUES[st]||[],byName=new Map();
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
}).map(r=>{const finished=Number(r.total)>0&&Number(r.done)>=Number(r.total),last=r.lastDelivery||r._p.current?.lastDelivery||null,rescue=r._isRescue,routes=(r.routes||[r.route]).join(', ');const pct=Math.max(0,Math.min(100,Number(r.total)>0?(Number(r.done||0)/Number(r.total))*100:0)),tone=finished?{line:'#22c55e',fill:'rgba(34,197,94,.18)',base:'#f0fdf4'}:(rescue?{line:'#8b5cf6',fill:'rgba(139,92,246,.18)',base:'#faf7ff'}:(r._p.behind?{line:'#ef4444',fill:'rgba(239,68,68,.16)',base:'#fff8f8'}:{line:'#3b82f6',fill:'rgba(59,130,246,.15)',base:'#f8fbff'}));return `<div class="item coachRouteProgress" style="border:2px solid ${tone.line};background:linear-gradient(90deg,${tone.fill} 0%,${tone.fill} ${pct}%,${tone.base} ${pct}%,${tone.base} 100%);transition:background .45s ease,border-color .25s ease"><div class="row between"><div><div class="drivername">${esc(r.name)}</div><div class="muted">${rescue?'🚑 RESCUE · '+esc(routes):esc(r.route||'')} · ${st}</div></div><span class="pill" style="${finished?'background:#dcfce7;color:#15803d':''}">${r.done||0}/${r.total||0} stops</span></div>${rescue?'<div class="row" style="margin-top:8px"><span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#8b5cf6;color:white;font-size:11px;font-weight:900">🚑 RESCUE DRIVER</span><button class="btn soft coachNotRescue" data-st="'+st+'" data-key="'+esc(driverKey(r.name))+'" style="padding:6px 10px;font-size:11px">Not Rescue — move to drivers</button></div>':''}${finished?'<div style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#22c55e;color:white;font-size:11px;font-weight:900">✓ ROUTE COMPLETED</div>':(!r._p.routeLoaded?'<div style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#f59e0b;color:white;font-size:11px;font-weight:900">⚠ ROUTE NOT LOADED</div>':'')}${!finished&&r._p.routeLoaded&&!Number.isFinite(Number(r._p.current?.stop5AtMinutes))?'<div style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#dc2626;color:white;font-size:11px;font-weight:900">⚠ STOP 5 REAL TIME NOT FOUND</div>':''}<div class="addr" style="margin-top:10px">${finished?'COACH FINISH: '+esc(last||'Completed'):'COACH ETA: '+(r._p.eta?fmtMin(r._p.eta):'Learning...')}</div><div class="muted">Deadline ${fmtMin(mins(deadline))} · ${Number.isFinite(Number(r._p.current?.stop5AtMinutes))?'Pace since Stop 5 '+(r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data'):'Live pace '+(r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data')}${r._p.packages?' · '+r._p.packages+' packages':''}${!finished&&r._p.behind?' · 🔴 ~'+r._p.behind+' stops behind':''}</div><div class="muted" style="margin-top:4px">${r._p.model} · ${r._p.historyCount}/20 previous routes${r._p.current?.stop5AtText?' · Stop 5 '+esc(r._p.current.stop5AtText):''}</div></div>`}).join(''):'<div class="empty">No LIVE data yet. The Chrome collector will feed this station here.</div>';
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
async function start(){ensureUI();render();const db=await dbReady();if(db){onSnapshot(collection(db,'liveRoutes'),snap=>{LIVE={DJX3:[],DJX4:[]};snap.forEach(x=>{const d=x.data();if(LIVE[d.station])LIVE[d.station].push(d)});const st=window._coachStation||'DJX3',rows=LIVE[st];const newest=Math.max(0,...rows.map(r=>Number(r.capturedMs)||0));const e=document.getElementById('liveUpdated');if(e)e.textContent=newest?'Updated '+new Date(newest).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Waiting for Chrome data';render()});onSnapshot(collection(db,'driverRouteHistory'),snap=>{HISTORY=snap.docs.map(x=>({id:x.id,...x.data()}));render()});onSnapshot(collection(db,'routes'),snap=>{SAVED_ROUTES=snap.docs.map(x=>({id:x.id,...x.data()}));render()});onSnapshot(collection(db,'liveRescues'),snap=>{RESCUES={DJX3:[],DJX4:[]};snap.forEach(x=>{const d=x.data();if(RESCUES[d.station])RESCUES[d.station].push(d)});render()})}setInterval(render,15000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
