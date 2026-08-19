import wave
import numpy as np

def read_wav(path):
    with wave.open(path, 'rb') as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)

SR = 8000
src = read_wav('orig_src_8k.wav')

def find_offset(clip_path, name):
    clip = read_wav(clip_path)
    n = len(clip)
    size = 1
    while size < len(src) + n:
        size *= 2
    S = np.fft.rfft(src, size)
    C = np.fft.rfft(clip, size)
    xc = np.fft.irfft(S * np.conj(C), size)
    valid = xc[:len(src) - n + 1]
    off = int(np.argmax(valid))
    seg = src[off:off + n]
    corr = float(np.dot(seg, clip) / (np.linalg.norm(seg) * np.linalg.norm(clip)))
    print(f"{name}: offset = {off / SR:.3f}s  norm-corr = {corr:.4f}  clip_dur = {n / SR:.3f}s  -> source range {off / SR:.2f}s to {(off + n) / SR:.2f}s")

find_offset('orig_clip1_8k.wav', 'ORIG clip1')
find_offset('orig_clip2_8k.wav', 'ORIG clip2')
