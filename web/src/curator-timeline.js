// Event IDs are the persisted server order, including after SSE replay/reconnect.
// Merge only adjacent text of the same kind; never merge across a tool or round.
export function curatorTimeline(events){
 const rows=[],seen=new Set(),pending=new Map();let round=null,previous=null;
 for(const e of [...events].sort((a,b)=>a.id-b.id)){
  if(seen.has(e.id))continue;seen.add(e.id);
  const data=e.data || {};
  if(e.kind==='usage')continue;
  if(e.kind==='thinking'||e.kind==='answer'){
   if(!data.text)continue;
   if(previous?.kind===e.kind)previous.text+=data.text;
   else{previous={id:e.id,kind:e.kind,text:data.text,created:e.created,round};rows.push(previous)}
   continue;
  }
  previous=null;
  if(e.kind==='tool_start'){
   const row={id:e.id,kind:'tool',...data,created:e.created,round,ended:false};
   rows.push(row);pending.set(data.call_id,row);
  }else if(e.kind==='tool_end'){
   // Reused provider call IDs in later rounds are separate invocations.
   const row=pending.get(data.call_id);
   if(row){Object.assign(row,data,{ended:true});pending.delete(data.call_id)}
   else rows.push({id:e.id,kind:'tool',...data,created:e.created,round,ended:true});
  }else if(e.kind==='phase'){
   if(data.round)round=data.round;
   rows.push({id:e.id,kind:'phase',...data,created:e.created,round});
  }else if(e.kind==='done')rows.push({id:e.id,kind:'done',...data,created:e.created});
 }
 return rows;
}

export function curatorWorkState(events,status){
 if(!['queued','running','preparing'].includes(status))return null;
 if(status==='preparing')return {kind:'preparing',label:'准备展厅'};
 const latest=[...events].reverse().find(e=>['thinking','answer','tool_start','tool_end','phase'].includes(e.kind));
 if(latest?.kind==='tool_start')return {kind:'tool',label:'执行工具',name:latest.data.name};
 if(latest?.kind==='answer')return {kind:'answer',label:'模型输出'};
 if(latest?.kind==='thinking')return {kind:'thinking',label:'模型思考'};
 if(latest?.data?.stage==='preparing')return {kind:'preparing',label:'准备展厅'};
 return {kind:'waiting',label:status==='queued'?'等待模型':'等待模型响应'};
}
