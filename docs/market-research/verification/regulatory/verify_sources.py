"""Rebuild task-specific evidence from saved extracts and primary downloads."""
import json, pathlib, subprocess, sys, re, io
import requests
from pypdf import PdfReader
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(__file__).resolve().parent
SCRIPT=pathlib.Path('C:/Users/MohamedSabry/AppData/Local/hermes/skills/research/grounded-citations/scripts/sources.py')
docs={}
for value in json.loads((ROOT/'saudi-source-extracts.json').read_text(encoding='utf-8')).values():
    for r in value['results']:
        if r.get('content'): docs[r['url']]=r
for f in sorted(OUT.glob('live-batch*.json')):
    for r in json.loads(f.read_text(encoding='utf-8'))['results']:
        if r.get('content') and len(r['content'])>len(docs.get(r['url'],{}).get('content','')): docs[r['url']]=r
urls=[
'https://nphies.sa/storage/library-files/01KBMWZ2KFSH7X8M1P5BWFZ2VP.pdf',
'https://dga.gov.sa/sites/default/files/2024-03/Digital%20Government%20Policies%20-%20V2.0.pdf',
'https://www.chi.gov.sa/en/Rules/MedicalStandards/CHI-DRG-ImplementationGuidelines.pdf',
]
for u in urls:
    try:
        r=requests.get(u,timeout=70); r.raise_for_status()
        text='\n'.join(f'\n--- PDF page {i+1} ---\n'+p.extract_text() for i,p in enumerate(PdfReader(io.BytesIO(r.content)).pages))
        docs[u]={'url':u,'content':text,'title':u.split('/')[-1],'retrieval':'Direct primary PDF; review cutoff 2026-09-11','last_modified':r.headers.get('Last-Modified')}
        print('DOWNLOADED',u,len(text))
    except Exception as e: print('FAIL',u,str(e))
(OUT/'evidence-documents.json').write_text(json.dumps(docs,ensure_ascii=False,indent=2),encoding='utf-8')
for i,(u,r) in enumerate(docs.items(),1):
    (OUT/f'primary-{i:02}.txt').write_text(r['content'],encoding='utf-8')
    print(i,u,len(r['content']))
