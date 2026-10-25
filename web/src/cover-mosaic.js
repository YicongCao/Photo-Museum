const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
// Layout only: the caller's score-ranked photographs and their order stay intact.
export function planCoverMosaic(selected,coverAspect=1.5){
 const {width,height}=selected[0]?.info || {};
 const observed=Number(width)>0&&Number(height)>0?Number(width)/Number(height):NaN;
 const ratio=Number.isFinite(observed)?observed:1.5;
 const shape=ratio>=2.4?'wide':ratio<.95?'portrait':ratio<1.2?'square':'landscape';
 const aspect=Number.isFinite(coverAspect)&&coverAspect>0?coverAspect:1.5;
 const style={};
 if(shape==='portrait')style['--cover-hero-width']=`${clamp(ratio/aspect,.18,.55)*100}%`;
 else{
  const rows=shape==='wide'?2:shape==='square'?3:2;
  const fraction=shape==='wide'?1:shape==='square'?.5:.6;
  const height=shape==='wide'?clamp(aspect/ratio,.30,.64):shape==='square'?clamp(aspect*fraction/ratio,.56,.84):clamp(aspect*fraction/ratio,.40,.74);
  // Two equally weighted rows follow a wide hero; other templates have one.
  const remainder=shape==='wide'?2:1;
  style['--cover-hero-row']=`${height*remainder/(rows*(1-height))}fr`;
 }
 return {className:`photo-mosaic count-${selected.length} hero-${shape}`,style};
}
