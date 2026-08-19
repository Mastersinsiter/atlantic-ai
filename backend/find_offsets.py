import wave, struct, sys

def read_wav(path):
    with wave.open(path, 'rb') as w:
        n = w.getnframes()
        raw = w.readframes(n)
        samples = struct.unpack('<%dh' % n, raw)
        return samples

src = read_wav('orig_src_8k.wav')
c1 = read_wav('orig_clip1_8k.wav')
c2 = read_wav('orig_clip2_8k.wav')
SR = 8000

def find_offset(src, clip, name):
    # Coarse scan at 10x step, then refine
    best = (-2, -1)
    step = 10
    n = len(clip)
    for off in range(0, len(src) - n, step):
        s = 0
        # sample every 40th point for speed
        for i in range(0, n, 40):
            s += src[off + i] * clip[i]
        if s > best[0]:
            best = (s, off)
    # refine around best
    coarse = best[1]
    best = (-2, -1)
    for off in range(max(0, coarse - step), min(len(src) - n, coarse + step)):
        s = 0
        for i in range(0, n, 10):
            s += src[off + i] * clip[i]
        if s > best[0]:
            best = (s, off)
    off = best[1]
    # normalized correlation at best offset
    num = sum(src[off + i] * clip[i] for i in range(0, n, 5))
    den1 = sum(src[off + i] ** 2 for i in range(0, n, 5)) ** 0.5
    den2 = sum(clip[i] ** 2 for i in range(0, n, 5)) ** 0.5
    corr = num / (den1 * den2) if den1 and den2 else 0
    print(f"{name}: offset = {off / SR:.3f}s  (samples {off})  norm-corr = {corr:.4f}  clip_dur = {n / SR:.3f}s  -> source range {off / SR:.2f}s to {(off + n) / SR:.2f}s")

find_offset(src, c1, 'ORIG clip1')
find_offset(src, c2, 'ORIG clip2')
