"""Local-only gallery projections and explicitly authored exhibition arrangements.

Tag edges describe shared model candidates; city groups are suggestions to compare,
never evidence of a shared viewpoint. All reads and writes use the same filtered
catalog as their parent Gallery (including prepared curator collections).
"""
from collections import defaultdict
import json
import math
import time
import uuid

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from .exhibitions import key as identity, place_keys, place_label
from .localization import localize_tags


LIMITS = {'years': 80, 'activities_per_year': 80, 'chapters': 500,
          'groups': 90, 'groups_per_kind': 30, 'places': 30, 'selected': 5, 'place_years': 80, 'sample_records': 1200}


def bound_samples(payload):
    """Share one response budget across all repeated sample projections.

    Give each displayed group one representative before adding detail photos.
    Counts remain exact; collection endpoints never inherit this preview limit.
    """
    place_endpoints = [year for place in payload['places']
                       for year in (place['years'][:1] + place['years'][-1:])]
    groups = [*place_endpoints, *payload['groups'], *payload['places'], *payload['years'], *payload['chapters']]
    groups += [group for year in payload['years'] for group in year['activities']]
    groups += [year for place in payload['places'] for year in place['years']]
    seen = set()
    original = []
    for group in groups:
        if id(group) not in seen:
            original.append((group, group['selected']))
            seen.add(id(group))
    total = sum(len(items) for _, items in original)
    for group, _ in original:
        group['selected'] = []
    remaining = LIMITS['sample_records']
    for rank in range(LIMITS['selected']):
        for group, items in original:
            if remaining and rank < len(items):
                group['selected'].append(items[rank])
                remaining -= 1
    payload['sample_records'] = LIMITS['sample_records'] - remaining
    payload['sample_records_omitted'] = total - payload['sample_records']
    return payload


def ranking(photo):
    return (photo.get('score') is None, -(photo.get('score') or 0), photo['id'])


def chronological(photo):
    return (photo.get('period') is None, photo.get('period') or '',
            str(photo.get('captured_at') or ''), photo.get('name', ''), photo['id'])


def samples(photos, size=5):
    return sorted(photos, key=ranking)[:size]


def chapter(aid, photos):
    event = photos[0].get('event') or {}
    period = max((p['period'] for p in photos if p.get('period')), default=None)
    label = event.get('theme') or '活动未详'
    return {'id': aid, 'label': label, 'title': label, 'event': event,
            'period': period, 'count': len(photos), 'selected': samples(photos)}


def tagged_groups(db, photos):
    """Read current tags in one snapshot; no embeddings or people identities."""
    present = {p['id']: p for p in photos}
    groups = {}

    def same_input(row):
        # Catalog projections may be cached, including an immutable curator
        # selection. A current analysis for the same ID is not enough: it must
        # describe the exact source revision and preview pipeline in that view.
        photo = present.get(row['asset_id'])
        return (photo is not None and row['media_version'] is not None
                and photo.get('revision') == row['revision']
                and (photo.get('info') or {}).get('version') == row['media_version'])

    def add(photo_id, kind, tag, version):
        photo = present.get(photo_id)
        if not photo or not isinstance(tag, dict):
            return
        label = tag.get('label_zh') or tag.get('label')
        raw_id = tag.get('id') if kind != 'subject' else tag.get('synset', tag.get('class_index', label))
        if not isinstance(label, str) or not label.strip() or raw_id is None:
            return
        value = tag.get('similarity' if kind != 'subject' else 'confidence')
        if value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value)):
            return
        gid = identity('group', kind, raw_id)
        group = groups.setdefault(gid, {'id': gid, 'label': label, 'kind': kind,
            'basis': {'topic': '本地摄影主题候选', 'style': '本地摄影风格候选', 'subject': '本地主体候选'}[kind],
            'source': 'visual' if kind == 'subject' else 'photography', 'candidate': True,
            'version': version, '_photos': {}})
        group['_photos'][photo_id] = photo

    with db.connect() as c:
        c.execute('BEGIN')
        for row in c.execute("""SELECT a.asset_id,a.revision,a.version,
            json_extract(m.data_json,'$.version') media_version,json_extract(a.data_json,'$.tags') tags
            FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
            JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
            JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
            WHERE a.provider='visual' AND q.status='ready'
            AND a.version=(SELECT value FROM settings WHERE key='analysis_version')
            AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
            AND json_extract(a.data_json,'$.error') IS NULL"""):
            if not same_input(row):
                continue
            for tag in localize_tags(json.loads(row['tags'] or '[]')):
                add(row['asset_id'], 'subject', tag, row['version'])
        for row in c.execute("""SELECT a.asset_id,a.revision,a.version,a.data_json,
            json_extract(m.data_json,'$.version') media_version
            FROM analysis a JOIN entries e ON e.id=a.asset_id AND e.revision=a.revision
            JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision
            JOIN media_jobs q ON q.asset_id=e.id AND q.revision=e.revision
            WHERE a.provider='photography' AND q.status='ready'
            AND a.version=(SELECT value FROM settings WHERE key='photography_version')
            AND json_extract(a.data_json,'$.input_media_version') IS json_extract(m.data_json,'$.version')
            AND json_extract(a.data_json,'$.input_preview_updated') IS m.updated
            AND json_extract(a.data_json,'$.error') IS NULL"""):
            if not same_input(row):
                continue
            data = json.loads(row['data_json'])
            for axis in ('topic', 'style'):
                for tag in (data.get(axis) or {}).get('labels', []):
                    add(row['asset_id'], axis, tag, row['version'])
    return groups


