import json, subprocess, sys, os, glob
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BACKEND = os.path.dirname(os.path.abspath(__file__))

def latest(pat):
    files = glob.glob(os.path.join(BACKEND, 'uploads', pat))
    return max(files, key=os.path.getmtime) if files else None

AUDIO = latest('*_align_clip_*.m4a')
TRANS = latest('*_align_transcript_*.json')
print('AUDIO:', AUDIO)
print('TRANS:', TRANS)

# ---------- Q1: exact transcript input ----------
with open(TRANS, encoding='utf-8-sig') as f:
    tdata = json.load(f)
words = [w['word'] for w in tdata]
print(f'\n=== Q1: transcript input ===')
print(f'count: {len(words)}')
print('first 10:', words[:10])
print('last 10:', words[-10:])
text = ' '.join(words)
print(f'joined text length: {len(text)} chars')
print('first 120 chars:', text[:120])
print('last 120 chars:', text[-120:])

# ---------- Q3: call signature + real audio duration ----------
print(f'\n=== Q3: call signature + durations ===')
print('call: model.align(audio=<m4a>, text=<joined 510 words>, language=<auto-detect>)')
print('model: stable_whisper.load_model("medium")  | NO vad flag, NO duration/offset param')
r = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0', AUDIO],
                   capture_output=True, text=True)
print(f'ffprobe duration of extracted audio: {r.stdout.strip()}s')

# ---------- Q2: VAD / speech-segment detection on this exact file ----------
print(f'\n=== Q2: VAD speech segments (silero via stable_whisper) ===')
vad_script = os.path.join(BACKEND, '_vad_probe.py')
with open(vad_script, 'w', encoding='utf-8') as f:
    f.write('''
import sys, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import stable_whisper
model = stable_whisper.load_model("medium")
# transcribe with vad to see where speech is detected
res = model.transcribe(sys.argv[1], vad=True, language="hi")
segs = [{"start": round(s.start,2), "end": round(s.end,2), "text": s.text[:40]} for s in res.segments]
print(json.dumps(segs[:15], ensure_ascii=False))
print("TOTAL_SEGS", len(res.segments))
''')
r = subprocess.run(['python', vad_script, AUDIO], capture_output=True, text=True, timeout=600)
print('VAD transcribe stdout:', r.stdout.strip()[:2000])
if r.stderr.strip():
    print('stderr (tail):', r.stderr.strip()[-300:])

# ---------- Q4: discriminating test ----------
print(f'\n=== Q4: discriminating test ===')
# (a) control: full 510-word transcript (already known ~48.8, rerun once for this session)
short = [{"word": w} for w in words[:6]]  # मिल जाओ दादी कौन सी भाषा
short_path = os.path.join(BACKEND, '_short_transcript.json')
with open(short_path, 'w', encoding='utf-8') as f:
    json.dump(short, f, ensure_ascii=False)
print('short transcript words:', [w['word'] for w in short])

aligner = os.path.join(BACKEND, 'src', 'aligner.py')
for label, tp in [('control-510', TRANS), ('short-6', short_path)]:
    op = os.path.join(BACKEND, f'_disc_{label}.json')
    r = subprocess.run(['python', aligner, '--audio', AUDIO, '--transcript', tp,
                        '--language', 'auto', '--output', op],
                       capture_output=True, text=True, timeout=900)
    if os.path.exists(op):
        with open(op, encoding='utf-8-sig') as f:
            ww = json.load(f)['words']
        print(f'{label}: {len(ww)} words | word[0]={ww[0]} | last start={ww[-1]["start"]}')
    else:
        print(f'{label}: FAILED\n{r.stderr[-400:]}')
