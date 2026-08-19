import subprocess, wave, json
import numpy as np

def extract_audio(path,out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out],check=True)
    with wave.open(out,'rb') as w:
        sr=w.getframerate(); d=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float64)
    return sr,d

def speech_onsets(sr,audio,thresh_ratio=0.22,min_gap=0.15):
    win=int(sr*0.01); n=len(audio)//win
    e=np.array([np.sqrt(np.mean(audio[i*win:(i+1)*win]**2)) for i in range(n)])
    thr=e.max()*thresh_ratio; act=e>thr
    ons=[]; last=-9
    for i,a in enumerate(act):
        if a and (i==0 or not act[i-1]):
            t=i*0.01
            if t-last>min_gap: ons.append(t); last=t
    return np.array(ons)

def best_offset(cue_starts, onsets, search=np.arange(-1.0,1.0,0.005), tol=0.22):
    """Find offset such that (cue_start + offset) aligns with a speech onset.
       offset>0 means caption appears BEFORE speech by that amount is wrong sign;
       we define rendered_caption_time = cue_start, and measure onset - cue_start."""
    best=None
    for off in search:
        cnt=0
        for cs in cue_starts:
            if np.any(np.abs(onsets-(cs+off))<tol): cnt+=1
        if best is None or cnt>best[1]: best=(off,cnt)
    return best

data=json.load(open('_cues.json',encoding='utf-8-sig'))
clips=[('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip1.mp4','CLIP1',data[0]),
       ('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip2.mp4','CLIP2',data[1])]

for path,label,info in clips:
    sr,audio=extract_audio(path,f'_syncf_{label}.wav')
    onsets=speech_onsets(sr,audio)
    src_start=info['sourceStart']
    raw_cue_starts=np.array([c['start'] for c in info['cues']])
    dur=len(audio)/sr
    print(f'=== {label} === sourceStart={src_start} audioDur={dur:.2f}s cues={len(raw_cue_starts)} onsets={len(onsets)}')
    print(f'  raw cue start range: {raw_cue_starts.min():.2f}..{raw_cue_starts.max():.2f}')

    # Try candidate time bases to convert cue->clip-relative:
    #  clip1 cues look clip-relative already (0..55.88). clip2 cues need offset.
    # We'll brute-force a global shift that best aligns cue-starts to onsets.
    # search shift over a wide range (for clip2 the shift ~ -397 to bring to clip base)
    shifts=np.arange(-60,60,0.02)
    best=None
    for sh in shifts:
        cs=raw_cue_starts+sh
        # only consider cues within audio duration
        cs=cs[(cs>=0)&(cs<dur)]
        if len(cs)<5: continue
        off,cnt=best_offset(cs,onsets,search=np.arange(-0.6,0.6,0.01),tol=0.22)
        # total score: matches at the best residual offset
        if best is None or cnt>best[2]:
            best=(sh,off,cnt,len(cs))
    sh,off,cnt,ncs=best
    print(f'  best global shift={sh:+.2f}s  residual offset={off*1000:+.0f}ms  matched {cnt}/{ncs} cues')
    # The residual offset IS the sync error: caption vs audio
    # Now per-third drift using this shift
    cs=raw_cue_starts+sh
    cs=cs[(cs>=0)&(cs<dur)]
    thirds=[(0,dur/3),(dur/3,2*dur/3),(2*dur/3,dur+1)]
    for name,(t0,t1) in zip(['EARLY','MID','LATE'],thirds):
        seg=cs[(cs>=t0)&(cs<t1)]
        if len(seg)>=4:
            o,c=best_offset(seg,onsets,search=np.arange(-0.6,0.6,0.005),tol=0.22)
            print(f'    {name} ({t0:4.1f}-{t1:4.1f}s): offset={o*1000:+5.0f}ms  ({c}/{len(seg)} matched)')
        else:
            print(f'    {name}: too few cues (n={len(seg)})')
