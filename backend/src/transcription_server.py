import argparse
import io
import os
import subprocess
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Atlantic AI Transcription Server")

# Global models (lazy load)
whisper_model = None
align_model = None
align_metadata = None

def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            # Load with int8 on CPU since the machine is likely CPU-only or limited GPU
            # Change device="cuda" if GPU is fully available.
            logger.info("Loading Faster-Whisper large-v3...")
            whisper_model = WhisperModel("large-v3", device="cpu", compute_type="int8")
        except Exception as e:
            logger.error(f"Failed to load Faster-Whisper: {e}")
            raise HTTPException(status_code=500, detail="Faster-Whisper not installed or failed to load")
    return whisper_model

def get_whisperx_model(language):
    global align_model, align_metadata
    if align_model is None:
        try:
            import whisperx
            logger.info(f"Loading WhisperX alignment model for {language}...")
            # For alignment, CPU can be slow but works.
            align_model, align_metadata = whisperx.load_align_model(language_code=language, device="cpu")
        except Exception as e:
            logger.error(f"Failed to load WhisperX alignment: {e}")
            return None, None
    return align_model, align_metadata

@app.post("/transcribe")
async def transcribe(
    audio_path: str = Form(...),
    language: str = Form("auto")
):
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=400, detail="Audio file not found")
        
    model = get_whisper_model()
    
    lang = None if language == "auto" else language
    if lang == "hinglish":
        lang = None  # auto-detect; large-v3 handles code-switched audio better than forced 'hi'
        
    logger.info(f"Transcribing {audio_path} (language: {lang})...")
    
    # Run Faster-Whisper with VAD
    # We use word_timestamps=True to get word-level timing directly from CTC
    segments_gen, info = model.transcribe(
        audio_path,
        language=lang,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    detected_lang = info.language
    logger.info(f"Detected language: {detected_lang}")
    
    segments = []
    whisperx_segments = []
    
    for seg in segments_gen:
        segment = {
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
            "words": []
        }
        
        # WhisperX formatting needs texts per segment
        whisperx_segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text
        })
        
        if seg.words:
            for w in seg.words:
                segment["words"].append({
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    "probability": w.probability
                })
        segments.append(segment)
        
    # Attempt WhisperX alignment if available
    aligned = False
    try:
        import whisperx
        a_model, a_meta = get_whisperx_model(detected_lang)
        if a_model is not None:
            logger.info("Running WhisperX alignment...")
            # WhisperX requires loading the audio again
            audio = whisperx.load_audio(audio_path)
            result = whisperx.align(whisperx_segments, a_model, a_meta, audio, "cpu", return_char_alignments=False)
            
            # Replace words with aligned words
            aligned_segments = []
            for s in result["segments"]:
                seg_dict = {
                    "start": s["start"],
                    "end": s["end"],
                    "text": s["text"],
                    "words": []
                }
                if "words" in s:
                    for w in s["words"]:
                        if "start" in w and "end" in w:
                            seg_dict["words"].append({
                                "word": w["word"],
                                "start": w["start"],
                                "end": w["end"]
                            })
                aligned_segments.append(seg_dict)
            segments = aligned_segments
            aligned = True
            logger.info("WhisperX alignment complete.")
    except Exception as e:
        logger.warning(f"WhisperX alignment skipped/failed: {e}")
        
    return JSONResponse({
        "language": detected_lang,
        "segments": segments,
        "aligned_with_whisperx": aligned
    })

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)
