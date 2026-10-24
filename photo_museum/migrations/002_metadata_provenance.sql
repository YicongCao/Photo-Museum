ALTER TABLE metadata ADD COLUMN record_id TEXT;
ALTER TABLE metadata ADD COLUMN info_json TEXT NOT NULL DEFAULT '{}';
UPDATE metadata SET record_id=lower(hex(randomblob(16)));
ALTER TABLE dependencies ADD COLUMN donor_record_id TEXT;
CREATE TABLE metadata_history(id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL, field TEXT NOT NULL, layer TEXT NOT NULL,
 record_json TEXT NOT NULL, archived REAL NOT NULL);
CREATE TABLE extractions(asset_id TEXT NOT NULL REFERENCES entries(id), source_revision TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('extracted','unsupported','read_failed','corrupt')),
 extractor_version TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY(asset_id,source_revision));
