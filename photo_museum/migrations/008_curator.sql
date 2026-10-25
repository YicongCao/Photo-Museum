CREATE TABLE curator_runs(id TEXT PRIMARY KEY,prompt TEXT NOT NULL,room TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',exhibition_id TEXT,error TEXT,created REAL NOT NULL,updated REAL NOT NULL);
CREATE TABLE curator_events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES curator_runs(id) ON DELETE CASCADE,kind TEXT NOT NULL,data_json TEXT NOT NULL,created REAL NOT NULL);
CREATE INDEX curator_events_run ON curator_events(run_id,id);
CREATE TABLE curator_exhibitions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES curator_runs(id),title TEXT NOT NULL,room TEXT NOT NULL,assets_json TEXT NOT NULL,selection_json TEXT NOT NULL,prepared INTEGER NOT NULL DEFAULT 0,created REAL NOT NULL);
CREATE UNIQUE INDEX curator_one_draft ON curator_exhibitions(run_id);
