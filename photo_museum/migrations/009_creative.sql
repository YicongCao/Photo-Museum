CREATE TABLE creative_pairs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    left_id TEXT NOT NULL REFERENCES entries(id),
    left_revision TEXT NOT NULL,
    right_id TEXT NOT NULL REFERENCES entries(id),
    right_revision TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created REAL NOT NULL,
    updated REAL NOT NULL,
    CHECK (left_id != right_id)
);
CREATE INDEX creative_pairs_scope ON creative_pairs(scope, updated DESC);
CREATE TABLE creative_layouts (
    scope TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    updated REAL NOT NULL
);
