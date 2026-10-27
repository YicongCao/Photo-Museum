def drop_lexicon(c):
    for row in c.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'lexicon_*'").fetchall():
        c.execute('DROP TRIGGER "'+row[0].replace('"','""')+'"')
    # These tests reconstruct v5/v6: remove later runtime/search objects too.
    for row in c.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND (name GLOB 'runtime_*' OR name GLOB 'telemetry_*' OR name GLOB 'search_*' OR name GLOB 'reviews_*')").fetchall():
        c.execute('DROP TRIGGER "'+row[0].replace('"','""')+'"')
    for table in ('keyword_reviews','search_collections','runtime_revision'):
        c.execute('DROP TABLE IF EXISTS '+table)
    for index in ('media_readiness','analysis_readiness'):
        c.execute('DROP INDEX IF EXISTS '+index)
    for table in ('lexicon_asset_terms','lexicon_aliases','lexicon_terms','lexicon_dirty','lexicon_state','lexicon_generations'):
        c.execute('DROP TABLE '+table)
