const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'us-east1', maxInstances: 10 });

const db = admin.firestore();

function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-COACH-Collector-Key');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

async function requireAdmin(req) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Error('unauthenticated');
  const decoded = await admin.auth().verifyIdToken(header.slice(7));
  const snap = await db.doc(`users/${decoded.uid}`).get();
  if (!snap.exists || snap.data().role !== 'admin' || snap.data().status !== 'active') throw new Error('permission-denied');
  return decoded;
}

exports.adminUser = onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    const caller = await requireAdmin(req);
    const action = String(req.body?.action || '');

    if (action === 'create' || action === 'invite') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const name = String(req.body?.name || '').trim() || email;
      const role = req.body?.role === 'admin' ? 'admin' : 'user';
      const password = String(req.body?.password || '');
      if (!email) return res.status(400).json({ error: 'email-required' });
      if (password.length < 8) return res.status(400).json({ error: 'password-must-have-8-characters' });

      let userRecord;
      let reused = false;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
        reused = true;
        userRecord = await admin.auth().updateUser(userRecord.uid, { password, disabled: false, displayName: name });
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        userRecord = await admin.auth().createUser({ email, password, disabled: false, displayName: name });
      }

      await db.doc(`users/${userRecord.uid}`).set({
        uid: userRecord.uid,
        name,
        email,
        role,
        status: 'active',
        mustChangePassword: false,
        createdBy: caller.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await admin.auth().revokeRefreshTokens(userRecord.uid);
      return res.json({ ok: true, uid: userRecord.uid, email, reused });
    }

    if (action === 'delete') {
      const uid = String(req.body?.uid || '').trim();
      if (!uid) return res.status(400).json({ error: 'uid-required' });
      if (uid === caller.uid) return res.status(400).json({ error: 'cannot-delete-self' });
      try { await admin.auth().deleteUser(uid); } catch (err) { if (err.code !== 'auth/user-not-found') throw err; }
      await db.doc(`users/${uid}`).delete().catch(() => {});
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown-action' });
  } catch (err) {
    console.error(err);
    const code = err.message === 'unauthenticated' ? 401 : err.message === 'permission-denied' ? 403 : 500;
    return res.status(code).json({ error: err.message || 'server-error' });
  }
});


