import * as THREE from 'three';
import { ProgressiveMedia, TexturePool, type CatalogAsset, type OpenOptions } from './media';
import './style.css';

type Rect = {x:number;y:number;w:number;h:number};
type Action = Rect & {id:string;label:string;run:()=>void};
type MuseumEvent = {id:string;title:string;date:string;description:string;assetIds:string[]};
type Catalog = {events:MuseumEvent[];assets:CatalogAsset[]};
const host = document.querySelector<HTMLElement>('#museum')!;
const semantics = document.querySelector<HTMLElement>('#semantics')!;
const announcement = document.querySelector<HTMLElement>('#announcement')!;
const paper = '#f2efe6', ink = '#303731', orange = '#bd5737', muted = '#7a8077';
const params = new URLSearchParams(location.search);
let width=innerWidth, height=innerHeight, dpr=Math.min(devicePixelRatio,2);
let mode:'theme'|'wall'='theme', collection=params.get('collection')==='private'?'private':'demo';
let catalog:Catalog={events:[],assets:[]}, eventIndex=0, photoIndex=0, selected:CatalogAsset|null=null;
let epoch=0, busy=false, contextLost=false, statusMessage='', messageUntil=0;
let zoom=1, panX=0, panY=0, showPanel=false, hudVisible=true, lastInput=performance.now();
let reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let fixture:{delayMs:number;fault:NonNullable<OpenOptions['fault']>}={delayMs:0,fault:''};
let actions:Action[]=[], photoTargets:(Rect&{asset:CatalogAsset})[]=[];
let detailRect:Rect={x:0,y:0,w:0,h:0};
let state:any={phase:'idle',tiles:[],generation:0};
let animStart=0,animDuration=0,animSignature='',raf=0,dirty=true,sceneDirty=true;
let detailHasBeenShown=false, returnFocusAction='open-main', pendingFocus='';
let previousFrameAnimated=false;
let frameResolvers:(()=>void)[]=[];
const frameTimes:number[]=[], frameIntervals:number[]=[];
let lastFrame=0, renderedFrames=0, contextRestores=0;
const events:{at:number;type:string;assetId?:string;phase?:string;generation?:number}[]=[];
const log=(type:string)=>{events.push({at:Math.round(performance.now()),type,assetId:selected?.id,phase:state.phase,generation:state.generation});if(events.length>300)events.shift();};
let renderer:THREE.WebGLRenderer;
try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'default'}); }
catch { host.innerHTML='<div class="fallback"><h1>这座展厅需要 WebGL 2</h1><p>当前浏览器未能创建画布。请尝试启用浏览器图形加速，或使用支持 WebGL 2 的浏览器。</p><button onclick="location.reload()">重试进入</button></div>'; throw new Error('WebGL2 unavailable'); }
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NoToneMapping;
renderer.setPixelRatio(dpr);renderer.setSize(width,height);
renderer.domElement.setAttribute('aria-label','照片展厅画布；方向键导航，Enter看图，Escape返回');
renderer.domElement.tabIndex=0;host.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(0,width,0,height,-100,100);camera.position.z=10;
const plane=new THREE.PlaneGeometry(1,1);
const pool=new TexturePool({budgetBytes:128*1024*1024,maxTextureSize:renderer.capabilities.maxTextureSize,prepare:(texture:THREE.Texture)=>renderer.initTexture(texture)});
const thumbHandles=new Map<string,any>();
const thumbPending=new Map<string,AbortController>();
let wantedThumbs=new Set<string>();
let heroPreview:{assetId:string;handle:any}|null=null, heroRequest:{assetId:string;controller:AbortController}|null=null;
function keepHero(asset:CatalogAsset|null){
 if(heroPreview&&heroPreview.assetId!==asset?.id){heroPreview.handle.release();heroPreview=null;}
 if(heroRequest&&heroRequest.assetId!==asset?.id){heroRequest.controller.abort();heroRequest=null;}
 if(!asset||heroPreview||heroRequest||contextLost)return;
 const controller=new AbortController();heroRequest={assetId:asset.id,controller};
 pool.acquire(`${asset.id}:${asset.revision}:preview`,asset.preview,{revision:asset.revision,signal:controller.signal}).then(handle=>{if(controller.signal.aborted||selected||mode!=='theme'){handle.release();return;}heroPreview={assetId:asset.id,handle};invalidate();}).catch(()=>{}).finally(()=>{if(heroRequest?.controller===controller)heroRequest=null;});
}
const hud=document.createElement('canvas');
const ctx=hud.getContext('2d',{alpha:true})!;
const hudTexture=new THREE.CanvasTexture(hud);hudTexture.colorSpace=THREE.SRGBColorSpace;hudTexture.generateMipmaps=false;hudTexture.minFilter=THREE.LinearFilter;
const hudMaterial=new THREE.MeshBasicMaterial({map:hudTexture,transparent:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false});
const hudMesh=new THREE.Mesh(plane,hudMaterial);hudMesh.renderOrder=100;
const photoMaterials:THREE.ShaderMaterial[]=[];let usedPhotoMaterials=0;
const vertexShader=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader=`uniform sampler2D image;uniform vec2 uvScale;uniform vec2 uvOffset;uniform float reveal;uniform vec2 globalOffset;uniform vec2 globalScale;varying vec2 vUv;
float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){vec4 c=texture2D(image,vUv*uvScale+uvOffset);vec2 p=globalOffset+vUv*globalScale;float edge=p.x*.78+(1.-p.y)*.22;float a=reveal>=1.?1.:smoothstep(edge-.13,edge+.13,reveal*1.3-.15+(noise(p*900.)-.5)*.035);gl_FragColor=vec4(c.rgb,c.a*a);
#include <colorspace_fragment>
}`;
function invalidate(rebuild=true){dirty=true;if(rebuild)sceneDirty=true;if(!raf&&!document.hidden&&!contextLost)raf=requestAnimationFrame(frame);}
function note(text:string){statusMessage=text;messageUntil=performance.now()+4000;announcement.textContent=text;invalidate();setTimeout(()=>invalidate(),4100);}
const loader=new ProgressiveMedia({pool,onChange:(next:any)=>{
  state=next;log('media');
  if(next.phase==='detail_ready'&&!detailHasBeenShown){
    detailHasBeenShown=true;
    const signature=`${next.generation}:${next.detail?.key??next.tiles?.map((t:any)=>t.key).join(',')}`;
    if(signature!==animSignature){animSignature=signature;animStart=performance.now();animDuration=reducedMotion||!next.preview?0:520;}
  }
  announcement.textContent=phaseLabel();invalidate();
},onPreviewFrame:()=>new Promise<void>(resolve=>{frameResolvers.push(resolve);invalidate();})});
function currentEvent(){return catalog.events[eventIndex];}
function currentAssets(){const e=currentEvent();return e?e.assetIds.map(id=>catalog.assets.find(a=>a.id===id)!).filter(Boolean):[];}
function keepThumbs(assets:CatalogAsset[]){
  wantedThumbs=new Set(assets.map(a=>a.id));
  for(const [id,controller] of thumbPending)if(!wantedThumbs.has(id)){controller.abort();thumbPending.delete(id);}
  for(const [id,handle] of thumbHandles)if(!wantedThumbs.has(id)){handle.release();thumbHandles.delete(id);}
  const version=epoch;
  for(const asset of assets){if(thumbHandles.has(asset.id)||thumbPending.has(asset.id))continue;
    const controller=new AbortController();thumbPending.set(asset.id,controller);
    pool.acquire(`thumb:${asset.id}:${asset.revision}`,asset.thumbnail,{revision:asset.revision,signal:controller.signal}).then(handle=>{
      if(controller.signal.aborted||version!==epoch||!wantedThumbs.has(asset.id)){handle.release();return;}
      thumbHandles.set(asset.id,handle);invalidate();
    }).catch(e=>{if(e.name!=='AbortError')console.warn('Thumbnail unavailable',asset.id);}).finally(()=>{if(thumbPending.get(asset.id)===controller)thumbPending.delete(asset.id);});
  }
}
function discardScene(){usedPhotoMaterials=0;scene.clear();}
function photo(texture:THREE.Texture|undefined,r:Rect,sourceAspect:number,cover=false,reveal=1,global?:{x:number;y:number;width:number;height:number}){
  if(!texture)return;
  const scale=new THREE.Vector2(1,1),offset=new THREE.Vector2();
  if(cover){const ar=r.w/r.h;if(sourceAspect>ar){scale.x=ar/sourceAspect;offset.x=(1-scale.x)/2;}else{scale.y=sourceAspect/ar;offset.y=(1-scale.y)/2;}}
  const index=usedPhotoMaterials++;
  const mat=photoMaterials[index]??new THREE.ShaderMaterial({uniforms:{image:{value:texture},uvScale:{value:scale},uvOffset:{value:offset},reveal:{value:reveal},globalOffset:{value:new THREE.Vector2(global?.x??0,global?1-global.y-global.height:0)},globalScale:{value:new THREE.Vector2(global?.width??1,global?.height??1)}},vertexShader,fragmentShader,transparent:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false});
  photoMaterials[index]=mat;mat.uniforms.image.value=texture;mat.uniforms.uvScale.value.copy(scale);mat.uniforms.uvOffset.value.copy(offset);mat.uniforms.reveal.value=reveal;mat.uniforms.globalOffset.value.set(global?.x??0,global?1-global.y-global.height:0);mat.uniforms.globalScale.value.set(global?.width??1,global?.height??1);
  const mesh=new THREE.Mesh(plane,mat);mesh.position.set(r.x+r.w/2,r.y+r.h/2,0);mesh.scale.set(r.w,-r.h,1); // screen coordinates use y down; preserve image UV orientation
  mesh.renderOrder=index+1;scene.add(mesh);return mat;
}
function setupHud(){
  const pw=Math.round(width*dpr),ph=Math.round(height*dpr);
  if(hud.width!==pw||hud.height!==ph){hud.width=pw;hud.height=ph;}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  hudMesh.position.set(width/2,height/2,1);hudMesh.scale.set(width,-height,1);
  actions=[];photoTargets=[];
}
function text(value:string,x:number,y:number,size=14,color=ink,font='sans',align:CanvasTextAlign='left'){
 ctx.font=`${font==='bold'?'600 ':''}${size}px ${font==='serif'?'Georgia,"Songti SC",serif':font==='mono'?'ui-monospace,Menlo,monospace':'Arial,"PingFang SC",sans-serif'}`;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillStyle=color;ctx.fillText(value,x,y);
}
function line(x:number,y:number,x2:number,y2:number,color='#d7d8cd'){ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();}
function rounded(r:Rect,fill:string,radius=20){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,radius);ctx.fill();}
function button(id:string,label:string,r:Rect,run:()=>void,opts:{active?:boolean;dark?:boolean;plain?:boolean;small?:boolean}={}){
 actions.push({...r,id,label,run});
 if(!opts.plain)rounded(r,opts.active?(opts.dark?'#eceadd':ink):(opts.dark?'#182820e8':'#e5e4d9'),r.h/2);
 text(label,r.x+r.w/2,r.y+r.h/2+4,opts.small?11:13,opts.active?(opts.dark?ink:paper):(opts.dark?'#e7e7dc':ink),'sans','center');
}
function metaTop(dark=false){const fg=dark?'#e6e6da':ink,sub=dark?'#8c958b':muted;
 text('photo-museum',width<600?20:42,42,width<600?21:25,fg,'serif');
 if(width>800)text('A LIFE IN PICTURES',224,40,9,sub,'mono');
 button('collection',collection==='private'?'本机小样':'演示藏品',{x:width-(width<600?168:246),y:19,w:88,h:34},()=>void setCollection(collection==='demo'?'private':'demo'),{plain:true,dark,small:true});
 button('verify','验证',{x:width-(width<600?78:150),y:19,w:58,h:34},()=>{showPanel=!showPanel;invalidate();},{plain:true,dark,small:true});
 if(width>=600)button('fullscreen','全屏 ↗',{x:width-90,y:19,w:68,h:34},fullscreen,{plain:true,dark,small:true});
}
function footer(dark=false){const w=208,x=(width-w)/2,y=height-64;
 rounded({x:x-6,y:y-6,w:w+12,h:46},dark?'#111c17dd':'#e6e5d9dd',28);
 button('theme','主题展览',{x,y,w:102,h:34},()=>setMode('theme'),{active:mode==='theme',dark});
 button('wall','照片墙',{x:x+106,y,w:102,h:34},()=>setMode('wall'),{active:mode==='wall',dark});
 if(width>800){text('P0.5  /  SDR',160,height-40,10,dark?'#b4b9ad':muted,'mono');text('滚动穿过时光 · 点击进入照片',width-42,height-40,11,dark?'#b4b9ad':muted,'sans','right');}
}
function themeScene(){scene.background=new THREE.Color(paper);const compact=height<560&&width>height;const mobile=width<700&&!compact;const e=currentEvent();const assets=currentAssets();const a=assets[photoIndex%Math.max(1,assets.length)];
 const visible=assets.slice(Math.max(0,photoIndex-2),Math.max(0,photoIndex-2)+(mobile?4:compact?3:6));keepThumbs(a?[a,...visible]:[]);
 keepHero(a??null);metaTop();if(!e||!a){text(busy?'正在打开藏品…':'暂时没有可展示的小样',width/2,height/2,22,ink,'serif','center');return;}
 const heroX=mobile?20:compact?Math.max(235,width*.32):Math.max(300,width*.27),heroW=mobile?width-40:width-heroX-(compact?28:90);
 const heroH=mobile?Math.min(height*.37,heroW*.86):compact?height-155:Math.min(height-330,heroW*.67);
 const heroY=mobile?140:compact?82:Math.max(115,(height-heroH-220)/2);
 const hero={x:heroX,y:heroY,w:heroW,h:heroH};
 // Neutral mat around a fully contained work; thumbnails are intentionally cropped.
 const ar=a.width/a.height;const fitW=Math.min(hero.w,hero.h*ar),fitH=fitW/ar;
 const framed={x:hero.x+(hero.w-fitW)/2,y:hero.y+(hero.h-fitH)/2,w:fitW,h:fitH};
 photo(heroPreview?.assetId===a.id?heroPreview.handle.texture:thumbHandles.get(a.id)?.texture,framed,ar);
 photoTargets.push({...hero,asset:a});actions.push({...hero,id:'open-main',label:'打开当前照片',run:()=>openAsset(a)});
 text(`${String(photoIndex+1).padStart(2,'0')} / ${String(assets.length).padStart(2,'0')}`,hero.x,hero.y-17,11,muted,'mono');
 text('点击，重回这一刻 ↗',hero.x+hero.w,hero.y-17,11,muted,'sans','right');
 const tx=mobile?22:42,ty=mobile?hero.y+hero.h+40:hero.y+70;
 text(`${e.date||'记忆'}   /   展览 ${String(eventIndex+1).padStart(2,'0')}`,tx,mobile?105:ty-40,11,orange,'mono');
 const title=e.title||'在时间里，重逢';
 const pieces=title.length>10?[title.slice(0,Math.ceil(title.length/2)),title.slice(Math.ceil(title.length/2))]:[title];
 pieces.forEach((s,i)=>text(s,tx,ty+i*(mobile?34:46),mobile||compact?28:38,ink,'serif'));
 if(!mobile&&!compact){text('那些走过的地方，',tx,ty+pieces.length*46+18,13,muted);text('在光里，再次相遇。',tx,ty+pieces.length*46+42,13,muted);line(tx,ty+pieces.length*46+75,tx+35,ty+pieces.length*46+75,orange);text(collection==='private'?'你的真实照片 · 本机只读小样':'光与地貌 · 程序生成的演示藏品',tx,ty+pieces.length*46+103,11,muted);}
 const stripY=mobile?height-163:height-184,stripX=mobile?20:compact?42:heroX;
 const tw=mobile?(width-40-18)/4:compact?Math.min(64,(heroX-65)/3):Math.min(110,(heroW-50)/6),th=mobile?62:compact?45:76;
 visible.forEach((asset,i)=>{const r={x:stripX+i*(tw+6),y:stripY,w:tw,h:th};photo(thumbHandles.get(asset.id)?.texture,r,asset.width/asset.height,true);photoTargets.push({...r,asset});actions.push({...r,id:`photo-${i}`,label:`查看${asset.title}`,run:()=>openAsset(asset)});if(asset.id===a.id)line(r.x,r.y+r.h+6,r.x+r.w,r.y+r.h+6,orange);});
 if(!mobile&&!compact)text('同一次相遇',stripX,stripY+th+28,10,muted);
 button('previous-event','↑',{x:mobile?20:42,y:height-67,w:36,h:36},()=>selectEvent(eventIndex-1),{plain:true});
 button('next-event','↓',{x:mobile?58:88,y:height-67,w:36,h:36},()=>selectEvent(eventIndex+1),{plain:true});
 if(!mobile){text(`${String(eventIndex+1).padStart(2,'0')} / ${String(catalog.events.length).padStart(2,'0')}`,42,height-104,11,muted,'mono');
 const rx=width-34,ry=height/2;line(rx,ry-65,rx,ry+65);catalog.events.slice(0,7).forEach((ev,i)=>{ctx.fillStyle=i===eventIndex?orange:'#b8beb0';ctx.beginPath();ctx.arc(rx,ry-55+i*24,i===eventIndex?4:2,0,Math.PI*2);ctx.fill();actions.push({x:rx-14,y:ry-65+i*24,w:28,h:20,id:`event-${i}`,label:`前往${ev.title}`,run:()=>selectEvent(i)});});}
 button('next-photo','→',{x:width-(mobile?56:96),y:height-67,w:36,h:36},()=>nextPhoto(1),{plain:true});footer();
}
let wallOffset=0;
function wallScene(){keepHero(null);scene.background=new THREE.Color('#18241c');const cols=Math.max(3,Math.ceil(width/245)),rows=Math.ceil(height/(width/cols));const cw=width/cols,ch=height/rows;const assets=catalog.assets;
 const visible=Array.from({length:cols*rows},(_,i)=>assets[(i+wallOffset)%Math.max(1,assets.length)]).filter(Boolean);keepThumbs(visible);
 visible.forEach((a,i)=>{const r={x:(i%cols)*cw,y:Math.floor(i/cols)*ch,w:cw-.8,h:ch-.8};photo(thumbHandles.get(a.id)?.texture,r,a.width/a.height,true);photoTargets.push({...r,asset:a});actions.push({...r,id:`wall-${i}`,label:`打开${a.title}`,run:()=>openAsset(a)});});
 if(hudVisible){const gradient=ctx.createLinearGradient(0,0,0,100);gradient.addColorStop(0,'#07150cb0');gradient.addColorStop(1,'#07150c00');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,100);metaTop(true);footer(true);button('shuffle','换一面墙 ↻',{x:20,y:height-119,w:112,h:34},()=>{wallOffset+=7;invalidate();},{dark:true});}
}
function phaseLabel(){
 if(!selected)return collection==='private'?'真实SDR小样':'演示藏品';
 if(state.phase==='source_changed')return '源版本已改变 · 保留4K预览';
 if(state.phase==='detail_unavailable'||state.error)return '细节暂不可用 · 预览仍可查看';
 if(state.phase==='detail_ready')return performance.now()<animStart+animDuration?'暗房显影中':selected.detail.kind==='tiles'?(collection==='private'?'原图细节 · SDR兼容分块':'原图细节 · 按需分块'):(collection==='private'?'原图兼容显示':'原图 · SDR');
 if(state.phase==='source_loading')return fixture.delayMs?'4K已就绪 · 慢速读取演示':'4K已就绪 · 取回原始成片';
 if(state.phase==='detail_preparing'||state.phase==='source_received')return '4K已就绪 · 准备细节';
 if(state.preview)return '4K预览';
 return '正在准备4K预览';
}
function getFit(){const a=selected!;const margin=width<700?12:60;const availableW=width-margin*2,availableH=height-(width<700?182:190);const f=Math.min(availableW/a.width,availableH/a.height);return {w:a.width*f,h:a.height*f};}
function clampPan(){if(!selected)return;const fit=getFit();panX=Math.max(-Math.max(0,(fit.w*zoom-width+24)/2),Math.min(Math.max(0,(fit.w*zoom-width+24)/2),panX));panY=Math.max(-Math.max(0,(fit.h*zoom-height+160)/2),Math.min(Math.max(0,(fit.h*zoom-height+160)/2),panY));}
function updateView(){if(!selected)return;const f=getFit();const r={x:(width-f.w*zoom)/2+panX,y:(height-f.h*zoom)/2+panY-8,w:f.w*zoom,h:f.h*zoom};detailRect=r;
 const x=Math.max(0,-r.x/r.w),y=Math.max(0,-r.y/r.h),vw=Math.min(1,(width-r.x)/r.w)-x,vh=Math.min(1,(height-r.y)/r.h)-y;
 loader.setView({x,y,width:Math.max(.001,vw),height:Math.max(.001,vh),pixelWidth:Math.min(width,r.w)*dpr,pixelHeight:Math.min(height,r.h)*dpr});
}
function detailScene(){keepHero(null);scene.background=new THREE.Color('#121a16');if(!selected)return;
 keepThumbs(state.preview||state.detail?[]:[selected]);const r=detailRect;const base=state.preview?.texture??thumbHandles.get(selected.id)?.texture;
 photo(base,r,selected.width/selected.height);
 const reveal=animDuration===0?1:Math.min(1,Math.max(0,(performance.now()-animStart)/animDuration));
 if(state.detail)photo(state.detail.texture,r,selected.width/selected.height,false,reveal);
 for(const tile of state.phase==='detail_ready'||detailHasBeenShown?(state.tiles??[]):[]){photo(tile.texture,{x:r.x+tile.x*r.w,y:r.y+tile.y*r.h,w:tile.width*r.w,h:tile.height*r.h},tile.width*r.w/(tile.height*r.h),false,reveal,tile);}
 if(hudVisible||showPanel){
 const grad=ctx.createLinearGradient(0,0,0,112);grad.addColorStop(0,'#121a16e8');grad.addColorStop(1,'#121a1600');ctx.fillStyle=grad;ctx.fillRect(0,0,width,112);
 const bottom=ctx.createLinearGradient(0,height-150,0,height);bottom.addColorStop(0,'#121a1600');bottom.addColorStop(1,'#121a16f5');ctx.fillStyle=bottom;ctx.fillRect(0,height-150,width,150);
 button('close','← 返回展厅',{x:width<700?14:34,y:20,w:112,h:36},closeDetail,{dark:true,plain:true});
 text(selected.title,width/2,43,width<700?12:14,'#dfe3d7','sans','center');
 button('verify','验证',{x:width-78,y:20,w:58,h:34},()=>{showPanel=!showPanel;invalidate();},{dark:true,plain:true,small:true});
 text(phaseLabel(),width<700?20:42,height-91,width<700?12:14,'#dadfd3');
 text(`${selected.width.toLocaleString()} × ${selected.height.toLocaleString()}  ·  ${Math.round(zoom*100)}%${collection==='private'?'  ·  SDR兼容图':'  ·  演示藏品'}`,width<700?20:42,height-66,10,'#8d9b8d','mono');
 button('previous-photo','←',{x:width/2-84,y:height-48,w:38,h:32},()=>nextPhoto(-1),{dark:true,plain:true});
 button('fit',zoom===1?'放大细看':'适合画面',{x:width/2-42,y:height-48,w:84,h:32},()=>zoomTo(zoom===1?3:1),{dark:true,plain:true});
 button('next-photo','→',{x:width/2+46,y:height-48,w:38,h:32},()=>nextPhoto(1),{dark:true,plain:true});
 if(state.error||state.phase==='source_changed')button('retry','重新读取',{x:width-116,y:height-99,w:96,h:32},()=>openAsset(selected!),{dark:true});
 if(width>700)text('滚轮缩放 · 拖动探索 · Esc返回',width-42,height-67,11,'#8d9b8d','sans','right');
 }
}
function verificationPanel(){if(!showPanel)return;const w=Math.min(330,width-28),x=width-w-14,y=70;rounded({x,y,w,h:385},'#1a2926f5',12);
 text('验证台',x+20,y+31,17,'#f0f0e4');text('仅影响本次原型中的读取',x+20,y+53,11,'#a4b5a7');
 const choices:[string,NonNullable<OpenOptions['fault']>,number][]=[['正常读取','',0],['慢速读取 · 2秒','',2000],['读取失败','offline',0],['解码失败','decode',0],['源版本改变','changed',0]];
 choices.forEach(([label,fault,delayMs],i)=>button(`fault-${i}`,label,{x:x+16,y:y+68+i*36,w:w-32,h:30},()=>{fixture={fault,delayMs};if(selected)openAsset(selected);invalidate();},{active:fixture.fault===fault&&fixture.delayMs===delayMs,dark:true,small:true}));
 button('motion',reducedMotion?'减少动态效果：开':'减少动态效果：关',{x:x+16,y:y+260,w:w-32,h:30},()=>{reducedMotion=!reducedMotion;invalidate();},{dark:true,small:true});
 button('full-panel',document.fullscreenElement?'退出系统全屏':'进入系统全屏',{x:x+16,y:y+296,w:w-32,h:30},fullscreen,{dark:true,small:true});
 const stats=pool.stats() as any;text(`纹理估算 ${((stats.bytes??0)/1048576).toFixed(1)} MiB / 128 MiB`,x+20,y+350,10,'#a4b5a7','mono');text('原型数据 · 本机访问 · sRGB SDR',x+20,y+370,10,'#a4b5a7');
}
function syncSemantics(){
 const oldFocus=(document.activeElement as HTMLElement)?.dataset.action;
 const ids=actions.map(a=>a.id).join('|');
 if(semantics.dataset.ids!==ids){semantics.replaceChildren();for(const a of actions){const b=document.createElement('button');b.dataset.action=a.id;b.setAttribute('aria-label',a.label);b.addEventListener('click',()=>actions.find(v=>v.id===b.dataset.action)?.run());b.addEventListener('focus',()=>{hudVisible=true;invalidate();});semantics.appendChild(b);}semantics.dataset.ids=ids;if(oldFocus)semantics.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(oldFocus)}"]`)?.focus({preventScroll:true});}
 if(pendingFocus){const b=semantics.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(pendingFocus)}"]`);if(b){pendingFocus='';b.focus({preventScroll:true});}}
 for(const a of actions){const b=semantics.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(a.id)}"]`);if(b){b.style.left=`${a.x}px`;b.style.top=`${a.y}px`;b.style.width=`${a.w}px`;b.style.height=`${a.h}px`;b.setAttribute('aria-label',a.label);}}
}
function rebuild(){discardScene();setupHud();if(selected)detailScene();else if(mode==='wall')wallScene();else themeScene();verificationPanel();
 if(statusMessage&&performance.now()<messageUntil){const w=Math.min(width-32,420);rounded({x:(width-w)/2,y:height-215,w,h:42},'#24372fe8',6);text(statusMessage,width/2,height-189,12,'#f0f0e3','sans','center');}
 for(let i=usedPhotoMaterials;i<photoMaterials.length;i++)photoMaterials[i].uniforms.image.value=null;
 hudTexture.needsUpdate=true;scene.add(hudMesh);syncSemantics();sceneDirty=false;
}
function frame(now:number){raf=0;if(contextLost||document.hidden)return;const start=performance.now();
 if(sceneDirty)rebuild();
 const animation=!!selected&&animDuration>0&&now<animStart+animDuration;
 if(animation){const value=Math.min(1,Math.max(0,(now-animStart)/animDuration));for(let i=1;i<usedPhotoMaterials;i++)photoMaterials[i].uniforms.reveal.value=value;}
 renderer.render(scene,camera);renderedFrames++;frameTimes.push(performance.now()-start);if(frameTimes.length>600)frameTimes.shift();if(lastFrame&&previousFrameAnimated&&animation){frameIntervals.push(now-lastFrame);if(frameIntervals.length>600)frameIntervals.shift();}lastFrame=now;previousFrameAnimated=animation;
 const resolvers=frameResolvers;frameResolvers=[];resolvers.forEach(r=>r());dirty=false;
 if(animation){raf=requestAnimationFrame(frame);}else if(selected&&state.phase==='detail_ready'&&animDuration>0){animDuration=0;announcement.textContent=phaseLabel();invalidate();}
}
async function loadCatalog(){busy=true;const generation=++epoch;closeDetail();keepHero(null);keepThumbs([]);pool.clearUnused();invalidate();try{const res=await fetch(`/api/catalog?collection=${collection}`);if(!res.ok)throw new Error('Catalog unavailable');const next=await res.json();if(generation!==epoch)return;catalog=next;eventIndex=0;photoIndex=0;wallOffset=0;(window as any).__museum.catalog=catalog;}catch{catalog={events:[],assets:[]};note('这一组小样尚未准备好');}finally{busy=false;invalidate();}}
async function setCollection(value:string){collection=value==='private'?'private':'demo';showPanel=false;await loadCatalog();}
function openAsset(a:CatalogAsset){if(!selected){returnFocusAction=(document.activeElement as HTMLElement)?.dataset.action||'open-main';pendingFocus='close';}selected=a;detailHasBeenShown=false;zoom=1;panX=panY=0;showPanel=false;hudVisible=true;lastInput=performance.now();animDuration=0;animSignature='';
 const e=catalog.events.findIndex(e=>e.assetIds.includes(a.id));if(e>=0){eventIndex=e;photoIndex=currentAssets().findIndex(x=>x.id===a.id);}
 log('open');if(contextLost||document.hidden){state={phase:'preview_loading',tiles:[],generation:state.generation+1};return;}void loader.open(a,{delayMs:fixture.delayMs,fault:fixture.fault||undefined});updateView();invalidate();}
