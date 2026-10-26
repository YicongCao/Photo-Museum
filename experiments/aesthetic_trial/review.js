'use strict';
const data=JSON.parse(document.querySelector('#trial-data').textContent),byId=new Map(data.photos.map(p=>[p.id,p]));
const labels={technical:'原技术评分',center:'神经美学 · 标准裁切',multi:'神经美学 · 三裁块均值'},key='aesthetic-trial:'+data.dataset_id;
let mode='compare',pairIndex=0,reveal=false,votes={};
try{const saved=JSON.parse(localStorage.getItem(key)||'{}');if(saved.dataset_id===data.dataset_id)votes=saved.votes||{}}catch{}
const content=document.querySelector('#content'),eventSelect=document.querySelector('#event');
for(const g of data.groups){const option=document.createElement('option');option.value=g.id;option.textContent=g.label;eventSelect.append(option)}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el}
function persist(){try{localStorage.setItem(key,JSON.stringify({dataset_id:data.dataset_id,votes}))}catch{}}
function rank(g,method){return g.photos.map(id=>byId.get(id)).sort((a,b)=>b[method]-a[method]||(method==='technical'?g.photos.indexOf(a.id)-g.photos.indexOf(b.id):a.id.localeCompare(b.id)))}
function zoom(p){document.querySelector('#zoom-image').src=p.image;document.querySelector('#zoom-caption').textContent=p.name+' · 标准中心裁切保留约 '+Math.round(100*Math.min(p.aspect,1/p.aspect))+'% 画面 · 三裁块分差 '+p.crop_span.toFixed(3);document.querySelector('#zoom').showModal()}
function photo(p,method,blindLabel){const fig=node('figure',undefined,'photo'),button=node('button');button.setAttribute('aria-label',blindLabel?'放大照片 '+blindLabel:'放大 '+p.name);const image=node('img');image.src=p.image;image.loading='lazy';image.decoding='async';image.alt=blindLabel?'照片 '+blindLabel:p.name;button.append(image);button.addEventListener('click',()=>zoom(p));fig.append(button);const caption=node('figcaption');if(blindLabel){caption.textContent=blindLabel;if(reveal)caption.append(node('small',` · 技术 ${p.technical.toFixed(1)} · 神经 ${p.center.toFixed(3)}`))}else{caption.append(node('b',method==='technical'?p.technical.toFixed(1):p[method].toFixed(3)),node('span',p.name,'name'))}fig.append(caption);return fig}
function draw(){
 content.replaceChildren();document.querySelector('.controls').hidden=mode==='pairs';const s=data.summary;
 document.querySelector('#status').textContent=`${s.photos} 张缓存样本 · ${s.activities} 个活动 · 正式评分未改动 · A/B 已记录 ${Object.keys(votes).length}/${data.pairs.length}`;
 if(mode==='pairs'){drawPair();return}
 const g=data.groups.find(g=>g.id===eventSelect.value),left=document.querySelector('#left-method').value,right=document.querySelector('#right-method').value;
 document.querySelector('#scope').textContent=`活动共 ${g.population} 张可用照片，本轮抽样 ${g.photos.length} 张，含原技术前十。神经排名仅限样本；神经原始预测值没有校准，不能与技术分直接比较。点击照片可放大。`;
 if(mode==='all'){const grid=node('div',undefined,'photos all-photos');for(const p of rank(g,right))grid.append(photo(p,right));content.append(grid);return}
 const a=rank(g,left).slice(0,10),b=rank(g,right).slice(0,10),common=new Set(a.filter(p=>b.some(x=>x.id===p.id)).map(p=>p.id));
 const wrapper=node('div',undefined,'compare');for(const [method,ps] of [[left,a],[right,b]]){const col=node('section',undefined,'comparison-column');col.append(node('h2',`${labels[method]} · 共同入选 ${common.size}/10`));const grid=node('div',undefined,'photos');for(const p of ps){const fig=photo(p,method);if(common.has(p.id))fig.classList.add('shared');grid.append(fig)}col.append(grid);wrapper.append(col)}content.append(wrapper);
}
function drawPair(){
 document.querySelector('#scope').textContent='同一活动的盲看对照，包含算法分歧样本与随机样本。按你自己的喜好选，无需迎合模型；尚未训练个人模型。选择只保存在本机浏览器，可导出。';
 const pair=data.pairs[pairIndex],g=data.groups.find(g=>g.id===pair.group),stage=node('section',undefined,'pair-stage'),head=node('div',undefined,'pair-head');head.append(node('h2',g.label));const revealButton=node('button',reveal?'隐藏分数':'查看分数');revealButton.addEventListener('click',()=>{reveal=!reveal;draw()});head.append(revealButton);stage.append(head);
 const ps=node('div',undefined,'pair-photos');ps.append(photo(byId.get(pair.left),'center','A'),photo(byId.get(pair.right),'center','B'));stage.append(ps);
 const bar=node('div',undefined,'pair-votes');for(const [choice,label] of [['left','更喜欢 A'],['right','更喜欢 B'],['tie','差不多'],['skip','跳过']]){const button=node('button',label);button.setAttribute('aria-pressed',votes[pair.id]?.choice===choice?'true':'false');button.addEventListener('click',()=>{votes[pair.id]={choice,time:new Date().toISOString(),scores_revealed:reveal};persist();if(pairIndex<data.pairs.length-1)pairIndex++;reveal=false;draw()});bar.append(button)}stage.append(bar);
 const nav=node('div',undefined,'pair-navigation'),prev=node('button','← 上一对'),next=node('button','下一对 →');prev.disabled=pairIndex===0;next.disabled=pairIndex===data.pairs.length-1;prev.addEventListener('click',()=>{pairIndex--;reveal=false;draw()});next.addEventListener('click',()=>{pairIndex++;reveal=false;draw()});nav.append(prev,node('span',`${pairIndex+1} / ${data.pairs.length}`),next);stage.append(nav);if(votes[pair.id])stage.append(node('p','本对已有选择，可重新选择覆盖。','vote-history'));content.append(stage);
}
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(n=>n.setAttribute('aria-pressed',n===button?'true':'false'));draw()}));
for(const id of ['event','left-method','right-method'])document.querySelector('#'+id).addEventListener('change',draw);
document.querySelector('#close-zoom').addEventListener('click',()=>document.querySelector('#zoom').close());document.querySelector('#zoom').addEventListener('close',()=>{document.querySelector('#zoom-image').removeAttribute('src')});
document.querySelector('#export').addEventListener('click',()=>{const exported={schema:1,dataset_id:data.dataset_id,base_sha256:data.summary.base_sha256,head_sha256:data.summary.head_sha256,exported_at:new Date().toISOString(),pairs:data.pairs.map(p=>({id:p.id,left:p.left,right:p.right,group:p.group,kind:p.kind})),votes};const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='aesthetic-trial-preferences.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
draw();
