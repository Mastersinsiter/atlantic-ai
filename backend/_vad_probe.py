
import sys, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import stable_whisper
model = stable_whisper.load_model("medium")
res = model.transcribe(sys.argv[1], vad=True, language="hi")
segs = [{"start": round(s.start,2), "end": round(s.end,2), "text": s.text[:40]} for s in res.segments]
print(json.dumps(segs[:15], ensure_ascii=False))
print("TOTAL_SEGS", len(res.segments))
