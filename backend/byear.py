import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import whisper
AUDIO = r"C:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai\backend\uploads\81fa1de5-a3c3-4090-b700-537b4e36f046_align_clip_1785661906983.m4a"
model = whisper.load_model("base")
res = model.transcribe(AUDIO)   # auto-detect language, no forcing
print("detected lang:", res.get("language"))
for s in res["segments"]:
    if s["start"] < 12:
        print(f'{s["start"]:.2f}-{s["end"]:.2f}: {s["text"]}')