const { defineSecret } = require('firebase-functions/params');
const COACH_COLLECTOR_KEY = defineSecret('COACH_COLLECTOR_KEY');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const COACH_ALERT_EMAIL = defineSecret('COACH_ALERT_EMAIL');
const crypto = require('crypto');
function clockMinutes12(v){
  const m=String(v||'').match(/(\d{1,2}):(\d{2})\s*([ap]m)/i);if(!m)return null;
  let h=Number(m[1])%12;if(m[3].toLowerCase()==='pm')h+=12;return h*60+Number(m[2]);
}
function liveDriverKey(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,100)||'unknown';
}
function nameTokens(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]}
function twoNamesMatch(a,b){const A=nameTokens(a),B=nameTokens(b),used=new Set();let n=0;for(const x of A){const i=B.findIndex((y,j)=>y===x&&!used.has(j));if(i>=0){used.add(i);if(++n>=2)return true}}return false}
function htmlEsc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function reasonText(note){
  const n=String(note||'').trim(),q=n.toLowerCase();
  if(/wrong address|incorrect address|direccion incorrecta|dirección incorrecta/.test(q))return{en:'Previous complaint related to delivery to the wrong address. Please verify the address carefully before completing the delivery.',es:'Complaint anterior relacionado con entrega en la dirección incorrecta. Por favor, verifica bien la dirección antes de completar la entrega.'};
  if(/neighbor|vecino/.test(q))return{en:"Previous complaint related to delivery to a neighbor. Please make sure the package is left at the customer's address unless the instructions say otherwise.",es:'Complaint anterior relacionado con entrega a un vecino. Por favor, asegúrate de dejar el paquete en la dirección del cliente, salvo que las instrucciones indiquen lo contrario.'};
  if(/instruction|instruccion|instrucción/.test(q))return{en:"Previous complaint related to delivery instructions. Please read and follow the customer's instructions carefully.",es:'Complaint anterior relacionado con las instrucciones de entrega. Por favor, lee y sigue cuidadosamente todas las instrucciones del cliente.'};
  if(/throw|threw|tirar|lanz/.test(q))return{en:'Previous complaint related to how the package was handled. Please place the package carefully and do not throw it.',es:'Complaint anterior relacionado con cómo se manipuló el paquete. Por favor, coloca el paquete con cuidado y no lo tires.'};
  return{en:'Previous complaint: '+n,es:'Complaint anterior: '+n};
}
async function sendComplaintAlert(driverName,station,rows){
  const to=String(COACH_ALERT_EMAIL.value()||'').trim(); if(!to||!rows.length)return false;
  const first=String(driverName||'Driver').trim().split(/\s+/)[0]||'Driver';
  const en=rows.map(x=>{const r=reasonText(x.notes).en;return '<li style="margin:0 0 16px"><b>STOP '+x.stop+' – '+htmlEsc(x.address)+'</b><br><span>'+htmlEsc(r)+'</span></li>'}).join('');
  const es=rows.map(x=>{const r=reasonText(x.notes).es;return '<li style="margin:0 0 16px"><b>STOP '+x.stop+' – '+htmlEsc(x.address)+'</b><br><span>'+htmlEsc(r)+'</span></li>'}).join('');
  const html='<div style="font-family:Arial,sans-serif;max-width:680px;color:#0f172a;line-height:1.5"><h2 style="color:#087ee5">COACH · Complaint Alert</h2><h3>English</h3><p>Hello '+htmlEsc(first)+', just a heads-up about '+(rows.length===1?'this stop':'these stops')+'. These customers have submitted complaints before. <b>This does NOT mean the complaints were against you</b>; they may have been related to deliveries by other drivers. Please take special care at these locations:</p><ul>'+en+'</ul><p>Thank you!</p><hr style="border:0;border-top:1px solid #dbe8f2;margin:24px 0"><h3>Español</h3><p>Hola '+htmlEsc(first)+', solo para avisarte sobre '+(rows.length===1?'esta parada':'estas paradas')+'. Estos clientes han puesto complaints anteriormente. <b>Esto NO significa que los complaints hayan sido contra ti</b>; pudieron haber sido por entregas de otros drivers. Por favor, ten especial cuidado en estas ubicaciones:</p><ul>'+es+'</ul><p>¡Gracias!</p></div>';
  const rr=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+RESEND_API_KEY.value(),'Content-Type':'application/json'},body:JSON.stringify({from:'COACH <notifications@aaxiclosing.com>',to:[to],subject:'COACH alert · '+first+' · '+station,html})});
  if(!rr.ok)throw new Error('resend-'+rr.status+': '+await rr.text()); return true;
}
async function processComplaintProgress(station,day,liveRows){
  const [routeSnap,complaintSnap]=await Promise.all([db.collection('routes').where('dateKey','==',day).get(),db.collection('complaints').get()]);
  const routes=routeSnap.docs.map(x=>({id:x.id,...x.data()})), complaints=new Map(complaintSnap.docs.map(x=>[String(x.data().normalizedAddress||''),{id:x.id,...x.data()}]));
  for(const live of liveRows){
    if(live.isRescue||Number(live.routeCount||0)>1)continue;
    const route=routes.find(x=>String(x.routeCode||'').toUpperCase()===String(live.route||'').toUpperCase()&&(!x.station||x.station===station)&&twoNamesMatch(x.driverName,live.name));
    if(!route)continue;
    const done=Math.max(0,Number(live.done)||0), alerts=[];
    for(const stop of (route.stops||[])){
      const c=complaints.get(String(stop.normalizedAddress||'')); if(!c)continue;
      const n=Number(stop.stop); if(!Number.isFinite(n))continue;
      const key=[day,route.driverId,n,stop.normalizedAddress].join('|');
      if(n<=done){
        const id=crypto.createHash('sha1').update(key).digest('hex');
        await db.doc('doneStops/'+id).set({key,dateKey:day,driverId:route.driverId,driverName:route.driverName,stop:n,normalizedAddress:stop.normalizedAddress,completedAt:admin.firestore.FieldValue.serverTimestamp(),source:'live-auto'},{merge:true});
        continue;
      }
      if(n-done<=5){
        const alertId=crypto.createHash('sha1').update([day,station,route.driverId,n,stop.normalizedAddress].join('|')).digest('hex'),ref=db.doc('complaintAlerts/'+alertId),snap=await ref.get();
        if(!snap.exists)alerts.push({ref,stop:n,address:stop.address,notes:c.notes||'',normalizedAddress:stop.normalizedAddress});
      }
    }
    if(alerts.length){
      await sendComplaintAlert(route.driverName||live.name,station,alerts);
      const b=db.batch(); for(const a of alerts)b.set(a.ref,{day,dateKey:day,station,driverId:route.driverId,driverName:route.driverName,route:live.route,stop:a.stop,address:a.address,normalizedAddress:a.normalizedAddress,sentAt:admin.firestore.FieldValue.serverTimestamp()}); await b.commit();
    }
  }
}
function easternDay(v){
  const d=new Date(v);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return o.year+'-'+o.month+'-'+o.day;
}

