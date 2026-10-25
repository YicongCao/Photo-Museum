const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
export const coverStyles={classic:'经典镜面',framed:'金框画廊',depth:'纵深展廊',arc:'全景弧幕'};
// Continuous geometry; resident count is a buffer, not a demand to make every wing legible.
export function coverLayout(width,height,total,position,style='classic'){
 // CSS uses viewport height for the short-screen rail; this function receives
 // the stage height below navigation. Blend the space reserves before each
 // rail reflow so a one-pixel resize does not suddenly resize every cover.
 const viewportHeight=height+(width<=700?68:78),stageHeight=viewportHeight-78;
 const shortWeight=(1-smooth(480,540,viewportHeight))*smooth(600,800,width);
 const compact=(1-smooth(1100,1300,width))*(1-shortWeight);
 const rail=Math.max(180*shortWeight,clamp(width*.15,186,246)*smooth(900,1200,width)),ratio=style==='arc'?1.72:1.5;
 const usable=width-2*rail,cover=Math.max(110,Math.min(width*(.66-.16*smooth(550,1400,width)),usable*.78,900,
  Math.max(110,stageHeight-(170+130*compact))*ratio));
 const count=Math.min(total,viewportHeight<=540&&width>=700?7:width<600?5:width<1100?7:width<1500?9:width<2000?11:width<2800?15:20);
 const top=Math.max(18,Math.min(stageHeight*.14,(stageHeight-(110+160*compact)-cover/ratio)*.35));
 const spacing=clamp((usable*.48-cover*.5)/Math.max(1,(count-3)/2),20,100);
 const base={cover,count,ratio,top,rail,spacing,origin:clamp(6+30800/Math.max(1,width),34,50)};
 if(style==='depth')base.cover=Math.min(cover*1.05,usable*.85);
 return base;
}
export function coverPose(d,layout,style='classic'){
 const {cover,spacing}=layout,a=Math.abs(d),s=Math.sign(d),lean=Math.min(1,a);
 if(style==='depth'){
  const ahead=Math.max(0,d),behind=Math.min(0,d);
  return {x: ahead?cover*(.68*(1-Math.exp(-ahead*.65)))+ahead*spacing*.65:behind*cover*.72,
   y:0,scale:d>=0?1/(1+ahead*.27):1+(-d)*.04,angle:d>=0?-Math.min(1,d)*34:Math.min(-d,1)*26,
   light:Math.max(.27,1-a*.11),origin:layout.origin,z:1000-Math.round(a*10)};
 }
 if(style==='arc')return {x:s*(Math.min(a,1)*cover*.82+Math.max(0,a-1)*spacing*1.2),y:-Math.min(a,4)*8,
  scale:Math.max(.60,1-a*.075),angle:s*Math.min(1,a)*25,light:Math.max(.38,1-a*.10),origin:50,z:1000-Math.round(a*10)};
 return {x:s*(lean*cover*.59+Math.max(0,a-1)*spacing),y:0,scale:1-.17*lean-Math.min(Math.max(0,a-1)*.025,.16),
  angle:-s*(60+Math.min(Math.max(a-1,0)*1.2,6))*lean,light:Math.max(.35,1-a*.09),origin:50,z:1000-Math.round(a*10)};
}
