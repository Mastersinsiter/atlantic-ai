import subprocess, wave, json
import numpy as np

SRC = r"..\uploads\bc4258d4-bd25-4253-a106-9d0ffe263d0b.mp4"
import os
if not os.path.exists(SRC):
    # find the source
    for root,_,files in os.walk('..'):
        for f in files:
            if f.startswith('bc4258d4') and f.endswith('.mp4'):
                SRC=os.path.join(root,f)

def extract_audio(path,out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out],check=True)
    with wave.open(out,'rb') as w:
        sr=w.getframerate(); d=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float64)
    return sr,d

def energy_env(sr,audio):
    win=int(sr*0.01); n=len(audio)//win
    e=np.array([np.sqrt(np.mean(audio[i*win:(i+1)*win]**2)) for i in range(n)])
    return e,0.01

def onset_near(e,win_s,t,search=0.40):
    """Find speech onset nearest to time t using a LOCAL adaptive threshold.
       Onset = rising edge where energy crosses above local floor."""
    lo=max(0,int((t-search)/win_s)); hi=min(len(e)-1,int((t+search)/win_s))
    seg=e[lo:hi+1]
    if len(seg)<3: return None
    # local threshold: midpoint between local min and max
    thr=seg.min()+(seg.max()-seg.min())*0.4
    act=seg>thr
    best=None
    for i in range(len(seg)):
        if act[i] and (i==0 or not act[i-1]):
            tt=(lo+i)*win_s
            if best is None or abs(tt-t)<abs(best-t): best=tt
    return best

data=json.load(open('_words.json',encoding='utf-8-sig'))
print('source:',SRC)
sr,audio=extract_audio(SRC,'_src_16k.wav')
e,win_s=energy_env(sr,audio)
print(f'source audio dur={len(audio)/sr:.2f}s')

for info,label in [(data[0],'CLIP1'),(data[1],'CLIP2')]:
    words=info['words']
    print(f'\n=== {label} === sourceStart={info["sourceStart"]} words={len(words)}')
    # sample words spread across the clip: first, ~25%, ~50%, ~75%, last-ish
    n=len(words)
    picks=[0, n//4, n//2, (3*n)//4, n-2]
    offsets=[]
    for pi in picks:
        w=words[pi]
        t=w['start']
        on=onset_near(e,win_s,t)
        if on is not None:
            off=(t-on)*1000  # + means aligned timestamp is LATER than actual audio onset
            offsets.append((pi,w['word'],t,on,off))
            print(f'  word[{pi}] "{w["word"]}" aligned_start={t:.3f}s  audio_onset={on:.3f}s  offset={off:+.0f}ms')
        else:
            print(f'  word[{pi}] "{w["word"]}" aligned_start={t:.3f}s  NO onset found nearby')
    vals=[o[4] for o in offsets]
    if vals:
        print(f'  -> offsets: {[round(v) for v in vals]}  mean={np.mean(vals):+.0f}ms')
