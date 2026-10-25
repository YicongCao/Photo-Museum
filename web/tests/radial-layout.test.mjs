import test from 'node:test';
import assert from 'node:assert/strict';
import {ringSector,ringGeometry,yearWindow,constellationLayout} from '../src/rooms/radial-layout.js';

const photo=id=>({id,thumbnail:'/cache/'+id,period:'2024',name:id});
test('Annular sectors have finite clipping bounds, including cardinal extrema',()=>{
 for(const start of [-Math.PI*2,-Math.PI,-Math.PI/2,0,Math.PI/2]){
  const sector=ringSector(100,400,start,start+Math.PI*1.5);
  assert.ok([sector.x,sector.y,sector.width,sector.height].every(Number.isFinite));
  assert.ok(sector.width>0&&sector.height>0&&sector.width<=800.001&&sector.height<=800.001);
  assert.ok(!sector.path.includes('NaN'));
 }
});
test('Year window bounds density and keeps selected oldest/newest years present',()=>{
 const years=Array.from({length:80},(_,i)=>({year:2025-i,activities:[{id:'a'+i,selected:Array.from({length:5},(_,j)=>photo(`${i}-${j}`))}]}));
 for(const selected of [2025,2017,1946]){
  const window=yearWindow(years,selected);assert.equal(window.length,5);assert.ok(window.some(y=>y.year===selected));
  const layout=ringGeometry(years,selected);assert.ok(layout.every(r=>r.inner>0&&r.outer<=438&&r.photos.length<=12));
 }
});
test('An empty or undated-only catalog does not fabricate an annual sector',()=>{
 assert.deepEqual(ringGeometry([],null),[]);
 assert.equal(ringGeometry([{year:2024,activities:[],selected:[]}],2024)[0].photos.length,0);
});
test('Star graph is stable, bounded, deduplicates photo nodes, and edges prove membership',()=>{
 const groups=Array.from({length:30},(_,i)=>({id:'g'+i,label:'tag'+i,count:30-i,selected:[photo('shared'),...Array.from({length:4},(_,j)=>photo(`${i}-${j}`))]}));
 const layout=constellationLayout(groups,'g14');
 assert.equal(layout.groups[0].id,'g14');assert.equal(layout.groups.length,3);assert.ok(layout.nodes.length<=15);
 assert.equal(new Set(layout.nodes.map(n=>n.photo.id)).size,layout.nodes.length);
 for(const edge of layout.edges)assert.ok(groups.find(g=>g.id===edge.group).selected.some(p=>p.id===edge.photo));
 assert.deepEqual(layout,constellationLayout(groups,'g14'));
 const mobile=constellationLayout(groups,'g14',true);assert.ok(mobile.nodes.length<=9);
 assert.ok(mobile.nodes.every(n=>n.x>=0&&n.y>=0&&n.x+n.width<=420&&n.y+n.height<=560));
 assert.deepEqual(constellationLayout([],null),{groups:[],nodes:[],edges:[],hero:null});
});
