import json, subprocess, sys, glob, os
import numpy as np
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BACKEND = os.path.dirname(os.path.abspath(__file__))

# --- locate preserved artifacts (latest by mtime) ---
def latest(pat):
    files = glob.glob(os.path.join(BACKEND, 'uploads', pat))
    return max(files, key=os.path.getmtime) if files else None

audio_m4a = latest('*_align_clip_*.m4a')
out_json  = latest('*_align_output_*.json')
trans_json= latest('*_align_transcript_*.json')
print('audio:', audio_m4a)
print('output:', out_json)
print('transcript:', trans_json)

SRC = os.path.join(BACKEND, 'uploads', 'bc4258d4-bd25-4253-a106-9d0ffe263d0b.mp4')
SRC_WAV = os.path.join(BACKEND, '_src_16k.wav')
CLIP_WAV = os.path.join(BACKEND, '_clip2_align_16k.wav')

# decode extracted clip audio to 16k mono wav
subprocess.run(['ffmpeg','-y','-v','error','-i',audio_m4a,'-ac','1','-ar','16000',CLIP_WAV], check=True)

def load_wav(p):
    import wave
    with wave.open(p,'rb') as w:
        n = w.getnframes(); sr = w.getframerate()
        d = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32)/32768.0
    return d, sr

src, sr1 = load_wav(SRC_WAV)
clip, sr2 = load_wav(CLIP_WAV)
print(f'src: {len(src)/sr1:.2f}s @ {sr1}  clip: {len(clip)/sr2:.2f}s @ {sr2}')

# --- FFT cross-correlation: where does clip audio start in source? ---
# use first 20s of clip for the correlation template
tpl = clip[:20*sr2]
n = len(src) + len(tpl) - 1
nfft = 1 << (n-1).bit_length()
S = np.fft.rfft(src, nfft)
T = np.fft.rfft(tpl[::-1], nfft)
xc = np.fft.irfft(S*T, nfft)[len(tpl)-1:len(src)]
peak = int(np.argmax(np.abs(xc)))
print(f'CORRELATION PEAK: clip audio starts at source t = {peak/sr1:.3f}s  (expected 449.000s, delta = {peak/sr1-449:+.3f}s)')

# --- what did the aligner output say? ---
with open(out_json, encoding='utf-8-sig') as f:
    out = json.load(f)
w = out['words']
print(f'aligner output: {len(w)} words, word[0]={w[0]}, last word start={w[-1]["start"]}')

# --- step 3: rerun stable-ts 3x on the SAME saved audio file ---
print()
print('=== stable-ts determinism test: 3 reruns on SAME audio ===')
aligner = os.path.join(BACKEND, 'src', 'aligner.py')
for i in range(3):
    op = os.path.join(BACKEND, f'_rerun_out_{i}.json')
    r = subprocess.run(['python', aligner, '--audio', audio_m4a, '--transcript', trans_json,
                        '--language', 'auto', '--output', op],
                       capture_output=True, text=True)
    if os.path.exists(op):
        with open(op, encoding='utf-8-sig') as f:
            ww = json.load(f)['words']
        print(f'run {i}: {len(ww)} words, word[0].start={ww[0]["start"]} end={ww[0]["end"]} | last start={ww[-1]["start"]}')
    else:
        print(f'run {i}: FAILED\n{r.stderr[-500:]}')
