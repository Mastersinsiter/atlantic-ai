import subprocess, wave
import numpy as np

def extract_audio(path,out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out],check=True)
    with wave.open(out,'rb') as w:
        sr=w.getframerate(); d=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float64)
    return sr,d

def speech_onsets(sr,audio,thresh_ratio=0.25,min_gap=0.18):
    win=int(sr*0.01); n=len(audio)//win
    e=np.array([np.sqrt(np.mean(audio[i*win:(i+1)*win]**2)) for i in range(n)])
    thr=e.max()*thresh_ratio; act=e>thr
    ons=[]; last=-9
    for i,a in enumerate(act):
        if a and (i==0 or not act[i-1]):
            t=i*0.01
            if t-last>min_gap: ons.append(t); last=t
    return ons,e,thr

def caption_frames(path):
    # tight strip at text rows. From band crop: text occupies roughly y 1500-1600 of 1920.
    out=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0',path],capture_output=True,text=True).stdout.strip()
    W,H,fps=out.split(','); W,H=int(W),int(H)
    num,den=fps.split('/'); fps=float(num)/float(den)
    y0=int(H*0.785); y1=int(H*0.835); bh=y1-y0
    cmd=['ffmpeg','-v','error','-i',path,'-vf',f'crop={W}:{bh}:0:{y0},format=gray','-f','rawvideo','-']
    raw=subprocess.run(cmd,capture_output=True).stdout
    fsz=W*bh; nf=len(raw)//fsz
    fr=np.frombuffer(raw[:nf*fsz],dtype=np.uint8).reshape(nf,bh,W).astype(np.float64)
    return fr,fps

def caption_change(fr,fps):
    # white text pixels: very bright
    white=(fr>200).sum(axis=(1,2)).astype(np.float64)
    # normalize per-frame change in white mask
    # use correlation of consecutive white masks
    n=fr.shape[0]
    wm=(fr>200).reshape(n,-1)
    ch=[]
    for i in range(1,n):
        a=wm[i-1].astype(np.float64); b=wm[i].astype(np.float64)
        # fraction of differing pixels
        d=np.mean(a!=b)
        ch.append(d)
    ch=np.array([0]+ch)
    return white,ch,fps

for clip,label in [('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip1.mp4','CLIP1'),
                   ('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip2.mp4','CLIP2')]:
    fr,fps=caption_frames(clip)
    white,ch,fps=caption_change(fr,fps)
    print(f'=== {label} === fps={fps:.2f} frames={fr.shape[0]}')
    print(f'  white px: min={white.min():.0f} max={white.max():.0f} mean={white.mean():.0f} median={np.median(white):.0f}')
    # caption present = white above a floor
    floor=max(50, np.percentile(white,40))
    present=white>floor
    # changes = big frame-to-frame mask diff
    thr=max(ch.mean()+2*ch.std(), np.percentile(ch,92))
    idx=np.where(ch>thr)[0]
    times=[]; 
    for i in idx:
        t=i/fps
        if not times or t-times[-1]>0.12: times.append(t)
    print(f'  mask-diff thr={thr:.4f}  change count={len(times)}')
    print(f'  first 20 changes: {[round(t,2) for t in times[:20]]}')
    # save white curve for inspection
    np.save(f'_white_{label}.npy', white)
    np.save(f'_ch_{label}.npy', ch)
