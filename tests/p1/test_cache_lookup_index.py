from photo_museum.db import Database


def test_cache_lookup_uses_composite_index_after_upgrade(tmp_path):
    db = Database(tmp_path)
    with db.connect() as c:
        # Recreate the previous schema version, retaining a cache record across upgrade.
        c.execute('DROP INDEX cache_asset_revision_profile')
        c.execute('PRAGMA user_version=6')
        c.execute("INSERT INTO cache_files VALUES('test','asset','revision','thumb','fixture.webp',10,0)")
    Database(tmp_path)
    with db.connect() as c:
        plan = ' '.join(row[3] for row in c.execute(
            'EXPLAIN QUERY PLAN SELECT 1 FROM cache_files WHERE asset_id=? AND revision=? AND profile=?',
            ('asset','revision','thumb')))
        assert 'SEARCH' in plan and 'cache_asset_revision_profile' in plan
        assert c.execute('SELECT count(*) FROM cache_files').fetchone()[0] == 1
