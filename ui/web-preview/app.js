const recordButton = document.querySelector("#recordButton");
const stopButton = document.querySelector("#stopButton");
const analyzeButton = document.querySelector("#analyzeButton");
const calibrateButton = document.querySelector("#calibrateButton");
const dictateButton = document.querySelector("#dictateButton");
const stopDictationButton = document.querySelector("#stopDictationButton");
const clearBaselineButton = document.querySelector("#clearBaselineButton");
const microphoneSelect = document.querySelector("#microphoneSelect");
const refreshMicrophonesButton = document.querySelector("#refreshMicrophonesButton");
const loadProfileButton = document.querySelector("#loadProfileButton");
const profileName = document.querySelector("#profileName");
const transcript = document.querySelector("#transcript");
const promptOutput = document.querySelector("#promptOutput");
const jsonOutput = document.querySelector("#jsonOutput");
const baselineOutput = document.querySelector("#baselineOutput");
const statusOutput = document.querySelector("#status");
const baselineStatus = document.querySelector("#baselineStatus");
const microphoneStatus = document.querySelector("#microphoneStatus");
const dictationStatus = document.querySelector("#dictationStatus");
const verbosity = document.querySelector("#verbosity");
const canvas = document.querySelector("#meter");
const canvasContext = canvas.getContext("2d");

let audioContext;
let source;
let processor;
let stream;
let chunks = [];
let lastWavBase64 = "";
let profileStore = loadProfileStore();
let selectedAudioDeviceId = localStorage.getItem("subtextAudioDeviceId") || "";
let activeProfileName = localStorage.getItem("subtextActiveProfile") || "default";
profileName.value = activeProfileName;
let baseline = getActiveBaseline();
let microphoneDevices = [];
let recognition = null;
let dictationBaseText = "";
let dictationConfidenceValues = [];
let transcriptEnvelope = null;
let animationFrame = 0;
let latestFrame = new Float32Array(0);

renderBaseline();
setupMicrophones();
setupDictation();
drawMeter();

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
analyzeButton.addEventListener("click", analyzeRecording);
calibrateButton.addEventListener("click", calibrateRecording);
dictateButton.addEventListener("click", startDictation);
stopDictationButton.addEventListener("click", stopDictation);
clearBaselineButton.addEventListener("click", clearBaseline);
microphoneSelect.addEventListener("change", selectMicrophone);
refreshMicrophonesButton.addEventListener("click", setupMicrophones);
loadProfileButton.addEventListener("click", loadProfile);
profileName.addEventListener("change", loadProfile);
transcript.addEventListener("input", () => {
  transcriptEnvelope = null;
});

async function startRecording() {
  chunks = [];
  lastWavBase64 = "";
  promptOutput.value = "";
  jsonOutput.value = "";
  stream = await openMicrophoneStream();
  rememberCapturedMicrophone(stream);
  audioContext = new AudioContext();
  source = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    latestFrame = new Float32Array(input);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  recordButton.disabled = true;
  recordButton.classList.add("recording");
  stopButton.disabled = false;
  analyzeButton.disabled = true;
  statusOutput.value = "Recording";
  await setupMicrophones();
  drawMeter();
}

async function openMicrophoneStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : true
    });
  } catch (error) {
    if (!selectedAudioDeviceId) throw error;
    selectedAudioDeviceId = "";
    localStorage.setItem("subtextAudioDeviceId", "");
    microphoneSelect.value = "";
    microphoneStatus.value = "Microphone: selected device unavailable, using default";
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function stopRecording() {
  processor?.disconnect();
  source?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());

  const samples = mergeChunks(chunks);
  const wav = encodeWav(samples, audioContext.sampleRate);
  lastWavBase64 = arrayBufferToBase64(wav);
  await audioContext.close();

  recordButton.disabled = false;
  recordButton.classList.remove("recording");
  stopButton.disabled = true;
  analyzeButton.disabled = false;
  calibrateButton.disabled = false;
  statusOutput.value = `${(samples.length / audioContext.sampleRate).toFixed(1)}s captured`;
}

async function analyzeRecording() {
  if (!lastWavBase64) return;
  statusOutput.value = "Analyzing";
  const response = await fetch("/v1/analyze-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audioBase64: lastWavBase64,
      transcript: buildTranscriptPayload(),
      verbosity: verbosity.value,
      baseline
    })
  });

  const contract = await response.json();
  jsonOutput.value = JSON.stringify(contract, null, 2);

  const promptResponse = await fetch("/v1/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contract, verbosity: verbosity.value })
  });
  promptOutput.value = await promptResponse.text();
  statusOutput.value = contract.flags.length ? contract.flags.map((flag) => flag.type).join(", ") : "No flags";
}

