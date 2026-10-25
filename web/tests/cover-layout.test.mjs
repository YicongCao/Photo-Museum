import test from 'node:test';import assert from 'node:assert/strict';import {coverLayout,coverPose,coverStyles} from '../src/cover-layout.js';
test('cover size has no abrupt width breakpoint and bounded residency',()=>{for(const style of Object.keys(coverStyles)){let last;for(let w=320;w<=3440;w++){const l=coverLayout(w,822,400,20,style);assert.ok(l.count>=5&&l.count<=20);assert.ok(Number.isFinite(l.cover)&&l.cover>=110&&l.cover<=945);if(last)assert.ok(Math.abs(l.cover-last)<3,`${style}@${w}`);last=l.cover}}});
test('every style settles its main cover upright and preserves finite poses',()=>{for(const style of Object.keys(coverStyles)){const l=coverLayout(1440,822,200,5,style);assert.equal(Math.abs(coverPose(0,l,style).angle),0);for(let d=-10;d<=10;d+=.1){const p=coverPose(d,l,style);for(const v of Object.values(p))assert.ok(Number.isFinite(v));assert.ok(p.scale>0)}}});
test('short and compact viewport rail reflows do not jump the main cover size',()=>{
 for(const viewportHeight of [390,480,540,541,548,600,720,900])for(const style of Object.keys(coverStyles)){
  let before;
  for(let width=320;width<=3440;width++){
   const layout=coverLayout(width,viewportHeight-(width<=700?68:78),400,20,style);
   if(before)assert.ok(Math.abs(layout.cover-before.cover)<3,`${style} ${width}×${viewportHeight}: ${before.cover}→${layout.cover}`);
   before=layout;
  }
 }
});
test('height reflows stay continuous and horizontal timeline clears the main cover',()=>{
 for(const width of [320,390,700,701,844,1100,1101,1280])for(const style of Object.keys(coverStyles)){
  let before;
  for(let height=390;height<=900;height++){
   const nav=width<=700?68:78,layout=coverLayout(width,height-nav,400,20,style);
   if(before)assert.ok(Math.abs(layout.cover-before.cover)<5,`${style} ${width}×${height}`);
   if(width>=701&&width<=1100&&height>=541){
    const mainBottom=nav+layout.top+layout.cover/layout.ratio;
    assert.ok(mainBottom<=height-246,`${style} ${width}×${height}: cover ${mainBottom}, timeline ${height-246}`);
   }
   before=layout;
  }
 }
});
test('depth cover shares the centered phone title axis without clipping',()=>{
 for(let width=320;width<=700;width++){
  const layout=coverLayout(width,720-68,200,5,'depth'),pose=coverPose(0,layout,'depth');
  assert.equal(pose.origin,50);assert.ok(width*pose.origin/100-layout.cover/2>=0);
 }
});
