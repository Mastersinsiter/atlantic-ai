import subprocess, wave, json
import numpy as np

SRC=r"..\backend\uploads\bc4258d4-bd25-4253-a106-9d0ffe263d0b.mp4"
def extract_audio(path,out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out],check=True)
    with wave.open(out,'rb') as w:
        sr=w.getframerate(); d=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float64)
    return sr,d

sr,audio=extract_audio(SRC,'_src_16k.wav')
win=int(sr*0.01); n=len(audio)//win
e=np.array([np.sqrt(np.mean(audio[i*win:(i+1)*win]**2)) for i in range(n)])
WS=0.01

def onset_near(t,search=0.40):
    lo=max(0,int((t-search)/WS)); hi=min(len(e)-1,int((t+search)/WS))
    seg=e[lo:hi+1]
    if len(seg)<3: return None
    thr=seg.min()+(seg.max()-seg.min())*0.4
    act=seg>thr
    best=None
    for i in range(len(seg)):
        if act[i] and (i==0 or not act[i-1]):
            tt=(lo+i)*WS
            if best is None or abs(tt-t)<abs(best-t): best=tt
    return best

def gap_before(t):
    # measure the silent run length immediately before time t
    i=int(t/WS)
    thr=e.max()*0.10  # global silence floor
    run=0
    j=i-1
    while j>=0 and e[j]<thr:
        run+=1; j-=1
    return run*WS

data=json.load(open('_words.json',encoding='utf-8-sig'))
for info,label in [(data[0],'CLIP1'),(data[1],'CLIP2')]:
    words=info['words']; n=len(words)
    print(f'\n=== {label} === words={n} sourceStart={info["sourceStart"]}')
    offsets=[]; over100=[]
    for i,w in enumerate(words):
        t=w['start']; on=onset_near(t)
        if on is None: continue
        off=(t-on)*1000
        offsets.append((i,w['word'],t,off))
        if abs(off)>100: over100.append((i,w['word'],round(t,2),round(off)))
    vals=[o[3] for o in offsets]
    print(f'  measured {len(vals)}/{n} words')
    print(f'  offset: mean={np.mean(vals):+.0f}ms median={np.median(vals):+.0f}ms min={min(vals):+.0f} max={max(vals):+.0f}')
    print(f'  |offset|>100ms: {len(over100)} words ({100*len(over100)/len(vals):.1f}%)')
    if over100:
        # cluster: group by 5-second buckets
        from collections import Counter
        buckets=Counter(int(t//5)*5 for _,_,t,_ in over100)
        print(f'  >100ms cluster buckets (sec_range: count):')
        for b in sorted(buckets): print(f'     {b:4d}-{b+5:<4d}s : {buckets[b]}')
        print(f'  first 15 offenders: {over100[:15]}')
    # item 3: classify the 5 quartile samples
    picks=[0,n//4,n//2,(3*n)//4,n-2]
    print(f'  quartile samples gap-before classification:')
    for pi in picks:
        w=words[pi]; g=gap_before(w['start'])
        kind='SILENCE-GAP (onset meaningful)' if g>=0.15 else f'MID-RUN continuous (gap={g:.2f}s)'
        print(f'    word[{pi}] "{w["word"]}" t={w["start"]:.3f}s gap_before={g:.2f}s -> {kind}')
