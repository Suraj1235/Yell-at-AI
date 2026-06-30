// Yell at AI — flagship web surface.
//
// Everything runs in the browser:
//   1. getUserMedia + MediaRecorder capture a short take.
//   2. Web Speech API (where available) streams a live transcript.
//   3. On stop, the recorded Blob is decoded with an AudioContext into a
//      Float32Array (channel 0) + sampleRate.
//   4. The SAME vocalcontext/v1 engine — vendored from src/index.browser.js —
//      runs analyzeSamples({ samples, sampleRate, text }) client-side.
//   5. We render emphasis, affect, flags, delivery, and the full <vocal-context>
//      block with a copy button.
//
// Fallback: if SpeechRecognition is unavailable (e.g. Firefox), the user types
// the transcript and still gets prosody from the recording.

import { analyzeSamples, renderVocalContext } from "./vendor/index.browser.js";

const MAX_SECONDS = 30;

/* ───────────────────────── element handles ───────────────────────── */
const el = {
  status: document.getElementById("status"),
  statusText: document.getElementById("status-text"),
  recordBtn: document.getElementById("record-btn"),
  recordLabel: document.querySelector(".record-btn-label"),
  timer: document.getElementById("timer"),
  recorderHint: document.getElementById("recorder-hint"),
  scope: document.getElementById("scope"),
  scopeEmpty: document.getElementById("scope-empty"),
  transcriptLive: document.getElementById("transcript-live"),
  transcript: document.getElementById("transcript"),
  transcriptSource: document.getElementById("transcript-source"),
  analyzeBtn: document.getElementById("analyze-btn"),
  analyzeNote: document.getElementById("analyze-note"),
  results: document.getElementById("results"),
  affectColoring: document.getElementById("affect-coloring"),
  affectConf: document.getElementById("affect-conf"),
  affectInterp: document.getElementById("affect-interp"),
  emphasisList: document.getElementById("emphasis-list"),
  flagsList: document.getElementById("flags-list"),
  deliveryList: document.getElementById("delivery-list"),
  blockOut: document.getElementById("block-out"),
  copyBtn: document.getElementById("copy-btn"),
  copyLabel: document.querySelector(".copy-label"),
  toolError: document.getElementById("tool-error")
};

/* ───────────────────────── feature detection ───────────────────────── */
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasMediaCapture = Boolean(
  navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window.MediaRecorder === "function"
);
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const hasDecode = Boolean(AudioCtx);

/* ───────────────────────── runtime state ───────────────────────── */
const state = {
  recording: false,
  mediaRecorder: null,
  mediaStream: null,
  chunks: [],
  recordedBlob: null,
  startTime: 0,
  timerRaf: 0,
  stopTimeout: 0,
  // live waveform
  audioContext: null,
  analyser: null,
  scopeRaf: 0,
  // speech recognition
  recognition: null,
  finalTranscript: "",
  interimTranscript: "",
  usedSpeech: false,
  // analysis bookkeeping
  decodedSampleRate: 0
};

/* ───────────────────────── status helper ───────────────────────── */
function setStatus(stateName, text) {
  el.status.dataset.state = stateName;
  el.statusText.textContent = text;
}

function showError(message) {
  el.toolError.hidden = false;
  el.toolError.textContent = message;
}

function clearError() {
  el.toolError.hidden = true;
  el.toolError.textContent = "";
}

/* ───────────────────────── init / capability gate ───────────────────────── */
function init() {
  if (!hasMediaCapture || !hasDecode) {
    setStatus("error", "Mic capture unsupported here");
    el.recordBtn.disabled = true;
    el.recorderHint.textContent = "This browser can't record audio.";
    el.analyzeNote.textContent =
      "Recording needs a modern browser with microphone and Web Audio support. You can still type a transcript, but there's no recording to read prosody from.";
    // Allow manual analysis-less typing? Without audio we cannot run prosody.
    enableManualOnly();
    return;
  }

  if (SpeechRecognitionImpl) {
    setStatus("ready", "Ready — Chrome/Edge live transcript");
    el.transcript.placeholder =
      "Your words appear here as you speak. You can edit them before analyzing.";
  } else {
    setStatus("fallback", "Ready — type your transcript");
    el.recorderHint.textContent = "Up to 30 seconds · type what you said below";
    el.transcriptSource.textContent = "manual — live transcription not in this browser";
  }

  el.recordBtn.addEventListener("click", toggleRecording);
  el.analyzeBtn.addEventListener("click", runAnalysis);
  el.copyBtn.addEventListener("click", copyBlock);
  el.transcript.addEventListener("input", refreshAnalyzeEnabled);
}

