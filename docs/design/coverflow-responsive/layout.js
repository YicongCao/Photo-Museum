// Design study only: mirrors the current source geometry; proposal is not production policy.
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function layout(width,height,proposal=true){
 const stageHeight=height-(width>700?78:68);
 if(!proposal){
  const contentWidth=width>700?width-282:width,count=clamp(Math.round((contentWidth+280)/140),5,20),cover=Math.min(contentWidth*.60,stageHeight*.88,width>700?Math.max(120,width-584):Infinity);
  return {cover,count,angle:64,scale:.81,offset:.57,spacing:Math.max(12,(width*.47-cover*.50)/(count/2-1)),rail:width>700?282:0,mode:width>700?'右侧三层时间线':'底部横向时间线',top:Math.max(24,stageHeight*.08)+height-stageHeight,clip:width>700?282:0,caption:height-88};
 }
 const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
 const mix=(a,b,t)=>a+(b-a)*t;
 const interpolate=(points,x)=>{for(let i=1;i<points.length;i++)if(x<=points[i][0])return mix(points[i-1][1],points[i][1],clamp((x-points[i-1][0])/(points[i][0]-points[i-1][0]),0,1));return points.at(-1)[1]};
 const mobile=width<600,compact=width<1250,short=height<600;
 const railFull=clamp(width*.145,184,248),railSpace=railFull*smooth(950,1250,width),rail=compact?0:railFull;
 const edge=width/2-16-railSpace;
 const angle=mix(58,62,smooth(400,1250,width)),scale=mix(.82,.84,smooth(400,1250,width)),offset=mix(.43,.53,smooth(400,950,width));
 const extent=offset+scale*Math.cos(angle*Math.PI/180)/2;
 const reserve=interpolate([[320,16],[390,18],[768,52],[1440,64],[1920,96],[2560,200],[3440,288]],width);
 const heightCap=mix((height-210)*1.3,(height-180)*.93,smooth(480,640,height));
 const cover=Math.max(120,Math.min(width*mix(.68,.48,smooth(400,1250,width)),heightCap,(edge-reserve)/extent,900));
 let count=mobile?5:width<1100?7:width<1500?9:width<2000?11:width<2800?15:19;
 if(short)count=Math.min(count,7);
 // The resident buffer is independent of the number of readable wing layers.
 const sides=interpolate([[320,2],[768,3],[1440,3],[1920,4],[2560,6],[3440,9]],width);
 const firstOuter=cover*extent,strip=mix(18,32,smooth(390,1100,width));
 const spacing=Math.max(strip,(edge-firstOuter)/Math.max(1,sides-1));
 const normalTop=mobile?Math.max(110,(height-90-cover/1.5)*.43):compact?Math.max(100,height*.16):Math.max(100,(height-cover/1.5)*.28);
 const top=Math.min(mix(86,normalTop,smooth(480,640,height)),height-130-cover/1.5);
 return {cover,count,angle,scale,offset,spacing,rail,mode:compact?'折叠年月入口 · 点开三层导航':'右侧三层时间线',top,clip:railSpace?railSpace+16:0,caption:height-88};
}
