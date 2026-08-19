import wave
import numpy as np

def read_wav(path):
    with wave.open(path, 'rb') as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)

SR = 8000
src = read_wav('orig_src_8k.wav')

def top5(clip_path, name):
    clip = read_wav(clip_path)
    n = len(clip)
    size = 1
    while size < len(src) + n:
        size *= 2
    S = np.fft.rfft(src, size)
    C = np.fft.rfft(clip, size)
    xc = np.fft.irfft(S * np.conj(C), size)
    valid = xc[:len(src) - n + 1].copy()
    # normalized correlation across all offsets (vectorized-ish via stride tricks is heavy;
    # instead compute norm per candidate from the raw xcorr peak heights, then normalize top peaks)
    clip_norm = np.linalg.norm(clip)
    # find peaks: take top candidates by raw xcorr, separated by >= 1s
    work = valid.copy()
    results = []
    for _ in range(5):
        off = int(np.argmax(work))
        seg = src[off:off + n]
        corr = float(np.dot(seg, clip) / (np.linalg.norm(seg) * clip_norm))
        results.append((off / SR, corr))
        # suppress +-1s around this peak
        lo = max(0, off - SR)
        hi = min(len(work), off + SR)
        work[lo:hi] = -np.inf
    print(f"=== {name} (clip_dur={n/SR:.3f}s) top 5 candidate offsets ===")
    for i, (t, c) in enumerate(results, 1):
        print(f"  #{i}: offset={t:8.3f}s  norm-corr={c:.4f}")

top5('orig_clip2_8k.wav', 'ORIG clip2')
top5('orig_clip1_8k.wav', 'ORIG clip1')
