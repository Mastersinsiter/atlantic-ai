import json

with open('_words.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for item in data:
    words = item.get('words', [])
    print(f"--- Clip {item.get('index')} ({item.get('sourceStart')}s - {item.get('sourceEnd')}s) | {len(words)} words ---")
    for i in range(len(words)-1):
        w1 = words[i]
        w2 = words[i+1]
        if w1['word'].lower() == w2['word'].lower() or w2['start'] < w1['end'] - 0.01:
            print(f"   [OVERLAP/DUP] idx {i}: '{w1['word']}' ({w1['start']}..{w1['end']}) vs '{w2['word']}' ({w2['start']}..{w2['end']})")
