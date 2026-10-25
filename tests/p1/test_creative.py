import json
import time
import pytest

from photo_museum.creative import projection, tagged_groups
from photo_museum.db import Database
from .test_service import system
from .test_exhibitions import seed


def add_topic(db, row, version='creative-test', preview_delta=0):
    with db.connect() as c:
        media = c.execute('SELECT * FROM media_info WHERE asset_id=?', (row['id'],)).fetchone()
        info = json.loads(media['data_json'])
        c.execute("INSERT OR REPLACE INTO settings VALUES('photography_version','creative-test')")
        data = {'topic': {'labels': [{'id': 'waterscape', 'label': '海岸水景', 'similarity': .31}]},
                'style': {'labels': [{'id': 'monochrome', 'label': '黑白摄影', 'similarity': .3}]},
                'input_media_version': info['version'], 'input_preview_updated': media['updated']+preview_delta}
        c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',
                  (row['id'], row['revision'], 'photography', version, json.dumps(data), 0))


def scoped(db, rows, eid='test-scope'):
    now = time.time()
    with db.connect() as c:
        c.execute('INSERT INTO curator_runs(id,prompt,room,status,created,updated) VALUES(?,?,?,?,?,?)',
                  (eid, 'synthetic', 'cover', 'completed', now, now))
        c.execute('INSERT INTO curator_exhibitions VALUES(?,?,?,?,?,?,1,?)',
                  (eid, eid, 'Synthetic', 'cover', json.dumps([{'id': p['id'], 'revision': p['revision']} for p in rows]), '{}', now))
    return '/api/curator/exhibitions/'+eid+'/exhibitions/creative'


