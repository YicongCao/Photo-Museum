-- Cover hot read-only JSON expressions without parsing visual embeddings per row.
DROP INDEX analysis_readiness;
CREATE INDEX analysis_readiness ON analysis(asset_id,revision,provider,version,
 json_extract(data_json,'$.input_media_version'),json_extract(data_json,'$.input_preview_updated'),
 json_extract(data_json,'$.error'),json_extract(data_json,'$.score'),
 json_extract(data_json,'$.signature'),json_extract(data_json,'$.tags[0].label'));
