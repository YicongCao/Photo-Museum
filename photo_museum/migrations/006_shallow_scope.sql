ALTER TABLE entries ADD COLUMN scope_excluded INTEGER NOT NULL DEFAULT 0;
UPDATE entries SET scope_excluded=1 WHERE EXISTS (
 SELECT 1 FROM sources s WHERE s.id=entries.source_id AND
 (length(substr(entries.path,length(rtrim(s.root,'/'))+2))-length(replace(substr(entries.path,length(rtrim(s.root,'/'))+2),'/',''))) >= CASE WHEN entries.is_dir=1 THEN 1 ELSE 2 END
);
UPDATE media_jobs SET status='excluded',token=NULL,lease_until=NULL WHERE asset_id IN (SELECT id FROM entries WHERE scope_excluded=1);
UPDATE processing_progress SET status='excluded' WHERE asset_id IN (SELECT id FROM entries WHERE scope_excluded=1);
UPDATE scan_dirs SET state='excluded',token=NULL,lease_until=NULL WHERE EXISTS (
 SELECT 1 FROM jobs j JOIN sources s ON s.id=j.source_id WHERE j.id=scan_dirs.job_id AND
 (length(substr(scan_dirs.path,length(rtrim(s.root,'/'))+2))-length(replace(substr(scan_dirs.path,length(rtrim(s.root,'/'))+2),'/',''))) >= 1
);
UPDATE jobs SET status='completed' WHERE status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM scan_dirs d WHERE d.job_id=jobs.id AND d.state NOT IN ('done','excluded'));
