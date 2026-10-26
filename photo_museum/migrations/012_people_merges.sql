-- Private local identity corrections, retained for explicit undo.
CREATE TABLE IF NOT EXISTS people_merges (
 id TEXT PRIMARY KEY,
 target_id TEXT NOT NULL,
 sources_json TEXT NOT NULL,
 faces_json TEXT NOT NULL,
 created REAL NOT NULL,
 valid INTEGER NOT NULL DEFAULT 1,
 undone REAL
);
