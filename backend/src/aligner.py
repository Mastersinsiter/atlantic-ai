import argparse
import json
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--transcript", required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    import stable_whisper

    with open(args.transcript, "r", encoding="utf-8") as f:
        transcript_data = json.load(f)

    if isinstance(transcript_data, str):
        text = transcript_data
    elif isinstance(transcript_data, list):
        text = " ".join(w.get("word", "") for w in transcript_data if isinstance(w, dict))
    elif isinstance(transcript_data, dict) and "text" in transcript_data:
        text = transcript_data["text"]
    elif isinstance(transcript_data, dict) and "words" in transcript_data:
        text = " ".join(w.get("word", "") for w in transcript_data["words"])
    else:
        print(f"Unrecognized transcript JSON shape: {type(transcript_data)}", file=sys.stderr)
        sys.exit(1)

    # NOTE: "base" was a placeholder — bumped to "medium" for Hindi/Hinglish
    # accuracy. This reloads the model from scratch on every subprocess call
    # (once per clip per the logs) — worth caching/reusing later if alignment
    # gets slow.
    model = stable_whisper.load_model("medium")

    # stable_whisper's align() requires a concrete ISO 639-1 language code —
    # unlike transcribe() it does NOT accept None/"auto" (raises
    # TypeError: expected argument for language). So if the caller passed
    # "auto"/empty/unknown, detect the real language from the audio first.
    lang = (args.language or "").strip().lower()
    if lang in ("", "auto", "unknown", "none", "hinglish"):
        import whisper as _whisper
        from whisper.audio import load_audio as _load_audio, log_mel_spectrogram as _mel
        try:
            audio = _load_audio(args.audio)
            # First 30s is plenty for language ID
            mel = _mel(audio[: _whisper.audio.SAMPLE_RATE * 30])
            _, probs = model.detect_language(mel)
            detected = max(probs, key=probs.get)
            lang = detected
            print(f"[aligner] Auto-detected language: {lang} (p={probs[detected]:.2f})", file=sys.stderr)
        except Exception as e:
            print(f"[aligner] Language detection failed ({e}); falling back to 'en'", file=sys.stderr)
            lang = "en"

    result = model.align(audio=args.audio, text=text, language=lang)

    words_out = []
    for seg in result.segments:
        for w in seg.words:
            words_out.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump({"words": words_out}, f, ensure_ascii=False, indent=2)

    print(f"Aligned {len(words_out)} words -> {args.output}")

if __name__ == "__main__":
    main()
