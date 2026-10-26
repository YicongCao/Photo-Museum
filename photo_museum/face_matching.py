"""Local identity assistance. Similarity is not an identity probability.

Only owner-confirmed, current-model examples teach a named identity. Automatic
assignments never recursively train it. Stored vectors stay on this server.
"""
import json
import math

POLICY = 'confirmed-multi-v1'
REVIEW_MIN = .40
AUTO_MIN = .65
AUTO_SECOND = .55
AUTO_MARGIN = .10
SINGLE_MIN = .80
MAX_SAMPLES = 12
VISIBLE = "e.missing=0 AND e.scope_excluded=0 AND NOT EXISTS(SELECT 1 FROM curation h WHERE h.asset_id=e.id AND h.excluded=1)"
JOIN = ' FROM faces f JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision JOIN people p ON p.id=f.person_id '


def unit(raw):
    import numpy as np
    try:
        v = np.frombuffer(raw, dtype=np.float32) if isinstance(raw, bytes) else np.asarray(raw, dtype=np.float32)
        if v.ndim != 1 or not 2 <= len(v) <= 4096 or not np.isfinite(v).all():return None
        norm = float(np.linalg.norm(v))
        return v / norm if norm > 1e-8 else None
    except (ValueError, TypeError):return None


def area(row):
    try:
        b=json.loads(row['box_json']);a=float(b[2])*float(b[3])
        return a if math.isfinite(a) and a>0 else 0
    except (ValueError,TypeError,IndexError,KeyError,OverflowError):return 0


def diverse(rows):
    """Large clear crop first; retain distinct directions and distinct photos."""
    rows=sorted(rows,key=lambda r:(-area(r),r['id']))
    unique=[];seen=set()
    for r in rows:
        if r['asset_id'] not in seen:unique.append(r);seen.add(r['asset_id'])
    if len(unique)<=MAX_SAMPLES:return unique
    chosen=[unique.pop(0)]
    while unique and len(chosen)<MAX_SAMPLES:
        i=max(range(len(unique)),key=lambda k:1-max(float(unique[k]['vector']@v['vector']) for v in chosen))
        chosen.append(unique.pop(i))
    return chosen


def bank(c, model):
    rows=c.execute('SELECT f.*,p.label,p.updated person_updated'+JOIN+' WHERE '+VISIBLE+' AND f.model=? ORDER BY f.id',(model,)).fetchall()
    named={};anonymous={};occupied={}
    for raw in rows:
        r=dict(raw);v=unit(r['embedding'])
        if v is None:continue
        r['vector']=v
        if r['label'].strip():
            # An unconfirmed prediction must not become another reference sample.
            if r['manual']:
                named.setdefault((r['person_id'],len(v)),[]).append(r)
                occupied.setdefault(r['person_id'],set()).add(r['asset_id'])
        else:anonymous.setdefault((r['person_id'],len(v)),r)
    negatives={};rejected=set()
    for r in c.execute('SELECT r.face_id,r.person_id,f.embedding,f.asset_id FROM face_reviews r JOIN faces f ON f.id=r.face_id JOIN entries e ON e.id=f.asset_id AND e.revision=f.revision WHERE r.decision=\'no\' AND r.undone IS NULL AND r.model=f.model AND f.model=? AND f.person_id<>r.person_id AND '+VISIBLE,(model,)):
        rejected.add((r['face_id'],r['person_id']));v=unit(r['embedding'])
        if v is not None:negatives.setdefault((r['person_id'],len(v)),[]).append(v)
    return {'named':{key:diverse(value) for key,value in named.items()},'anonymous':anonymous,'occupied':occupied,'negatives':negatives,'rejected':rejected}


def rank(vector, references, asset_id=None, face_id=None):
    """Best distinct-photo samples; runner-up is a different identity, not sample."""
    candidates=[]
    for (pid,dim),examples in references['named'].items():
        if dim!=len(vector) or (face_id,pid) in references['rejected']:continue
        if asset_id in references['occupied'].get(pid,set()):continue
        scored=sorted(((float(vector@r['vector']),r) for r in examples if r['asset_id']!=asset_id),key=lambda x:(-x[0],x[1]['id']))
        if not scored:continue
        best=scored[0][0];second=scored[1][0] if len(scored)>1 else None
        negative=max((float(vector@v) for v in references['negatives'].get((pid,dim),[])),default=-1.)
        candidates.append({'person_id':pid,'label':scored[0][1]['label'],'target_updated':scored[0][1]['person_updated'],
            'similarity':best,'second_similarity':second,'support':sum(s>=AUTO_SECOND for s,_ in scored),
            'sample_count':len(scored),'examples':[r['id'] for _,r in scored[:3]],'negative_similarity':negative})
    candidates.sort(key=lambda r:(-r['similarity'],r['person_id']))
    for item in candidates:
        runner=max((r['similarity'] for r in candidates if r['person_id']!=item['person_id']),default=0.)
        item['margin']=item['similarity']-max(0.,runner)
        item['automatic']=bool(item['margin']>=AUTO_MARGIN and
            ((item['support']>=2 and item['similarity']>=AUTO_MIN) or (item['sample_count']==1 and item['similarity']>=SINGLE_MIN)) and
            (item['negative_similarity']<REVIEW_MIN or item['similarity']-item['negative_similarity']>=AUTO_MARGIN))
    return candidates


def assign_new(vector,references,asset_id,used):
    candidates=rank(vector,references,asset_id=asset_id)
    if candidates and candidates[0]['automatic'] and candidates[0]['person_id'] not in used:
        return candidates[0]['person_id'],candidates[0]
    # Legacy anonymous grouping stays separate from named identities. It cannot
    # bypass a failed margin/negative-example check for a named person.
    best=None;similarity=.55
    for (pid,dim),row in references['anonymous'].items():
        if dim!=len(vector) or pid in used or row['asset_id']==asset_id:continue
        score=float(vector@row['vector'])
        if score>similarity:best,similarity=pid,score
    return best,None


def invalidate_reviews(c,face_ids=(),people=()):
    # Preserve later manual edits when undoing a previous Yes.
    for r in c.execute("SELECT id,face_id,person_id,previous_person_id FROM face_reviews WHERE decision='yes' AND valid=1 AND undone IS NULL").fetchall():
        if r['face_id'] in face_ids or set(people).intersection((r['person_id'],r['previous_person_id'])):
            c.execute('UPDATE face_reviews SET valid=0 WHERE id=?',(r['id'],))
