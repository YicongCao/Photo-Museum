"""Read-only aggregate comparison. Uses existing metadata, never opens media/NAS."""
import argparse,json,sqlite3,time
from collections import defaultdict
from datetime import datetime
from photo_museum import aesthetics
from photo_museum.representatives import choose


def audit(path):
    start=time.perf_counter();c=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
    with c:
        c.execute('BEGIN')
        neural=aesthetics.scores(c)
        rows=c.execute("""SELECT e.id,e.source_id,e.parent,e.path,m.data_json,
         json_extract(a.data_json,'$.score') technical_score,json_extract(a.data_json,'$.signature') signature,
         json_extract(a.data_json,'$.tags[0].label') concept,
         (SELECT value_json FROM metadata md WHERE md.asset_id=e.id AND md.field='captured_at' AND md.stale=0
           AND (md.layer='manual' OR md.source_revision=e.revision) AND (md.layer!='inferred' OR json_extract(md.info_json,'$.accepted')=1)
           ORDER BY CASE md.layer WHEN 'manual' THEN 0 WHEN 'observed' THEN 1 ELSE 2 END LIMIT 1) capture
         FROM entries e JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
         JOIN analysis a ON a.asset_id=e.id AND a.revision=e.revision AND a.provider='visual'
         WHERE e.missing=0 AND e.scope_excluded=0 AND e.kind='image_candidate'
         AND NOT EXISTS(SELECT 1 FROM curation u WHERE u.asset_id=e.id AND u.excluded=1)
         AND coalesce(json_extract(m.data_json,'$.placeholder'),0)=0
         AND a.version=(SELECT value FROM settings WHERE key='analysis_version')
         AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
         AND json_extract(a.data_json,'$.error') IS NULL
         AND EXISTS(SELECT 1 FROM derivatives d WHERE d.asset_id=e.id AND d.revision=e.revision AND d.profile='thumb' AND d.status='ready')""").fetchall()
    c.close();groups=defaultdict(list)
    for row in rows:
        r=dict(row);r['representative_time']=json.loads(r['capture']) if r['capture'] else json.loads(r['data_json']).get('captured_at');groups[(r['source_id'],r['parent'])].append(r)
    result={'activities_compared':0,'changed_activities':0,'replaced_photos':0,'top10_similar_pairs':0,'representative_similar_pairs':0,'top10_days':0,'representative_days':0}
    def pairs(items):
        count=0
        for i,a in enumerate(items):
            for b in items[i+1:]:
                try:count+=(int(a['signature'],16)^int(b['signature'],16)).bit_count()<=5
                except (ValueError,TypeError):pass
        return count
    def days(items):return len({r['representative_time'][:10] for r in items if isinstance(r['representative_time'],str) and len(r['representative_time'])>=10})
    for group in groups.values():
        if len(group)<=10:continue
        use_neural=all(r['id'] in neural for r in group)
        for r in group:r['score']=neural[r['id']] if use_neural else r['technical_score'];r['score_kind']='aesthetic' if use_neural else 'technical'
        ranked=sorted((r for r in group if isinstance(r['score'],(float,int))),key=lambda r:(-r['score'],r['path'],r['id']))
        if len(ranked)<=10:continue
        chosen,summary=choose(ranked);result['activities_compared']+=1;result['changed_activities']+=summary['alternatives']>0;result['replaced_photos']+=summary['alternatives']
        result['top10_similar_pairs']+=pairs(ranked[:10]);result['representative_similar_pairs']+=pairs(chosen)
        result['top10_days']+=days(ranked[:10]);result['representative_days']+=days(chosen)
    return result|{'elapsed_seconds':round(time.perf_counter()-start,3),'scope':'valid visual analysis, >10 scored photos; aggregate heuristic comparison, not human quality accuracy'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('catalog');args=parser.parse_args();print(json.dumps(audit(args.catalog),ensure_ascii=False,indent=2))