function closeDetail(){if(selected)pendingFocus=returnFocusAction;selected=null;detailHasBeenShown=false;loader.close();state={phase:'idle',tiles:[],generation:state.generation};animDuration=0;zoom=1;panX=panY=0;frameResolvers.splice(0).forEach(r=>r());showPanel=false;hudVisible=true;log('close');invalidate();}
function setMode(next:'theme'|'wall'){if(selected)closeDetail();mode=next;showPanel=false;hudVisible=true;lastInput=performance.now();log('mode');invalidate();}
function selectEvent(index:number){if(!catalog.events.length)return;eventIndex=(index+catalog.events.length)%catalog.events.length;photoIndex=0;if(selected)openAsset(currentAssets()[0]);invalidate();}
function nextPhoto(direction=1){const assets=currentAssets();if(!assets.length)return;photoIndex=(photoIndex+direction+assets.length)%assets.length;if(selected)openAsset(assets[photoIndex]);else invalidate();}
function zoomTo(value:number){if(!selected)return;zoom=Math.min(12,Math.max(1,value));clampPan();updateView();invalidate();}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else throw new Error('Unsupported');}catch{note('系统全屏不可用，已保持视口全屏');}invalidate();}
function wake(){lastInput=performance.now();if(!hudVisible){hudVisible=true;invalidate();}}
renderer.domElement.addEventListener('click',(e)=>{wake();if(gestureWokeHud){gestureWokeHud=false;return;}if(dragMoved)return;const x=e.clientX,y=e.clientY;const a=[...actions].reverse().find(a=>x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h);if(a){a.run();return;}if(selected){hudVisible=!hudVisible;invalidate();}});
let gestureWokeHud=false;let dragMoved=false,dragStart={x:0,y:0},lastPointer={x:0,y:0};const pointers=new Map<number,{x:number;y:number}>();let pinchDistance=0;
renderer.domElement.addEventListener('pointerdown',e=>{gestureWokeHud=!hudVisible;wake();dragMoved=false;dragStart=lastPointer={x:e.clientX,y:e.clientY};pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});renderer.domElement.setPointerCapture(e.pointerId);if(pointers.size===2){const[a,b]=[...pointers.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);}});
renderer.domElement.addEventListener('pointermove',e=>{wake();if(!pointers.has(e.pointerId))return;const dx=e.clientX-lastPointer.x,dy=e.clientY-lastPointer.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(Math.hypot(e.clientX-dragStart.x,e.clientY-dragStart.y)>7)dragMoved=true;
 if(selected&&pointers.size===2){const[a,b]=[...pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance)zoomTo(zoom*distance/pinchDistance);pinchDistance=distance;dragMoved=true;}
 else if(selected&&zoom>1){panX+=dx;panY+=dy;clampPan();updateView();invalidate();}lastPointer={x:e.clientX,y:e.clientY};});