def projection(db, photos):
    years, activities, cities = defaultdict(list), defaultdict(list), defaultdict(list)
    for photo in photos:
        if photo.get('period'):
            years[photo['period'][:4]].append(photo)
        activities[photo['activity_id']].append(photo)
        if photo.get('place') and photo.get('gps'):
            cities[place_keys(photo)[-1]].append(photo)
    chapters = [chapter(aid, values) for aid, values in activities.items()]
    chapters.sort(key=lambda c: (c['period'] is not None, c['period'] or '', c['label'], c['id']), reverse=True)
    year_rows = []
    for year, values in sorted(years.items(), reverse=True):
        by_month, by_activity = defaultdict(list), defaultdict(list)
        for photo in values:
            stamp = photo['period']
            if len(stamp) >= 7:
                by_month[stamp[:7]].append(photo)
            by_activity[photo['activity_id']].append(photo)
        grouped = [chapter(aid, group) for aid, group in by_activity.items()]
        grouped.sort(key=lambda c: (c['period'] or '', c['label'], c['id']), reverse=True)
        year_rows.append({'id': year, 'year': int(year), 'label': year, 'count': len(values),
            'months': [{'id': month, 'label': str(int(month[5:])), 'count': len(group)}
                       for month, group in sorted(by_month.items(), reverse=True)],
            'month_unknown': sum(len(p['period']) == 4 for p in values),
            'activities': grouped[:LIMITS['activities_per_year']], 'activity_total': len(grouped),
            'selected': samples(values)})
    groups = tagged_groups(db, photos)
    group_rows = []
    for group in groups.values():
        values = list(group['_photos'].values())
        group_rows.append({k: v for k, v in group.items() if not k.startswith('_')} |
                          {'count': len(values), 'selected': samples(values)})
    group_rows.sort(key=lambda g: (-g['count'], {'topic': 0, 'style': 1, 'subject': 2}[g['kind']], g['label'], g['id']))
    # Each semantic axis gets its own quota. A rich subject vocabulary must not
    # suppress valid style/topic groups before the client applies its kind filter.
    group_counts = {kind: {'total': 0, 'visible': 0} for kind in ('topic', 'style', 'subject')}
    visible_groups = []
    for group in group_rows:
        count = group_counts[group['kind']]
        count['total'] += 1
        if count['visible'] < LIMITS['groups_per_kind']:
            visible_groups.append(group)
            count['visible'] += 1
    places = []
    for city, values in cities.items():
        by_year = defaultdict(list)
        for photo in values:
            if photo.get('period'):
                by_year[photo['period'][:4]].append(photo)
        if len(by_year) < 2:
            continue
        place = values[0]['place']
        places.append({'id': city, 'label': ' · '.join(dict.fromkeys(place_label(place, field) for field in ('country', 'city'))),
            'count': len(values), 'selected': samples(values), 'precision': 'nearest_city',
            'candidate': True, 'basis': '同城候选，需确认同地点',
            'estimated': sum(p.get('gps_layer') == 'inferred' for p in values),
            'years': [{'year': int(year), 'count': len(group), 'selected': samples(group)}
                      for year, group in sorted(by_year.items())][:LIMITS['place_years']],
            'year_total': len(by_year)})
    places.sort(key=lambda p: (-p['year_total'], -p['count'], p['label'], p['id']))
    return bound_samples({'total': len(photos), 'unknown': sum(not p.get('period') for p in photos),
        'years': year_rows[:LIMITS['years']], 'year_total': len(year_rows),
        'chapters': chapters[:LIMITS['chapters']], 'chapter_total': len(chapters),
        'groups': visible_groups, 'group_total': len(group_rows), 'group_counts': group_counts,
        'places': places[:LIMITS['places']], 'place_total': len(places), 'limits': LIMITS})


class PairInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    left_id: str = Field(min_length=1, max_length=128)
    right_id: str = Field(min_length=1, max_length=128)
    title: str = Field(default='', max_length=120)
    confirmed: bool


class ChapterInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    activity_id: str = Field(min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=120)
    hero_id: str | None = Field(default=None, max_length=128)


class ScrollInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    chapters: list[ChapterInput] = Field(default_factory=list, max_length=500)


def register(app, db, owner, get_catalog, prefix='/api', scoped=False):
    if scoped:
        def get_scope(exhibition_id: str):
            return 'curated:' + exhibition_id
    else:
        def get_scope():
            return 'library'

    def fresh_photos(catalog):
        source = catalog
        while hasattr(source, 'parent'):
            source = source.parent
        source.invalidate()
        return catalog.photos()

    @app.get(prefix + '/exhibitions/creative', dependencies=[Depends(owner)])
    def overview(catalog=Depends(get_catalog)):
        return projection(db, catalog.photos())

    @app.get(prefix + '/exhibitions/creative/resolve', dependencies=[Depends(owner)])
    def resolve(ids: str = Query(min_length=1, max_length=257), catalog=Depends(get_catalog)):
        wanted = ids.split(',')
        if len(wanted) > 2 or len(set(wanted)) != len(wanted) or any(not item or len(item) > 128 for item in wanted):
            raise HTTPException(422, '最多解析两张不同照片')
        # Session drafts store identifiers, not trusted reusable media objects.
        # Revalidate visibility and immutable curator membership before restoring.
        photos = {p['id']: p for p in fresh_photos(catalog)}
        return {'items': [photos[aid] for aid in wanted if aid in photos]}

    @app.get(prefix + '/exhibitions/creative/photos', dependencies=[Depends(owner)])
    def collection(kind: str, key: str, year: int | None = Query(None, ge=1, le=9998),
                   offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
                   sort: str = 'time', catalog=Depends(get_catalog)):
        photos = catalog.photos()
        if kind == 'year':
            found = [p for p in photos if (p.get('period') or '')[:4] == ('' if key == 'unknown' else key)]
        elif kind == 'month':
            found = [p for p in photos if (p.get('period') or '')[:7] == key]
        elif kind == 'chapter':
            found = [p for p in photos if p['activity_id'] == key]
        elif kind == 'place':
            found = [p for p in photos if key in place_keys(p)]
        elif kind == 'group':
            group = tagged_groups(db, photos).get(key)
            found = list(group['_photos'].values()) if group else []
        else:
            raise HTTPException(422, '集合类型无效')
        if sort not in ('time', 'score'):
            raise HTTPException(422, '排序无效')
        if year is not None:
            found = [p for p in found if (p.get('period') or '').startswith(str(year))]
        found.sort(key=ranking if sort == 'score' else chronological)
        return {'items': found[offset:offset+limit], 'total': len(found), 'photos': len(found), 'videos': 0, 'order': sort}

    def pair_value(row, photos):
        left, right = photos.get(row['left_id']), photos.get(row['right_id'])
        if not left or not right or left['revision'] != row['left_revision'] or right['revision'] != row['right_revision']:
            return None
        return {'id': row['id'], 'title': row['title'], 'confirmed': True, 'left': left, 'right': right,
                'created': row['created'], 'updated': row['updated']}

    @app.get(prefix + '/exhibitions/creative/pairs', dependencies=[Depends(owner)])
    def pairs(catalog=Depends(get_catalog), scope=Depends(get_scope)):
        photos = {p['id']: p for p in catalog.photos()}
        with db.connect() as c:
            rows = c.execute('SELECT * FROM creative_pairs WHERE scope=? ORDER BY updated DESC', (scope,)).fetchall()
        return {'items': [item for row in rows if (item := pair_value(row, photos)) is not None]}

    @app.post(prefix + '/exhibitions/creative/pairs', dependencies=[Depends(owner)])
    def save_pair(body: PairInput, catalog=Depends(get_catalog), scope=Depends(get_scope)):
        if not body.confirmed:
            raise HTTPException(422, '请确认这两张照片属于同一地点')
        if body.left_id == body.right_id:
            raise HTTPException(422, '请选择两张不同的照片')
        photos = {p['id']: p for p in fresh_photos(catalog)}
        if any(pid not in photos for pid in (body.left_id, body.right_id)):
            raise HTTPException(409, '照片已不可用或不在当前展览中')
        row = {'id': uuid.uuid4().hex, 'scope': scope, 'left_id': body.left_id,
               'left_revision': photos[body.left_id]['revision'], 'right_id': body.right_id,
               'right_revision': photos[body.right_id]['revision'], 'title': body.title.strip(),
               'created': time.time(), 'updated': time.time()}
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            for pid in (body.left_id, body.right_id):
                current = c.execute('SELECT revision,missing,scope_excluded FROM entries WHERE id=?', (pid,)).fetchone()
                hidden = c.execute('SELECT excluded FROM curation WHERE asset_id=?', (pid,)).fetchone()
                if not current or current['revision'] != photos[pid]['revision'] or current['missing'] or current['scope_excluded'] or (hidden and hidden[0]):
                    raise HTTPException(409, '照片已更新，请重新选择')
            if c.execute('SELECT count(*) FROM creative_pairs WHERE scope=?', (scope,)).fetchone()[0] >= 1000:
                raise HTTPException(409, '已保存 1000 组对照，请先移除不需要的记录')
            c.execute('INSERT INTO creative_pairs VALUES(:id,:scope,:left_id,:left_revision,:right_id,:right_revision,:title,:created,:updated)', row)
        return pair_value(row, photos)

    @app.delete(prefix + '/exhibitions/creative/pairs/{pair_id}', dependencies=[Depends(owner)])
    def remove_pair(pair_id: str, catalog=Depends(get_catalog), scope=Depends(get_scope)):
        # Resolve the catalog dependency even for deletion so prepared scope access is checked.
        with db.connect() as c:
            c.execute('DELETE FROM creative_pairs WHERE id=? AND scope=?', (pair_id, scope))
        return {'ok': True}

    @app.get(prefix + '/exhibitions/creative/scroll', dependencies=[Depends(owner)])
    def scroll(catalog=Depends(get_catalog), scope=Depends(get_scope)):
        photos = catalog.photos()
        activities = {p['activity_id'] for p in photos}
        ids = {p['id']: p['activity_id'] for p in photos}
        with db.connect() as c:
            row = c.execute('SELECT * FROM creative_layouts WHERE scope=?', (scope,)).fetchone()
        chapters = []
        for item in json.loads(row['data_json']) if row else []:
            if item['activity_id'] in activities:
                chapters.append(item | {'hero_id': item.get('hero_id') if ids.get(item.get('hero_id')) == item['activity_id'] else None})
        heroes = {p['id']: p for p in photos if p['id'] in {item['hero_id'] for item in chapters}}
        return {'revision': row['revision'] if row else 0, 'chapters': chapters, 'heroes': heroes}

    @app.put(prefix + '/exhibitions/creative/scroll', dependencies=[Depends(owner)])
    def save_scroll(body: ScrollInput, catalog=Depends(get_catalog), scope=Depends(get_scope)):
        photos = fresh_photos(catalog)
        activities = {p['activity_id'] for p in photos}
        ids = {p['id']: p['activity_id'] for p in photos}
        chapters = [item.model_dump() for item in body.chapters]
        if len({item['activity_id'] for item in chapters}) != len(chapters):
            raise HTTPException(422, '章节不可重复')
        for item in chapters:
            if item['activity_id'] not in activities or (item['hero_id'] and ids.get(item['hero_id']) != item['activity_id']):
                raise HTTPException(409, '章节或主图已不可用或不在当前展览中')
            if item['title'] is not None:
                item['title'] = item['title'].strip() or None
        with db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            previous = c.execute('SELECT revision FROM creative_layouts WHERE scope=?', (scope,)).fetchone()
            revision = previous[0] if previous else 0
            if revision != body.revision:
                raise HTTPException(409, '长卷已在其他窗口修改，请重新读取后再保存')
            revision += 1
            c.execute('INSERT OR REPLACE INTO creative_layouts VALUES(?,?,?,?)',
                      (scope, revision, json.dumps(chapters, ensure_ascii=False), time.time()))
        heroes = {p['id']: p for p in photos if p['id'] in {item['hero_id'] for item in chapters}}
        return {'revision': revision, 'chapters': chapters, 'heroes': heroes}
