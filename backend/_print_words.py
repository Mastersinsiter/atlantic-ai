import json

with open('_words.json', 'r', encoding='utf-8-sig') as f:
    data = json.load(f)

for item in data:
    print(f"=== CLIP {item.get('index')} ({item.get('sourceStart')}s - {item.get('sourceEnd')}s) ===")
    words = item.get('words', [])
    for w in words:
        print(f"  {w['word']:15s} | start={w['start']:.3f} | end={w['end']:.3f}")
