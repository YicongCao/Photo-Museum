import React from 'react';
import {Icon} from './icons';

export function photographyLabel(data,axis) {
  if(!data || data.error) return data?.error ? '识别失败' : null;
  if(data.status==='not_applicable') return '不适用';
  const result=data[axis];
  return result?.labels?.map(t=>t.label).join(' · ') || (result ? '未确定' : null);
}

export function photographyTitle(data,axis) {
  return (data?.[axis]?.labels || []).map(t=>`${t.label} · 相似度 ${t.similarity} · 领先基线 ${t.margin}`).join('\n') || '本地模型候选；相似度不是正确率。';
}

export function PhotographyLabels({analysis}) {
  const data=analysis?.data;
  if(!data || data.status==='not_applicable') return null;
  return <>{[['style','摄影风格'],['topic','摄影主题']].map(([axis,label])=><div key={axis} className="photography-labels">
    <small><Icon name={axis}/>{label} · 候选</small>
    <p title={data.error ? '本地识别失败' : photographyTitle(data,axis)}>{photographyLabel(data,axis)}</p>
  </div>)}</>;
}
