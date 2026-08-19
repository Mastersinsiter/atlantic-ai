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
SIL_THR=e.max()*0.10   # global silence floor (same as gap_before)
ONSET_RATIO=0.4        # local adaptive onset threshold

def gap_before(t):
    i=int(t/WS); run=0; j=i-1
    while j>=0 and e[j]<SIL_THR:
        run+=1; j-=1
    return run*WS

def onset_near(t,search=0.40):
    lo=max(0,int((t-search)/WS)); hi=min(len(e)-1,int((t+search)/WS))
    seg=e[lo:hi+1]
    if len(seg)<3: return None
    thr=seg.min()+(seg.max()-seg.min())*ONSET_RATIO
    act=seg>thr; best=None
    for i in range(len(seg)):
        if act[i] and (i==0 or not act[i-1]):
            tt=(lo+i)*WS
            if best is None or abs(tt-t)<abs(best-t): best=tt
    return best

data=json.load(open('_words.json',encoding='utf-8-sig'))
GAP_MIN=0.15  # >=150ms preceding silence => silence-gap-preceded

for info,label in [(data[0],'CLIP1'),(data[1],'CLIP2')]:
    words=info['words']; N=len(words)
    gap_preceded=[]; midrun=[]
    for i,w in enumerate(words):
        g=gap_before(w['start'])
        on=onset_near(w['start'])
        rec=(i,w['word'],w['start'],g,on)
        if g>=GAP_MIN: gap_preceded.append(rec)
        else: midrun.append(rec)
    # recompute >100ms ONLY on silence-gap subset with a found onset
    gp_meas=[r for r in gap_preceded if r[4] is not None]
    over=[r for r in gp_meas if abs((r[2]-r[4])*1000)>100]
    offs=[(r[2]-r[4])*1000 for r in gp_meas]
    print(f'=== {label} === total={N}')
    print(f'  silence-gap-preceded (gap>={GAP_MIN*1000:.0f}ms): {len(gap_preceded)} ({100*len(gap_preceded)/N:.1f}%)')
    print(f'  mid-run continuous: {len(midrun)} ({100*len(midrun)/N:.1f}%)')
    print(f'  --- >100ms rate on SILENCE-GAP subset only ---')
    print(f'  measurable (onset found): {len(gp_meas)}/{len(gap_preceded)}')
    if offs:
        print(f'  offset mean={np.mean(offs):+.0f}ms median={np.median(offs):+.0f}ms')
        print(f'  >100ms: {len(over)}/{len(gp_meas)} = {100*len(over)/len(gp_meas):.1f}%')
        if over:
            from collections import Counter
            buckets=Counter(int(r[2]//5)*5 for r in over)
            print(f'  >100ms clusters: '+', '.join(f'{b}-{b+5}s:{c}' for b,c in sorted(buckets.items())))
    # compare: mid-run subset >100ms (for honesty, marked unreliable)
    mr_meas=[r for r in midrun if r[4] is not None]
    mr_over=[r for r in mr_meas if abs((r[2]-r[4])*1000)>100]
    if mr_meas:
        print(f'  [unreliable] mid-run >100ms: {len(mr_over)}/{len(mr_meas)} = {100*len(mr_over)/len(mr_meas):.1f}%')
