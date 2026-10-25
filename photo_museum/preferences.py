"""Shared durable preferences; no secret values or media rebuild side effects."""
import hashlib,json,math
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field

class Preferences(BaseModel):
 model_config=ConfigDict(extra='forbid')
 gps_mode:Literal['offline','disabled']='offline'
 gps_use_inferred:bool=True
 gps_max_distance_km:float=Field(default=100,ge=1,le=500,allow_inf_nan=False)
 original_loading:Literal['auto','on_demand']='auto'
 hdr_display:Literal['sdr','native_if_supported']='sdr'
class PreferenceInput(Preferences):
 revision:int=Field(default=0,ge=0)

def read_preferences(c):
 row=c.execute("SELECT value FROM settings WHERE key='preferences'").fetchone()
 data=json.loads(row[0]) if row else {}
 return Preferences.model_validate(data.get('values',{})).model_dump()|{'revision':data.get('revision',0)}

def load_preferences(db):
 with db.connect() as c:return read_preferences(c)

def geography_stamp(p,generation=0):
 return hashlib.sha256(json.dumps([p['gps_max_distance_km'],p['gps_use_inferred'],int(generation)],separators=(',',':')).encode()).hexdigest()[:12]

def geography_version(base,p,generation=0):
 return base if p['gps_max_distance_km']==100 and p['gps_use_inferred'] and not generation else base+'-prefs-'+geography_stamp(p,generation)

def allowed_place(place,gps_layer,p):
 if not place:return None
 if not p['gps_use_inferred'] and gps_layer=='inferred':return None
 distance=place.get('distance_m')
 if isinstance(distance,(int,float)) and math.isfinite(distance) and distance>p['gps_max_distance_km']*1000:return None
 return place

def geocode_query():
 return """WITH ranked AS (SELECT m.*,e.revision,row_number() OVER(PARTITION BY m.asset_id ORDER BY CASE layer WHEN 'manual' THEN 0 WHEN 'observed' THEN 1 ELSE 2 END) priority
 FROM metadata m JOIN entries e ON e.id=m.asset_id WHERE m.field='gps' AND m.stale=0 AND e.missing=0 AND e.scope_excluded=0
 AND (m.layer='manual' OR m.source_revision=e.revision) AND (m.layer!='inferred' OR json_extract(m.info_json,'$.accepted')=1))
 SELECT r.* FROM ranked r LEFT JOIN analysis a ON a.asset_id=r.asset_id AND a.provider='places'
 WHERE r.priority=1 AND r.value_json!='null' AND (? OR r.layer!='inferred')
 AND (a.asset_id IS NULL OR a.revision!=r.revision OR a.version!=? OR json_extract(a.data_json,'$.input_record') IS NOT r.record_id)"""
