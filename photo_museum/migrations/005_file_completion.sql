CREATE TABLE file_completions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 asset_id TEXT NOT NULL REFERENCES entries(id),
 revision TEXT NOT NULL,
 pipeline TEXT NOT NULL,
 steps_json TEXT NOT NULL,
 completed REAL NOT NULL,
 UNIQUE(asset_id, revision, pipeline)
);
CREATE INDEX completed_asset ON file_completions(asset_id,revision);
