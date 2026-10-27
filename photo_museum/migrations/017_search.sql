CREATE TABLE search_collections(id TEXT PRIMARY KEY, filters_json TEXT NOT NULL, ordering TEXT NOT NULL, created REAL NOT NULL);
CREATE TRIGGER search_people_update AFTER UPDATE OF label ON people WHEN OLD.label IS NOT NEW.label BEGIN UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1; END;
CREATE TRIGGER search_faces_insert AFTER INSERT ON faces BEGIN UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1; END;
CREATE TRIGGER search_faces_delete AFTER DELETE ON faces BEGIN UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1; END;
CREATE TRIGGER search_faces_update AFTER UPDATE OF person_id,manual,model,revision ON faces BEGIN UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1; END;
CREATE TABLE keyword_reviews(asset_id TEXT NOT NULL REFERENCES entries(id), revision TEXT NOT NULL, keyword_id TEXT NOT NULL,
 verdict INTEGER NOT NULL CHECK(verdict IN (-1,1)), tag_json TEXT NOT NULL, token TEXT NOT NULL, updated REAL NOT NULL,
 PRIMARY KEY(asset_id,revision,keyword_id));
CREATE TRIGGER reviews_insert AFTER INSERT ON keyword_reviews BEGIN
 UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1;
 INSERT INTO lexicon_dirty VALUES(NEW.asset_id,hex(randomblob(16))) ON CONFLICT(asset_id) DO UPDATE SET token=excluded.token;
END;
CREATE TRIGGER reviews_update AFTER UPDATE ON keyword_reviews BEGIN
 UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1;
 INSERT INTO lexicon_dirty VALUES(NEW.asset_id,hex(randomblob(16))) ON CONFLICT(asset_id) DO UPDATE SET token=excluded.token;
END;
CREATE TRIGGER reviews_delete AFTER DELETE ON keyword_reviews BEGIN
 UPDATE runtime_revision SET catalog=catalog+1 WHERE id=1;
 INSERT INTO lexicon_dirty VALUES(OLD.asset_id,hex(randomblob(16))) ON CONFLICT(asset_id) DO UPDATE SET token=excluded.token;
END;
