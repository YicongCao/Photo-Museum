CREATE TABLE IF NOT EXISTS face_reviews (
 id TEXT PRIMARY KEY, face_id TEXT NOT NULL, person_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('yes','no')),
 previous_person_id TEXT, previous_manual INTEGER NOT NULL,
 model TEXT NOT NULL, revision TEXT NOT NULL, similarity REAL NOT NULL,
 created REAL NOT NULL, policy TEXT NOT NULL DEFAULT 'confirmed-multi-v1', valid INTEGER NOT NULL DEFAULT 1, undone REAL
);
CREATE INDEX IF NOT EXISTS face_reviews_pair ON face_reviews(face_id,person_id,decision,undone);
CREATE TABLE IF NOT EXISTS face_matches (
 face_id TEXT PRIMARY KEY, person_id TEXT NOT NULL, model TEXT NOT NULL,
 policy TEXT NOT NULL, similarity REAL NOT NULL, support INTEGER NOT NULL,
 margin REAL NOT NULL, created REAL NOT NULL
);
