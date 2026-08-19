import sys, os, json, subprocess
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
BACKEND = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(BACKEND, '_clip2_from447.m4a')
SHORT = os.path.join(BACKEND, '_short_transcript.json')
ALIGNER = os.path.join(BACKEND, 'src', 'aligner.py')

def run(args, timeout=900):
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout.decode('utf-8','replace'), r.stderr.decode('utf-8','replace')

# (3) fresh transcribe, no expected text — what does it hear at the start?
print('=== (3) transcribe() first segments on 447.0s extraction ===')
tscript = os.path.join(BACKEND, '_trans447.py')
open(tscript,'w',encoding='utf-8').write(
    'import sys,stable_whisper\n'
    'sys.stdout.reconfigure(encoding="utf-8",errors="replace")\n'
    'm=stable_whisper.load_model("medium")\n'
    'r=m.transcribe(sys.argv[1], language="hi")\n'
    'import json\n'
    'print(json.dumps([{"start":round(s.start,2),"end":round(s.end,2),"text":s.text[:50]} for s in r.segments[:6]], ensure_ascii=False))\n'
)
rc,out,err = run(['python', tscript, AUDIO])
print('rc',rc); print(out.strip()[:1500])
if err.strip(): print('err tail:', err.strip()[-150:])

# (2) short-6 align on the 447.0s extraction
print()
print('=== (2) short-6 align on 447.0s extraction ===')
op = os.path.join(BACKEND, '_short6_from447.json')
rc,out,err = run(['python', ALIGNER, '--audio', AUDIO, '--transcript', SHORT,
                  '--language', 'auto', '--output', op])
if os.path.exists(op):
    w = json.load(open(op, encoding='utf-8-sig'))['words']
    print(f'word[0]={w[0]}')
    print('all:', [(x['word'],x['start'],x['end']) for x in w])
    print(f'EXPECTED word[0] near 1.58s (448.582 - 447.0)')
else:
    print('FAILED rc',rc, err[-300:])
