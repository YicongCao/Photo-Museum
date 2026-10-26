"""Deterministic photo-evidence intervals; never infer actual border crossing dates."""
from collections import Counter
from datetime import date
from statistics import mean, median


def summarize_trips(photos, gap_days=7, offset=0, limit=100, *, today=None):
    today = today or date.today()
    days = Counter(); excluded = Counter(); estimated = 0
    for photo in photos:
        stamp = photo.get('period')
        if not stamp or len(stamp) != 10 or photo.get('date_source') == 'directory':
            excluded['unknown_or_partial_date'] += 1
            continue
        try:
            day = date.fromisoformat(stamp)
        except ValueError:
            excluded['invalid_date'] += 1
            continue
        if day > today:
            excluded['future_date'] += 1
            continue
        days[day] += 1
        estimated += bool(photo.get('date_estimated') or photo.get('gps_layer') == 'inferred')

    def clusters(threshold):
        visits = []
        for day in sorted(days):
            if not visits or (day-visits[-1]['end']).days > threshold:
                visits.append({'start':day, 'end':day, 'photo_count':0, 'observed_days':0})
            visit = visits[-1]; visit['end'] = day
            visit['photo_count'] += days[day]; visit['observed_days'] += 1
        return visits

    visits = clusters(gap_days); starts = []; breaks = []; result = []
    for i, visit in enumerate(visits):
        start, end = visit['start'], visit['end']
        interval = (start-visits[i-1]['start']).days if i else None
        between = (start-visits[i-1]['end']).days if i else None
        if i:
            starts.append(interval); breaks.append(between)
        result.append({'number':i+1, 'first_photo_date':start.isoformat(), 'last_photo_date':end.isoformat(),
                       'observed_span_days':(end-start).days+1, 'observed_days':visit['observed_days'],
                       'photo_count':visit['photo_count'], 'previous_start_to_start_days':interval,
                       'previous_last_to_this_first_days':between})
    summary = lambda values: {'count':len(values), 'mean_days':round(mean(values),2) if values else None,
                              'median_days':median(values) if values else None,
                              'min_days':min(values) if values else None, 'max_days':max(values) if values else None}
    return {'scope':'全部匹配且当前可展示的本地索引成片，不是分页抽样，也不是全部实际出行历史',
            'matched_photos':len(photos), 'dated_photos':sum(days.values()), 'estimated_photos_used':estimated,
            'excluded_dates':dict(excluded), 'observed_date_count':len(days), 'trip_count':len(visits),
            'grouping':{'gap_days':gap_days, 'rule':'相邻有照片日期相差超过 gap_days 才另起一组；这是疑似行程，不是已确认出入境',
                        'sensitivity_trip_counts':{str(g):len(clusters(g)) for g in sorted({3,7,14,gap_days})}},
            'start_to_start':summary(starts), 'last_to_next_first':summary(breaks),
            'trips_by_start_year':dict(Counter(str(v['start'].year) for v in visits)),
            'trips':result[offset:offset+limit], 'offset':offset,
            'next_offset':offset+limit if offset+limit<len(visits) else None,
            'limitations':['只依据满足定位条件的照片；无定位、未入库或未展示的照片可能造成漏计或拆分。',
                           '照片首末日期不是实际抵达、离境日期；不能由间隔推断出行目的或未拍照期间的位置。',
                           '年/月精度、缺日期和未来日期不参与精确日间隔，均单列。单次或零次没有可计算的平均间隔。']}
