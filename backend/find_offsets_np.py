import wave
import numpy as np

def read_wav(path):
    with wave.open(path, 'rb') as w:
        n = w.getnframes()
        raw = w.readframes(n)
        return np.frombuffer(raw, dtype=np.int16).astype(np.float64)

SR = 8000
src = read_wav('orig_src_8k.wav')

def find_offset(clip_path, name):
    clip = read_wav(clip_path)
    n = len(clip)
    # FFT-based cross-correlation: correlate src with clip, find peak
    # valid region: offsets 0 .. len(src)-n
    size = 1
    while size < len(src) + n:
        size *= 2
    S = np.fft.rfft(src, size)
    C = np.fft.rfft(clip[::-1], size)
    xcorr = np.fft.irfft(S * C, size)
    valid = xcorr[n - 1: len(src)]
    off = int(np.argmax(valid)) + n - 1
    # normalized correlation at that offset
    seg = src[off:off + n]
    corr = float(np.dot(seg, clip) / (np.linalg.norm(seg) * np.linalg.norm(clip)))
    print(f"{name}: offset = {off / SR:.3f}s  norm-corr = {corr:.4f}  clip_dur = {n / SR:.3f}s  -> source range {off / SR:.2f}s to {(off + n) / SR:.2f}s")

find_offset('orig_clip1_8k.wav', 'ORIG clip1')
find_offset('orig_clip2_8k.wav', 'ORIG clip2')
