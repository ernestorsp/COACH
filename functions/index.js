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
function clockMinutes12(v){
  const m=String(v||'').match(/(\d{1,2}):(\d{2})\s*([ap]m)/i);if(!m)return null;
  let h=Number(m[1])%12;if(m[3].toLowerCase()==='pm')h+=12;return h*60+Number(m[2]);
}
function liveDriverKey(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,100)||'unknown';
}
function easternDay(v){
  const d=new Date(v);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return o.year+'-'+o.month+'-'+o.day;
}

exports.liveIngest = onRequest({secrets:[COACH_COLLECTOR_KEY]}, async (req,res)=>{
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
      const clean={station,day,route,routes,routeCount:routes.length,isRescue,name,driverKey,historyId,done,total,amazonAvg:Number(r.amazonAvg)||null,recentPace:Number(r.recentPace)||null,lastDelivery,amazonProjectedRTS:String(r.amazonProjectedRTS||'').slice(0,30)||null,capturedAt,capturedMs,updatedAt:admin.firestore.FieldValue.serverTimestamp()};
      if(isRescue){
        batch.set(db.doc('liveRescues/'+station+'_'+driverKey),clean,{merge:true});
        batch.set(db.doc('liveRoutes/'+station+'_RESCUE_'+driverKey),clean,{merge:true});
      }else{
        batch.set(db.doc('liveRoutes/'+station+'_'+route),clean,{merge:true});
        const snapId=station+'_'+day+'_'+route+'_'+capturedMs;
        batch.set(db.doc('liveSnapshots/'+snapId),clean);
      }
      const hist={station,day,dateKey:day,route,driverName:name,driverKey,totalStops:total,liveDone:done,lastSeenAt:capturedAt,lastSeenMs:capturedMs,amazonAvg:clean.amazonAvg,recentPace:clean.recentPace,amazonProjectedRTS:clean.amazonProjectedRTS,updatedAt:admin.firestore.FieldValue.serverTimestamp()};
      if(Number.isFinite(lastDeliveryMinutes)){
        hist.lastDelivery=lastDelivery;hist.lastDeliveryMinutes=lastDeliveryMinutes;hist.doneAtLastDelivery=done;hist.totalAtLastDelivery=total;hist.lastDeliveryCapturedMs=capturedMs;
      }
      if(!isRescue){
        batch.set(db.doc('driverRouteHistory/'+historyId),hist,{merge:true});
        if(total>0&&done>=total)completed.push({historyId,capturedMs,capturedAt,lastDelivery,lastDeliveryMinutes,done,total});
      }
    }
    await batch.commit();
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
