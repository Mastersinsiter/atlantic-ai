import json, subprocess, sys, os, glob
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BACKEND = os.path.dirname(os.path.abspath(__file__))

def latest(pat):
    files = glob.glob(os.path.join(BACKEND, 'uploads', pat))
    return max(files, key=os.path.getmtime) if files else None

AUDIO = latest('*_align_clip_*.m4a')
TRANS = latest('*_align_transcript_*.json')

with open(TRANS, encoding='utf-8-sig') as f:
    tdata = json.load(f)
words = [w['word'] for w in tdata]

def run_py(args, timeout=900):
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    out = r.stdout.decode('utf-8', errors='replace') if r.stdout else ''
    err = r.stderr.decode('utf-8', errors='replace') if r.stderr else ''
    return r.returncode, out, err

# Build short transcript exactly as discriminate_align2.py does
short = [{"word": w} for w in words[:6]]
short_path = os.path.join(BACKEND, '_short_transcript.json')
with open(short_path, 'w', encoding='utf-8') as f:
    json.dump(short, f, ensure_ascii=False)

# INSTRUMENT: print what the file ACTUALLY contains at call time
with open(short_path, encoding='utf-8-sig') as _f:
    _actual = json.load(_f)
_words = [x['word'] for x in _actual]
print(f'[INSTRUMENT short-6] file={short_path}')
print(f'[INSTRUMENT short-6] type={type(_actual).__name__} token_count={len(_actual)}')
print(f'[INSTRUMENT short-6] full_text=' + ' '.join(_words))

aligner = os.path.join(BACKEND, 'src', 'aligner.py')
op = os.path.join(BACKEND, '_disc_short-6.json')
rc, out, err = run_py(['python', aligner, '--audio', AUDIO, '--transcript', short_path,
                       '--language', 'auto', '--output', op])
print('align rc=', rc)
if os.path.exists(op):
    with open(op, encoding='utf-8-sig') as f:
        ww = json.load(f)['words']
    print(f'short-6: {len(ww)} words | word[0]={ww[0]} | last start={ww[-1]["start"]}')
else:
    print('FAILED\n' + err[-400:])
