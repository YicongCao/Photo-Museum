"""Local synthetic container/TLS checks. No production owner or source credentials."""
import json
import ssl
from pathlib import Path
import httpx

results=[]
for base,verify in [('http://127.0.0.1:8792',True),('https://127.0.0.1:8794',ssl.create_default_context(cafile='data/p2-verification/tls/cert.pem'))]:
 with httpx.Client(base_url=base,verify=verify,headers={'Origin':base}) as c:
  initial=c.get('/api/bootstrap');initial.raise_for_status()
  assert c.get('/api/state').status_code==401
  if not initial.json()['initialized']:
   r=c.post('/api/setup',json={'password':'synthetic-deployment-password'});assert r.status_code==200,r.text
  else:
   r=c.post('/api/login',json={'password':'synthetic-deployment-password'});assert r.status_code==200,r.text
  assert c.get('/api/state').status_code==200
  assert c.get('/api/media/state').status_code==200
  assert c.get('/').status_code==200
  assert c.get('/api/gallery').status_code==200
  if base.startswith('https:'):
   assert next(x for x in c.cookies.jar if x.name=='museum_session').secure
  assert c.post('/api/logout',json={}).status_code==200
  assert c.get('/api/media/state').status_code==401
  results.append({'url':base,'checks':['anonymous_denied','password_setup_login','state','media_state','gallery','static_UI','logout_revoked'],'trusted_certificate':base.startswith('https:')})
Path('docs/research/deployment-evidence.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
