"""P6 UI fixture reuses the validated P5 synthetic library; no external LLM or NAS."""
import os,runpy
from pathlib import Path
os.environ['MUSEUM_FIXTURE_PORT']='8796'
os.environ['MUSEUM_VALIDATION_CURATOR']='1'
os.environ['MUSEUM_WEB_DIST']=str(Path('data/p6-validation/web-dist').resolve())
runpy.run_path('tools/p5_validation_server.py',run_name='__main__')
