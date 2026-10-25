import React from 'react';
const text=(field,value)=>{
  if(value==null)return '';
  if(field==='captured_at')return String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/,'$1-$2-$3');
  if(field==='exposure')return Number(value)>0 && Number(value)<1 ? `1/${Math.round(1/Number(value))} s` : `${value} s`;
  if(field==='aperture')return `ƒ/${value}`;
  if(field==='iso')return `ISO ${value}`;
  if(field==='focal_length')return `${value} mm`;
  if(field==='gps' && typeof value==='object')return `${Number(value.latitude).toFixed(5)}, ${Number(value.longitude).toFixed(5)}`;
  return String(value);
};
export function PhotoArchive({metadata,media}) {
  const value=k=>metadata[k]?.value;
  const provenance=keys=>[...new Set(keys.map(k=>metadata[k]?.layer).filter(Boolean))].map(layer=>({observed:'相机记录',manual:'已修订',inferred:'近邻推断'}[layer])).join(' / ');
  const rows=[];
  const add=(label,keys,content)=>{if(content)rows.push({label,content,note:provenance(keys)});};
  add('拍摄时间',['captured_at'],text('captured_at',value('captured_at')));
  add('相机',['make','camera'],value('make') && String(value('camera') || '').toLowerCase().startsWith(String(value('make')).toLowerCase()) ? value('camera') : [value('make'),value('camera')].filter(Boolean).join(' · '));
  add('镜头',['lens'],value('lens'));
  const width=media.width || value('width'),height=media.height || value('height');
  if(width || height)add('尺寸',['width','height'],`${width || '—'} × ${height || '—'} px${width && height ? ` · ${(width*height/1e6).toFixed(1)} MP` : ''}`);
  const depth=Array.isArray(media.source_bit_depth) ? Math.max(...media.source_bit_depth) : media.source_bit_depth;
  const sourceColor=media.source_color || value('color_profile');
  if(!media.metadata_only) add('色彩',[],[sourceColor,depth && `${depth} bit`,media.hdr_source ? 'HDR 源图' : media.hdr_source===false ? 'SDR 源图' : null,media.assumed_color ? 'sRGB 假定' : null,'sRGB · SDR 预览'].filter(Boolean).join(' · '));
  add('曝光',['aperture','exposure','iso'],['aperture','exposure','iso'].map(k=>text(k,value(k))).filter(Boolean).join(' · '));
  add('焦距',['focal_length','focal_35mm'],[text('focal_length',value('focal_length')),value('focal_35mm') && `等效 ${value('focal_35mm')} mm`].filter(Boolean).join(' · '));
  add('GPS',['gps'],text('gps',value('gps')));
  return <dl className="photo-archive">{rows.map(r=><div key={r.label}><dt>{r.label}{r.note && <small> · {r.note}</small>}</dt><dd>{r.content}</dd></div>)}</dl>;
}
