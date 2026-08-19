import sys, os, json, subprocess
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BACKEND = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(BACKEND, 'uploads', '81fa1de5-a3c3-4090-b700-537b4e36f046_align_clip_1785661906983.m4a')
SHORT = os.path.join(BACKEND, '_short_transcript.json')
ALIGNER = os.path.join(BACKEND, 'src', 'aligner.py')

def run(args, timeout=900):
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout.decode('utf-8','replace'), r.stderr.decode('utf-8','replace')

# short-6 with language=en (what the ORIGINAL job used) vs hi
for lang in ['en', 'hi']:
    op = os.path.join(BACKEND, f'_lang_{lang}.json')
    rc, out, err = run(['python', ALIGNER, '--audio', AUDIO, '--transcript', SHORT,
                        '--language', lang, '--output', op])
    if os.path.exists(op):
        w = json.load(open(op, encoding='utf-8-sig'))['words']
        print(f'lang={lang}: word[0]={w[0]} last_start={w[-1]["start"]}')
    else:
        print(f'lang={lang}: FAILED rc={rc} err={err[-300:]}')
