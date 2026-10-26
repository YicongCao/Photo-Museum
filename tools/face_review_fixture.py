"""Synthetic vectors for deterministic UI questions, not model quality evidence."""
import numpy as np

def enrich(db):
 with db.connect() as c:
  c.execute('UPDATE faces SET embedding=?',(np.array([0.,0.,-1.],dtype=np.float32).tobytes(),))
  for k,v in enumerate(([1,0,0],[.8,.6,0],[.8,-.6,0])):
   c.execute('UPDATE faces SET embedding=?,manual=1 WHERE id=?',(np.array(v,dtype=np.float32).tobytes(),f'fixture-face-000-{k}'))
  c.execute("UPDATE people SET label='示例人物甲' WHERE id='fixture-person-000'")
  c.execute("UPDATE people SET label='示例人物乙' WHERE id='fixture-person-040'")
  c.execute("UPDATE faces SET embedding=?,manual=1 WHERE person_id='fixture-person-040'",(np.array([0.,0.,1.],dtype=np.float32).tobytes(),))
  for n,v in [(5,[.6,.8,0]),(6,[.72,-.69,0]),(8,[.45,.89,0]),(9,[0,.8,.6])]:
   c.execute('UPDATE faces SET embedding=? WHERE person_id=?',(np.array(v,dtype=np.float32).tobytes(),f'fixture-person-{n:03}'))
