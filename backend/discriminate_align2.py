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
    # binary capture to dodge cp1252 decode crashes
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    out = r.stdout.decode('utf-8', errors='replace') if r.stdout else ''
    err = r.stderr.decode('utf-8', errors='replace') if r.stderr else ''
    return r.returncode, out, err

# ---------- Q2: VAD speech segments ----------
print('=== Q2: VAD speech segments (stable_whisper transcribe vad=True) ===')
vad_script = os.path.join(BACKEND, '_vad_probe.py')
with open(vad_script, 'w', encoding='utf-8') as f:
    f.write('''
import sys, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import stable_whisper
model = stable_whisper.load_model("medium")
res = model.transcribe(sys.argv[1], vad=True, language="hi")
segs = [{"start": round(s.start,2), "end": round(s.end,2), "text": s.text[:40]} for s in res.segments]
print(json.dumps(segs[:15], ensure_ascii=False))
print("TOTAL_SEGS", len(res.segments))
''')
rc, out, err = run_py(['python', vad_script, AUDIO])
print('rc=', rc)
print('stdout:', out.strip()[:2500])
if err.strip():
    print('stderr tail:', err.strip()[-300:])

# ---------- Q4: discriminating test ----------
print()
print('=== Q4: discriminating test ===')
short = [{"word": w} for w in words[:6]]
short_path = os.path.join(BACKEND, '_short_transcript.json')
with open(short_path, 'w', encoding='utf-8') as f:
    json.dump(short, f, ensure_ascii=False)
print('short transcript:', [w['word'] for w in short])

aligner = os.path.join(BACKEND, 'src', 'aligner.py')
for label, tp in [('control-510', TRANS), ('short-6', short_path)]:
    op = os.path.join(BACKEND, f'_disc_{label}.json')
    if label == 'short-6':
        with open(tp, encoding='utf-8-sig') as _f:
            _actual = json.load(_f)
        _words = [x['word'] for x in _actual]
        print(f'[INSTRUMENT short-6] file={tp}')
        print(f'[INSTRUMENT short-6] type={type(_actual).__name__} token_count={len(_actual)}')
        print(f'[INSTRUMENT short-6] full_text=' + ' '.join(_words))
    rc, out, err = run_py(['python', aligner, '--audio', AUDIO, '--transcript', tp,
                           '--language', 'auto', '--output', op])
    if os.path.exists(op):
        with open(op, encoding='utf-8-sig') as f:
            ww = json.load(f)['words']
        print(f'{label}: {len(ww)} words | word[0]={ww[0]} | last start={ww[-1]["start"]}')
    else:
        print(f'{label}: FAILED rc={rc}\n{err[-400:]}')