function pointerEnd(e:PointerEvent){const dx=e.clientX-dragStart.x,dy=e.clientY-dragStart.y;if(!selected&&dragMoved&&pointers.size===1){if(Math.max(Math.abs(dx),Math.abs(dy))>45){if(mode==='wall'){wallOffset+=dx<0?3:1;invalidate();}else if(Math.abs(dx)>Math.abs(dy))nextPhoto(dx<0?1:-1);else selectEvent(eventIndex+(dy<0?1:-1));}}pointers.delete(e.pointerId);pinchDistance=0;if(pointers.size===1)lastPointer=[...pointers.values()][0];}
renderer.domElement.addEventListener('pointerup',pointerEnd);renderer.domElement.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);pinchDistance=0;if(pointers.size===1)lastPointer=[...pointers.values()][0];});
let wheelAt=0;
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();wake();if(selected){zoomTo(zoom*Math.exp(-e.deltaY*.0015));return;}if(performance.now()-wheelAt<300)return;wheelAt=performance.now();if(mode==='wall'){wallOffset+=e.deltaY>0?3:-3;wallOffset=Math.max(0,wallOffset);invalidate();}else if(Math.abs(e.deltaX)>Math.abs(e.deltaY))nextPhoto(e.deltaX>0?1:-1);else selectEvent(eventIndex+(e.deltaY>0?1:-1));},{passive:false});
window.addEventListener('keydown',e=>{wake();if(e.key==='Escape'){if(showPanel){showPanel=false;invalidate();}else if(selected)closeDetail();return;}if((e.target as HTMLElement).tagName==='BUTTON'&&(e.key==='Enter'||e.key===' '))return;
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','+','-','f','F'].includes(e.key))e.preventDefault();
 if(e.key==='ArrowLeft')nextPhoto(-1);if(e.key==='ArrowRight')nextPhoto(1);if(e.key==='ArrowUp')selected?zoomTo(zoom*1.25):selectEvent(eventIndex-1);if(e.key==='ArrowDown')selected?zoomTo(zoom/1.25):selectEvent(eventIndex+1);if(e.key==='Enter'&&!selected){const a=currentAssets()[photoIndex];if(a)openAsset(a);}if(e.key==='+'||e.key==='=')zoomTo(zoom*1.5);if(e.key==='-')zoomTo(zoom/1.5);if(e.key.toLowerCase()==='f')void fullscreen();});
