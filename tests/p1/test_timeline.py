import json
from photo_museum.gallery import activity_time
from photo_museum.media_worker import MediaWorker
from .test_media import jpeg
from .test_service import system, scan
from .fixture import ROOT


def test_capture_order_ignores_invalid_and_outside_declared_period():
    rows = [{'data_json': json.dumps({'captured_at': value})} for value in [
        '2026:10:09 13:00:00', '2026-10-22T08:00:00', '2027:10:30 00:00:00',
        '2026:11:30 00:00:00', '2026:10:99 00:00:00', None]]
    assert activity_time({'year': 2026, 'month': 10}, rows) == '2026-10-22T08:00:00'
    assert activity_time({'year': 2025}, rows) == ''


def test_gallery_orders_same_month_by_capture_time(system):
    app, client, remote, sid = system
    remote.entries = {ROOT: None}
    for theme in ['2026-10-A', '2026-10-Z', '2026-11-B']:
        directory = ROOT + '/' + theme
        remote.entries.update({directory: None, directory + '/one.jpg': jpeg()})
    scan(app, client, sid)
    worker = MediaWorker(app.state.db)
    while worker.tick(): pass
    with app.state.db.connect() as c:
        for row in c.execute('SELECT e.id,e.path,m.data_json FROM entries e JOIN media_info m ON m.asset_id=e.id').fetchall():
            data = json.loads(row['data_json'])
            data['captured_at'] = '2026:10:25 12:00:00' if '/2026-10-A/' in row['path'] else '2026:10:01 12:00:00'
            c.execute('UPDATE media_info SET data_json=? WHERE asset_id=?', (json.dumps(data), row['id']))
    activities = client.get('/api/gallery').json()['activities']
    assert [a['event']['theme'] for a in activities] == ['B', 'A', 'Z']