function enableManualOnly() {
  // No capture path; let the user at least see the engine wiring is absent
  // gracefully. Analyze stays disabled because there is no audio to read.
  el.analyzeBtn.disabled = true;
  el.transcript.addEventListener("input", () => {
    el.analyzeNote.textContent =
      "Prosody is read from a recording. Without microphone support, this browser can't produce the vocal-context layer.";
  });
}

/* ───────────────────────── recording ───────────────────────── */
async function toggleRecording() {
  if (state.recording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  clearError();
  resetTakeArtifacts();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    setStatus("error", "Microphone blocked");
    showError(
      "Couldn't access your microphone. Allow mic permission for this page and try again. " +
        "If you're on a deployed site, it must be served over HTTPS."
    );
    return;
  }

  state.mediaStream = stream;
  state.chunks = [];
  state.recordedBlob = null;

  // MediaRecorder with a defensively chosen mime type.
  let recorder;
  try {
    recorder = new MediaRecorder(stream, pickRecorderOptions());
  } catch (error) {
    recorder = new MediaRecorder(stream);
  }
  state.mediaRecorder = recorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) state.chunks.push(event.data);
  });
  recorder.addEventListener("stop", onRecorderStop);

  recorder.start();
  state.recording = true;
  state.startTime = performance.now();

  // UI
  el.recordBtn.setAttribute("aria-pressed", "true");
  el.recordLabel.textContent = "Stop";
  setStatus("recording", "Listening…");
  el.scopeEmpty.hidden = true;
  el.results.hidden = true;
  el.analyzeBtn.disabled = true;
  el.analyzeNote.textContent = "Recording… speak naturally, then stop.";

  startScope(stream);
  startTimer();
  startRecognition();

  // Hard stop at the cap.
  state.stopTimeout = window.setTimeout(() => {
    if (state.recording) stopRecording();
  }, MAX_SECONDS * 1000);
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  window.clearTimeout(state.stopTimeout);
  stopTimer();
  stopRecognition();

  try {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      state.mediaRecorder.stop();
    }
  } catch (error) {
    /* no-op */
  }

  el.recordBtn.setAttribute("aria-pressed", "false");
  el.recordLabel.textContent = "Record";
}

function onRecorderStop() {
  stopScope();
  stopTracks();

  if (!state.chunks.length) {
    setStatus(SpeechRecognitionImpl ? "ready" : "fallback", "No audio captured — try again");
    showError("That take didn't capture any audio. Check your microphone and record again.");
    return;
  }

  const mimeType = state.mediaRecorder?.mimeType || state.chunks[0]?.type || "audio/webm";
  state.recordedBlob = new Blob(state.chunks, { type: mimeType });

  setStatus(SpeechRecognitionImpl ? "ready" : "fallback", "Take captured — read it");
  el.recorderHint.textContent = formatBytes(state.recordedBlob.size) + " captured";
  refreshAnalyzeEnabled();

  // Nudge: if speech recognition produced nothing, prompt manual entry.
  if (!el.transcript.value.trim()) {
    el.analyzeNote.textContent = SpeechRecognitionImpl
      ? "Didn't catch the words? Type the transcript, then read the delivery."
      : "Type what you said, then read the delivery.";
    el.transcript.focus();
  } else {
    el.analyzeNote.textContent = "Ready — read the delivery, or edit the transcript first.";
  }
}

function pickRecorderOptions() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];
  for (const mimeType of candidates) {
    if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType };
    }
  }
  return {};
}

function resetTakeArtifacts() {
  state.finalTranscript = "";
  state.interimTranscript = "";
  el.transcriptLive.textContent = "";
  // Keep any manual text the user typed; clear only auto-captured live text by
  // not touching the textarea here.
}

