import React from 'react';
import {Icon} from './icons';
const text=(field,value)=>{
  if(value==null)return '';
  if(field==='captured_at')return String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/,'$1-$2-$3');
  if(field==='exposure')return Number(value)>0 && Number(value)<1 ? `1/${Math.round(1/Number(value))} s` : `${value} s`;
  if(field==='aperture')return `ƒ/${value}`;
  if(field==='iso')return `ISO ${value}`;
  if(field==='focal_length')return `${value} mm`;
  return String(value);
};
export function ArchiveRow({label,icon,note,children,title,className=''}){
  return <div className={className}><dt><Icon name={icon}/>{label}{note&&<small> · {note}</small>}</dt><dd title={title}>{children}</dd></div>;
}
export function PhotoArchive({metadata,media,size,place}) {
  const value=k=>metadata[k]?.value;
  const provenance=keys=>[...new Set(keys.map(k=>metadata[k]?.layer).filter(Boolean))].map(layer=>({manual:'已修订',inferred:'近邻推断'}[layer])).filter(Boolean).join(' / ');
  const rows=[];
  const add=(label,keys,content)=>{if(content)rows.push({label,content,note:provenance(keys)});};
  add('拍摄时间',['captured_at'],text('captured_at',value('captured_at')));
  add('相机',['make','camera'],value('make') && String(value('camera') || '').toLowerCase().startsWith(String(value('make')).toLowerCase()) ? value('camera') : [value('make'),value('camera')].filter(Boolean).join(' · '));
  add('镜头',['lens'],value('lens'));
  const width=media.width || value('width'),height=media.height || value('height');
  if(width || height)add('尺寸',['width','height'],`${width || '—'} × ${height || '—'} px`);
  add('文件体积',[],!(Number.isFinite(size)&&size>=0)?'未记录':size>=1024**3?`${(size/1024**3).toFixed(2)} GiB`:size>=1024**2?`${(size/1024**2).toFixed(2)} MiB`:size>=1024?`${(size/1024).toFixed(1)} KiB`:`${size} B`);
  const depth=Array.isArray(media.source_bit_depth) ? Math.max(...media.source_bit_depth) : media.source_bit_depth;
  const sourceColor=media.source_color || value('color_profile');
  const hdr=media.hdr_source===true || media.hdr_source===1,sdr=media.hdr_source===false || media.hdr_source===0;
  if(!media.metadata_only) add('色彩',[],[sourceColor,depth && `${depth} bit`,hdr ? 'HDR 源图' : sdr ? 'SDR 源图' : null,media.assumed_color ? 'sRGB 假定' : null,hdr?'sRGB · SDR 预览':null].filter(Boolean).join(' · '));
  if(media.recovery)add('兼容处理',[],({'jpeg_missing_eoi':'临时补齐 JPEG 结束标记 · 源文件未改动','heif_iref_native':'HEIF 容器原生兼容解码','declared_p3_sdr_native':'P3 SDR 原生色彩转换'}[media.recovery] || '兼容解码'));
  add('曝光',['aperture','exposure','iso'],['aperture','exposure','iso'].map(k=>text(k,value(k))).filter(Boolean).join(' · '));
  const equivalent=Number(value('focal_35mm'));
  add('等效焦距',['focal_35mm'],Number.isFinite(equivalent)&&equivalent>0?`${equivalent} mm`:value('focal_length')?'未记录':null);
  const resolved=place&&(!place.input_record||!metadata.gps?.record_id||place.input_record===metadata.gps.record_id)?place:null;
  const city=resolved?.display_zh?.city || resolved?.city;
  if(city || value('gps'))add('近似城市',['gps'],city || '未解析');
  return <dl className="photo-archive" aria-label="EXIF">{rows.map(r=><ArchiveRow key={r.label} label={r.label} note={r.note} icon={{'拍摄时间':'clock','相机':'camera','镜头':'lens','尺寸':'dimensions','文件体积':'file','色彩':'color','兼容处理':'color','曝光':'exposure','等效焦距':'focus','近似城市':'pin'}[r.label]} title={r.label==='近似城市'?'GPS最近城市，不代表行政区归属':undefined}>{r.content}</ArchiveRow>)}</dl>;
}
