export function countSyllables(word) {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return 1;
  if (normalized.length <= 3) return 1;

  const withoutSilentE = normalized.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  const groups = withoutSilentE.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}
