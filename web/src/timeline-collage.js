// Keep score order; vary only the number of leading photos to limit crop loss.
export function planTimelineCollage(selected, aspect = 318 / 180) {
  const ranked = selected.filter(p => p.kind === 'image_candidate' && p.thumbnail &&
    !p.info?.placeholder && typeof p.score === 'number' && Number.isFinite(p.score))
    .sort((a,b) => b.score-a.score).slice(0,5);
  if (ranked.length < 3) return {photos:ranked, count:ranked.length};
  const slots = {
    3:[aspect*.6,aspect*.8,aspect*.8],
    4:Array(4).fill(aspect),
    5:[aspect*.55,...Array(4).fill(aspect*.45)],
  };
  let count=3, best=Infinity;
  for(let n=3;n<=ranked.length;n++) {
    const loss=ranked.slice(0,n).reduce((sum,p,i)=>{
      const ratio=p.info?.width>0 && p.info?.height>0 ? p.info.width/p.info.height : 1.5;
      return sum + 1-Math.min(ratio/slots[n][i],slots[n][i]/ratio);
    },0)/n + (5-n)*.02;
    if(loss<best){best=loss;count=n;}
  }
  return {photos:ranked.slice(0,count),count};
}
