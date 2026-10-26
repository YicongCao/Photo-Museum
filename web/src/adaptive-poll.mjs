// One request at a time. Quiet/error backoff is bounded; explicit changes and
// returning to the tab wake immediately. Hidden tabs own no polling timer.
export function adaptivePoll(read,{base=2500,max=30000,enabled=()=>true,doc=document,win=window,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let stopped=false,running=false,timer=null,delay=base,pending=false;
 const clear=()=>{clearTimer(timer);timer=null};
 const schedule=ms=>{clear();if(!stopped&&!doc.hidden)timer=setTimer(run,ms)};
 async function run(){
  clear();if(stopped||doc.hidden)return;
  if(running){pending=true;return}
  if(!enabled()){schedule(max);return}
  running=true;
  try{delay=(await read())===true?base:Math.min(max,delay*2)}
  catch{delay=Math.min(max,delay*2)}
  finally{running=false;if(pending){pending=false;schedule(0)}else schedule(delay)}
 }
 const wake=()=>{delay=base;if(stopped||doc.hidden)return;if(running)pending=true;else schedule(0)};
 const visibility=()=>{if(doc.hidden){clear();pending=false}else wake()};
 doc.addEventListener('visibilitychange',visibility);
 for(const event of ['focus','online','museum-data-changed'])win.addEventListener(event,wake);
 schedule(0);
 return {wake,stop(){stopped=true;clear();doc.removeEventListener('visibilitychange',visibility);for(const event of ['focus','online','museum-data-changed'])win.removeEventListener(event,wake)}};
}
