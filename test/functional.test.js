import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startHttpServer } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const bin = join(root, "bin", "subtext.js");
const hook = join(root, "adapters", "claude-code", "hooks", "user-prompt-submit.mjs");
const vscodeRunner = require(join(root, "adapters", "vscode", "runner.cjs"));
const audioPath = join(root, "eval", "fixtures", "emphasis.wav");
const fakeRecorder = "node scripts/fake-recorder.mjs {out}";
const text = "can we just refactor the whole auth module";
const runTmp = join(root, "tmp", `functional-${process.pid}-${Date.now()}`);

function tmpPath(...parts) {
  return join(runTmp, ...parts);
}

test("CLI analyze renders an injectable vocal-context prompt", async () => {
  const stdout = await run("node", [
    bin,
    "analyze",
    "--audio",
    audioPath,
    "--text",
    text,
    "--transcript-source",
    "host-native-voice",
    "--word-timings",
    JSON.stringify(emphasisWordTimings()),
    "--format",
    "prompt",
    "--verbosity",
    "full"
  ]);

  assert.match(stdout, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(stdout, /Transcript: host-native-voice word_timestamps=true/);
  assert.match(stdout, /Emphasis: whole/);
  assert.match(stdout, /Affect: emphatic/);
  assert.match(stdout, /Alignment: platform_word_timestamps confidence=1 matched=8\/8/);
  assert.match(stdout, new RegExp(`${escapeRegExp(text)}\\s*$`));
});

test("CLI analyze accepts native transcript envelope files", async () => {
  const transcriptPath = tmpPath("functional-transcript-envelope.json");
  await mkdir(dirname(transcriptPath), { recursive: true });
  await writeFile(transcriptPath, `${JSON.stringify({
    schema: "subtext/transcript/v1",
    text,
    source: "codex-native-voice",
    confidence: 0.94,
    language: "en",
    words: emphasisWordTimingsWithPhones()
  })}\n`);

  const stdout = await run("node", [
    bin,
    "analyze",
    "--audio",
    audioPath,
    "--transcript",
    transcriptPath,
    "--require-word-timings",
    "--format",
    "json"
  ]);
  const contract = JSON.parse(stdout);

  assert.equal(contract.schema, "vocalcontext/v1");
  assert.equal(contract.transcript.source, "codex-native-voice");
  assert.equal(contract.transcript.confidence, 0.94);
  assert.equal(contract.transcript.language, "en");
  assert.equal(contract.transcript.word_timestamps, true);
  assert.equal(contract.alignment.source, "platform_word_timestamps");
  assert.equal(contract.emphasis[0].word.toLowerCase(), "whole");
  const whole = contract.word_features.find((item) => item.word.toLowerCase() === "whole");
  assert.equal(whole.duration_source, "platform_phone_timestamps");
});

test("HTTP server analyzes audio and renders prompt output", async () => {
  const server = startHttpServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.deepEqual(await health.json(), { ok: true, service: "subtext", schema: "vocalcontext/v1" });

    const jsonResponse = await fetch(`${baseUrl}/v1/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audioPath,
        transcript: {
          schema: "subtext/transcript/v1",
          text,
          source: "platform-native-voice",
          confidence: 0.97,
          language: "en",
          wordTimings: emphasisWordTimings()
        }
      })
    });
    const contract = await jsonResponse.json();
    assert.equal(contract.schema, "vocalcontext/v1");
    assert.equal(contract.emphasis[0].word.toLowerCase(), "whole");
    assert.equal(contract.alignment.source, "platform_word_timestamps");
    assert.equal(contract.transcript.source, "platform-native-voice");
    assert.equal(contract.transcript.confidence, 0.97);
    assert.equal(contract.transcript.language, "en");

    const promptResponse = await fetch(`${baseUrl}/v1/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioPath, text, format: "prompt", verbosity: "subtle" })
    });
    assert.match(await promptResponse.text(), /<vocal-context schema="vocalcontext\/v1">/);

    const wavBase64 = (await readFile(audioPath)).toString("base64");
    const audioResponse = await fetch(`${baseUrl}/v1/analyze-audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: wavBase64, text })
    });
    const audioContract = await audioResponse.json();
    assert.equal(audioContract.schema, "vocalcontext/v1");
    assert.equal(audioContract.emphasis[0].word.toLowerCase(), "whole");

    const dictatedAudioResponse = await fetch(`${baseUrl}/v1/analyze-audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audioBase64: wavBase64,
        transcript: {
          schema: "subtext/transcript/v1",
          text,
          source: "browser-speech-recognition",
          confidence: 0.91,
          language: "en-US",
          wordTimings: emphasisWordTimingsWithPhones()
        },
        requireWordTimings: true
      })
    });
    const dictatedAudio = await dictatedAudioResponse.json();
    assert.equal(dictatedAudio.schema, "vocalcontext/v1");
    assert.equal(dictatedAudio.transcript.source, "browser-speech-recognition");
    assert.equal(dictatedAudio.transcript.confidence, 0.91);
    assert.equal(dictatedAudio.transcript.language, "en-US");
    assert.equal(dictatedAudio.transcript.word_timestamps, true);
    assert.equal(dictatedAudio.alignment.source, "platform_word_timestamps");
    const dictatedWhole = dictatedAudio.word_features.find((item) => item.word.toLowerCase() === "whole");
    assert.equal(dictatedWhole.duration_source, "platform_phone_timestamps");

    const baselineResponse = await fetch(`${baseUrl}/v1/calibrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: wavBase64, text })
    });
    const baseline = await baselineResponse.json();
    assert.equal(baseline.schema, "subtext/baseline/v1");
    assert.equal(baseline.samples, 1);

    const updatedBaselineResponse = await fetch(`${baseUrl}/v1/calibrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: wavBase64, text, baseline })
    });
    const updatedBaseline = await updatedBaselineResponse.json();
    assert.equal(updatedBaseline.schema, "subtext/baseline/v1");
    assert.equal(updatedBaseline.samples, 2);
    assert.equal(typeof updatedBaseline.updatedAt, "string");

    const personalizedResponse = await fetch(`${baseUrl}/v1/analyze-audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: wavBase64, text, baseline: updatedBaseline })
    });
    const personalized = await personalizedResponse.json();
    assert.equal(personalized.calibration.baseline, "personal");
    assert.equal(personalized.calibration.samples, 2);
  } finally {
    await closeServer(server);
  }
});

test("HTTP server serves the microphone preview harness", async () => {
  const server = startHttpServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    assert.match(html, /Voice Context Preview/);
    assert.match(html, /\/app\.js/);
    assert.match(html, /profileName/);
    assert.match(html, /Load Profile/);
    assert.match(html, /microphoneSelect/);
    assert.match(html, /Refresh Mics/);

    const app = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(app, /getUserMedia/);
    assert.match(app, /enumerateDevices/);
    assert.match(app, /deviceId/);
    assert.match(app, /selected device unavailable/);
    assert.match(app, /SpeechRecognition/);
    assert.match(app, /Dictation/);
    assert.match(app, /subtext\/transcript\/v1/);
    assert.match(app, /browser-speech-recognition/);
    assert.match(app, /browser-preview-manual/);
    assert.match(app, /\/v1\/analyze-audio/);
    assert.match(app, /\/v1\/calibrate/);
    assert.match(app, /baseline/);
    assert.match(app, /subtextProfiles/);
    assert.match(app, /subtextActiveProfile/);
    assert.match(app, /subtextAudioDeviceId/);
    assert.match(app, /deviceProfiles/);
    assert.match(app, /localStorage/);
  } finally {
    await closeServer(server);
  }
});

test("HTTP server rejects malformed and oversized JSON requests", async () => {
  const server = startHttpServer({ port: 0, host: "127.0.0.1", maxBodyBytes: 64 });
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const malformed = await fetch(`${baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "invalid_json");

    const oversized = await fetch(`${baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract: { text: "x".repeat(128) } })
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, "payload_too_large");
  } finally {
    await closeServer(server);
  }
});

test("CLI serve exits cleanly with a readable error on a port conflict", async () => {
  const server = startHttpServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();

  try {
    const { code, stderr } = await runProcess("node", [
      bin,
      "serve",
      "--port",
      String(address.port),
      "--host",
      address.address
    ]);

    assert.equal(code, 1);
    assert.match(stderr, /subtext:/);
    assert.match(stderr, /EADDRINUSE/);
    assert.doesNotMatch(stderr, /at Server\./);
    assert.doesNotMatch(stderr, /node:events/);
  } finally {
    await closeServer(server);
  }
});

test("CLI calibrate writes a reusable baseline for analyze", async () => {
  const baselinePath = tmpPath("functional-baseline.json");
  await run("node", [
    bin,
    "calibrate",
    "--audio",
    audioPath,
    "--text",
    text,
    "--out",
    baselinePath
  ]);

  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.equal(baseline.schema, "subtext/baseline/v1");
  assert.equal(baseline.samples, 1);

  await run("node", [
    bin,
    "calibrate",
    "--baseline",
    baselinePath,
    "--audio",
    audioPath,
    "--text",
    text,
    "--out",
    baselinePath
  ]);

  const updatedBaseline = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.equal(updatedBaseline.schema, "subtext/baseline/v1");
  assert.equal(updatedBaseline.samples, 2);
  assert.equal(typeof updatedBaseline.updatedAt, "string");

  const stdout = await run("node", [
    bin,
    "analyze",
    "--audio",
    audioPath,
    "--text",
    text,
    "--baseline",
    baselinePath
  ]);
  const contract = JSON.parse(stdout);
  assert.equal(contract.calibration.baseline, "personal");
  assert.equal(contract.calibration.samples, 2);
});

test("CLI profile store manages named calibration profiles", async () => {
  const profilesPath = tmpPath("functional-profiles.json");
  await rm(profilesPath, { force: true });

  await run("node", [
    bin,
    "calibrate",
    "--profile",
    "laptop-mic",
    "--profiles",
    profilesPath,
    "--device",
    "built-in",
    "--environment",
    "desk",
    "--audio",
    audioPath,
    "--text",
    text
  ]);

  const listStdout = await run("node", [bin, "profile", "list", "--profiles", profilesPath, "--format", "json"]);
  const list = JSON.parse(listStdout);
  assert.equal(list.schema, "subtext/profile-list/v1");
  assert.equal(list.profiles[0].name, "laptop-mic");
  assert.equal(list.profiles[0].samples, 1);
  assert.equal(list.profiles[0].device, "built-in");
  assert.equal(list.profiles[0].environment, "desk");

  await run("node", [
    bin,
    "calibrate",
    "--profile",
    "laptop-mic",
    "--profiles",
    profilesPath,
    "--audio",
    audioPath,
    "--text",
    text
  ]);

  const show = JSON.parse(await run("node", [bin, "profile", "show", "--profiles", profilesPath, "--name", "laptop-mic"]));
  assert.equal(show.baseline.samples, 2);

  const stdout = await run("node", [
    bin,
    "analyze",
    "--profile",
    "laptop-mic",
    "--profiles",
    profilesPath,
    "--audio",
    audioPath,
    "--text",
    text
  ]);
  const contract = JSON.parse(stdout);
  assert.equal(contract.calibration.baseline, "personal");
  assert.equal(contract.calibration.samples, 2);

  await run("node", [bin, "profile", "delete", "--profiles", profilesPath, "--name", "laptop-mic"]);
  await assert.rejects(
    run("node", [bin, "analyze", "--profile", "laptop-mic", "--profiles", profilesPath, "--audio", audioPath, "--text", text]),
    /Profile has no usable baseline/
  );
});

test("CLI handoff can target stdout, file, clipboard command, and active-app paste command", async () => {
  const stdout = await run("node", [
    bin,
    "handoff",
    "--audio",
    audioPath,
    "--text",
    text,
    "--target",
    "stdout",
    "--verbosity",
    "full"
  ]);
  assert.match(stdout, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(stdout, /Emphasis: whole/);

  const handoffPath = tmpPath("functional-handoff.txt");
  await run("node", [
    bin,
    "handoff",
    "--audio",
    audioPath,
    "--text",
    text,
    "--target",
    "file",
    "--out",
    handoffPath
  ]);
  assert.match(await readFile(handoffPath, "utf8"), /<vocal-context/);

  const clipboardPath = tmpPath("functional-clipboard.txt");
  await run("node", [
    bin,
    "handoff",
    "--audio",
    audioPath,
    "--text",
    text,
    "--target",
    "clipboard",
    "--clipboard-command",
    `node scripts/clipboard-sink.mjs ${clipboardPath}`
  ]);
  assert.match(await readFile(clipboardPath, "utf8"), /<vocal-context/);

  const pasteClipboardPath = tmpPath("functional-paste-clipboard.txt");
  const pastePath = tmpPath("functional-paste.txt");
  await run("node", [
    bin,
    "handoff",
    "--audio",
    audioPath,
    "--text",
    text,
    "--target",
    "paste",
    "--clipboard-command",
    `node scripts/clipboard-sink.mjs ${pasteClipboardPath}`,
    "--paste-command",
    `node scripts/paste-sink.mjs ${pastePath}`
  ]);
  assert.match(await readFile(pasteClipboardPath, "utf8"), /<vocal-context/);
  assert.equal(await readFile(pastePath, "utf8"), "pasted\n");
});

test("CLI capture records desktop audio path and can analyze it", async () => {
  const capturePath = tmpPath("functional-capture.wav");
  const reportStdout = await run("node", [
    bin,
    "capture",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder
  ]);
  const report = JSON.parse(reportStdout);
  assert.equal(report.schema, "subtext/capture/v1");
  assert.equal(report.audioPath, capturePath);
  assert.equal(report.recorder, "custom");
  assert.ok((await readFile(capturePath)).length > 44);

  const promptStdout = await run("node", [
    bin,
    "capture",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--text",
    text,
    "--format",
    "prompt",
    "--verbosity",
    "full"
  ]);
  assert.match(promptStdout, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(promptStdout, /Affect: emphatic/);
  assert.match(promptStdout, /can we just refactor the whole auth module/);

  const pasteClipboardPath = tmpPath("functional-capture-paste-clipboard.txt");
  const pastePath = tmpPath("functional-capture-paste.txt");
  await run("node", [
    bin,
    "capture",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--text",
    text,
    "--target",
    "paste",
    "--clipboard-command",
    `node scripts/clipboard-sink.mjs ${pasteClipboardPath}`,
    "--paste-command",
    `node scripts/paste-sink.mjs ${pastePath}`
  ]);
  assert.match(await readFile(pasteClipboardPath, "utf8"), /<vocal-context/);
  assert.equal(await readFile(pastePath, "utf8"), "pasted\n");
});

test("CLI session records natural speech, reads a host transcript command, and can paste", async () => {
  const capturePath = tmpPath("functional-session.wav");
  const transcriptCommand = "node scripts/transcript-source.mjs {audio}";

  const jsonStdout = await run("node", [
    bin,
    "session",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--transcript-command",
    transcriptCommand,
    "--format",
    "json"
  ]);
  const result = JSON.parse(jsonStdout);
  assert.equal(result.capture.schema, "subtext/capture/v1");
  assert.equal(result.contract.schema, "vocalcontext/v1");
  assert.equal(result.contract.transcript.source, "host_transcript_command");
  assert.equal(result.contract.text, text);
  assert.ok((await readFile(capturePath)).length > 44);

  const structuredStdout = await run("node", [
    bin,
    "session",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--transcript-command",
    `${transcriptCommand} --json`,
    "--require-word-timings",
    "--format",
    "json"
  ]);
  const structured = JSON.parse(structuredStdout);
  assert.equal(structured.contract.transcript.source, "host-native-voice");
  assert.equal(structured.contract.transcript.confidence, 0.97);
  assert.equal(structured.contract.transcript.language, "en");
  assert.equal(structured.contract.transcript.word_timestamps, true);
  assert.equal(structured.contract.alignment.source, "platform_word_timestamps");
  assert.equal(structured.contract.alignment.matched_words, 8);
  assert.equal(structured.contract.emphasis[0].word.toLowerCase(), "whole");

  const promptStdout = await run("node", [
    bin,
    "session",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--transcript-command",
    transcriptCommand,
    "--target",
    "stdout",
    "--verbosity",
    "full"
  ]);
  assert.match(promptStdout, /Transcript: host_transcript_command/);
  assert.match(promptStdout, /Affect: emphatic/);
  assert.match(promptStdout, new RegExp(`${escapeRegExp(text)}\\s*$`));

  const pasteClipboardPath = tmpPath("functional-session-paste-clipboard.txt");
  const pastePath = tmpPath("functional-session-paste.txt");
  await run("node", [
    bin,
    "session",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--transcript-command",
    transcriptCommand,
    "--verbosity",
    "full",
    "--target",
    "paste",
    "--clipboard-command",
    `node scripts/clipboard-sink.mjs ${pasteClipboardPath}`,
    "--paste-command",
    `node scripts/paste-sink.mjs ${pastePath}`
  ]);
  assert.match(await readFile(pasteClipboardPath, "utf8"), /<vocal-context/);
  assert.match(await readFile(pasteClipboardPath, "utf8"), /Transcript: host_transcript_command/);
  assert.equal(await readFile(pastePath, "utf8"), "pasted\n");
});

test("CLI ptt loops bounded natural-speech turns with structured transcript metadata", async () => {
  const capturePath = tmpPath("functional-ptt-{turn}.wav");
  const stdout = await run("node", [
    bin,
    "ptt",
    "--turns",
    "2",
    "--trigger",
    "none",
    "--duration",
    "1",
    "--audio-out",
    capturePath,
    "--record-command",
    fakeRecorder,
    "--transcript-command",
    "node scripts/transcript-source.mjs {audio} --json",
    "--require-word-timings",
    "--format",
    "json"
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.schema, "subtext/ptt-run/v1");
  assert.equal(result.turns.length, 2);

  for (const [index, turn] of result.turns.entries()) {
    assert.equal(turn.turn, index + 1);
    assert.match(turn.capture.audioPath, new RegExp(`functional-ptt-${index + 1}\\.wav$`));
    assert.equal(turn.contract.schema, "vocalcontext/v1");
    assert.equal(turn.contract.transcript.source, "host-native-voice");
    assert.equal(turn.contract.transcript.word_timestamps, true);
    assert.equal(turn.contract.alignment.source, "platform_word_timestamps");
    assert.equal(turn.contract.emphasis[0].word.toLowerCase(), "whole");
    assert.ok((await readFile(turn.capture.audioPath)).length > 44);
  }
});

test("MCP server lists tools and runs analyze_file", async () => {
  const child = spawn("node", [bin, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const client = createJsonLineClient(child);

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    const init = await client.waitForId(1);
    assert.equal(init.result.serverInfo.name, "subtext");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(init.result.serverInfo.version, pkg.version);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const listed = await client.waitForId(2);
    assert.ok(listed.result.tools.some((tool) => tool.name === "analyze_file"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "analyze_audio"));

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "analyze_file",
        arguments: {
          audioPath,
          transcript: {
            schema: "subtext/transcript/v1",
            text,
            source: "mcp-native-voice",
            wordTimings: emphasisWordTimings()
          },
          format: "prompt",
          verbosity: "full"
        }
      }
    })}\n`);
    const analyzed = await client.waitForId(3);
    assert.match(analyzed.result.content[0].text, /Emphasis: whole/);
    assert.match(analyzed.result.content[0].text, /Guidance: preserve_emphasis\/focused/);
    assert.match(analyzed.result.content[0].text, /Transcript: mcp-native-voice word_timestamps=true/);
    assert.match(analyzed.result.content[0].text, /Alignment: platform_word_timestamps/);

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "analyze_audio",
        arguments: {
          audioBase64: (await readFile(audioPath)).toString("base64"),
          transcript: {
            schema: "subtext/transcript/v1",
            text,
            source: "mcp-audio-native-voice",
            confidence: 0.93,
            language: "en",
            wordTimings: emphasisWordTimingsWithPhones()
          },
          requireWordTimings: true,
          format: "json"
        }
      }
    })}\n`);
    const analyzedAudio = await client.waitForId(4);
    const audioContract = JSON.parse(analyzedAudio.result.content[0].text);
    assert.equal(audioContract.schema, "vocalcontext/v1");
    assert.equal(audioContract.transcript.source, "mcp-audio-native-voice");
    assert.equal(audioContract.transcript.confidence, 0.93);
    assert.equal(audioContract.transcript.language, "en");
    assert.equal(audioContract.transcript.word_timestamps, true);
    assert.equal(audioContract.alignment.source, "platform_word_timestamps");
    const audioWhole = audioContract.word_features.find((item) => item.word.toLowerCase() === "whole");
    assert.equal(audioWhole.duration_source, "platform_phone_timestamps");
  } finally {
    child.kill();
  }
});

test("Claude Code hook enriches prompt events and passes through non-audio events", async () => {
  const enrichedStdout = await run("node", [hook], {
    input: JSON.stringify({ prompt: text, audioPath })
  });
  const enriched = JSON.parse(enrichedStdout);
  assert.match(enriched.prompt, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(enriched.prompt, /Guidance: preserve_emphasis\/focused/);
  assert.equal(enriched.subtext.schema, "vocalcontext/v1");
  assert.equal(enriched.subtext.assistant_guidance.priority, "preserve_emphasis");

  const structuredStdout = await run("node", [hook], {
    input: JSON.stringify({
      audioPath,
      transcript: {
        schema: "subtext/transcript/v1",
        text,
        source: "claude-native-voice",
        confidence: 0.96,
        language: "en",
        wordTimings: emphasisWordTimingsWithPhones()
      }
    })
  });
  const structured = JSON.parse(structuredStdout);
  assert.equal(structured.subtext.transcript.source, "claude-native-voice");
  assert.equal(structured.subtext.transcript.word_timestamps, true);
  const whole = structured.subtext.word_features.find((item) => item.word.toLowerCase() === "whole");
  assert.equal(whole.duration_source, "platform_phone_timestamps");
  assert.match(structured.prompt, /Transcript: claude-native-voice word_timestamps=true/);

  const failedOpenStdout = await run("node", [hook], {
    input: JSON.stringify({ prompt: text, audioPath: tmpPath("missing-audio.wav") })
  });
  const failedOpen = JSON.parse(failedOpenStdout);
  assert.equal(failedOpen.prompt, text);
  assert.match(failedOpen.subtext_error, /WAV file not found|ENOENT|no such file/i);

  const passthroughStdout = await run("node", [hook], {
    input: JSON.stringify({ prompt: "plain typed prompt" })
  });
  assert.deepEqual(JSON.parse(passthroughStdout), { prompt: "plain typed prompt" });
});

test("Claude Code hook fails open (exit 0, quickly) when the subtext CLI child hangs", async () => {
  const hangingCliPath = tmpPath("hooks", "hanging-subtext-cli.mjs");
  await mkdir(dirname(hangingCliPath), { recursive: true });
  await writeFile(hangingCliPath, "setInterval(() => {}, 1000);\n");

  const startedAt = Date.now();
  const stdout = await run("node", [hook], {
    input: JSON.stringify({ prompt: text, audioPath }),
    env: {
      SUBTEXT_CLI_PATH: hangingCliPath,
      SUBTEXT_HOOK_TIMEOUT_MS: "300"
    }
  });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 10_000, `expected the hook to fail open well under 10s, took ${elapsedMs}ms`);
  const result = JSON.parse(stdout);
  assert.equal(result.prompt, text);
  assert.match(result.subtext_error, /timed out/i);
});

test("Claude Code hook does not leak a temp dir when there is no audioPath", async () => {
  const scratchDir = tmpPath("hook-tmp-scratch");
  await mkdir(scratchDir, { recursive: true });
  const event = { transcript: { text: "hello", source: "test" } };

  const stdout = await run("node", [hook], {
    input: JSON.stringify(event),
    env: { TMPDIR: scratchDir, TEMP: scratchDir, TMP: scratchDir }
  });

  assert.deepEqual(JSON.parse(stdout), event);
  const entries = await readdir(scratchDir);
  assert.ok(
    !entries.some((entry) => entry.startsWith("subtext-claude-")),
    `expected no leaked subtext-claude-* temp dir, found: ${entries.join(", ")}`
  );
});

test("Codex MCP config example stays parseable and points at the subtext command", async () => {
  const config = JSON.parse(await readFile(join(root, "adapters", "codex", "mcp.config.example.json"), "utf8"));
  assert.equal(config.mcpServers.subtext.command, "node");
  assert.deepEqual(config.mcpServers.subtext.args.slice(-1), ["mcp"]);
});

test("VS Code adapter metadata and runner render an enriched prompt", async () => {
  const extensionPackage = JSON.parse(await readFile(join(root, "adapters", "vscode", "package.json"), "utf8"));
  assert.equal(extensionPackage.main, "./extension.cjs");
  assert.equal(extensionPackage.contributes.configuration.properties["subtext.defaultVerbosity"].default, "full");

  const commands = new Set(extensionPackage.contributes.commands.map((command) => command.command));
  for (const command of [
    "subtext.copyEnrichedPrompt",
    "subtext.insertEnrichedPrompt",
    "subtext.previewEnrichedPrompt"
  ]) {
    assert.ok(commands.has(command), `missing command ${command}`);
    assert.ok(extensionPackage.activationEvents.includes(`onCommand:${command}`), `missing activation for ${command}`);
  }

  const resolvedCli = vscodeRunner.resolveCliPath("", join(root, "adapters", "vscode"));
  assert.equal(resolvedCli, bin);

  const args = vscodeRunner.buildHandoffArgs({
    cliPath: resolvedCli,
    audioPath,
    text,
    verbosity: "full"
  });
  assert.deepEqual(args.slice(0, 6), [bin, "handoff", "--audio", audioPath, "--text", text]);
  assert.ok(args.includes("--target"));
  assert.ok(args.includes("stdout"));

  const vscodeTranscriptPath = tmpPath("vscode-native-transcript.json");
  await mkdir(dirname(vscodeTranscriptPath), { recursive: true });
  await writeFile(vscodeTranscriptPath, `${JSON.stringify({
    schema: "subtext/transcript/v1",
    text,
    source: "vscode-native-voice",
    confidence: 0.95,
    language: "en",
    wordTimings: emphasisWordTimingsWithPhones()
  })}\n`);
  const transcriptArgs = vscodeRunner.buildHandoffArgs({
    cliPath: resolvedCli,
    audioPath,
    transcriptPath: vscodeTranscriptPath,
    requireWordTimings: true,
    verbosity: "full"
  });
  assert.ok(transcriptArgs.includes("--transcript"));
  assert.ok(transcriptArgs.includes(vscodeTranscriptPath));
  assert.ok(!transcriptArgs.includes("--text"));
  assert.ok(transcriptArgs.includes("--require-word-timings"));

  const output = await vscodeRunner.runSubtextHandoff({
    cliPath: resolvedCli,
    audioPath,
    text,
    verbosity: "full",
    cwd: root
  });
  assert.match(output, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(output, /Emphasis: whole/);
  assert.match(output, /Guidance: preserve_emphasis\/focused/);

  const structuredOutput = await vscodeRunner.runSubtextHandoff({
    cliPath: resolvedCli,
    audioPath,
    transcript: {
      schema: "subtext/transcript/v1",
      text,
      source: "vscode-native-voice",
      confidence: 0.95,
      language: "en",
      wordTimings: emphasisWordTimingsWithPhones()
    },
    requireWordTimings: true,
    verbosity: "full",
    cwd: root
  });
  assert.match(structuredOutput, /Transcript: vscode-native-voice word_timestamps=true/);
  assert.match(structuredOutput, /Alignment: platform_word_timestamps confidence=1 matched=8\/8/);
});

test("CLI doctor verifies harness adapter readiness", async () => {
  const help = await run("node", [bin, "--help"]);
  assert.match(help, /meaning and emotion from natural speech/);
  assert.match(help, /native-desktop/);

  const stdout = await run("node", [bin, "doctor", "--format", "json"]);
  const report = JSON.parse(stdout);
  assert.equal(report.schema, "subtext/harness-doctor/v1");
  assert.equal(report.ok, true);
  assert.equal(report.summary.notReady, 0);

  const ids = new Set(report.harnesses.map((harness) => harness.id));
  for (const id of ["cli", "http", "web-preview", "desktop-capture", "mcp", "codex", "claude-code", "realtime", "vscode", "hotkey", "native-desktop", "universal"]) {
    assert.ok(ids.has(id), `missing doctor result for ${id}`);
  }

  const codex = report.harnesses.find((harness) => harness.id === "codex");
  assert.equal(codex.ready, true);
  assert.ok(codex.checks.some((check) => check.evidence === "adapters/codex/mcp.config.example.json"));

  const textReport = await run("node", [bin, "doctor", "--harness", "universal"]);
  assert.match(textReport, /Subtext harness doctor: 1\/1 ready/);
  assert.match(textReport, /active-app paste into any text field/);

  const hotkeyReport = await run("node", [bin, "doctor", "--harness", "hotkey"]);
  assert.match(hotkeyReport, /Subtext harness doctor: 1\/1 ready/);
  assert.match(hotkeyReport, /global hotkey automation/);

  const desktopReport = await run("node", [bin, "doctor", "--harness", "native-desktop"]);
  assert.match(desktopReport, /Subtext harness doctor: 1\/1 ready/);
  assert.match(desktopReport, /visible bounded desktop capture app/);
});

test("CLI conformance verifies natural-speech cues and top harness policies", async () => {
  const stdout = await run("node", [bin, "conformance"]);
  const report = JSON.parse(stdout);
  assert.equal(report.schema, "subtext/harness-conformance/v1");
  assert.equal(report.ok, true);
  assert.deepEqual(report.requirements.naturalSpeechCues, ["yelling", "emphasis", "confusion"]);
  assert.equal(report.requirements.topHarnesses.length, 12);
  assert.deepEqual(report.missingTopHarnesses, []);
  assert.equal(report.cues.length, 3);
  assert.ok(report.cues.every((cue) => cue.ok));
  assert.ok(report.cues.every((cue) => cue.wordFeatureDimensions.includes("log_f0_slope")));
  assert.equal(report.harnesses.length, 12);
  assert.ok(report.harnesses.every((harness) => harness.conformance));

  const text = await run("node", [bin, "conformance", "--format", "text"]);
  assert.match(text, /Subtext harness conformance: ok/);
  assert.match(text, /cue yelling: yelling -> de_escalate\/calm/);
  assert.match(text, /native-desktop/);
});

test("adapter package builder emits local bundles for every harness", async () => {
  const stdout = await run("npm", ["run", "package:adapters", "--silent"]);
  const index = JSON.parse(stdout);

  assert.equal(index.schema, "subtext/adapter-bundles/v1");
  assert.equal(index.harnesses, 12);
  assert.equal(index.ready, 12);

  const bundleIds = new Set(index.bundles.map((bundle) => bundle.id));
  for (const id of ["cli", "http", "web-preview", "desktop-capture", "mcp", "codex", "claude-code", "realtime", "vscode", "hotkey", "native-desktop", "universal"]) {
    assert.ok(bundleIds.has(id), `missing adapter bundle ${id}`);
    const manifest = JSON.parse(await readFile(join(root, "dist", "adapters", id, "bundle.json"), "utf8"));
    assert.equal(manifest.schema, "subtext/adapter-bundle/v1");
    assert.equal(manifest.id, id);
    assert.equal(manifest.ready, true);
    assert.equal(manifest.requiresCorePackage, true);
    assert.ok(manifest.files.length > 0);
  }

  const codexConfig = JSON.parse(await readFile(join(root, "dist", "adapters", "codex", "adapters", "codex", "mcp.config.example.json"), "utf8"));
  assert.equal(codexConfig.mcpServers.subtext.command, "node");

  const vscodePackage = JSON.parse(await readFile(join(root, "dist", "adapters", "vscode", "adapters", "vscode", "package.json"), "utf8"));
  assert.equal(vscodePackage.main, "./extension.cjs");

  const hotkeyLua = await readFile(join(root, "dist", "adapters", "hotkey", "adapters", "hotkey", "hammerspoon-subtext.lua"), "utf8");
  assert.match(hotkeyLua, /hs\.hotkey\.bind/);
  assert.match(hotkeyLua, /ptt/);

  const desktopConfig = JSON.parse(await readFile(join(root, "dist", "adapters", "native-desktop", "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"));
  assert.equal(desktopConfig.productName, "Subtext Desktop");
  assert.equal(desktopConfig.app.withGlobalTauri, true);

  const desktopHtml = await readFile(join(root, "dist", "adapters", "native-desktop", "apps", "desktop", "src", "index.html"), "utf8");
  assert.match(desktopHtml, /subtext_load_config/);
  assert.match(desktopHtml, /subtext_session/);
});

test("adapter installer writes concrete host config and runnable copied hooks", async () => {
  const codexTarget = tmpPath("install-codex");
  await rm(codexTarget, { recursive: true, force: true });
  const codexStdout = await run("node", [
    bin,
    "install-adapter",
    "--harness",
    "codex",
    "--target",
    codexTarget,
    "--format",
    "json"
  ]);
  const codexInstall = JSON.parse(codexStdout);
  assert.equal(codexInstall.schema, "subtext/adapter-install/v1");
  assert.equal(codexInstall.id, "codex");
  assert.ok(codexInstall.generatedFiles.includes("adapters/codex/mcp.config.generated.json"));

  const generatedCodexConfig = JSON.parse(await readFile(
    join(codexTarget, "adapters", "codex", "mcp.config.generated.json"),
    "utf8"
  ));
  assert.deepEqual(generatedCodexConfig.mcpServers.subtext.args, [bin, "mcp"]);

  await assert.rejects(
    run("node", [bin, "install-adapter", "--harness", "codex", "--target", codexTarget]),
    /Refusing to overwrite/
  );
  const dryRunInstall = JSON.parse(await run("node", [
    bin,
    "install-adapter",
    "--harness",
    "codex",
    "--target",
    codexTarget,
    "--dry-run",
    "--format",
    "json"
  ]));
  assert.equal(dryRunInstall.dryRun, true);

  const claudeTarget = tmpPath("install-claude");
  await rm(claudeTarget, { recursive: true, force: true });
  await run("node", [
    bin,
    "install-adapter",
    "--harness",
    "claude-code",
    "--target",
    claudeTarget
  ]);

  const installedHook = join(claudeTarget, "adapters", "claude-code", "hooks", "user-prompt-submit.mjs");
  const hookStdout = await run("node", [installedHook], {
    input: JSON.stringify({ prompt: text, audioPath }),
    env: { SUBTEXT_CLI_PATH: bin }
  });
  const hookResult = JSON.parse(hookStdout);
  assert.match(hookResult.prompt, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(hookResult.prompt, /Guidance: preserve_emphasis\/focused/);
  assert.equal(hookResult.subtext.schema, "vocalcontext/v1");
  assert.equal(hookResult.subtext.assistant_guidance.priority, "preserve_emphasis");

  const vscodeTarget = tmpPath("install-vscode");
  await rm(vscodeTarget, { recursive: true, force: true });
  await run("node", [
    bin,
    "install-adapter",
    "--harness",
    "vscode",
    "--target",
    vscodeTarget
  ]);
  const vscodeSettings = JSON.parse(await readFile(
    join(vscodeTarget, "adapters", "vscode", "settings.generated.json"),
    "utf8"
  ));
  assert.equal(vscodeSettings["subtext.cliPath"], bin);
  assert.equal(vscodeSettings["subtext.defaultVerbosity"], "full");

  const hotkeyTarget = tmpPath("install-hotkey");
  await rm(hotkeyTarget, { recursive: true, force: true });
  await run("node", [
    bin,
    "install-adapter",
    "--harness",
    "hotkey",
    "--target",
    hotkeyTarget
  ]);
  const generatedHotkey = await readFile(
    join(hotkeyTarget, "adapters", "hotkey", "hammerspoon-subtext.generated.lua"),
    "utf8"
  );
  // Path-separator agnostic: on Windows the generated Lua escapes "\" as "\\",
  // so assert the config invokes the subtext.js CLI via the bounded ptt turn
  // rather than matching the OS-specific absolute path.
  assert.match(generatedHotkey, /subtext\.js/);
  assert.match(generatedHotkey, /"ptt"/);
  assert.match(generatedHotkey, /"--turns"/);
  assert.match(generatedHotkey, /hs\.hotkey\.bind/);
  assert.match(generatedHotkey, /host-transcript --json \{audio\}/);

  const desktopTarget = tmpPath("install-native-desktop");
  await rm(desktopTarget, { recursive: true, force: true });
  await run("node", [
    bin,
    "install-adapter",
    "--harness",
    "native-desktop",
    "--target",
    desktopTarget
  ]);
  const generatedDesktopConfig = JSON.parse(await readFile(
    join(desktopTarget, "apps", "desktop", "subtext-desktop.generated.json"),
    "utf8"
  ));
  assert.equal(generatedDesktopConfig.schema, "subtext/desktop-config/v1");
  assert.equal(generatedDesktopConfig.nodeCommand, "node");
  assert.equal(generatedDesktopConfig.subtextCliPath, bin);
  assert.equal(generatedDesktopConfig.transcriptCommand, "host-transcript --json {audio}");
  assert.equal(generatedDesktopConfig.target, "clipboard");
  assert.equal(generatedDesktopConfig.hotkey.accelerator, "Cmd+Alt+Ctrl+Y");
  assert.equal(generatedDesktopConfig.hotkey.mode, "scaffold");
});

test("harness catalog covers implemented and target top harnesses", async () => {
  const harnesses = JSON.parse(await readFile(join(root, "adapters", "harnesses.json"), "utf8"));
  const ids = new Set(harnesses.map((item) => item.id));
  for (const id of ["cli", "http", "web-preview", "desktop-capture", "mcp", "codex", "claude-code", "realtime", "vscode", "hotkey", "native-desktop", "universal"]) {
    assert.ok(ids.has(id), `missing harness ${id}`);
  }
  assert.ok(harnesses.filter((item) => item.status === "implemented").length >= 3);
});

function run(command, args, options = {}) {
  return runProcess(command, args, options).then(({ code, stdout, stderr }) => {
    if (code === 0) return stdout;
    throw new Error(stderr || `${command} exited ${code}`);
  });
}

// Like run(), but never rejects on a non-zero exit code - callers get the raw
// { code, stdout, stderr } so they can assert on failure paths directly.
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" && command === "npm",
      env: { ...process.env, ...(options.env ?? {}) }
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

function createJsonLineClient(child) {
  let buffer = "";
  const messages = [];
  const waiters = new Map();

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      messages.push(message);
      const waiter = waiters.get(message.id);
      if (waiter) {
        waiters.delete(message.id);
        waiter.resolve(message);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    for (const waiter of waiters.values()) {
      waiter.reject(new Error(text));
    }
    waiters.clear();
  });

  return {
    waitForId(id, timeoutMs = 1500) {
      const existing = messages.find((message) => message.id === id);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          reject(new Error(`Timed out waiting for MCP response id ${id}`));
        }, timeoutMs);
        waiters.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    }
  };
}

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emphasisWordTimings() {
  return [
    { word: "can", start: 0, end: 0.22 },
    { word: "we", start: 0.25, end: 0.45 },
    { word: "just", start: 0.48, end: 0.76 },
    { word: "refactor", start: 0.79, end: 1.25 },
    { word: "the", start: 1.29, end: 1.47 },
    { word: "whole", start: 1.49, end: 1.99 },
    { word: "auth", start: 2.03, end: 2.31 },
    { word: "module", start: 2.34, end: 2.7 }
  ];
}

function emphasisWordTimingsWithPhones() {
  return emphasisWordTimings().map((timing) => {
    if (timing.word !== "whole") return timing;
    return {
      ...timing,
      phones: [
        { phone: "hh", start: 1.5, end: 1.55 },
        { phone: "ow", start: 1.7, end: 1.75 },
        { phone: "l", start: 1.92, end: 1.97 }
      ]
    };
  });
}