/* ───────────────────────── live waveform scope ───────────────────────── */
function startScope(stream) {
  try {
    state.audioContext = new AudioCtx();
    const source = state.audioContext.createMediaStreamSource(stream);
    const analyser = state.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    state.analyser = analyser;

    const canvas = el.scope;
    const ctx = canvas.getContext("2d");
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const history = [];

    const draw = () => {
      state.scopeRaf = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      analyser.getByteTimeDomainData(buffer);

      // RMS of this frame for a scrolling amplitude bar field.
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      history.push(rms);
      const maxBars = Math.floor(w / 6);
      while (history.length > maxBars) history.shift();

      ctx.clearRect(0, 0, w, h);

      // scrolling amplitude bars (instrument feel)
      const mid = h / 2;
      const barW = 3;
      const gap = 3;
      for (let i = 0; i < history.length; i += 1) {
        const amp = Math.min(1, history[i] * 3.4);
        const barH = Math.max(2, amp * (h * 0.8));
        const x = w - (history.length - i) * (barW + gap);
        const t = i / Math.max(1, history.length - 1);
        // gradient from cool (old) to hot (recent)
        const r = Math.round(54 + (255 - 54) * t);
        const g = Math.round(214 + (122 - 214) * t);
        const b = Math.round(195 + (24 - 195) * t);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + 0.55 * t})`;
        ctx.fillRect(x, mid - barH / 2, barW, barH);
      }

      // live oscilloscope line on top
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 162, 76, 0.9)";
      ctx.beginPath();
      const step = w / buffer.length;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128;
        const y = mid + v * (h * 0.42);
        const x = i * step;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
  } catch (error) {
    // Scope is decorative; never let it break recording.
    state.analyser = null;
  }
}

function stopScope() {
  if (state.scopeRaf) cancelAnimationFrame(state.scopeRaf);
  state.scopeRaf = 0;
  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
    state.audioContext = null;
  }
  state.analyser = null;
  // Leave the last frame painted; reveal the "no signal" plate only on reset.
}

/* ───────────────────────── timer ───────────────────────── */
function startTimer() {
  const tick = () => {
    const elapsed = (performance.now() - state.startTime) / 1000;
    el.timer.textContent = `${Math.min(MAX_SECONDS, elapsed).toFixed(1)}s`;
    state.timerRaf = requestAnimationFrame(tick);
  };
  tick();
}

function stopTimer() {
  if (state.timerRaf) cancelAnimationFrame(state.timerRaf);
  state.timerRaf = 0;
}

/* ───────────────────────── speech recognition ───────────────────────── */
function startRecognition() {
  if (!SpeechRecognitionImpl) return;
  try {
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    state.recognition = recognition;
    state.usedSpeech = true;

    recognition.addEventListener("result", (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) state.finalTranscript += text + " ";
        else interim += text;
      }
      state.interimTranscript = interim;
      const combined = (state.finalTranscript + interim).replace(/\s+/g, " ").trimStart();
      el.transcript.value = combined;
      el.transcriptLive.textContent = interim ? interim : "";
      el.transcriptSource.textContent = "live · Web Speech";
      refreshAnalyzeEnabled();
    });

    recognition.addEventListener("error", (event) => {
      // 'no-speech' / 'aborted' are routine; only surface real failures.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        el.transcriptSource.textContent = "live transcript blocked — type instead";
      }
    });

    recognition.start();
  } catch (error) {
    state.recognition = null;
  }
}

function stopRecognition() {
  if (!state.recognition) return;
  try {
    state.recognition.stop();
  } catch (error) {
    /* no-op */
  }
  el.transcriptLive.textContent = "";
}

/* ───────────────────────── analyze enabling ───────────────────────── */
function refreshAnalyzeEnabled() {
  const hasAudio = Boolean(state.recordedBlob);
  const hasText = el.transcript.value.trim().length > 0;
  const ready = hasAudio && hasText && !state.recording;
  el.analyzeBtn.disabled = !ready;
  if (ready) {
    el.analyzeNote.textContent = "Ready when you are.";
  } else if (hasAudio && !hasText) {
    el.analyzeNote.textContent = "Add the transcript text to analyze the delivery.";
  } else if (!hasAudio) {
    el.analyzeNote.textContent = "Record a take to enable analysis.";
  }
}

/* ───────────────────────── analysis ───────────────────────── */
async function runAnalysis() {
  clearError();
  const text = el.transcript.value.trim();
  if (!text) {
    showError("Add the transcript text first — the engine pairs your words with how you said them.");
    return;
  }
  if (!state.recordedBlob) {
    showError("Record a take first so there's audio to read.");
    return;
  }

  el.analyzeBtn.disabled = true;
  el.analyzeNote.textContent = "Reading the waveform…";

  let samples;
  let sampleRate;
  try {
    const decoded = await decodeBlob(state.recordedBlob);
    samples = decoded.samples;
    sampleRate = decoded.sampleRate;
    state.decodedSampleRate = sampleRate;
  } catch (error) {
    el.analyzeBtn.disabled = false;
    el.analyzeNote.textContent = "Couldn't decode that recording.";
    showError("Couldn't decode the recorded audio in this browser. Try recording again.");
    return;
  }

  if (!samples || samples.length < 256) {
    el.analyzeBtn.disabled = false;
    el.analyzeNote.textContent = "That take was too short.";
    showError("That recording was too short to read. Hold a full sentence and try again.");
    return;
  }

  let contract;
  try {
    contract = analyzeSamples({
      samples,
      sampleRate,
      text,
      options: {
        transcriptSource: state.usedSpeech ? "webspeech" : "manual",
        language: state.recognition?.lang || navigator.language || undefined
      }
    });
  } catch (error) {
    el.analyzeBtn.disabled = false;
    el.analyzeNote.textContent = "Analysis failed.";
    showError(`Analysis failed: ${error.message}`);
    return;
  }

  renderContract(contract);
  el.analyzeBtn.disabled = false;
  el.analyzeNote.textContent = "Read complete. Record again to re-read.";
}

async function decodeBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioCtx();
  try {
    // decodeAudioData has both promise and callback forms; wrap for older Safari.
    const audioBuffer = await new Promise((resolve, reject) => {
      const maybePromise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    });
    const channel = audioBuffer.getChannelData(0); // Float32Array, channel 0
    // Copy out before closing the context.
    const samples = new Float32Array(channel.length);
    samples.set(channel);
    return { samples, sampleRate: audioBuffer.sampleRate };
  } finally {
    ctx.close().catch(() => {});
  }
}

/* ───────────────────────── rendering ───────────────────────── */
function renderContract(contract) {
  // Affect
  const affect = contract.affect || {};
  el.affectColoring.textContent = humanize(affect.emotional_coloring || "neutral");
  el.affectConf.textContent = affect.confidence != null ? `confidence ${affect.confidence}` : "";
  el.affectInterp.textContent = affect.interpretation || "";

  // Emphasis
  el.emphasisList.replaceChildren();
  if (contract.emphasis && contract.emphasis.length) {
    const maxZ = Math.max(...contract.emphasis.map((item) => item.z), 1);
    for (const item of contract.emphasis) {
      const li = document.createElement("li");
      li.className = "emphasis-item";

      const word = document.createElement("span");
      word.className = "emphasis-word";
      word.textContent = item.word;

      const barWrap = document.createElement("span");
      barWrap.className = "emphasis-bar-wrap";
      const bar = document.createElement("span");
      bar.className = "emphasis-bar";
      bar.style.width = `${Math.max(8, (item.z / maxZ) * 100)}%`;
      barWrap.appendChild(bar);

      const z = document.createElement("span");
      z.className = "emphasis-z";
      z.textContent = `z ${item.z}`;

      li.append(word, barWrap, z);
      el.emphasisList.appendChild(li);
    }
  } else {
    el.emphasisList.appendChild(emptyNote("No word stood out above threshold."));
  }

  // Flags
  el.flagsList.replaceChildren();
  if (contract.flags && contract.flags.length) {
    for (const flag of contract.flags) {
      const li = document.createElement("li");
      li.className = `flag-item flag-${flag.type}`;

      const top = document.createElement("div");
      top.className = "flag-top";
      const type = document.createElement("span");
      type.className = "flag-type";
      type.textContent = humanize(flag.type);
      const conf = document.createElement("span");
      conf.className = "flag-conf";
      conf.textContent = String(flag.conf);
      top.append(type, conf);

      const evidence = document.createElement("span");
      evidence.className = "flag-evidence";
      evidence.textContent = flag.evidence || "";

      li.append(top, evidence);
      el.flagsList.appendChild(li);
    }
  } else {
    el.flagsList.appendChild(emptyNote("No strong cues — neutral delivery."));
  }

  // Delivery
  el.deliveryList.replaceChildren();
  const prosody = contract.prosody || {};
  const deliveryFields = [
    ["rate", prosody.rate],
    ["energy", prosody.energy],
    ["pitch range", prosody.pitch_range],
    ["pauses", prosody.pause_density],
    ["terminal", prosody.terminal_pitch],
    ["voice", prosody.voice_quality]
  ];
  for (const [label, value] of deliveryFields) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value != null ? String(value) : "—";
    wrap.append(dt, dd);
    el.deliveryList.appendChild(wrap);
  }

  // Full block
  el.blockOut.textContent = renderVocalContext(contract, { verbosity: "full" });

  // Reveal + reset copy state
  el.results.hidden = false;
  resetCopyButton();
  el.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function emptyNote(text) {
  const li = document.createElement("li");
  li.className = "empty-note";
  li.textContent = text;
  return li;
}

/* ───────────────────────── copy ───────────────────────── */
async function copyBlock() {
  const text = el.blockOut.textContent;
  if (!text) return;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (error) {
    ok = false;
  }
  if (!ok) ok = legacyCopy(text);

  if (ok) {
    el.copyBtn.classList.add("copied");
    el.copyLabel.textContent = "Copied";
    window.setTimeout(resetCopyButton, 1800);
  } else {
    el.copyLabel.textContent = "Press Ctrl/Cmd+C";
  }
}

function resetCopyButton() {
  el.copyBtn.classList.remove("copied");
  el.copyLabel.textContent = "Copy";
}

function legacyCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch (error) {
    return false;
  }
}

/* ───────────────────────── cleanup helpers ───────────────────────── */
function stopTracks() {
  if (state.mediaStream) {
    for (const track of state.mediaStream.getTracks()) track.stop();
    state.mediaStream = null;
  }
}

/* ───────────────────────── formatting ───────────────────────── */
function humanize(value) {
  return String(value || "").replace(/_/g, " ");
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ───────────────────────── go ───────────────────────── */
init();
