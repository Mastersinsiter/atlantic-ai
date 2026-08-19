import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini API
const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenerativeAI(apiKey);
};

export async function translateSegments(segments, options = {}) {
  const sourceLang = options.sourceLanguage || 'auto';
  const targetLang = options.targetLanguage || 'en';
  
  if (sourceLang === 'en') {
    return segments; // No translation needed, although maybe cleanup can happen here
  }

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Group segments to provide context
  // The prompt asks Gemini to return translated segments in JSON
  const prompt = `
You are translating ${sourceLang} gaming commentary into natural, conversational ${targetLang}.

Rules for English:
- "bhai" -> context-dependent: "dude", "man", "bro", or omit
- "yaar" -> "man", "dude", or omit
- "kya" -> "what", "seriously", or part of a larger phrase

Rules for Hinglish:
- If target language is "hinglish", do NOT translate the meaning. Only TRANSLITERATE the Hindi/Urdu words into Roman script (e.g. "bhai sach mein" instead of "भाई सच में"). NEVER use Devanagari script.

General Rules:
- Gaming slang stays: "clutch", "one-tap", "wallbang"
- Internet slang stays: "GG", "noob", "OP"
- Preserve emotion intensity: if speaker is hyped, translation is hyped
- NEVER literal. ALWAYS conversational.
- Keep approximately the same number of words as the source if possible.

Below is an array of segments with their timestamps.
Return a JSON array of translated segments. Each object in the array must contain:
"start", "end", "text" (the translated text), and "words" (an array of translated words).
For the words array, distribute the total time (end - start) roughly evenly among the translated words.
Each word object must have "word", "start", and "end".

Input segments:
${JSON.stringify(segments, null, 2)}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    // Parse JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return segments; // Fallback
  } catch (err) {
    console.error('[translation] Failed to translate segments:', err.message);
    return segments; // Fallback to original
  }
}
