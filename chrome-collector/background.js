const INGEST='https://us-east1-coachaaxi.cloudfunctions.net/liveIngest';
chrome.runtime.onMessage.addListener((m,s,send)=>{
 if(m?.type!=='COACH_INGEST')return;
 (async()=>{try{const cfg=await chrome.storage.local.get(['collectorKey']);if(!cfg.collectorKey)return send({sent:false,error:'Collector key not configured'});const r=await fetch(INGEST,{method:'POST',headers:{'Content-Type':'application/json','X-COACH-Collector-Key':cfg.collectorKey},body:JSON.stringify(m.data)});let server='';try{server=await r.text()}catch{}send({sent:r.ok,status:r.status,server})}catch(e){send({sent:false,error:String(e?.message||e)})}})();return true;
});