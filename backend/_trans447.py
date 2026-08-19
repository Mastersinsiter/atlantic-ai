import sys,stable_whisper
sys.stdout.reconfigure(encoding="utf-8",errors="replace")
m=stable_whisper.load_model("medium")
r=m.transcribe(sys.argv[1], language="hi")
import json
print(json.dumps([{"start":round(s.start,2),"end":round(s.end,2),"text":s.text[:50]} for s in r.segments[:6]], ensure_ascii=False))
