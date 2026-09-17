"""Resume the task-local citation ledger from retrieved/cached primary text."""
import json, pathlib, subprocess, sys, re
BASE = pathlib.Path(__file__).parent
ROOT = BASE.parent.parent
SCRIPT = pathlib.Path('C:/Users/MohamedSabry/AppData/Local/hermes/skills/research/grounded-citations/scripts/sources.py')
LEDGER = BASE/'ledger.json'

def call(*args):
    p=subprocess.run([sys.executable,str(SCRIPT),'--ledger',str(LEDGER),*map(str,args)],capture_output=True,text=True,encoding='utf-8')
    if p.returncode: raise RuntimeError(p.stdout+p.stderr)
    return p.stdout.strip()

rows=[]
for f in sorted(BASE.glob('retrieval-??.json')):
    for row in json.loads(f.read_text(encoding='utf-8')).get('results',[]):
        if row.get('content') and not row.get('error'): rows.append(row)
for f in ['fresh-primary.json','fresh-secondary-batch.json','fresh-incumbents.json']:
    for row in json.loads((BASE/f).read_text(encoding='utf-8')).get('results',[]):
        if row.get('content') and not row.get('error') and row['content']!='Searching...': rows.append(row)
old=ROOT/'saudi-competitors-evidence'
for row in json.loads((old/'ledger.json').read_text(encoding='utf-8'))['sources']:
    if row['id'] in [3,5,6,7,8,12,13,14,15,16,17]:
        rows.append(dict(url=row['url'],title=row['title'],content=(old/(str(row['id'])+'.txt')).read_text(encoding='utf-8')))
# Register URLs before drafting; retain original identities and append additional sources.
index={}
for row in rows:
    sid=int(re.search(r'\[(\d+)\]',call('add',row['url'],'--title',row.get('title',''))).group(1))
    # Save each extract separately; do not replace a fuller text with an older short cache.
    dest=BASE/f'page-{sid:02d}.txt'
    content=row['content']
    if dest.exists() and len(dest.read_text(encoding='utf-8'))>len(content): content=dest.read_text(encoding='utf-8')
    dest.write_text(content,encoding='utf-8')
    index[sid]={'id':sid,'url':row['url'],'path':str(dest)}
# Exact extracts are evidence, not independent confirmation of vendor claims.
# Attach actual prose paragraphs so broad claims retain inspectable context.
for sid,row in sorted(index.items()):
    content=pathlib.Path(row['path']).read_text(encoding='utf-8')
    paragraphs=[p.strip() for p in re.split(r'\n\s*\n',content) if len(p.strip())>90 and len(p.split())>=5 and not p.lstrip().startswith(('![','[!','URL:')) and '[TRUNCATED]' not in p and '[... middle' not in p]
    for paragraph in paragraphs:
        call('quote',str(sid),'--text',paragraph,'--from',row['path'])
(BASE/'evidence-index.json').write_text(json.dumps(list(index.values()),ensure_ascii=False,indent=2),encoding='utf-8')
print(call('list'))
print('Attached exact paragraphs for',len(index),'sources.')
