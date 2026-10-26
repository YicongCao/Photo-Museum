// Freeze the ordered geometry before exposing a position slider. These are
// metadata pages only: no thumbnail, display or NAS-original fetches here.
export async function completeWallCatalogue(api,endpoint,initial,signal){
 const items=[...initial.items],seen=new Set(items.map(p=>p.id)),total=initial.total;
 if(seen.size!==items.length)throw Error('照片列表已更新，请重新打开');
 while(items.length<total){
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const [path,query='']=endpoint.split('?'),params=new URLSearchParams(query);
  params.set('offset',String(items.length));params.set('limit','200');
  const page=await api(path+'?'+params,'GET',undefined,{signal});
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(page.total!==total||!page.items.length||items.length+page.items.length>total||page.items.some(p=>seen.has(p.id))||new Set(page.items.map(p=>p.id)).size!==page.items.length)throw Error('照片列表已更新，请重新打开');
  page.items.forEach(p=>{seen.add(p.id);items.push(p)});
 }
 return {...initial,items};
}
