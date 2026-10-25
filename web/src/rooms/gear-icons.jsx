import React from 'react';
// Original schematic drawings: references verify structure, not CAD dimensions.
export const cameraDrawings=[
 {test:/^ILCE-7C(R|M2)$/i,shape:'rangefinder',finder:'electronic',lens:28,grip:true,source:'https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7cr/specifications'},
 {test:/^ILCE-7M3$/i,shape:'prism',lens:30,grip:true,source:'https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7m3/specifications'},
 {test:/^X-T50$/i,shape:'prism',lens:27,dials:3,source:'https://www.fujifilm-x.com/en-us/products/cameras/x-t50/'},
 {test:/^X-S20$/i,shape:'prism',lens:28,grip:true,source:'https://www.fujifilm-x.com/en-us/products/cameras/x-s20/'},
 {test:/^X100VI$/i,shape:'rangefinder',lens:21,dials:2,source:'https://www.fujifilm-x.com/en-us/products/cameras/x100vi/'},
 {test:/^RICOH GR (IV|IIIx HDF|III)$/i,shape:'compact',lens:22,grip:true,source:'https://www.ricoh-imaging.co.jp/english/products/gr-4/spec/'},
 {test:/^Canon EOS 6D Mark II$/i,shape:'prism',lens:30,grip:true,source:'https://www.canon-europe.com/cameras/eos-6d-mark-ii/'},
];
export function drawing(device){
 if(device?.kind==='lens')return {shape:'lens',zoom:/\d\s*[-–]\s*\d/.test(device.model || '')};
 return cameraDrawings.find(d=>d.test.test(device?.model || '')) || {shape:device?.type==='phone'?'phone':device?.type==='software'?'screen':'camera'};
}
export function CameraDrawing({device,decorative=false}) {
 const d=drawing(device),label=(device?.model || '设备')+' · '+(d.source?'结构示意':'类型示意');
 return <svg viewBox="0 0 160 110" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
  role={decorative?undefined:'img'} aria-hidden={decorative || undefined} aria-label={decorative?undefined:label}>
  {d.shape==='phone'?<><rect x="50" y="5" width="60" height="100" rx="9"/><rect x="57" y="12" width="30" height="34" rx="6"/><circle cx="65" cy="21" r="5"/><circle cx="78" cy="35" r="5"/><circle cx="65" cy="36" r="5"/><path d="M73 98h14M112 33v18"/></>:
   d.shape==='screen'?<><rect x="14" y="15" width="132" height="77" rx="3"/><path d="M65 105h30M80 92v13M22 83h116M38 39l16 14-16 14M67 65h37"/></>:
   d.shape==='lens'?<><path d={`M${d.zoom?22:39} 33H120v45H${d.zoom?22:39}zM120 26h12v59h-12M${d.zoom?28:45} 28h10v55H${d.zoom?28:45}z`}/><ellipse cx="132" cy="55.5" rx="11" ry="29.5"/><ellipse cx="132" cy="55.5" rx="6" ry="23"/><path d="M58 34v43M65 34v43M72 34v43M95 34v43M100 34v43M105 34v43"/></>:
   <><path d={d.shape==='prism'?'M10 35h40l12-18h34l13 18h41v62H10z':'M10 35h140v62H10z'}/>
    {d.shape==='rangefinder'&&(d.finder==='electronic'?<path d="M15 35v-8h24v8M20 30h12"/>:<rect x="20" y="42" width="23" height="12"/>)}<path d="M18 62v25M25 65v22M108 46h17M127 46h9M120 88h16"/>
    {d.grip&&<path d="M132 35v16l8 7v39M133 28h10v7"/>}
    {Array.from({length:d.dials || 1},(_,i)=><path key={i} d={`M${20+i*35} 35v-7h22v7M${24+i*35} 25h14`}/>)}
    <circle cx="80" cy="66" r={d.lens || 27}/><circle cx="80" cy="66" r={(d.lens || 27)-6}/><circle cx="80" cy="66" r={(d.lens || 27)-12}/><path d="M53 96h54M16 101h18M126 101h18"/></>}
 </svg>;
}
