import{getApp}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import{getFirestore,collection,onSnapshot}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const STATIONS={DJX3:{deadline:'21:00'},DJX4:{deadline:'20:00'}};
const sleep=m=>new Promise(r=>setTimeout(r,m));
async function dbReady(){for(let i=0;i<60;i++){try{return getFirestore(getApp())}catch{}await sleep(100)}}
function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function mins(t){const [h,m]=String(t).split(':').map(Number);return h*60+m}
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
let HISTORY=[];
function historyFor(r,st){
 const key=r.driverKey||driverKey(r.name),day=String(r.day||easternDay());
 const all=HISTORY.filter(h=>h.driverKey===key&&h.station===st),current=all.find(h=>h.day===day)||null;
 const prior=all.filter(h=>h.day!==day&&h.completed&&routeDuration(h)).sort((a,b)=>String(b.day).localeCompare(String(a.day))).slice(0,20);
 return{current,prior,key};
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
 return{pace,eta,late,behind,current,historyCount:prior.length,model,packages:pkg,packagesPerStop:pps};
}
function ensureUI(){
 if(document.getElementById('live'))return;
 const app=document.getElementById('app'),nav=document.querySelector('.nav'),main=document.querySelector('main.shell');if(!app||!nav||!main)return;
 nav.style.gridTemplateColumns='repeat(5,1fr)';
 const b=document.createElement('button');b.dataset.page='live';b.innerHTML='<span class="ni">📊</span><span>Live</span>';nav.appendChild(b);
 const s=document.createElement('section');s.id='live';s.className='page';s.innerHTML=`
 <div class="card"><div class="row between"><h3 class="sectionTitle"><span class="sectionIcon">📊</span>LIVE Routes</h3><span class="muted" id="liveUpdated">Waiting for Chrome data</span></div>
 <div class="row" style="margin-top:14px"><button class="btn blue liveStation" data-st="DJX3">DJX3</button><button class="btn soft liveStation" data-st="DJX4">DJX4</button><button class="btn soft" id="liveSettings">⚙ Deadlines</button><button class="btn soft" id="liveUrls">🔗 Itinerary URLs</button></div>
 <div id="liveSummary" class="stats" style="margin-top:14px"></div><div id="liveList" class="list" style="margin-top:14px"></div></div>`;main.appendChild(s);
 document.querySelectorAll('.nav button').forEach(x=>x.addEventListener('click',()=>{document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav button').forEach(q=>q.classList.remove('on'));document.getElementById(x.dataset.page)?.classList.add('on');x.classList.add('on')}));
 document.querySelectorAll('.liveStation').forEach(x=>x.onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();window._coachStation=x.dataset.st;document.querySelectorAll('.liveStation').forEach(y=>{const active=y.dataset.st===window._coachStation;y.classList.toggle('blue',active);y.classList.toggle('soft',!active)});requestAnimationFrame(render)});
 document.getElementById('liveUrls').onclick=()=>{const st=window._coachStation||'DJX3';const current=localStorage.getItem('coach_itinerary_'+st)||'';const v=prompt(st+' itinerary URL',current);if(v===null)return;try{const u=new URL(v.trim());if(u.hostname!=='logistics.amazon.com'||!u.pathname.includes('/operations/execution/itineraries'))throw Error();localStorage.setItem('coach_itinerary_'+st,u.toString());alert(st+' itinerary URL saved.')}catch{alert('Please paste a valid logistics.amazon.com itineraries URL.')}};
 document.getElementById('liveSettings').onclick=async()=>{const st=window._coachStation||'DJX3',cur=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline,v=prompt(st+' route deadline (24-hour HH:MM)',cur);if(/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')){localStorage.setItem('coach_deadline_'+st,v);render()}};
}
let LIVE={DJX3:[],DJX4:[]};
function getData(st){return LIVE[st]||[]}
let rendering=false;
function render(){
 if(rendering)return; rendering=true;
 ensureUI();const st=window._coachStation||'DJX3',deadline=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline,rows=getData(st);
 const calc=rows.map(r=>({...r,_p:predict(r,deadline,st)}));const late=calc.filter(r=>r._p.behind>0).length,behind=calc.reduce((a,r)=>a+r._p.behind,0);
 document.getElementById('liveSummary').innerHTML=`<div class="card stat"><span class="label">Drivers</span><b>${rows.length}</b></div><div class="card stat"><span class="label">Projected late</span><b>${late}</b></div><div class="card stat"><span class="label">Stops behind</span><b>${behind}</b></div>`;
 document.getElementById('liveList').innerHTML=calc.length?calc.sort((a,b)=>b._p.behind-a._p.behind).map(r=>`<div class="item" style="${r._p.behind?'border:2px solid #dc2626':''}"><div class="row between"><div><div class="drivername">${esc(r.name)}</div><div class="muted">${esc(r.route||'')} · ${st}</div></div><span class="pill">${r.done||0}/${r.total||0} stops</span></div><div class="addr" style="margin-top:10px">COACH ETA: ${r._p.eta?fmtMin(r._p.eta):'Learning...'}</div><div class="muted">Deadline ${fmtMin(mins(deadline))} · Pace since Stop 5 ${r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data'}${r._p.packages?' · '+r._p.packages+' packages':''}${r._p.behind?' · 🔴 ~'+r._p.behind+' stops behind':''}</div><div class="muted" style="margin-top:4px">${r._p.model} · ${r._p.historyCount}/20 previous routes${r._p.current?.stop5AtText?' · Stop 5 '+esc(r._p.current.stop5AtText):''}</div></div>`).join(''):'<div class="empty">No LIVE data yet. The Chrome collector will feed this station here.</div>';
 rendering=false;
}
async function start(){ensureUI();render();const db=await dbReady();if(db){onSnapshot(collection(db,'liveRoutes'),snap=>{LIVE={DJX3:[],DJX4:[]};snap.forEach(x=>{const d=x.data();if(LIVE[d.station])LIVE[d.station].push(d)});const st=window._coachStation||'DJX3',rows=LIVE[st];const newest=Math.max(0,...rows.map(r=>Number(r.capturedMs)||0));const e=document.getElementById('liveUpdated');if(e)e.textContent=newest?'Updated '+new Date(newest).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Waiting for Chrome data';render()});onSnapshot(collection(db,'driverRouteHistory'),snap=>{HISTORY=snap.docs.map(x=>({id:x.id,...x.data()}));render()})}setInterval(render,15000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
