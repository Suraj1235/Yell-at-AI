import readline from "node:readline";
import { parseWav } from "../audio/wav.js";
import { analyzeFile, analyzeSamples } from "../contract/analyzer.js";
import { renderVocalContext } from "../render/text.js";
import { normalizeTranscriptEnvelope } from "../transcript/envelope.js";

export function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
      const result = await handleMessage(message);
      if (message.id !== undefined) {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
      }
    } catch (error) {
      const id = message?.id ?? null;
      output.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: error.message }
      })}\n`);
    }
  });

  return rl;
}

async function handleMessage(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "subtext", version: "0.1.0" }
    };
  }

  if (message.method === "tools/list") {
    return {
      tools: [
        {
          name: "analyze_file",
          description: "Analyze a local WAV file and transcript into a vocalcontext/v1 contract or prompt block.",
          inputSchema: {
            type: "object",
            required: ["audioPath"],
            properties: {
              audioPath: { type: "string" },
              text: { type: "string" },
              transcript: {
                type: "object",
                description: "Optional native voice transcript metadata.",
                properties: {
                  schema: { type: "string", const: "subtext/transcript/v1" },
                  text: { type: "string" },
                  source: { type: "string" },
                  confidence: { type: "number" },
                  language: { type: "string" },
                  wordTimings: { type: "array" }
                }
              },
              transcriptSource: { type: "string", default: "mcp" },
              transcriptConfidence: { type: "number" },
              language: { type: "string" },
              wordTimings: {
                type: "array",
                description: "Optional host voice-model word timings in seconds, e.g. [{ word, start, end }].",
                items: {
                  type: "object",
                  required: ["word", "start", "end"],
                  properties: {
                    word: { type: "string" },
                    start: { type: "number" },
                    end: { type: "number" }
                  }
                }
              },
              requireWordTimings: { type: "boolean", default: false },
              format: { type: "string", enum: ["json", "prompt"], default: "prompt" },
              verbosity: { type: "string", enum: ["raw", "subtle", "full"], default: "subtle" }
            }
          }
        },
        {
          name: "analyze_audio",
          description: "Analyze base64 WAV audio and transcript metadata into a vocalcontext/v1 contract or prompt block.",
          inputSchema: {
            type: "object",
            required: ["audioBase64"],
            properties: {
              audioBase64: { type: "string", description: "Base64-encoded WAV bytes." },
              audioDataUrl: { type: "string", description: "Optional data:audio/wav;base64,... URL." },
              text: { type: "string" },
              transcript: {
                type: "object",
                description: "Optional native voice transcript metadata.",
                properties: {
                  schema: { type: "string", const: "subtext/transcript/v1" },
                  text: { type: "string" },
                  source: { type: "string" },
                  confidence: { type: "number" },
                  language: { type: "string" },
                  wordTimings: { type: "array" }
                }
              },
              transcriptSource: { type: "string", default: "mcp" },
              transcriptConfidence: { type: "number" },
              language: { type: "string" },
              wordTimings: {
                type: "array",
                description: "Optional host voice-model word timings in seconds, e.g. [{ word, start, end }].",
                items: {
                  type: "object",
                  required: ["word", "start", "end"],
                  properties: {
                    word: { type: "string" },
                    start: { type: "number" },
                    end: { type: "number" }
                  }
                }
              },
              requireWordTimings: { type: "boolean", default: false },
              baseline: { type: "object" },
              format: { type: "string", enum: ["json", "prompt"], default: "prompt" },
              verbosity: { type: "string", enum: ["raw", "subtle", "full"], default: "subtle" }
            }
          }
        },
        {
          name: "render_vocal_context",
          description: "Render an existing vocalcontext/v1 contract as an assistant prompt block.",
          inputSchema: {
            type: "object",
            required: ["contract"],
            properties: {
              contract: { type: "object" },
              verbosity: { type: "string", enum: ["raw", "subtle", "full"], default: "subtle" }
            }
          }
        }
      ]
    };
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params ?? {};
    if (name === "analyze_file") {
      const transcript = normalizeToolTranscript(args);
      const contract = await analyzeFile(args.audioPath, transcript.text, {
        ...args,
        wordTimings: transcript.wordTimings,
        transcriptSource: transcript.source,
        transcriptConfidence: transcript.confidence,
        language: transcript.language
      });
      return renderToolContract(contract, args);
    }
    if (name === "analyze_audio") {
      const transcript = normalizeToolTranscript(args);
      const audioBase64 = args.audioBase64 ?? stripDataUrl(args.audioDataUrl ?? args.audio ?? "");
      if (!audioBase64) {
        throw new Error("analyze_audio requires audioBase64 or audioDataUrl.");
      }
      const wav = parseWav(Buffer.from(audioBase64, "base64"));
      const contract = analyzeSamples({
        samples: wav.samples,
        sampleRate: wav.sampleRate,
        text: transcript.text,
        baseline: args.baseline,
        options: {
          ...args,
          wordTimings: transcript.wordTimings,
          transcriptSource: transcript.source,
          transcriptConfidence: transcript.confidence,
          language: transcript.language
        }
      });
      return renderToolContract(contract, args);
    }
    if (name === "render_vocal_context") {
      return {
        content: [{
          type: "text",
          text: renderVocalContext(args.contract, { verbosity: args.verbosity ?? "subtle" })
        }]
      };
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  if (message.method === "notifications/initialized") {
    return {};
  }

  throw new Error(`Unsupported JSON-RPC method: ${message.method}`);
}

function renderToolContract(contract, args) {
  const text = args.format === "json"
    ? JSON.stringify(contract, null, 2)
    : renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });
  return { content: [{ type: "text", text }] };
}

function stripDataUrl(value) {
  const text = String(value);
  const marker = ";base64,";
  const index = text.indexOf(marker);
  return index >= 0 ? text.slice(index + marker.length) : text;
}

function normalizeToolTranscript(args) {
  return normalizeTranscriptEnvelope(args, {
    fallbackSource: "mcp",
    source: args.transcriptSource ?? args.transcript_source,
    confidence: args.transcriptConfidence ?? args.transcript_confidence,
    language: args.language,
    wordTimings: args.wordTimings
      ?? args.word_timestamps
      ?? args.wordTimestamps
      ?? args.word_timings
  });
}
