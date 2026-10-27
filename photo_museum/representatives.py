"""Deterministic cover diversification using existing metadata only, never media I/O."""
from datetime import datetime,timezone

VERSION = 'representative-v1'

def choose(ranked, limit=10):
    """Keep the strongest hero; greedily balance quality, time and visual variety.

    Input is already validated and sorted on ONE score scale. dHash is only a
    near-duplicate heuristic, not scene/identity recognition. Unknowns earn no
    diversity bonus. We never fill with unscored/hidden assets.
    """
    if len(ranked) <= limit:
        return ranked[:], {'version': VERSION, 'alternatives': 0}
    def stamp(r):
        value=r.get('representative_time') or ''
        try:return datetime.fromisoformat(value[:10].replace(':','-')+value[10:19]).replace(tzinfo=timezone.utc).timestamp()
        except (ValueError, TypeError, OverflowError):return None
    times={r['id']:stamp(r) for r in ranked}
    known=[t for t in times.values() if t is not None]
    span=max(known)-min(known) if known else 0
    def similarity(a,b):
        x,y=a.get('signature'),b.get('signature')
        if not isinstance(x,str) or not isinstance(y,str) or len(x)!=16 or len(y)!=16:return None
        try:return 1-(int(x,16)^int(y,16)).bit_count()/64
        except (ValueError,TypeError):return None
    scores=[r['score'] for r in ranked]
    lo,hi=min(scores),max(scores)
    # A 0.1 point spread must not become a full quality-range penalty.
    scale=max(hi-lo,2.0 if ranked[0].get('score_kind')=='aesthetic' else 20.0)
    selected=[ranked[0]];remaining=ranked[1:]
    while remaining and len(selected)<limit:
        def utility(r):
            quality=1-(hi-r['score'])/scale
            sims=[s for p in selected if (s:=similarity(r,p)) is not None]
            duplicate=bool(sims and max(sims)>=.92)
            visual=1-max(sims) if sims else 0
            t=times[r['id']];ds=[abs(t-times[p['id']]) for p in selected if t is not None and times[p['id']] is not None]
            temporal=min(1,min(ds)/(span/max(1,limit-1))) if ds and span else 0
            concept=r.get('concept');novel=bool(concept and all(p.get('concept')!=concept for p in selected))
            return .55*quality+.25*temporal+.15*visual+.05*novel-.7*duplicate
        best=max(remaining,key=utility)  # ties retain original score/path order
        selected.append(best);remaining.remove(best)
    return selected, {'version':VERSION,'alternatives':sum(r['id'] not in {p['id'] for p in ranked[:limit]} for r in selected)}
