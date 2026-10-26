import test from 'node:test';
import assert from 'node:assert/strict';
import {taskStatus} from '../src/task-status.mjs';

test('Fast local backfill between active samples still has real completion evidence',()=>{
 const state={counts:{ready:100},fully_done:30,error_count:0,active:[],completion_events:[{completion_id:1}]};
 assert.equal(taskStatus(state).text,'任务进行中');
 assert.equal(taskStatus({...state,completion_events:[]}).text,'等待处理');
 assert.equal(taskStatus({...state,paused:true}).text,'媒体已暂停');
 assert.equal(taskStatus({...state,fully_done:100}).text,'全部处理完成');
});
