import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def load(p):
    with open(p, encoding='utf-8-sig') as f:
        return json.load(f)

W = load('_words.json')
C = load('_cues.json')

# files are lists of per-clip dicts: [{index, sourceStart, sourceEnd, words|cues: [...]}, ...]
w2 = W[1]['words']
c2 = C[1]['cues']
print(f"clip2: {len(w2)} words, {len(c2)} cues, sourceStart={W[1]['sourceStart']} sourceEnd={W[1]['sourceEnd']}")
print('sample word[0]:', w2[0])
print('sample cue[0]:', c2[0])

CLIP_START = 449.0
OFFSET = 448.582 - 51.22  # 397.362

def fmt(t):
    if t < 0: t = 0
    cs = int((t % 1) * 100)
    s = int(t) % 60
    m = (int(t) // 60) % 60
    h = int(t) // 3600
    return f'{h}:{m:02d}:{s:02d}.{cs:02d}'

print()
print('=' * 70)
print('Q1: every clip2 word containing "मिल"')
print('=' * 70)
hits = [i for i, w in enumerate(w2) if 'मिल' in w.get('word', '')]
print(f'occurrences: {len(hits)}')
for i in hits:
    w = w2[i]
    print(f"--- idx {i}: '{w['word']}' start={w['start']:.3f} end={w['end']:.3f} clip-rel={w['start']-CLIP_START:+.3f}s")
    for j in range(max(0, i - 2), min(len(w2), i + 3)):
        x = w2[j]
        mark = '>>' if j == i else '  '
        print(f"   {mark}[{j}] {x['word']} ({x['start']:.3f}-{x['end']:.3f})")

print()
print('=' * 70)
print('Q2: clip2 cue count + first 5 cues verbatim')
print('=' * 70)
print(f'total cues: {len(c2)}')
for i, c in enumerate(c2[:5]):
    print(f"cue[{i}] start={c['start']} end={c['end']}  ASS: {fmt(c['start'])} --> {fmt(c['end'])}")
    print(f"   text: {c['text']}")
    ws, we = c['start'] + OFFSET, c['end'] + OFFSET
    inside = [w['word'] for w in w2 if w['end'] > ws - 0.05 and w['start'] < we + 0.05]
    print(f"   words in source window {ws:.3f}-{we:.3f} (offset {OFFSET:.3f}): {' '.join(inside)}")

print()
print('=' * 70)
print('Q3: cues with start < 51.21 (is 0-51.21s caption-free?)')
print('=' * 70)
early = [c for c in c2 if c['start'] < 51.21]
print(f'cues with start < 51.21: {len(early)}')
for c in early[:20]:
    print(f"   start={c['start']} end={c['end']} text={c['text']}")
print(f"min cue start: {min(c['start'] for c in c2)}")
print(f"max cue start: {max(c['start'] for c in c2)}")
beyond = [c for c in c2 if c['start'] > 60.157]
print(f'cues starting beyond video duration 60.157s (never rendered): {len(beyond)}')
