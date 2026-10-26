import React from 'react';
import {ArchiveRow} from './photo-archive';
import {PhotographyLabels} from './photography-labels';
import {subjectLabel} from './localized-labels';
export function PhotoAnalysisArchive({analysis}){
 const visual=analysis?.visual?.data,photography=analysis?.photography,aesthetic=analysis?.aesthetics?.data;
 const people=analysis?.people?.items||[];
 if(aesthetic?.score==null&&!people.length&&visual?.score==null&&!visual?.tags?.length&&(!photography?.data||photography.data.status==='not_applicable'))return null;
 return <><h3 className="archive-section-title">刮削生成</h3><dl className="photo-archive photo-analysis-archive" aria-label="刮削生成">
  {aesthetic?.score!=null&&<ArchiveRow label="美学评分" icon="score" title="本地神经模型预测，名义十分制；未按个人偏好校准，不是喜欢概率">{aesthetic.score.toFixed(1)} · 神经美学</ArchiveRow>}
  {visual?.score!=null&&<ArchiveRow label="技术评分" icon="score">{visual.score} / 100{visual.score_penalty_reason==='assumed_srgb'?' · 色域假定 −15':''}</ArchiveRow>}
  {!!visual?.tags?.length&&<ArchiveRow label="本地主体识别" icon="subject">{visual.tags.slice(0,3).map(subjectLabel).join(' · ')}</ArchiveRow>}
  {!!people.length&&<ArchiveRow label="面孔" icon="face">{people.map(p=>p.label||'未命名').join(' · ')}</ArchiveRow>}
  <PhotographyLabels analysis={photography}/>
 </dl></>;
}
