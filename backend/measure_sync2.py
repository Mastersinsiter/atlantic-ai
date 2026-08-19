import subprocess, wave
import numpy as np

def extract_audio(path, out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out], check=True)
    with wave.open(out,'rb') as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    return sr, data

def speech_onsets(sr, audio, thresh_ratio=0.3, min_gap=0.20):
    win = int(sr*0.01)
    nwin = len(audio)//win
    energy = np.array([np.sqrt(np.mean(audio[i*win:(i+1)*win]**2)) for i in range(nwin)])
    thr = energy.max()*thresh_ratio
    active = energy > thr
    onsets = []
    last = -1e9
    for i,a in enumerate(active):
        if a and (i==0 or not active[i-1]):
            t = i*0.01
            if t-last > min_gap:
                onsets.append(t); last = t
    return onsets

def caption_change_times(path, band_top=0.775, band_bot=0.845):
    out = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0',path], capture_output=True, text=True).stdout.strip()
    W,H,fps = out.split(','); W,H=int(W),int(H)
    num,den=fps.split('/'); fps=float(num)/float(den)
    y0=int(H*band_top); y1=int(H*band_bot); bh=y1-y0
    cmd=['ffmpeg','-v','error','-i',path,'-vf',f'crop={W}:{bh}:0:{y0},scale=160:{max(1,int(bh*160/W))},format=gray','-f','rawvideo','-']
    raw=subprocess.run(cmd,capture_output=True).stdout
    fw,fh=160,max(1,int(bh*160/W)); fsz=fw*fh
    nframes=len(raw)//fsz
    frames=np.frombuffer(raw[:nframes*fsz],dtype=np.uint8).reshape(nframes,fsz).astype(np.float64)
    diffs=np.array([np.mean(np.abs(frames[i]-frames[i-1])) for i in range(1,nframes)])
    diffs=np.concatenate([[0],diffs])
    thr=max(diffs.mean()+1.5*diffs.std(),1.5)
    changes=[i/fps for i in range(nframes) if diffs[i]>thr]
    merged=[]
    for t in changes:
        if not merged or t-merged[-1]>0.12: merged.append(t)
    return merged,fps

def best_lag(onsets, changes, max_lag=1.5, step=0.005):
    # for each candidate lag, count how many caption changes have a speech onset within tol
    best=None
    lags=np.arange(-max_lag,max_lag,step)
    ons=np.array(onsets)
    results=[]
    for lag in lags:
        # caption appears at change time; predicted speech onset = change + lag
        # count matches
        cnt=0
        for c in changes:
            pred=c+lag
            if np.any(np.abs(ons-pred)<0.20):
                cnt+=1
        results.append((lag,cnt))
        if best is None or cnt>best[1]:
            best=(lag,cnt)
    return best,results

for clip,label in [('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip1.mp4','CLIP1'),
                   ('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip2.mp4','CLIP2')]:
    wav=f'_sync_{label}.wav'
    sr,audio=extract_audio(clip,wav)
    onsets=speech_onsets(sr,audio)
    changes,fps=caption_change_times(clip)
    (lag,cnt),results=best_lag(onsets,changes)
    print(f'=== {label} ===  changes={len(changes)} onsets={len(onsets)}')
    print(f'  OVERALL best lag = {lag*1000:.0f} ms  (matched {cnt}/{len(changes)})')
    # drift: split into thirds by caption-change time
    dur = max(changes)
    for seg,(t0,t1) in zip(['EARLY','MID  ','LATE '],[(0,dur/3),(dur/3,2*dur/3),(2*dur/3,dur+1)]):
        ch=[c for c in changes if t0<=c<t1]
        on=[o for o in onsets if t0-1.5<=o<t1+1.5]
        if len(ch)>=3:
            (l,ct),_=best_lag(on,ch)
            print(f'  {seg} ({t0:5.1f}-{t1:5.1f}s): lag={l*1000:+5.0f}ms  ({ct}/{len(ch)} matched, n={len(ch)})')
        else:
            print(f'  {seg} ({t0:5.1f}-{t1:5.1f}s): too few changes (n={len(ch)})')
