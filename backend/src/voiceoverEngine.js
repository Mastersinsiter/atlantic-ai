import fs from 'fs';
import path from 'path';

/**
 * Generates TTS audio using ElevenLabs and saves it to outputPath
 * @param {string} text - The script to read
 * @param {string} outputPath - Where to save the mp3
 * @returns {Promise<boolean>} True if successful
 */
export async function generateElevenLabsVoiceover(text, outputPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log('[voiceover] No ELEVENLABS_API_KEY found, skipping.');
    return false;
  }
  if (!text || !text.trim()) {
    console.log('[voiceover] No text provided for voiceover.');
    return false;
  }

  // Use a default popular voice ID (e.g. Adam or Rachel)
  const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam

  try {
    console.log(`[voiceover] Generating TTS for: "${text.slice(0, 30)}..."`);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log(`[voiceover] API error ${res.status}: ${errText.slice(0, 200)}`);
      return false;
    }

    const buffer = await res.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    console.log(`[voiceover] Saved to ${outputPath}`);
    return true;
  } catch (err) {
    console.log(`[voiceover] Failed to generate TTS: ${err.message}`);
    return false;
  }
}
