import sys, os, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import numpy as np
import whisper
from whisper.audio import load_audio, SAMPLE_RATE, N_FRAMES, HOP_LENGTH

AUDIO = r"C:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\backend\uploads\81fa1de5-a3c3-4090-b700-537b4e36f046_align_clip_1785661906983.m4a"

print("SAMPLE_RATE", SAMPLE_RATE, "HOP", HOP_LENGTH)
audio = load_audio(AUDIO)   # exactly what stable-ts/whisper uses
dur = len(audio) / SAMPLE_RATE
print(f"decoded samples={len(audio)} dur={dur:.4f}s")

# RMS energy in 1s windows across the file -> where is speech actually loud?
win = SAMPLE_RATE
rms = [float(np.sqrt(np.mean(audio[i:i+win]**2))) for i in range(0, len(audio)-win+1, win)]
print("RMS per second (first 12):", [round(x,4) for x in rms[:12]])
print("RMS per second (last 12): ", [round(x,4) for x in rms[-12:]])
peak = int(np.argmax(rms))
print(f"loudest 1s window = {peak}s (rms={rms[peak]:.4f})")
print(f"mean rms first 5s={np.mean(rms[:5]):.4f}  last 5s={np.mean(rms[-5:]):.4f}")

# Is the first second silence or speech?
print("first 0.5s max abs:", float(np.max(np.abs(audio[:SAMPLE_RATE//2]))))
print("48-50s   max abs:", float(np.max(np.abs(audio[48*SAMPLE_RATE:50*SAMPLE_RATE]))))
