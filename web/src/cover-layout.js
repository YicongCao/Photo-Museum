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
 const capped=Math.min(total,viewportHeight<=540&&width>=700?7:width<600?5:width<1100?7:width<1500?9:width<2000?11:width<2800?15:20),count=capped>0&&capped%2===0?capped-1:capped;
 const top=Math.max(18,Math.min(stageHeight*.14,(stageHeight-(110+160*compact)-cover/ratio)*.35));
 const spacing=clamp((usable*.48-cover*.5)/Math.max(1,(count-3)/2),20,100);
 const base={cover,count,ratio,top,rail,spacing,origin:50};
 if(style==='depth')base.cover=Math.min(cover*1.05,usable*.85);
 return base;
}
export function coverPose(d,layout,style='classic'){
 const {cover,spacing}=layout,a=Math.abs(d),s=Math.sign(d),lean=Math.min(1,a);
 if(style==='depth')return {x:s*(cover*.68*(1-Math.exp(-a*.65))+a*spacing*.65),
  y:0,scale:1/(1+a*.27),angle:-s*Math.min(1,a)*34,
  light:Math.max(.27,1-a*.11),origin:50,z:1000-Math.round(a*10)};
 if(style==='arc')return {x:s*(Math.min(a,1)*cover*.82+Math.max(0,a-1)*spacing*1.2),y:-Math.min(a,4)*8,
  scale:Math.max(.60,1-a*.075),angle:s*Math.min(1,a)*25,light:Math.max(.38,1-a*.10),origin:50,z:1000-Math.round(a*10)};
 return {x:s*(lean*cover*.36+Math.max(0,a-1)*spacing),y:0,scale:1-.17*lean-Math.min(Math.max(0,a-1)*.025,.16),
  angle:-s*(60+Math.min(Math.max(a-1,0)*1.2,6))*lean,light:Math.max(.35,1-a*.09),origin:50,z:1000-Math.round(a*10)};
}

export function coverWindow(total,position,count){
 if(!total||!count)return [];
 const center=Math.round(position),half=Math.floor((count-1)/2);
 return Array.from({length:half*2+1},(_,j)=>{const logical=center+j-half;return {index:((logical%total)+total)%total,d:logical-position}});
}