async function calibrateRecording() {
  if (!lastWavBase64) return;
  statusOutput.value = "Calibrating";
  const response = await fetch("/v1/calibrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audioBase64: lastWavBase64,
      text: transcript.value,
      baseline
    })
  });
  baseline = await response.json();
  saveActiveBaseline(baseline);
  renderBaseline();
  statusOutput.value = `Profile saved (${activeProfileName}, ${baseline.samples} sample${baseline.samples === 1 ? "" : "s"})`;
}

function clearBaseline() {
  baseline = null;
  delete profileStore.profiles[activeProfileName];
  saveProfileStore();
  localStorage.removeItem("subtextBaseline");
  renderBaseline();
  statusOutput.value = `Profile cleared (${activeProfileName})`;
}

function loadProfile() {
  activeProfileName = normalizeProfileName(profileName.value);
  profileName.value = activeProfileName;
  localStorage.setItem("subtextActiveProfile", activeProfileName);
  baseline = getActiveBaseline();
  renderBaseline();
  statusOutput.value = `Profile loaded (${activeProfileName})`;
}

async function setupMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    microphoneSelect.disabled = true;
    refreshMicrophonesButton.disabled = true;
    microphoneStatus.value = "Microphone: selector unavailable";
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  microphoneDevices = devices.filter((device) => device.kind === "audioinput");
  renderMicrophoneOptions();
  applyMicrophoneProfile({ announce: false });
}

function renderMicrophoneOptions() {
  const current = selectedAudioDeviceId;
  microphoneSelect.replaceChildren(new Option("Default microphone", ""));
  for (let index = 0; index < microphoneDevices.length; index += 1) {
    const device = microphoneDevices[index];
    const label = device.label || `Microphone ${index + 1}`;
    microphoneSelect.append(new Option(label, device.deviceId));
  }
  if (microphoneDevices.some((device) => device.deviceId === current)) {
    microphoneSelect.value = current;
  } else {
    selectedAudioDeviceId = "";
    microphoneSelect.value = "";
    localStorage.setItem("subtextAudioDeviceId", "");
  }
}

function selectMicrophone() {
  selectedAudioDeviceId = microphoneSelect.value;
  localStorage.setItem("subtextAudioDeviceId", selectedAudioDeviceId);
  applyMicrophoneProfile({ announce: true });
}

function rememberCapturedMicrophone(activeStream) {
  const settings = activeStream.getAudioTracks()[0]?.getSettings?.() ?? {};
  if (settings.deviceId) {
    selectedAudioDeviceId = settings.deviceId;
    localStorage.setItem("subtextAudioDeviceId", selectedAudioDeviceId);
    microphoneSelect.value = selectedAudioDeviceId;
  }
  applyMicrophoneProfile({ announce: false });
}

function applyMicrophoneProfile(options = {}) {
  const device = currentMicrophone();
  const profile = profileNameForDevice(device);
  if (profile !== activeProfileName) {
    activeProfileName = profile;
    profileName.value = activeProfileName;
    localStorage.setItem("subtextActiveProfile", activeProfileName);
    baseline = getActiveBaseline();
    renderBaseline();
  }
  microphoneStatus.value = `Microphone: ${deviceLabel(device)} -> profile ${activeProfileName}`;
  if (options.announce) statusOutput.value = `Microphone profile loaded (${activeProfileName})`;
}

function currentMicrophone() {
  return microphoneDevices.find((device) => device.deviceId === selectedAudioDeviceId) ?? null;
}

function profileNameForDevice(device) {
  if (!device) return "default";
  const explicit = profileStore.deviceProfiles?.[deviceKey(device)];
  if (explicit) return explicit;
  return `mic-${slugify(device.label || device.deviceId || "default")}`;
}

function deviceKey(device) {
  return device.deviceId || device.groupId || device.label || "default";
}

function deviceLabel(device) {
  return device?.label || (device ? "selected microphone" : "default");
}

function setupDictation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    dictateButton.disabled = true;
    stopDictationButton.disabled = true;
    dictationStatus.value = "Browser dictation: unavailable";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const alternative = event.results[i][0];
      const text = alternative.transcript;
      if (event.results[i].isFinal) finalText += text;
      else interimText += text;
      if (event.results[i].isFinal && Number.isFinite(alternative.confidence)) {
        dictationConfidenceValues.push(alternative.confidence);
      }
    }
    const next = [dictationBaseText, finalText, interimText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    transcript.value = next;
    transcriptEnvelope = browserDictationEnvelope(next);
    if (finalText) {
      dictationBaseText = next;
      dictationStatus.value = dictationConfidenceValues.length
        ? `Browser dictation: listening, confidence ${averageConfidence().toFixed(2)}`
        : "Browser dictation: listening";
    }
  };
  recognition.onerror = (event) => {
    dictationStatus.value = `Browser dictation: ${event.error}`;
    dictateButton.disabled = false;
    stopDictationButton.disabled = true;
  };
  recognition.onend = () => {
    dictateButton.disabled = false;
    stopDictationButton.disabled = true;
    if (dictationStatus.value === "Browser dictation: listening") {
      dictationStatus.value = "Browser dictation: stopped";
    }
  };
  dictationStatus.value = "Browser dictation: available";
}

