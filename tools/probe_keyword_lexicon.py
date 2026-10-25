"""Read-only/offline lexicon assessment; private vocabulary stays in ignored data/.

This is a design probe, not a production index builder or synonym expansion policy.
"""
import argparse
from collections import Counter,defaultdict
from contextlib import contextmanager
from datetime import datetime,timezone
import hashlib,json,os,socket,sqlite3,statistics,time,unicodedata
from pathlib import Path


def norm(value):
    return ' '.join(unicodedata.normalize('NFKC',str(value)).casefold().split())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    target=args.output.resolve()
    if not target.is_relative_to(repo/'data'):parser.error('Private output must be inside this repository data/')
    target.mkdir(parents=True,exist_ok=True);os.chmod(target,0o700)
    attempts=[]
    def deny(*a,**k):
        attempts.append('blocked');raise RuntimeError('Network disabled for private lexicon assessment')
    socket.socket.connect=deny;socket.socket.connect_ex=deny;socket.create_connection=deny
    from photo_museum.exhibitions import ExhibitionCatalog
    from photo_museum.curator_tools import LocalTools,Filters
    from photo_museum.localization import catalog as localization
    c=sqlite3.connect(args.database.resolve().as_uri()+'?mode=ro',uri=True,timeout=5)
    c.row_factory=sqlite3.Row;c.execute('PRAGMA query_only=ON')
    class ReadOnly:
        @contextmanager
        def connect(self):yield c
    db=ReadOnly();started=time.perf_counter()
    local=LocalTools(db,ExhibitionCatalog(db),'offline-lexicon-probe')
    try:
        photos=local.load()  # One SQLite read transaction shared by both projections.
        loaded=time.perf_counter()-started
        versions=dict(c.execute("SELECT key,value FROM settings WHERE key IN ('analysis_version','photography_version')"))
        schema=c.execute('PRAGMA user_version').fetchone()[0]
    finally:
        c.rollback();c.close()
    vocabulary={};links=defaultdict(set);aliases=defaultdict(set)
    public=localization()
    public_names=defaultdict(set)
    for base in public['synsets'].values():
        for word in {base['en'],base['source_en'],base['zh'],*base['en'].split(', ')}:public_names[norm(word)].add(base['synset'])
    raw_subject_ids=set()
    def add(key,domain,label,words,photo,**extra):
        if key not in vocabulary:vocabulary[key]={'id':key,'domain':domain,'label':label,'aliases':set(),'photos':set(),**extra}
        row=vocabulary[key];row['aliases'].update(str(w) for w in words if w);row['photos'].add(photo['id'])
        for word in words:
            if word:aliases[norm(word)].add(key)
        links[photo['id']].add(key)
    for p in photos:
        for source,domain in [('subjects','subject'),('topics','topic'),('styles','style')]:
            for t in p[source]:
                raw_id=t['id'];identity=raw_id;words={t['label'],raw_id}
                if domain=='subject':
                    raw_subject_ids.add(raw_id)
                    base=public['synsets'].get(raw_id)
                    if not base and raw_id.isdigit():base=public['indices'].get(int(raw_id))
                    if not base:
                        candidates=public_names.get(norm(raw_id),set()) or public_names.get(norm(t['label']),set())
                        if len(candidates)==1:base=public['synsets'][next(iter(candidates))]
                    if base:
                        identity=base['synset'];words.update([identity,base['zh'],base['en'],base['source_en'],*base['en'].split(', ')])
                key=domain+':'+identity
                add(key,domain,t['label'],words,p)
                vocabulary[key].setdefault('filter_values',set()).add(raw_id)
        place=p.get('place')
        if place and place.get('city'):
            parent=[str(place.get('country_code') or place.get('country') or ''),str(place.get('province_code') or place.get('province') or '')]
            identity=str(place['geonames_id']) if place.get('geonames_id') else 'fallback-'+hashlib.sha256(json.dumps(parent+[norm(place['city'])]).encode()).hexdigest()[:16]
            words={place['city'],(place.get('display_zh') or {}).get('city')}
            entry=public['geo']['places'].get(str(place.get('geonames_id','')))
            if entry:words.update([entry.get('name'),entry.get('ascii')])
            add('city:'+identity,'city',(place.get('display_zh') or {}).get('city') or place['city'],words,p,parent=parent,precision='nearest_city',has_stable_id=bool(place.get('geonames_id')))
    counts=Counter(r['domain'] for r in vocabulary.values())
    resolved_subjects=sum(r['domain']=='subject' and r['id'].split(':',1)[1] in public['synsets'] for r in vocabulary.values())
    facets={};timings={}
    for domain in ['subject','topic','style','city']:
        t=time.perf_counter();f=local.dispatch('list_facets',{'field':domain,'limit':60});timings[domain]=round(time.perf_counter()-t,4)
        facets[domain]={'distinct_labels':f['distinct'],'returned':len(f['values']),'omitted_after_top60':max(0,f['distinct']-len(f['values']))}
    existing_subject_values={norm(v) for p in photos for v in local.values(p,'subject')}
    exact_cases=[]
    for row in sorted(vocabulary.values(),key=lambda r:r['id']):
        if row['domain']!='subject':continue
        words=sorted(w for w in row['aliases'] if norm(w) not in {norm(row['label']),norm(row['id'])})
        for word in words:
            # A one-to-one synonym is safe for this probe. Ambiguous words need disambiguation.
            ids={k for k in aliases[norm(word)] if vocabulary[k]['domain']=='subject'}
            if len(ids)!=1:continue
            key=next(iter(ids));resolved=vocabulary[key]
            exact_cases.append({'query':word,'expected_id':key,'photos':len(row['photos']),
                'baseline_exact_present':norm(word) in existing_subject_values,
                'resolved_existing_filters':sorted(resolved['filter_values'])})
    # Retrieval benchmark uses the same existing matcher with ID returned by the proposal.
    samples=[case for case in exact_cases if not case['baseline_exact_present']][:20];comparisons=[]
    for case in samples:
        baseline={p['id'] for p in photos if local.matches(p,Filters(subject=[case['query']]))}
        revised={p['id'] for p in photos if local.matches(p,Filters(subject=case['resolved_existing_filters']))}
        expected=vocabulary[case['expected_id']]['photos']
        comparisons.append({'query':case['query'],'baseline_matches':len(baseline),'alias_resolved_matches':len(revised),'exact_expected_set':revised==expected})
    label_groups=defaultdict(set)
    for row in vocabulary.values():label_groups[(row['domain'],norm(row['label']))].add(row['id'])
    collisions={d:sum(1 for (domain,_),ids in label_groups.items() if domain==d and len(ids)>1) for d in counts}
    alias_collisions=Counter()
    for ids in aliases.values():
        ds=Counter(vocabulary[k]['domain'] for k in ids)
        alias_collisions.update(d for d,n in ds.items() if n>1)
    loc_tests=[]
    for query in ['惠州','huizhou','汽车','车','sports car']:
        fields=['city'] if query in ('惠州','huizhou') else ['subject','topic']
        loc_tests.append({'query':query,'facets':{d:local.dispatch('list_facets',{'field':d,'query':query,'limit':60}) for d in fields},'exact_alias_ids':sorted(aliases.get(norm(query),set()))})
    serialized=[]
    for row in vocabulary.values():serialized.append({**row,**({'filter_values':sorted(row['filter_values'])} if 'filter_values' in row else {}),'aliases':sorted(row['aliases']),'photo_count':len(row['photos']),'photos':sorted(row['photos'])})
    raw=json.dumps(serialized,ensure_ascii=False).encode()
    prototype=target/'lexicon-prototype.sqlite'
    if prototype.resolve()==args.database.resolve():raise RuntimeError('Output database cannot be the input catalog')
    temporary=target/'lexicon-prototype-next.sqlite'
    temporary.unlink(missing_ok=True)
    q=sqlite3.connect(temporary);build_started=time.perf_counter()
    q.executescript("""CREATE TABLE terms(id TEXT PRIMARY KEY,domain TEXT NOT NULL,label TEXT NOT NULL,photo_count INTEGER NOT NULL,metadata_json TEXT NOT NULL);
        CREATE TABLE aliases(term_id TEXT NOT NULL,normalized TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(term_id,normalized));
        CREATE INDEX aliases_lookup ON aliases(normalized,term_id);
        CREATE TABLE asset_terms(asset_id TEXT NOT NULL,term_id TEXT NOT NULL,PRIMARY KEY(asset_id,term_id));
        CREATE INDEX term_assets ON asset_terms(term_id,asset_id);""")
    for row in serialized:
        q.execute('INSERT INTO terms VALUES(?,?,?,?,?)',(row['id'],row['domain'],row['label'],row['photo_count'],json.dumps({k:v for k,v in row.items() if k not in ('photos','aliases')},ensure_ascii=False)))
        q.executemany('INSERT OR IGNORE INTO aliases VALUES(?,?,?)',[(row['id'],norm(a),a) for a in row['aliases']])
        q.executemany('INSERT INTO asset_terms VALUES(?,?)',[(pid,row['id']) for pid in row['photos']])
    q.commit();assert q.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    built=time.perf_counter()-build_started;durations=[]
    for case in samples*10:
        t=time.perf_counter();found=q.execute("SELECT t.id FROM aliases a JOIN terms t ON t.id=a.term_id WHERE a.normalized=? AND t.domain='subject'",(norm(case['query']),)).fetchall();durations.append((time.perf_counter()-t)*1000)
        assert {r[0] for r in found}=={case['expected_id']}
    q.close();os.replace(temporary,prototype)
    prototype_stats={'bytes':prototype.stat().st_size,'build_seconds':round(built,3),'lookup_trials':len(durations),'warm_exact_lookup_median_ms':round(statistics.median(durations),4),'warm_exact_lookup_p95_ms':round(sorted(durations)[int(len(durations)*.95)],4),'integrity_check':'ok'}
    inventory_bytes=len(json.dumps([{k:v for k,v in row.items() if k!='photos'} for row in serialized],ensure_ascii=False).encode())
    (target/'private-vocabulary.json').write_bytes(raw)
    private={'cases':comparisons,'alias_cases':exact_cases,'keyword_checks':loc_tests,'ambiguous_labels':[{'domain':d,'label':l,'ids':sorted(ids)} for (d,l),ids in label_groups.items() if len(ids)>1]}
    (target/'private-evaluation.json').write_text(json.dumps(private,ensure_ascii=False,indent=2))
    summary={'snapshot_utc':datetime.now(timezone.utc).isoformat(),'schema':schema,'photos':len(photos),'coverage':{k:sum(bool(p[k]) for p in photos) for k in ['subjects','topics','styles','place']},'terms':dict(counts),'subject_raw_id_variants':len(raw_subject_ids),'subject_resolved_synsets':resolved_subjects,'subject_unresolved_records':counts['subject']-resolved_subjects,'unique_alias_strings':len(aliases),'photo_term_links':sum(len(v) for v in links.values()),'facets':facets,'same_label_multiple_ids':collisions,'ambiguous_alias_strings_per_domain':dict(alias_collisions),'city_without_stable_id':sum(r['domain']=='city' and not r['has_stable_id'] for r in vocabulary.values()),'load_seconds':round(loaded,3),'facet_seconds_after_load':timings,'serialized_vocabulary_bytes_including_photo_ids':len(raw),'inventory_bytes_without_photo_ids':inventory_bytes,'sqlite_prototype':prototype_stats,'unique_unambiguous_subject_alias_cases':len(exact_cases),'subject_alias_cases_absent_from_existing_exact_filters':sum(not case['baseline_exact_present'] for case in exact_cases),'sample_evaluation':{'cases':len(comparisons),'baseline_nonempty':sum(r['baseline_matches']>0 for r in comparisons),'alias_nonempty':sum(r['alias_resolved_matches']>0 for r in comparisons),'exact_expected_set':sum(r['exact_expected_set'] for r in comparisons)},'network_attempts':len(attempts),'boundary':'SQLite URI mode=ro/query_only. Existing current-version/exclusion/GPS preference projection. Alias test measures dictionary exact-match recovery, not image accuracy or LLM end-to-end success.'}
    (target/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    for f in target.iterdir():
        if f.is_file():os.chmod(f,0o600)
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
