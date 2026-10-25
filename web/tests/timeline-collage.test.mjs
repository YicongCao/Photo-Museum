import test from 'node:test';
import assert from 'node:assert/strict';
import {planTimelineCollage} from '../src/timeline-collage.js';
const photo=(score,ratio=1.5,id=String(score))=>({id,kind:'image_candidate',score,thumbnail:'/thumb/'+id,info:{width:ratio*100,height:100}});
test('Chooses three, four or five leading photos to preserve their composition',()=>{
 for(const [ratios,count] of [[[1.05,1.4,1.4,.5,.5],3],[[1.5,1.5,1.5,1.5,1.5],4],[[1,.75,.75,.75,.75],5]]){
  const p=ratios.map((r,i)=>photo(100-i,r));const plan=planTimelineCollage(p);assert.equal(plan.count,count);assert.deepEqual(plan.photos,p.slice(0,count));
 }
});
test('Uses highest valid photo scores, retains zero, and never promotes a pin or video',()=>{
 const p=[photo(0),photo(30),{...photo(100),kind:'video_candidate'},{...photo(99),info:{placeholder:'oversized'}},{...photo(null),pinned:true},photo(20)];
 assert.deepEqual(planTimelineCollage(p).photos.map(p=>p.score),[30,20,0]);assert.equal(p[0].score,0);
});
test('Does not fabricate photos for small or unscored activities',()=>{
 assert.equal(planTimelineCollage([]).count,0);assert.equal(planTimelineCollage([photo(1),photo(2)]).count,2);assert.equal(planTimelineCollage([photo(NaN),photo(Infinity)]).count,0);
});
