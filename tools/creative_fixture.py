"""Explicit synthetic annotations for creative-gallery UI tests, never real analysis."""
import json
import time


def enrich(db):
    with db.connect() as c:
        rows = c.execute('SELECT e.id,e.revision,m.data_json,m.updated FROM entries e JOIN media_info m ON m.asset_id=e.id AND m.revision=e.revision WHERE e.is_dir=0 ORDER BY e.path').fetchall()
        c.execute("INSERT OR REPLACE INTO settings VALUES('photography_version','creative-synthetic-v1')")
        topics = [('waterscape', '海岸水景'), ('landscape', '山野风景'), ('architecture', '建筑空间'),
                  ('street', '街头生活'), ('travel', '旅行记录')]
        styles = [('minimalism', '极简摄影'), ('cinematic', '电影感'), ('monochrome', '黑白摄影')]
        for n, row in enumerate(rows):
            info = json.loads(row['data_json'])
            tid, topic = topics[n % len(topics)]
            sid, style = styles[n % len(styles)]
            data = {'topic': {'status': 'candidates', 'labels': [{'id': tid, 'label': topic, 'similarity': .32, 'candidate': True}]},
                    'style': {'status': 'candidates', 'labels': [{'id': sid, 'label': style, 'similarity': .3, 'candidate': True}]},
                    'input_media_version': info['version'], 'input_preview_updated': row['updated'],
                    'method': 'synthetic-fixture', 'offline': True, 'calibrated': False}
            c.execute('INSERT OR REPLACE INTO analysis VALUES(?,?,?,?,?,?)',
                      (row['id'], row['revision'], 'photography', 'creative-synthetic-v1', json.dumps(data, ensure_ascii=False), time.time()))
            c.execute("UPDATE analysis SET data_json=json_set(data_json,'$.score',?) WHERE asset_id=? AND provider='visual'",
                      (65 + n % 30, row['id']))