exports.liveIngest = onRequest({secrets:[COACH_COLLECTOR_KEY,RESEND_API_KEY,COACH_ALERT_EMAIL]}, async (req,res)=>{
  cors(res); if(req.method==='OPTIONS')return res.status(204).send('');
  if(req.method!=='POST')return res.status(405).json({error:'method-not-allowed'});
  try{
    if((req.get('X-COACH-Collector-Key')||'')!==COACH_COLLECTOR_KEY.value())return res.status(401).json({error:'invalid-collector-key'});
    const station=String(req.body?.station||''); if(!['DJX3','DJX4'].includes(station))return res.status(400).json({error:'invalid-station'});
    const capturedAt=String(req.body?.capturedAt||new Date().toISOString()), drivers=Array.isArray(req.body?.drivers)?req.body.drivers.slice(0,300):[];
    const day=easternDay(capturedAt), capturedMs=Date.parse(capturedAt)||Date.now(), batch=db.batch(), completed=[];
    for(const r of drivers){
      const routes=(Array.isArray(r.routes)?r.routes:[r.route]).map(x=>String(x||'').toUpperCase()).filter(x=>/^CX\d+$/.test(x));
      if(!routes.length)continue;
      const route=routes[0],isRescue=routes.length>1,name=String(r.name||'').slice(0,120),driverKey=liveDriverKey(name),done=Math.max(0,Number(r.done)||0),total=Math.max(0,Number(r.total)||0),historyId=station+'_'+day+'_'+driverKey;
      const lastDelivery=String(r.lastDelivery||'').slice(0,30)||null,lastDeliveryMinutes=clockMinutes12(lastDelivery);
      const clean={station,day,route,routes,routeCount:routes.length,isRescue,name,driverKey,historyId,done,total,amazonAvg:Number(r.amazonAvg)||null,recentPace:Number(r.recentPace)||null,lastDelivery,amazonProjectedRTS:String(r.amazonProjectedRTS||'').slice(0,30)||null,deliveredPackages:Number.isFinite(Number(r.deliveredPackages))?Math.max(0,Number(r.deliveredPackages)):null,totalPackages:Number.isFinite(Number(r.totalPackages))?Math.max(0,Number(r.totalPackages)):null,capturedAt,capturedMs,updatedAt:admin.firestore.FieldValue.serverTimestamp()};
      if(isRescue){
        batch.set(db.doc('liveRescues/'+station+'_'+driverKey),clean,{merge:true});
        batch.set(db.doc('liveRoutes/'+station+'_RESCUE_'+driverKey),clean,{merge:true});
        // If this person was seen earlier today as a normal single-CX route, remove that day's
        // performance record so a rescue day can never contaminate the driver's delivery-speed history.
        batch.delete(db.doc('driverRouteHistory/'+historyId));
      }else{
        batch.set(db.doc('liveRoutes/'+station+'_'+route),clean,{merge:true});
        const snapId=station+'_'+day+'_'+route+'_'+capturedMs;
        batch.set(db.doc('liveSnapshots/'+snapId),clean);
      }
      const hist={station,day,dateKey:day,route,driverName:name,driverKey,totalStops:total,liveDone:done,lastSeenAt:capturedAt,lastSeenMs:capturedMs,amazonAvg:clean.amazonAvg,recentPace:clean.recentPace,amazonProjectedRTS:clean.amazonProjectedRTS,updatedAt:admin.firestore.FieldValue.serverTimestamp()};
      // Preserve the minute-by-minute progress we actually saw. These compact samples let COACH
      // learn each driver's speed by time of day instead of reducing a whole route to one average.
      // arrayUnion is idempotent for an identical sample and keeps the history attached to that route/day.
      hist.paceSamples=admin.firestore.FieldValue.arrayUnion({ms:capturedMs,done,total,packages:Number.isFinite(Number(clean.deliveredPackages))?Number(clean.deliveredPackages):null,totalPackages:Number.isFinite(Number(clean.totalPackages))?Number(clean.totalPackages):null});
      if(Number.isFinite(lastDeliveryMinutes)){
        hist.lastDelivery=lastDelivery;hist.lastDeliveryMinutes=lastDeliveryMinutes;hist.doneAtLastDelivery=done;hist.totalAtLastDelivery=total;hist.lastDeliveryCapturedMs=capturedMs;
      }
      if(!isRescue){
        batch.set(db.doc('driverRouteHistory/'+historyId),hist,{merge:true});
        if(total>0&&done>=total)completed.push({historyId,capturedMs,capturedAt,lastDelivery,lastDeliveryMinutes,done,total});
      }
    }
    await batch.commit();
    try{await processComplaintProgress(station,day,drivers.map(r=>{const routes=(Array.isArray(r.routes)?r.routes:[r.route]).map(x=>String(x||'').toUpperCase()).filter(x=>/^CX\d+$/.test(x));return{...r,route:routes[0]||'',routeCount:routes.length,isRescue:routes.length>1}}))}catch(alertErr){console.error('complaint-progress',alertErr)}
    for(const x of completed){
      const ref=db.doc('driverRouteHistory/'+x.historyId);
      await db.runTransaction(async tx=>{
        const s=await tx.get(ref),d=s.exists?s.data():{};
        if(!d.finishedAtMs){
          const finalDone=Number.isFinite(Number(d.doneAtLastDelivery))?Number(d.doneAtLastDelivery):x.done;
          const finalTotal=Number.isFinite(Number(d.totalAtLastDelivery))?Number(d.totalAtLastDelivery):x.total;
          tx.set(ref,{completed:true,finishedAtMs:x.capturedMs,finishedAt:x.capturedAt,performanceEndSource:d.lastDelivery?'last-delivery':'completion-detected',performanceEndAt:d.lastDelivery||x.capturedAt,performanceEndMinutes:Number.isFinite(Number(d.lastDeliveryMinutes))?Number(d.lastDeliveryMinutes):null,performanceDone:finalDone,performanceTotal:finalTotal,returnedOrUnfinishedStops:Math.max(0,finalTotal-finalDone),updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
        }
      });
    }
    return res.json({ok:true,station,count:drivers.length});
  }catch(err){console.error(err);return res.status(500).json({error:'server-error'})}
});