def test_creative_dates_chapters_candidates_and_zero_source_io(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    add_topic(app.state.db, current[0])
    add_topic(app.state.db, current[1], version='stale')
    add_topic(app.state.db, current[2], preview_delta=1)
    before = list(remote.calls)
    overview = client.get('/api/exhibitions/creative').json()
    assert overview['total'] == 5 and overview['unknown'] == 1
    assert [y['year'] for y in overview['years']] == [2024, 2023]
    annual = next(y for y in overview['years'] if y['year'] == 2023)
    assert annual['months'] == [] and annual['month_unknown'] == 1
    assert all(len(y['selected']) <= 5 for y in overview['years'])
    group = next(g for g in overview['groups'] if g['kind'] == 'topic')
    assert group['count'] == 1 and group['candidate'] is True and group['source'] == 'photography'
    assert group['selected'][0]['id'] == current[0]['id']
    photos = client.get('/api/exhibitions/creative/photos', params={'kind': 'group', 'key': group['id']}).json()
    assert photos['total'] == 1 and photos['items'][0]['id'] == current[0]['id']
    assert client.get('/api/exhibitions/creative/photos?kind=year&key=unknown').json()['items'][0]['id'] == current[2]['id']
    assert client.get('/api/exhibitions/creative/photos?kind=month&key=2024-10').json()['total'] == 3
    assert client.get('/api/exhibitions/creative/photos?kind=year&key=2024&offset=1&limit=1').json()['total'] == 3
    assert client.get('/api/exhibitions/creative/photos?kind=bad&key=x').status_code == 422
    assert client.get('/api/exhibitions/creative/photos?kind=year&key=2024&limit=201').status_code == 422
    assert remote.calls == before


def test_revisit_candidates_do_not_claim_same_viewpoint(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    db = app.state.db
    for index, row in enumerate(current[:3]):
        db.set_metadata(row['id'], 'captured_at', f'{2022+index}-10-05', 'manual')
        db.set_metadata(row['id'], 'gps', {'latitude': 43.4, 'longitude': 83.2}, 'observed', row['revision'], 'creative-fixture')
        gps = db.effective(row['id'])['gps']
        place = {'country': 'China', 'country_code': 'CN', 'province': 'Xinjiang', 'city': 'Xinyuan',
                 'geonames_id': '1529046', 'precision': 'nearest_city',
                 'input_record': gps['record_id'] if index != 2 else 'stale'}
        with db.connect() as c:
            c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',
                      (row['id'], row['revision'], 'places', 'fixture', json.dumps(place), 0))
    overview = client.get('/api/exhibitions/creative').json()
    place = overview['places'][0]
    assert place['count'] == 2 and [y['year'] for y in place['years']] == [2022, 2023]
    assert place['candidate'] and place['precision'] == 'nearest_city'
    assert place['label'] == '中国 · 新源'
    assert '需确认' in place['basis']
    data = client.get('/api/exhibitions/creative/photos', params={'kind': 'place', 'key': place['id'], 'year': 2023}).json()
    assert data['total'] == 1 and data['items'][0]['id'] == current[1]['id']


def test_confirmed_pairs_persist_scope_and_recheck_visibility(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    path = '/api/exhibitions/creative/pairs'
    payload = {'left_id': current[0]['id'], 'right_id': current[1]['id'], 'title': '手工确认', 'confirmed': True}
    assert client.post(path, json=payload | {'confirmed': False}).status_code == 422
    assert client.post(path, json=payload | {'right_id': current[0]['id']}).status_code == 422
    assert client.post(path, json=payload | {'right_id': 'not-present'}).status_code == 409
    before = list(remote.calls)
    saved = client.post(path, json=payload).json()
    assert saved['left']['id'] == current[0]['id'] and saved['confirmed']
    assert client.get(path).json()['items'][0]['id'] == saved['id']
    with Database(app.state.db.directory).connect() as c:
        assert c.execute('SELECT title FROM creative_pairs WHERE id=?', (saved['id'],)).fetchone()[0] == '手工确认'
    scope = scoped(app.state.db, current[:1])
    assert client.get(scope+'/pairs').json()['items'] == []
    assert client.post(scope+'/pairs', json=payload).status_code == 409
    client.post('/api/assets/'+current[0]['id']+'/curation', json={'excluded': True})
    assert client.get(path).json()['items'] == []
    assert client.post(path, json=payload).status_code == 409
    assert remote.calls == before


def test_scroll_optimistic_edits_and_curated_collection_limits(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    overview = client.get('/api/exhibitions/creative').json()
    chapter = next(c for c in overview['chapters'] if c['event'].get('year') == 2024)
    path = '/api/exhibitions/creative/scroll'
    assert client.get(path).json() == {'revision': 0, 'chapters': [], 'heroes': {}}
    payload = {'revision': 0, 'chapters': [{'activity_id': chapter['id'], 'title': '自己的章节', 'hero_id': current[0]['id']}]}
    saved = client.put(path, json=payload).json()
    assert saved['revision'] == 1 and client.get(path).json() == saved
    assert client.put(path, json=payload).status_code == 409
    assert client.put(path, json={'revision': 1, 'chapters': payload['chapters']*2}).status_code == 422
    scope = scoped(app.state.db, current[:1])
    scoped_overview = client.get(scope).json()
    assert scoped_overview['total'] == 1 and scoped_overview['chapters'][0]['count'] == 1
    assert client.get(scope+'/photos', params={'kind': 'chapter', 'key': chapter['id']}).json()['total'] == 1
    assert client.get(scope+'/scroll').json()['revision'] == 0
    assert client.put(scope+'/scroll', json=payload | {'chapters': [payload['chapters'][0] | {'hero_id': current[1]['id']}]}).status_code == 409
    assert client.put(scope+'/scroll', json=payload).status_code == 200
    client.post('/api/assets/'+current[0]['id']+'/curation', json={'excluded': True})
    assert client.get(path).json()['chapters'][0]['hero_id'] is None


def test_creative_endpoints_require_auth_and_same_origin(system):
    app, client, remote, sid = system
    assert client.put('/api/exhibitions/creative/scroll', json={'revision': 0, 'chapters': []},
                      headers={'Origin': 'https://example.org'}).status_code == 403
    client.post('/api/logout', json={})
    for path in ('', '/photos?kind=year&key=2024', '/pairs', '/scroll', '/resolve?ids=one'):
        assert client.get('/api/exhibitions/creative'+path).status_code == 401


def test_creative_summary_bounds_without_inventing_photos(tmp_path):
    # The projection is exercised against a deliberately long dated catalog.
    db = Database(tmp_path/'long')
    photos = [{'id': str(n), 'period': str(1900+n), 'activity_id': str(n), 'event': {'theme': f'Year {n}'},
               'score': None, 'name': str(n), 'captured_at': None, 'place': None, 'gps': None}
              for n in range(90)]
    result = projection(db, photos)
    assert len(result['years']) == 80 and result['year_total'] == 90
    assert result['total'] == 90 and len(result['chapters']) == 90


def test_creative_preview_budget_preserves_complete_collection_counts(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    # Many activity summaries duplicate representatives in year and chapter views.
    photos = [{'id': str(n), 'period': str(1950+n%70), 'activity_id': str(n//6), 'event': {'theme': f'Activity {n//6}'},
               'score': n%100, 'name': str(n), 'captured_at': None, 'place': None, 'gps': None}
              for n in range(3000)]
    result = projection(app.state.db, photos)
    groups = [*result['years'], *result['chapters'], *result['groups'], *result['places']]
    groups += [a for y in result['years'] for a in y['activities']]
    groups += [y for p in result['places'] for y in p['years']]
    assert sum(len(g['selected']) for g in groups) == result['sample_records'] == 1200
    assert result['sample_records_omitted'] > 0
    assert sum(c['count'] for c in result['chapters']) == result['total'] == 3000
    assert all(c['selected'] for c in result['chapters'])


def test_new_curator_rooms_prepare_and_retain_the_same_selection(system):
    import asyncio
    from photo_museum.curator_tools import LocalTools, ROOMS
    current, rows = seed(system)
    app, client, remote, sid = system
    assert len(ROOMS) == 10
    before = list(remote.calls)
    for room in ('rings', 'constellation', 'scroll', 'revisit'):
        rid = 'creative-'+room
        local = LocalTools(app.state.db, app.state.exhibitions, rid, room)
        found = local.dispatch('search_photos', {'filters': {'years': [2024]}})
        draft = local.dispatch('create_exhibition', {'title': 'Synthetic', 'search_id': found['search_id'], 'room': room})
        assert draft['count'] == 3 and draft['room'] == room
        now = time.time()
        with app.state.db.connect() as c:
            c.execute('INSERT INTO curator_runs(id,prompt,room,status,created,updated) VALUES(?,?,?,?,?,?)',
                      (rid, 'Synthetic', room, 'running', now, now))
        asyncio.run(app.state.curator.prepare(rid, local.draft))
        eid = app.state.curator.get_run(rid)['exhibition_id']
        prefix = '/api/curator/exhibitions/'+eid+'/exhibitions/creative'
        assert client.get(prefix).json()['total'] == 3
        assert client.get(prefix+'/photos?kind=year&key=2023').json()['total'] == 0
        assert client.get(prefix+'/photos?kind=year&key=2024').json()['total'] == 3
        assert client.get(prefix+'/pairs').json()['items'] == []
    assert remote.calls == before


def test_creative_draft_resolver_rechecks_current_scope_and_revision(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    db = app.state.db
    scope = scoped(db, current[:1])
    path = '/api/exhibitions/creative/resolve'
    wanted = ','.join(row['id'] for row in current[:2])
    before = list(remote.calls)
    found = client.get(path, params={'ids': wanted}).json()['items']
    assert [p['id'] for p in found] == [row['id'] for row in current[:2]]
    assert [p['revision'] for p in found] == [row['revision'] for row in current[:2]]
    assert len(client.get(scope+'/resolve', params={'ids': wanted}).json()['items']) == 1
    assert client.get(path, params={'ids': current[0]['id']+','+current[0]['id']}).status_code == 422
    assert client.get(path, params={'ids': 'one,two,three'}).status_code == 422
    # Change visibility directly without invalidating the cached catalog: draft
    # restoration must still see the current state immediately.
    with db.connect() as c:
        c.execute('INSERT OR REPLACE INTO curation VALUES(?,?,?,?)', (current[1]['id'], 0, 1, 0))
    assert len(client.get(path, params={'ids': wanted}).json()['items']) == 1
    with db.connect() as c:
        for table, column in [('entries', 'id'), ('media_info', 'asset_id'), ('cache_files', 'asset_id')]:
            c.execute(f'UPDATE {table} SET revision=? WHERE {column}=?', ('new-draft-revision', current[0]['id']))
    assert client.get(path, params={'ids': wanted}).json()['items'][0]['revision'] == 'new-draft-revision'
    assert client.get(scope+'/resolve', params={'ids': wanted}).json()['items'] == []
    assert remote.calls == before


@pytest.mark.parametrize('changed_input', ['revision', 'media_version'])
def test_creative_tags_do_not_mix_current_analysis_with_cached_input(system, changed_input):
    current, rows = seed(system)
    app, client, remote, sid = system
    db, row = app.state.db, current[0]
    add_topic(db, row)
    scope = scoped(db, [row])
    cached = app.state.exhibitions.photos()
    before = list(remote.calls)
    assert {g['kind'] for g in tagged_groups(db, cached).values()
            if row['id'] in g['_photos']} == {'subject', 'topic', 'style'}
    with db.connect() as c:
        if changed_input == 'revision':
            for table, column in [('entries', 'id'), ('media_info', 'asset_id'),
                                  ('media_jobs', 'asset_id'), ('cache_files', 'asset_id'), ('analysis', 'asset_id')]:
                c.execute(f'UPDATE {table} SET revision=? WHERE {column}=?', ('new-revision', row['id']))
        else:
            c.execute("UPDATE media_info SET data_json=json_set(data_json,'$.version','new-preview') WHERE asset_id=?", (row['id'],))
            c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.input_media_version','new-preview') WHERE asset_id=?", (row['id'],))
    # Hold the cached projection in its normal five-second cache window. The
    # current tags are valid for the new input, but must not attach to the old one.
    app.state.exhibitions.loaded = time.monotonic()
    assert not any(row['id'] in group['_photos'] for group in tagged_groups(db, cached).values())
    assert client.get(scope).json()['groups'] == []
    app.state.exhibitions.invalidate()
    fresh = app.state.exhibitions.photos()
    assert {g['kind'] for g in tagged_groups(db, fresh).values()
            if row['id'] in g['_photos']} == {'subject', 'topic', 'style'}
    if changed_input == 'revision':
        assert client.get(scope).json()['total'] == 0
    assert remote.calls == before


def test_creative_group_quotas_preserve_each_kind_and_report_visible_counts(system):
    current, rows = seed(system)
    app, client, remote, sid = system
    db = app.state.db
    add_topic(db, current[2])
    with db.connect() as c:
        c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.tags',json('[]')) WHERE provider='visual'")
        for row in current[:2]:
            tags = [{'class_index': 9000+i, 'label': f'valid subject {i:02}', 'confidence': .8} for i in range(35)]
            c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.tags',json(?)) WHERE asset_id=? AND provider='visual'", (json.dumps(tags), row['id']))
        data = json.loads(c.execute("SELECT data_json FROM analysis WHERE asset_id=? AND provider='photography'", (current[2]['id'],)).fetchone()[0])
        for axis in ('topic', 'style'):
            data[axis]['labels'] = [{'id': f'{axis}-{i:02}', 'label': f'{axis} {i:02}', 'similarity': .3} for i in range(35)]
        c.execute("UPDATE analysis SET data_json=? WHERE asset_id=? AND provider='photography'", (json.dumps(data), current[2]['id']))
    before = list(remote.calls)
    overview = client.get('/api/exhibitions/creative').json()
    assert overview['group_total'] == 105 and len(overview['groups']) == 90
    assert overview['group_counts'] == {kind: {'total': 35, 'visible': 30} for kind in ('subject', 'style', 'topic')}
    assert all(sum(g['kind'] == kind for g in overview['groups']) == 30 for kind in overview['group_counts'])
    # Overview limits do not truncate the membership endpoint, including groups
    # outside the representative list and subject groups containing two photos.
    groups = tagged_groups(db, app.state.exhibitions.photos())
    omitted = next(group for group in groups.values() if group['kind'] == 'subject'
                   and group['id'] not in {g['id'] for g in overview['groups']})
    detail = client.get('/api/exhibitions/creative/photos', params={'kind': 'group', 'key': omitted['id'], 'limit': 1}).json()
    assert detail['total'] == 2 and len(detail['items']) == 1
    assert remote.calls == before
