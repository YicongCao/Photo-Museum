import test from 'node:test';
import assert from 'node:assert/strict';
import {curatorTimeline,curatorWorkState} from '../src/curator-timeline.js';
const e=(id,kind,data={})=>({id,kind,data,created:1700000000+id});
test('Replay stays chronological; text cannot jump over a tool or a round',()=>{
 const events=[e(1,'phase',{stage:'thinking',round:1}),e(2,'thinking',{text:'先检查'}),e(3,'thinking',{text:'城市。'}),e(4,'answer',{text:'开始检索'}),e(5,'tool_start',{call_id:'a',name:'list_facets',arguments:{field:'city'}}),e(6,'tool_end',{call_id:'a',result:{values:['合成城市']},duration_ms:12}),e(7,'phase',{stage:'thinking',round:2}),e(8,'thinking',{text:'再检查主体'}),e(9,'tool_start',{call_id:'b',name:'search_photos'}),e(10,'tool_end',{call_id:'b',duration_ms:3,result:{total:2}}),e(11,'answer',{text:'筛选完成'}),e(12,'done',{status:'completed'})];
 const rows=curatorTimeline([...events.slice(6),...events.slice(0,6),events[2]]);
 assert.deepEqual(rows.map(r=>r.kind),['phase','thinking','answer','tool','phase','thinking','tool','answer','done']);
 assert.equal(rows[1].text,'先检查城市。');assert.equal(rows[3].name,'list_facets');assert.equal(rows[3].ended,true);assert.equal(rows[5].round,2);assert.equal(rows[7].text,'筛选完成');
 assert.equal(events[1].data.text,'先检查');
});
test('Reused provider call IDs stay as two separate tools and later thoughts do not merge backwards',()=>{
 const rows=curatorTimeline([e(1,'thinking',{text:'A'}),e(2,'tool_start',{call_id:'same',name:'first'}),e(3,'tool_end',{call_id:'same',result:{total:1}}),e(4,'thinking',{text:'B'}),e(5,'tool_start',{call_id:'same',name:'second'}),e(6,'tool_end',{call_id:'same',result:{total:2}})]);
 assert.equal(rows.length,4);assert.equal(rows[1].name,'first');assert.equal(rows[1].result.total,1);assert.equal(rows[3].name,'second');assert.equal(rows[3].result.total,2);
});
test('An interrupted tool stays unfinished; a result without a start is still visible',()=>{
 assert.equal(curatorTimeline([e(1,'tool_start',{call_id:'a'}),e(2,'done',{status:'cancelled'})])[0].ended,false);
 assert.deepEqual(curatorTimeline([e(1,'tool_end',{call_id:'b',result:{error:'参数无效'}})])[0].result,{error:'参数无效'});
});
test('Busy state follows actual latest event and never animates a terminal run',()=>{
 assert.equal(curatorWorkState([e(1,'thinking')],'running').kind,'thinking');
 assert.equal(curatorWorkState([e(1,'answer')],'running').kind,'answer');
 assert.equal(curatorWorkState([e(1,'tool_start',{name:'search_photos'})],'running').name,'search_photos');
 assert.equal(curatorWorkState([e(1,'tool_end')],'running').kind,'waiting');
 assert.equal(curatorWorkState([],'preparing').kind,'preparing');
 for(const status of ['completed','failed','cancelled','interrupted'])assert.equal(curatorWorkState([e(1,'thinking')],status),null);
});