function startDictation() {
  if (!recognition) return;
  dictationBaseText = transcript.value.trim();
  dictationConfidenceValues = [];
  transcriptEnvelope = null;
  dictateButton.disabled = true;
  stopDictationButton.disabled = false;
  dictationStatus.value = "Browser dictation: listening";
  recognition.start();
}

function stopDictation() {
  if (!recognition) return;
  recognition.stop();
  dictationStatus.value = "Browser dictation: stopping";
}

function buildTranscriptPayload() {
  const text = transcript.value.trim();
  if (transcriptEnvelope && transcriptEnvelope.text === text) return transcriptEnvelope;
  return {
    schema: "subtext/transcript/v1",
    text,
    source: "browser-preview-manual",
    language: navigator.language || "en-US"
  };
}

function browserDictationEnvelope(text) {
  return {
    schema: "subtext/transcript/v1",
    text,
    source: "browser-speech-recognition",
    language: recognition?.lang || navigator.language || "en-US",
    ...(dictationConfidenceValues.length ? { confidence: averageConfidence() } : {})
  };
}

function averageConfidence() {
  const values = dictationConfidenceValues.filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mergeChunks(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function drawMeter() {
  canvasContext.clearRect(0, 0, canvas.width, canvas.height);
  canvasContext.fillStyle = "#0d0f12";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  canvasContext.strokeStyle = "#2dd4bf";
  canvasContext.lineWidth = 2;
  canvasContext.beginPath();

  const frame = latestFrame.length ? latestFrame : new Float32Array(256);
  for (let x = 0; x < canvas.width; x += 1) {
    const index = Math.floor((x / canvas.width) * frame.length);
    const y = canvas.height / 2 + frame[index] * (canvas.height * 0.42);
    if (x === 0) canvasContext.moveTo(x, y);
    else canvasContext.lineTo(x, y);
  }
  canvasContext.stroke();

  canvasContext.strokeStyle = "rgba(245, 158, 11, 0.55)";
  canvasContext.beginPath();
  canvasContext.moveTo(0, canvas.height / 2);
  canvasContext.lineTo(canvas.width, canvas.height / 2);
  canvasContext.stroke();

  animationFrame = requestAnimationFrame(drawMeter);
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrame);
});

function loadProfileStore() {
  try {
    const raw = localStorage.getItem("subtextProfiles");
    const store = raw ? JSON.parse(raw) : { schema: "subtext/profile-store/v1", profiles: {}, deviceProfiles: {} };
    if (!store.profiles) store.profiles = {};
    if (!store.deviceProfiles) store.deviceProfiles = {};
    const legacy = localStorage.getItem("subtextBaseline");
    if (legacy && !store.profiles.default) {
      store.profiles.default = {
        name: "default",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        baseline: JSON.parse(legacy)
      };
      localStorage.setItem("subtextProfiles", JSON.stringify(store));
    }
    return store;
  } catch {
    return { schema: "subtext/profile-store/v1", profiles: {}, deviceProfiles: {} };
  }
}

function renderBaseline() {
  if (!baseline) {
    baselineStatus.value = `Profile: ${activeProfileName} (utterance only)`;
    baselineOutput.value = "";
    return;
  }
  baselineStatus.value = `Profile: ${activeProfileName} (${baseline.samples} sample${baseline.samples === 1 ? "" : "s"})`;
  baselineOutput.value = JSON.stringify(baseline, null, 2);
}

function getActiveBaseline() {
  return profileStore.profiles[activeProfileName]?.baseline ?? null;
}

function saveActiveBaseline(nextBaseline) {
  const existing = profileStore.profiles[activeProfileName] ?? {};
  const device = currentMicrophone();
  if (device) {
    profileStore.deviceProfiles = profileStore.deviceProfiles ?? {};
    profileStore.deviceProfiles[deviceKey(device)] = activeProfileName;
  }
  profileStore.profiles[activeProfileName] = {
    ...existing,
    name: activeProfileName,
    device: deviceLabel(device),
    deviceId: device?.deviceId ?? existing.deviceId ?? "",
    groupId: device?.groupId ?? existing.groupId ?? "",
    createdAt: existing.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    baseline: nextBaseline
  };
  saveProfileStore();
}

function saveProfileStore() {
  localStorage.setItem("subtextActiveProfile", activeProfileName);
  localStorage.setItem("subtextProfiles", JSON.stringify(profileStore));
}

function normalizeProfileName(value) {
  const name = String(value || "").trim();
  return name || "default";
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "default";
}
