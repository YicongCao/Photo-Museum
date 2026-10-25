const TAU=Math.PI*2;
export function point(radius,angle,cx=464,cy=500){return {x:cx+Math.cos(angle)*radius,y:cy+Math.sin(angle)*radius}}
export function ringSector(inner,outer,start,end,cx=464,cy=500){
 const a=point(outer,start,cx,cy),b=point(outer,end,cx,cy),c=point(inner,end,cx,cy),d=point(inner,start,cx,cy),large=end-start>Math.PI?1:0;
 const path=`M${a.x},${a.y} A${outer},${outer} 0 ${large} 1 ${b.x},${b.y} L${c.x},${c.y} A${inner},${inner} 0 ${large} 0 ${d.x},${d.y} Z`;
 const points=[a,b,c,d];
 for(let angle=Math.ceil(start/(Math.PI/2))*Math.PI/2;angle<=end;angle+=Math.PI/2)points.push(point(outer,angle,cx,cy));
 const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
 return {path,x:minX,y:minY,width:Math.max(...points.map(p=>p.x))-minX,height:Math.max(...points.map(p=>p.y))-minY};
}
export function yearWindow(years,selected,max=5){
 if(years.length<=max)return years;
 const index=Math.max(0,years.findIndex(y=>String(y.year)===String(selected)));
 const start=Math.min(Math.max(0,index-Math.floor(max/2)),years.length-max);
 return years.slice(start,start+max);
}
export function ringPhotos(year,limit=12){
 const entries=[],seen=new Set();
 for(let rank=0;rank<5&&entries.length<limit;rank++)for(const activity of year.activities || []){
  const photo=activity.selected?.[rank];if(!photo||seen.has(photo.id))continue;
  seen.add(photo.id);entries.push({photo,activity});if(entries.length>=limit)break;
 }
 if(!entries.length)for(const photo of year.selected || []){if(!seen.has(photo.id)){seen.add(photo.id);entries.push({photo,activity:null})}}
 return entries.slice(0,limit);
}
export function ringGeometry(years,selected){
 return yearWindow(years,selected).map((year,index,window)=>{
  const thickness=(322-(window.length-1)*9)/window.length,outer=438-index*(thickness+9),inner=outer-thickness,photos=ringPhotos(year);
  const count=Math.max(1,photos.length),angle=TAU/count;
  return {year,inner,outer,photos:photos.map((item,j)=>({...item,...ringSector(inner,outer,-Math.PI/2+j*angle+.012,-Math.PI/2+(j+1)*angle-.012)}))};
 });
}

// Positions are deterministic and bounded. Edges only express group membership.
const clusters=[
 {hub:{x:115,y:345},slots:[[80,60,190,145],[295,105,150,160],[165,420,205,145],[385,440,132,177],[76,615,162,115]]},
 {hub:{x:1110,y:96},slots:[[900,45,178,132],[1150,155,180,142],[1030,326,146,120],[1245,335,126,167],[840,298,150,112]]},
 {hub:{x:1090,y:565},slots:[[1045,625,174,130],[800,600,176,135],[1260,566,124,151],[620,650,150,108],[1230,55,128,90]]},
];
const compactClusters=[
 {hub:{x:22,y:169},slots:[[20,35,112,86],[150,30,100,75],[270,50,102,88]]},
 {hub:{x:260,y:410},slots:[[270,450,112,86],[142,452,100,75],[22,445,103,90]]},
 {hub:{x:20,y:400},slots:[[15,210,82,72],[328,220,80,110],[328,337,80,66]]},
];
export function constellationLayout(groups,selectedId,compact=false){
 if(!groups.length)return {groups:[],nodes:[],edges:[],hero:null};
 const selected=groups.find(g=>g.id===selectedId)||groups[0],ids=new Set((selected.selected||[]).map(p=>p.id));
 const neighbors=groups.filter(g=>g.id!==selected.id).sort((a,b)=>{
  const overlap=g=>(g.selected||[]).filter(p=>ids.has(p.id)).length;
  return overlap(b)-overlap(a)||b.count-a.count||a.id.localeCompare(b.id);
 }).slice(0,2);
 const visible=[selected,...neighbors],hero=selected.selected?.[0] || null,nodes=[],edges=[],placed=new Map();
 if(hero){nodes.push({photo:hero,...(compact?{x:110,y:210,width:208,height:148}:{x:545,y:270,width:310,height:220}),hero:true});placed.set(hero.id,nodes[0])}
 visible.forEach((group,index)=>{
  const cluster=(compact?compactClusters:clusters)[index];let slot=0;
  for(const photo of (group.selected||[]).slice(0,compact?3:5)){
   let node=placed.get(photo.id);
   if(!node){const [x,y,width,height]=cluster.slots[slot++];node={photo,x,y,width,height,hero:false};nodes.push(node);placed.set(photo.id,node)}
   edges.push({group:group.id,photo:photo.id,x1:cluster.hub.x,y1:cluster.hub.y+24,x2:node.x+node.width/2,y2:node.y+node.height/2});
  }
 });
 return {groups:visible.map((g,i)=>({...g,...(compact?compactClusters:clusters)[i].hub})),nodes,edges,hero};
}
