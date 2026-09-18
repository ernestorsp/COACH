import{getApp}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import{getFirestore,collection,onSnapshot}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const STATIONS={DJX3:{deadline:'21:00'},DJX4:{deadline:'20:00'}};
const sleep=m=>new Promise(r=>setTimeout(r,m));
async function dbReady(){for(let i=0;i<60;i++){try{return getFirestore(getApp())}catch{}await sleep(100)}}
function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function mins(t){const [h,m]=String(t).split(':').map(Number);return h*60+m}
function fmtMin(n){n=Math.round(n);const h=Math.floor(n/60)%24,m=n%60;return new Date(2000,0,1,h,m).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}
function predict(r,deadline){
 const done=Number(r.done||0),total=Number(r.total||0),now=new Date(),nowM=now.getHours()*60+now.getMinutes();
 const pace=Number(r.smartPace||r.recentPace||r.pace||0);
 const eta=pace>0?nowM+Math.max(0,total-done)/pace*60:null;
 const late=eta==null?0:eta-mins(deadline);
 const behind=late>0&&pace>0?Math.ceil(late/60*pace):0;
 return{pace,eta,late,behind};
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
 document.querySelectorAll('.liveStation').forEach(x=>x.onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();window._coachStation=x.dataset.st;document.querySelectorAll('.liveStation').forEach(y=>y.classList.toggle('blue',y.dataset.st===window._coachStation)||y.classList.toggle('soft',y.dataset.st!==window._coachStation));requestAnimationFrame(render)});
 document.getElementById('liveUrls').onclick=()=>{const st=window._coachStation||'DJX3';const current=localStorage.getItem('coach_itinerary_'+st)||'';const v=prompt(st+' itinerary URL',current);if(v===null)return;try{const u=new URL(v.trim());if(u.hostname!=='logistics.amazon.com'||!u.pathname.includes('/operations/execution/itineraries'))throw Error();localStorage.setItem('coach_itinerary_'+st,u.toString());alert(st+' itinerary URL saved.')}catch{alert('Please paste a valid logistics.amazon.com itineraries URL.')}};
 document.getElementById('liveSettings').onclick=async()=>{const st=window._coachStation||'DJX3',cur=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline,v=prompt(st+' route deadline (24-hour HH:MM)',cur);if(/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')){localStorage.setItem('coach_deadline_'+st,v);render()}};
}
let LIVE={DJX3:[],DJX4:[]};
function getData(st){return LIVE[st]||[]}
let rendering=false;
function render(){
 if(rendering)return; rendering=true;
 ensureUI();const st=window._coachStation||'DJX3',deadline=localStorage.getItem('coach_deadline_'+st)||STATIONS[st].deadline,rows=getData(st);
 const calc=rows.map(r=>({...r,_p:predict(r,deadline)}));const late=calc.filter(r=>r._p.behind>0).length,behind=calc.reduce((a,r)=>a+r._p.behind,0);
 document.getElementById('liveSummary').innerHTML=`<div class="card stat"><span class="label">Drivers</span><b>${rows.length}</b></div><div class="card stat"><span class="label">Projected late</span><b>${late}</b></div><div class="card stat"><span class="label">Stops behind</span><b>${behind}</b></div>`;
 document.getElementById('liveList').innerHTML=calc.length?calc.sort((a,b)=>b._p.behind-a._p.behind).map(r=>`<div class="item" style="${r._p.behind?'border:2px solid #dc2626':''}"><div class="row between"><div><div class="drivername">${esc(r.name)}</div><div class="muted">${esc(r.route||'')} · ${st}</div></div><span class="pill">${r.done||0}/${r.total||0} stops</span></div><div class="addr" style="margin-top:10px">COACH ETA: ${r._p.eta?fmtMin(r._p.eta):'Learning...'}</div><div class="muted">Deadline ${fmtMin(mins(deadline))} · Smart pace ${r._p.pace?r._p.pace.toFixed(1)+'/h':'collecting data'}${r._p.behind?' · 🔴 ~'+r._p.behind+' stops behind':''}</div></div>`).join(''):'<div class="empty">No LIVE data yet. The Chrome collector will feed this station here.</div>';
 rendering=false;
}
async function start(){ensureUI();render();const db=await dbReady();if(db)onSnapshot(collection(db,'liveRoutes'),snap=>{LIVE={DJX3:[],DJX4:[]};snap.forEach(x=>{const d=x.data();if(LIVE[d.station])LIVE[d.station].push(d)});const st=window._coachStation||'DJX3',rows=LIVE[st];const newest=Math.max(0,...rows.map(r=>Number(r.capturedMs)||0));const e=document.getElementById('liveUpdated');if(e)e.textContent=newest?'Updated '+new Date(newest).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Waiting for Chrome data';render()});setInterval(render,15000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
