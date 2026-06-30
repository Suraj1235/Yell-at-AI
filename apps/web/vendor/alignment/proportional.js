export function alignWordsProportionally(words, prosodySummary) {
  if (!words.length) return [];
  const speechStartSec = prosodySummary.speechStartSec ?? 0;
  const speechEndSec = prosodySummary.speechEndSec ?? prosodySummary.durationSec ?? 0;
  const speechDurationSec = Math.max(0.001, speechEndSec - speechStartSec);
  const totalWeight = words.reduce((sum, word) => sum + wordWeight(word), 0);
  let cursor = speechStartSec;

  return words.map((word, index) => {
    const weight = wordWeight(word);
    const duration = index === words.length - 1 ? speechEndSec - cursor : (speechDurationSec * weight) / totalWeight;
    const startSec = cursor;
    const endSec = Math.min(speechEndSec, startSec + Math.max(0.04, duration));
    cursor = endSec;
    return {
      ...word,
      startSec,
      endSec,
      durationSec: Math.max(0.001, endSec - startSec)
    };
  });
}

function wordWeight(word) {
  return Math.sqrt(Math.max(1, word.syllables));
}
