import { countSyllables } from "./syllables.js";

export const FILLED_PAUSES = new Set(["um", "uh", "erm", "hmm", "mmm"]);
export const SOFTENERS = new Set(["just", "maybe", "perhaps", "kinda", "sorta", "possibly", "probably"]);
export const CONFUSION_WORDS = new Set(["confused", "lost", "stuck", "unsure", "unclear", "wait", "huh"]);
export const POSITIVE_WORDS = new Set(["fine", "great", "good", "okay", "ok", "totally", "sure", "love"]);
export const NEGATIVE_WORDS = new Set(["bad", "broken", "hate", "wrong", "terrible", "awful", "blocked"]);

const WORD_RE = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g;

export function tokenizeWords(text) {
  const words = [];
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    const normalized = word.toLowerCase();
    words.push({
      word,
      normalized,
      index: words.length,
      startChar: match.index,
      endChar: match.index + word.length,
      syllables: countSyllables(word)
    });
  }
  return words;
}
