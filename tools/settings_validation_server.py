"""Unified-settings fixture with generated photos, local fake LLM and offline address data."""
import os,runpy
from pathlib import Path
os.environ['MUSEUM_FIXTURE_PORT']='8797'
os.environ['MUSEUM_VALIDATION_CURATOR']='1'
os.environ['MUSEUM_VALIDATION_SETTINGS']='1'
os.environ['MUSEUM_WEB_DIST']=str(Path('data/settings-validation/web-dist').resolve())
runpy.run_path('tools/p5_validation_server.py',run_name='__main__')
