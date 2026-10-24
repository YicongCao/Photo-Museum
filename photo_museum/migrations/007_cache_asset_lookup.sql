-- Recent-media EXISTS checks and cache lookups must not rescan the entire cache.
CREATE INDEX cache_asset_revision_profile ON cache_files(asset_id, revision, profile);
