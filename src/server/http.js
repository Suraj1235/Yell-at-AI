import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaselineFromSamples, mergeBaselines } from "../calibration/baseline.js";
import { analyzeFile, analyzeSamples } from "../contract/analyzer.js";
import { parseWav } from "../audio/wav.js";
import { renderVocalContext } from "../render/text.js";
import { normalizeTranscriptEnvelope } from "../transcript/envelope.js";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const webPreviewDir = join(rootDir, "ui", "web-preview");

export function startHttpServer(options = {}) {
  const port = Number(options.port ?? process.env.SUBTEXT_PORT ?? 8765);
  const host = options.host ?? "127.0.0.1";
  const requestedMaxBodyBytes = Number(options.maxBodyBytes ?? process.env.SUBTEXT_MAX_BODY_BYTES ?? 25 * 1024 * 1024);
  const maxBodyBytes = Number.isFinite(requestedMaxBodyBytes) && requestedMaxBodyBytes > 0
    ? requestedMaxBodyBytes
    : 25 * 1024 * 1024;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/") {
        return sendStatic(res, "index.html");
      }

      if (req.method === "GET" && ["/app.js", "/style.css"].includes(url.pathname)) {
        return sendStatic(res, url.pathname.slice(1));
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true, service: "subtext", schema: "vocalcontext/v1" });
      }

      if (req.method === "POST" && url.pathname === "/v1/analyze") {
        const body = await readJson(req, { maxBodyBytes });
        const transcript = normalizeTranscript(body);
        const contract = await analyzeFile(body.audioPath, transcript.text, {
          ...(body.options ?? {}),
          baseline: body.baseline ?? body.options?.baseline,
          wordTimings: transcript.wordTimings,
          requireWordTimings: body.requireWordTimings ?? body.require_word_timings ?? body.options?.requireWordTimings,
          transcriptSource: transcript.source,
          transcriptConfidence: transcript.confidence,
          language: transcript.language
        });
        if (body.format === "prompt") {
          return sendText(res, 200, renderVocalContext(contract, { verbosity: body.verbosity ?? "subtle" }));
        }
        return sendJson(res, 200, contract);
      }

      if (req.method === "POST" && url.pathname === "/v1/analyze-audio") {
        const body = await readJson(req, { maxBodyBytes });
        const transcript = normalizeTranscript(body);
        const audioBase64 = body.audioBase64 ?? stripDataUrl(body.audioDataUrl ?? body.audio ?? "");
        if (!audioBase64) {
          return sendJson(res, 400, { error: "missing_audio", message: "Expected audioBase64 or audioDataUrl." });
        }
        const wav = parseWav(Buffer.from(audioBase64, "base64"));
        const contract = analyzeSamples({
          samples: wav.samples,
          sampleRate: wav.sampleRate,
          text: transcript.text,
          baseline: body.baseline ?? body.options?.baseline,
          options: {
            ...(body.options ?? {}),
            wordTimings: transcript.wordTimings,
            requireWordTimings: body.requireWordTimings ?? body.require_word_timings ?? body.options?.requireWordTimings,
            transcriptSource: transcript.source,
            transcriptConfidence: transcript.confidence,
            language: transcript.language
          }
        });
        if (body.format === "prompt") {
          return sendText(res, 200, renderVocalContext(contract, { verbosity: body.verbosity ?? "subtle" }));
        }
        return sendJson(res, 200, contract);
      }

      if (req.method === "POST" && url.pathname === "/v1/calibrate") {
        const body = await readJson(req, { maxBodyBytes });
        const entries = Array.isArray(body.entries)
          ? body.entries
          : [{ audioBase64: body.audioBase64 ?? stripDataUrl(body.audioDataUrl ?? body.audio ?? ""), text: body.text }];
        const newBaseline = buildBaselineFromSamples(entries.map((entry) => {
          const audioBase64 = entry.audioBase64 ?? stripDataUrl(entry.audioDataUrl ?? entry.audio ?? "");
          if (!audioBase64) {
            throw new Error("Calibration entry missing audioBase64 or audioDataUrl.");
          }
          const wav = parseWav(Buffer.from(audioBase64, "base64"));
          return {
            samples: wav.samples,
            sampleRate: wav.sampleRate,
            text: entry.text
          };
        }));
        const baseline = body.baseline ? mergeBaselines(body.baseline, newBaseline) : newBaseline;
        return sendJson(res, 200, baseline);
      }

      if (req.method === "POST" && url.pathname === "/v1/render") {
        const body = await readJson(req, { maxBodyBytes });
        return sendText(res, 200, renderVocalContext(body.contract, { verbosity: body.verbosity ?? "subtle" }));
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      return sendJson(res, error.statusCode ?? 500, { error: error.code ?? "internal_error", message: error.message });
    }
  });

  server.listen(port, host);
  return server;
}

async function sendStatic(res, fileName) {
  const safeName = normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(webPreviewDir, safeName);
  if (!filePath.startsWith(webPreviewDir)) {
    return sendJson(res, 403, { error: "forbidden" });
  }

  const content = await readFile(filePath);
  res.writeHead(200, { "content-type": contentType(filePath) });
  res.end(content);
}

function readJson(req, options = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? 25 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        settled = true;
        reject(httpError(413, "payload_too_large", `Request body exceeds ${maxBodyBytes} bytes.`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(httpError(400, "invalid_json", error.message));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

function sendText(res, status, value) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(value);
}

function stripDataUrl(value) {
  const text = String(value);
  const marker = ";base64,";
  const index = text.indexOf(marker);
  return index >= 0 ? text.slice(index + marker.length) : text;
}

function normalizeTranscript(body) {
  return normalizeTranscriptEnvelope(body, {
    fallbackSource: "http",
    source: body.transcriptSource ?? body.transcript_source,
    confidence: body.transcriptConfidence ?? body.transcript_confidence,
    language: body.language,
    wordTimings: body.wordTimings
      ?? body.word_timestamps
      ?? body.wordTimestamps
      ?? body.word_timings
      ?? body.options?.wordTimings
      ?? body.options?.word_timestamps
      ?? body.options?.wordTimestamps
      ?? body.options?.word_timings
  });
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
