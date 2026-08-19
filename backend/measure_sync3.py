import subprocess, wave
import numpy as np

def extract_audio(path, out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out], check=True)
    with wave.open(out,'rb') as w:
        sr=w.getframerate(); data=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float64)
    return sr,data

def energy_env(sr,audio):
    win=int(sr*0.005)  # 5ms
    nwin=len(audio)//win
    e=np.array([np.sqrt(np.mean(audio[i*win:(i+1)*win]**2)) for i in range(nwin)])
    return e, 0.005

def caption_events(path, band_top=0.775, band_bot=0.845):
    out=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0',path],capture_output=True,text=True).stdout.strip()
    W,H,fps=out.split(','); W,H=int(W),int(H)
    num,den=fps.split('/'); fps=float(num)/float(den)
    y0=int(H*band_top); y1=int(H*band_bot); bh=y1-y0
    cmd=['ffmpeg','-v','error','-i',path,'-vf',f'crop={W}:{bh}:0:{y0},scale=160:{max(1,int(bh*160/W))},format=gray','-f','rawvideo','-']
    raw=subprocess.run(cmd,capture_output=True).stdout
    fw,fh=160,max(1,int(bh*160/W)); fsz=fw*fh
    nframes=len(raw)//fsz
    frames=np.frombuffer(raw[:nframes*fsz],dtype=np.uint8).reshape(nframes,fsz).astype(np.float64)
    # binarize: caption text is bright. Count bright pixels per frame.
    bright=(frames>180).sum(axis=1)
    diffs=np.array([np.mean(np.abs(frames[i]-frames[i-1])) for i in range(1,nframes)])
    diffs=np.concatenate([[0],diffs])
    return bright,diffs,fps,nframes

for clip,label in [('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip1.mp4','CLIP1'),
                   ('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip2.mp4','CLIP2')]:
    bright,diffs,fps,nf=caption_events(clip)
    print(f'=== {label} === fps={fps:.2f} frames={nf}')
    print(f'  bright-pixel count: min={bright.min()} max={bright.max()} mean={bright.mean():.0f}')
    # caption present when bright>threshold
    thr=bright.max()*0.15
    present=bright>thr
    # find caption on/off transitions
    trans=[]
    for i in range(1,len(present)):
        if present[i] and not present[i-1]: trans.append(('ON ',i/fps))
        elif not present[i] and present[i-1]: trans.append(('OFF',i/fps))
    print(f'  caption ON/OFF transitions (first 20):')
    for kind,t in trans[:20]:
        print(f'    {kind} {t:7.3f}s')
    print(f'  total transitions={len(trans)}')
