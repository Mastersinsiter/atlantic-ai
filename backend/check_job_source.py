import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

with open('full_status.json', encoding='utf-8-sig') as f:
    s = json.load(f)
with open('_cues.json', encoding='utf-8-sig') as f:
    C = json.load(f)

print('job id:', s.get('id'))
print('status:', s.get('status'))

# Q1: heuristic fallback vs Gemini-selected
logs = s.get('logs') or []
if isinstance(logs, dict):
    logs = logs.get('lines') or logs.get('entries') or []
print(f'log lines: {len(logs)}')
pad = [l for l in logs if 'heuristic' in str(l).lower() or 'padding' in str(l).lower()]
gem = [l for l in logs if 'gemini' in str(l).lower()]
print('--- lines mentioning heuristic/padding:')
for l in pad: print('  ', l)
print('--- lines mentioning gemini (first 15):')
for l in gem[:15]: print('  ', l)

for i, c in enumerate(s['clips']):
    print(f"clip{i}: title={c.get('title')!r} start={c.get('start')} end={c.get('end')} "
          f"keys_with_title={[k for k in c.keys() if 'titl' in k.lower() or 'reason' in k.lower() or 'source' in k.lower() or 'select' in k.lower()]}")

# Q2: is _cues.json identical to full_status.json clips[].cues?
for i in (0, 1):
    persisted = s['clips'][i].get('cues')
    exported = C[i]['cues']
    same = persisted == exported
    print(f"clip{i}: persisted cues={len(persisted)} exported={len(exported)} IDENTICAL={same}")
    if not same:
        for j, (a, b) in enumerate(zip(persisted, exported)):
            if a != b:
                print(f'  first diff at cue {j}: {a} vs {b}')
                break
