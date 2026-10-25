def drop_lexicon(c):
    for row in c.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'lexicon_*'").fetchall():
        c.execute('DROP TRIGGER "'+row[0].replace('"','""')+'"')
    for table in ('lexicon_asset_terms','lexicon_aliases','lexicon_terms','lexicon_dirty','lexicon_state','lexicon_generations'):
        c.execute('DROP TABLE '+table)
