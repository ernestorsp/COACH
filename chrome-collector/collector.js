const INGEST='https://us-east1-coachaaxi.cloudfunctions.net/liveIngest';
function station(){const id=new URL(location.href).searchParams.get('serviceAreaId');if(id==='c599503f-5de9-4035-8532-125fcbc09b03')return'DJX3';if(id==='fbf527d0-7ba7-4768-b452-ef8522843889')return'DJX4';return'UNKNOWN'}
function scan(){
 const text=document.body.innerText,lines=text.split('\n').map(x=>x.trim()).filter(Boolean),rows=[];
 for(let i=0;i<lines.length;i++){
   if(!/^CX\d+/i.test(lines[i]))continue;
   const routeLine=lines[i],routes=(routeLine.match(/CX\d+/gi)||[]).map(x=>x.toUpperCase()),block=lines.slice(i,Math.min(lines.length,i+22)),before=lines.slice(Math.max(0,i-7),i);
   const stopLine=block.find(x=>/\b\d+\s*\/\s*\d+\s+stops\b/i.test(x));if(!stopLine)continue;
   const sm=stopLine.match(/(\d+)\s*\/\s*(\d+)\s+stops/i),joined=block.join(' ');
   let name=before.slice().reverse().find(x=>x.length>3&&!/DAs\/DPs|Route|stops|deliveries|Station|Progress/i.test(x)&&!/^\d/.test(x))||'';
   const avg=(joined.match(/Avg:\s*(\d+(?:\.\d+)?)\s*stops\/hour/i)||[])[1],pace=(joined.match(/Pace:\s*(\d+(?:\.\d+)?)\s*stops\/last hour/i)||[])[1],last=(joined.match(/Last:\s*Delivery at\s*([^\s]+)/i)||[])[1],projected=(joined.match(/Projected RTS:\s*([^\s]+)/i)||[])[1],deliveryMatch=joined.match(/(\d+)\s*\/\s*(\d+)\s+deliveries\b/i);
   const isRescue=routes.length>1||/[,…]|\.\.\./.test(routeLine);rows.push({name,route:routes[0],routes,routeCount:routes.length,isRescue,done:+sm[1],total:+sm[2],amazonAvg:avg?+avg:null,recentPace:pace?+pace:null,lastDelivery:last||null,amazonProjectedRTS:projected||null,deliveredPackages:deliveryMatch?+deliveryMatch[1]:null,totalPackages:deliveryMatch?+deliveryMatch[2]:null});
 }
 return{station:station(),url:location.href,capturedAt:new Date().toISOString(),drivers:rows}
}
async function sendNow(){const data=scan(),h=new Date().getHours();if(data.station==='UNKNOWN'||h<10||h>=23||!data.drivers.length)return{...data,sent:false};return await new Promise(resolve=>chrome.runtime.sendMessage({type:'COACH_INGEST',data},r=>{if(chrome.runtime.lastError)resolve({...data,sent:false,error:chrome.runtime.lastError.message});else resolve({...data,...r})}))}
chrome.runtime.onMessage.addListener((m,s,send)=>{if(m?.type==='COACH_SCAN'){sendNow().then(r=>send(r)).catch(e=>send({sent:false,error:String(e?.message||e)}));return true}});
setInterval(()=>sendNow().catch(()=>{}),60000);setTimeout(()=>sendNow().catch(()=>{}),5000);
