import React from 'react';
import {ArchiveRow} from './photo-archive';

export function photographyLabel(data,axis) {
  if(!data || data.error) return data?.error ? '识别失败' : null;
  if(data.status==='not_applicable') return '不适用';
  const result=data[axis];
  return result?.labels?.map(t=>t.label).join(' · ') || (result ? '未确定' : null);
}

export function photographyTitle(data,axis) {
  return '本地模型推断，未校准；相似度不是正确率。\n'+(data?.[axis]?.labels || []).map(t=>`${t.label} · 相似度 ${t.similarity} · 领先基线 ${t.margin}`).join('\n');
}

export function PhotographyLabels({analysis}) {
  const data=analysis?.data;
  if(!data || data.status==='not_applicable') return null;
  return <>{[['style','摄影风格'],['topic','摄影主题']].map(([axis,label])=>{
    if(axis==='style'&&!data.error&&!data.style?.labels?.length)return null;
    const content=photographyLabel(data,axis);if(!content)return null;
    return <ArchiveRow key={axis} className="photography-labels" label={label} icon={axis} title={data.error?'本地识别失败':photographyTitle(data,axis)}>{content}</ArchiveRow>;
  })}</>;
}
