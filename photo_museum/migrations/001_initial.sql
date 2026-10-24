CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts(peer TEXT PRIMARY KEY, failures INTEGER NOT NULL, until REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, root TEXT NOT NULL,
 username TEXT NOT NULL, secret TEXT NOT NULL, ca_pem TEXT, allow_http INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), root TEXT NOT NULL,
 status TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, error TEXT, files_seen INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS scan_dirs(id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), path TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available REAL NOT NULL DEFAULT 0,
 token TEXT, lease_until REAL, error TEXT, UNIQUE(job_id,path));
CREATE INDEX IF NOT EXISTS queue_ready ON scan_dirs(state,available,lease_until);
CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), path TEXT NOT NULL,
 parent TEXT NOT NULL, is_dir INTEGER NOT NULL, kind TEXT NOT NULL, size INTEGER, modified TEXT, etag TEXT,
 revision TEXT NOT NULL, version_quality TEXT NOT NULL, event_json TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0,
 seen_job TEXT NOT NULL, updated REAL NOT NULL, UNIQUE(source_id,path));
CREATE INDEX IF NOT EXISTS entry_parent ON entries(source_id,parent,missing);
CREATE TABLE IF NOT EXISTS metadata(asset_id TEXT NOT NULL REFERENCES entries(id), field TEXT NOT NULL,
 layer TEXT NOT NULL CHECK(layer IN ('observed','inferred','manual')), value_json TEXT NOT NULL,
 source_revision TEXT, rule_version TEXT, stale INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL,
 PRIMARY KEY(asset_id,field,layer));
CREATE TABLE IF NOT EXISTS dependencies(asset_id TEXT NOT NULL, field TEXT NOT NULL, donor_id TEXT NOT NULL REFERENCES entries(id),
 donor_revision TEXT NOT NULL, PRIMARY KEY(asset_id,field,donor_id));
CREATE INDEX IF NOT EXISTS donor_lookup ON dependencies(donor_id);
CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY, heartbeat REAL NOT NULL);
CREATE TABLE IF NOT EXISTS derivatives(asset_id TEXT NOT NULL REFERENCES entries(id), revision TEXT NOT NULL,
 profile TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', path TEXT, PRIMARY KEY(asset_id,revision,profile));
