"""Offline Chinese display names. Never modifies observations, coordinates or model scores."""
import hashlib
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

FIELDS=('country','province','city','district','street')
ROOT=Path(__file__).with_name('locales')
def _key(value):
    return ''.join(c for c in unicodedata.normalize('NFKD',str(value)).casefold() if c.isalnum() and not unicodedata.combining(c))
def _han(value):
    return isinstance(value,str) and bool(re.search('[\u3400-\u9fff]',value))
def _unique_add(mapping,key,value):
    if key in mapping and mapping[key]!=value:mapping[key]=None
    else:mapping[key]=value

@lru_cache(maxsize=1)
def catalog():
    raw=(ROOT/'geonames-zh.json').read_bytes();tags_raw=(ROOT/'imagenet-zh.json').read_bytes()
    geo=json.loads(raw);tags=json.loads(tags_raw)
    provinces={};province_codes={};cities={};global_cities={};subjects={};canonical={}
    for gid,p in geo['places'].items():
        for alias in (p['name'],p['ascii']):
            if p['kind']=='province':
                provinces[_key(alias)]=p['zh'];province_codes[_key(alias)]=p['province_code']
            else:
                _unique_add(cities,(_key(p['province_code']),_key(alias)),p['zh'])
                _unique_add(global_cities,_key(alias),p['zh'])
        if p['kind']=='province':provinces[_key(p['province_code'])]=p['zh']
    for tag in tags:
        _unique_add(canonical,' '.join(tag['en'].casefold().split()),tag['zh'])
        for label in {tag['en'],tag['source_en'],*tag['en'].split(', ')}:
            _unique_add(subjects,' '.join(label.casefold().split()),tag['zh'])
    subjects.update(canonical)
    return dict(geo=geo,provinces=provinces,province_codes=province_codes,cities=cities,global_cities=global_cities,subjects=subjects,
                synsets={t['synset']:t for t in tags},indices={t['index']:t for t in tags},
                version='zh-display-v1-'+hashlib.sha256(raw+tags_raw).hexdigest()[:12])

def localize_tags(tags):
    if not isinstance(tags,list):return []
    c=catalog();result=[]
    for tag in tags:
        if not isinstance(tag,dict):continue
        label=tag.get('label');translated=None;source=None
        if _han(label):translated=label;source='original'
        elif isinstance(label,str):
            entry=c['synsets'].get(tag.get('synset'))
            index=tag.get('class_index')
            if not entry and tag.get('taxonomy')=='imagenet1k' and type(index) is int:entry=c['indices'].get(index)
            if entry:translated=entry['zh'];source='imagenet1k-synset'
            else:
                translated=c['subjects'].get(' '.join(label.casefold().split()))
                if translated:source='imagenet1k-unique-label'
        result.append({**tag,'label_zh':translated,'label_translation_source':source,'label_translation_version':c['version']})
    return result

def localize_place(place):
    if not isinstance(place,dict):return place
    code=place.get('country_code')
    code=code.upper() if isinstance(code,str) else code
    is_china=code in ('CN','CHN') if code else _key(place.get('country','')) in ('china','中国')
    if not is_china:return dict(place)
    c=catalog();geo=c['geo'];places=geo['places'];display={k:place.get(k) for k in FIELDS};sources={}
    display['country']='中国';sources['country']='country-code'
    city=places.get(str(place.get('geonames_id','')),{})
    province_code=place.get('province_code') or city.get('province_code') or c['province_codes'].get(_key(place.get('province','')))
    if province_code and not str(province_code).startswith('CN.'):province_code='CN.'+str(province_code)
    province_id=place.get('province_geonames_id') or geo['provinces'].get(province_code)
    province=places.get(str(province_id),{})
    for field in FIELDS[1:]:
        value=place.get(field)
        if not isinstance(value,str) or not value or _han(value):continue
        explicit=place.get(field+'_zh')
        if _han(explicit):display[field]=explicit;sources[field]='provider-zh';continue
        entry=province if field=='province' else city if field=='city' else places.get(str(place.get(field+'_geonames_id','')), {})
        translated=entry.get('zh')
        if translated:sources[field]='geonames-id'
        elif field=='province':
            translated=c['provinces'].get(_key(value))
            if translated:sources[field]='geonames-admin-name'
        elif field=='city':
            translated=c['cities'].get((_key(province_code),_key(value))) if province_code else c['global_cities'].get(_key(value))
            if translated:sources[field]='geonames-unique-name'
        if translated:display[field]=translated
    return {**place,'display_zh':display,'name_translation_sources':sources,'name_translation_version':c['version']}
