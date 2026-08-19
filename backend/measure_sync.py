import subprocess, wave, sys
import numpy as np

def extract_audio(path, out):
    subprocess.run(['ffmpeg','-y','-v','error','-i',path,'-ac','1','-ar','16000','-f','wav',out], check=True)
    with wave.open(out,'rb') as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    return sr, data

def speech_onsets(sr, audio, thresh_ratio=0.3, min_gap=0.25):
    # short-time energy in 10ms windows
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
                onsets.append(t)
                last = t
    return onsets, energy, thr

def caption_change_times(path, band_top=0.775, band_bot=0.845, fps_sample=30):
    # decode caption band to grayscale, measure per-frame diff
    # use ffmpeg to output raw gray frames of the caption band
    import subprocess
    # get dimensions
    out = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0',path], capture_output=True, text=True).stdout.strip()
    W,H,fps = out.split(',')
    W,H = int(W),int(H)
    num,den = fps.split('/'); fps = float(num)/float(den)
    y0 = int(H*band_top); y1 = int(H*band_bot); bh = y1-y0
    # crop band, scale down, output gray rawvideo
    cmd = ['ffmpeg','-v','error','-i',path,'-vf',f'crop={W}:{bh}:0:{y0},scale=160:{max(1,int(bh*160/W))},format=gray','-f','rawvideo','-']
    raw = subprocess.run(cmd, capture_output=True).stdout
    fw, fh = 160, max(1,int(bh*160/W))
    fsz = fw*fh
    nframes = len(raw)//fsz
    frames = np.frombuffer(raw[:nframes*fsz], dtype=np.uint8).reshape(nframes, fsz).astype(np.float64)
    # per-frame mean abs diff
    diffs = np.array([np.mean(np.abs(frames[i]-frames[i-1])) for i in range(1,nframes)])
    diffs = np.concatenate([[0],diffs])
    # a caption change = large diff
    thr = max(diffs.mean()+1.5*diffs.std(), 1.5)
    changes = [i/fps for i in range(nframes) if diffs[i]>thr]
    # merge close changes
    merged=[]
    for t in changes:
        if not merged or t-merged[-1]>0.12:
            merged.append(t)
    return merged, fps, diffs, thr

for clip,label in [('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip1.mp4','CLIP1'),
                   ('outputs\\5396ac9c-16f9-474c-88ef-a2989b7e92fa_clip2.mp4','CLIP2')]:
    wav = f'_sync_{label}.wav'
    sr,audio = extract_audio(clip, wav)
    onsets,energy,thr = speech_onsets(sr,audio)
    changes,fps,diffs,dthr = caption_change_times(clip)
    print(f'=== {label} ===')
    print(f'  diff stats: mean={diffs.mean():.3f} std={diffs.std():.3f} max={diffs.max():.3f} thr={dthr:.3f}')
    print(f'  speech onsets (first 15): {[round(t,3) for t in onsets[:15]]}')
    print(f'  caption changes (first 15): {[round(t,3) for t in changes[:15]]}')
    print(f'  total onsets={len(onsets)} changes={len(changes)} fps={fps:.3f}')
