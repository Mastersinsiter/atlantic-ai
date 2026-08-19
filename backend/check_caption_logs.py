import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

with open('full_status.json', encoding='utf-8-sig') as f:
    s = json.load(f)

logs = s.get('logs') or []
print(f'total log lines: {len(logs)}')
print('--- ALL lines mentioning caption/align/cue/clip 2 (verbatim):')
for l in logs:
    m = str(l.get('msg', l))
    if any(k in m.lower() for k in ('caption', 'align', 'cue', 'clip 2', 'clip 1', 'stable', 'segment')):
        print(' ', l)