window.addEventListener('resize',()=>{width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio,2);renderer.setPixelRatio(dpr);renderer.setSize(width,height);camera.right=width;camera.bottom=height;camera.updateProjectionMatrix();clampPan();if(selected)updateView();invalidate();});
document.addEventListener('fullscreenchange',()=>{log('fullscreen');invalidate();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){loader.close();frameResolvers.splice(0).forEach(r=>r());if(raf)cancelAnimationFrame(raf);raf=0;log('hidden');}else{if(selected){detailHasBeenShown=false;void loader.open(selected,{delayMs:fixture.delayMs,fault:fixture.fault||undefined});updateView();}invalidate();}});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;keepHero(null);loader.close();for(const c of thumbPending.values())c.abort();thumbPending.clear();for(const h of thumbHandles.values())h.release();thumbHandles.clear();pool.clearUnused();frameResolvers.splice(0).forEach(r=>r());if(raf)cancelAnimationFrame(raf);raf=0;announcement.textContent='图形上下文暂时中断，正在等待恢复';log('context-lost');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;contextRestores++;hudTexture.needsUpdate=true;log('context-restored');if(selected){detailHasBeenShown=false;void loader.open(selected,{delayMs:fixture.delayMs,fault:fixture.fault||undefined});updateView();}invalidate();});
setInterval(()=>{if((selected||mode==='wall')&&!showPanel&&hudVisible&&performance.now()-lastInput>6000&&document.activeElement?.tagName!=='BUTTON'){hudVisible=false;invalidate();}},1000);
const p95=(data:number[])=>data.length?[...data].sort((a,b)=>a-b)[Math.floor((data.length-1)*.95)]:0;
function stressCatalog(count=20000){
 if(collection!=='demo')return;closeDetail();const source=catalog.assets.slice(0,13);if(!source.length)return;
 const assets:CatalogAsset[]=[],groups:MuseumEvent[]=[];
 for(let i=0;i<Math.min(20000,Math.max(1,count));i++){const group=Math.floor(i/10);if(!groups[group])groups[group]={id:`virtual-${group}`,title:`时间中的第 ${group+1} 次相遇`,date:String(2000+group%26),description:'模拟元数据压力测试',assetIds:[]};const a={...source[i%source.length],id:`virtual-${i}`,eventId:groups[group].id};assets.push(a);groups[group].assetIds.push(a.id);}
 catalog={events:groups,assets};api.catalog=catalog;eventIndex=0;photoIndex=0;epoch++;keepThumbs([]);invalidate();
}
const api={catalog,stressCatalog,open:(id:string)=>{const a=catalog.assets.find(a=>a.id===id);if(a)openAsset(a);},close:closeDetail,setMode,next:()=>nextPhoto(1),selectEvent,fixture:(value:Partial<typeof fixture>)=>{fixture={...fixture,...value};},zoomTo,setCollection,
 loseContext:()=>renderer.forceContextLoss(),restoreContext:()=>renderer.forceContextRestore(),setReducedMotion:(value:boolean)=>{reducedMotion=value;animDuration=value?0:animDuration;invalidate();},
 snapshot:()=>({mode,collection,assetId:selected?.id??null,phase:state.phase==='detail_ready'?(performance.now()<animStart+animDuration?'developing':'detail_visible'):state.phase,loaderPhase:state.phase,loaderAssetId:state.asset?.id??null,quality:state.quality,error:state.error?String(state.error):null,zoom,generation:state.generation,previewReady:!!state.preview,tileCount:state.tiles?.length??0,photoTextures:pool.stats(),renderer:{textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,calls:renderer.info.render.calls},canvasCount:document.querySelectorAll('canvas').length,frameStats:{renderP95:p95(frameTimes),intervalP95:p95(frameIntervals),samples:frameTimes.length,renderedFrames},detailWidth:state.detailWidth,detailLevel:state.detailLevel,detailRect:{...detailRect,width:detailRect.w,height:detailRect.h},contextLost,contextRestores,reducedMotion,capabilities:{maxTextureSize:renderer.capabilities.maxTextureSize,dpr,webgl2:true,wideGamut:matchMedia('(color-gamut: p3)').matches,hdrDisplay:matchMedia('(dynamic-range: high)').matches,hdrPipeline:false},events,buttons:actions.map(({id,label,x,y,w,h})=>({id,label,x,y,w,h})),pendingThumbnails:thumbPending.size,eventIndex,photoIndex,hudVisible,metaCount:catalog.assets.length})};
(window as any).__museum=api;
void loadCatalog();
