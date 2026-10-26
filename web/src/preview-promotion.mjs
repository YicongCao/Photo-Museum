// Limit complete fetch/decode/paint promotions, not merely network requests.
export function createPromotionQueue(limit=2){
 const waiting=[];let active=0;
 const pump=()=>{while(active<limit&&waiting.length){const job=waiting.shift();if(job.cancelled)continue;job.started=true;active++;job.start()}};
 return {acquire(start){const job={start,started:false,cancelled:false};waiting.push(job);queueMicrotask(pump);return()=>{if(job.cancelled)return;job.cancelled=true;if(job.started)active--;else{const index=waiting.indexOf(job);if(index>=0)waiting.splice(index,1)}pump()}}};
}
export const wallPromotions=createPromotionQueue();
