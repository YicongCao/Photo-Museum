CREATE TABLE processing_progress (
 asset_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 lane TEXT NOT NULL,
 token TEXT NOT NULL,
 stage TEXT NOT NULL,
 status TEXT NOT NULL,
 steps_json TEXT NOT NULL DEFAULT '{}',
 bytes_done INTEGER NOT NULL DEFAULT 0,
 bytes_total INTEGER,
 updated REAL NOT NULL,
 PRIMARY KEY(asset_id, revision, lane)
);
CREATE INDEX processing_active ON processing_progress(status, updated);
