const args = process.argv.slice(2);
const text = args.find((arg) => arg && !arg.endsWith(".wav") && !arg.startsWith("--"))
  ?? "can we just refactor the whole auth module";

if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify({
    schema: "subtext/transcript/v1",
    text,
    source: "host-native-voice",
    confidence: 0.97,
    language: "en",
    wordTimings: [
      { word: "can", start: 0, end: 0.22 },
      { word: "we", start: 0.25, end: 0.45 },
      { word: "just", start: 0.48, end: 0.76 },
      { word: "refactor", start: 0.79, end: 1.25 },
      { word: "the", start: 1.29, end: 1.47 },
      { word: "whole", start: 1.49, end: 1.99 },
      { word: "auth", start: 2.03, end: 2.31 },
      { word: "module", start: 2.34, end: 2.7 }
    ]
  })}\n`);
} else {
  process.stdout.write(`${text}\n`);
}
