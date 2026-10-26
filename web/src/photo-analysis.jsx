import React from 'react';
import {ArchiveRow} from './photo-archive';
import {PhotographyLabels} from './photography-labels';
import {subjectLabel} from './localized-labels';
export function PhotoAnalysisArchive({analysis}){
 const visual=analysis?.visual?.data,photography=analysis?.photography;
 const people=analysis?.people?.items||[];
 if(!people.length&&visual?.score==null&&!visual?.tags?.length&&(!photography?.data||photography.data.status==='not_applicable'))return null;
 return <><h3 className="archive-section-title">刮削生成</h3><dl className="photo-archive photo-analysis-archive" aria-label="刮削生成">
  {visual?.score!=null&&<ArchiveRow label="技术评分" icon="score">{visual.score} / 100{visual.score_penalty_reason==='assumed_srgb'?' · 色域假定 −15':''}</ArchiveRow>}
  {!!visual?.tags?.length&&<ArchiveRow label="本地主体识别" icon="subject">{visual.tags.slice(0,3).map(subjectLabel).join(' · ')}</ArchiveRow>}
  {!!people.length&&<ArchiveRow label="面孔" icon="face">{people.map(p=>p.label||'未命名').join(' · ')}</ArchiveRow>}
  <PhotographyLabels analysis={photography}/>
 </dl></>;
}
