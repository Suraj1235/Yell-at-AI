// The engine badge.
//
// A persistent, non-dismissible statement of which transcription engine is
// active and who — if anyone — receives the audio. It is painted before any
// capture is possible and there is no code path that hides or removes it.
//
// The rule it has to satisfy is that the sentence is literally true in EVERY
// state the shell can be in, including the states where nothing is sent. The
// state is chosen from the engine's `egress` field, never from its name:
//
//   vendor   a recognizer is active and uploads audio; name the vendor
//   none     a local recognizer (whisper.cpp on the desktop) is active, so the
//            words are recognised on this device and no audio is sent
//   unknown  a user-supplied command; we cannot know what it does, so say so
//   none     the engine is set to "none", so the user types the words and no
//            audio is sent to anyone for recognition
//   none     this browser cannot record at all, so there is no audio
//   blocked  recognition was refused mid-session, so no audio reached the
//            vendor and the user falls back to typing
//
// The vendor string is interpolated from the shared registry
// (src/transcribe/engines.js, vendored) rather than written here, so this page
// and the CLI cannot disagree about who gets the audio.

import { ENGINES } from "./engine.js";

// Which registry entry is in force. `reported` is what the host said it ran
// (the desktop CLI reports the engine it used, carrying `egress`); before any
// turn has run it is the registry entry for the selected engine. The badge's
// wording is chosen from `egress`, never from a name.
export function engineInfo(engine, reported = null) {
  if (reported && reported.egress) return { ...(ENGINES[reported.id] || {}), ...reported };
  return ENGINES[engine] || null;
}

// The sentence onboarding uses to say what you are not signing up for.
//
// It is derived here, from the same registry the badge reads, rather than
// written into onboarding as a fixed string — because the strongest true
// version of it depends on which engine is active, and a welcome screen is
// exactly where an over-claim would do the most damage. The shape stays the
// same in every state: no account, no word limit, and then precisely what does
// and does not leave this device.
export function privacyLine({ canCapture, engine, reported = null }) {
  const info = canCapture ? engineInfo(engine, reported) : null;
  if (!info) {
    return (
      "No account, no word limit, nothing to subscribe to. No audio is sent to anyone for " +
      "recognition: you type the words, and the prosody is read here, on this device."
    );
  }
  if (info.egress === "none") {
    return (
      "No account, no word limit, nothing to subscribe to. The words are recognised on this " +
      `device by ${info.label}, and the prosody is read here too. No audio is sent to anyone for recognition.`
    );
  }
  if (info.egress === "vendor" && info.id !== "webspeech") {
    return (
      "No account, no word limit, nothing to subscribe to. Prosody analysis runs here, on this " +
      `device. On this engine the audio goes to ${info.vendor} for the words alone.`
    );
  }
  if (info.egress !== "vendor") {
    return (
      "No account, no word limit, nothing to subscribe to. Prosody analysis runs here, on this " +
      "device. The words come from a command you configured, and whether it sends audio anywhere " +
      "depends entirely on that command."
    );
  }
  return (
    "No account, no word limit, nothing to subscribe to. Prosody analysis runs here, on this " +
    `device. On this engine the audio goes to ${ENGINES.webspeech.vendor} for the words alone — set the ` +
    "engine to none in Settings and no audio is sent to anyone for recognition."
  );
}

export function createBadge(root) {
  const badge = root.querySelector("#engine-badge");
  const title = root.querySelector("#engine-badge-title");
  const detail = root.querySelector("#engine-badge-detail");

  function paint(egress, headline, body) {
    badge.dataset.egress = egress;
    title.textContent = headline;
    detail.textContent = body;
  }

  return {
    // `reported` is the engine descriptor the host returned for the last turn
    // (desktop), so the badge follows what actually ran, not what was picked.
    render({ canCapture, engine, reported = null }) {
      if (!canCapture) {
        paint(
          "none",
          "Transcription engine — unavailable in this browser",
          "This browser can't record audio, so nothing is captured and no audio is sent to anyone " +
            "for recognition. Prosody analysis needs a recording, and it would run on this device."
        );
        return;
      }

      const info = engine === "none" ? null : engineInfo(engine, reported);

      if (!info) {
        paint(
          "none",
          "Transcription engine — none, you type the transcript",
          "No audio is sent to anyone for recognition. Type what you said; the prosody is read " +
            "from your recording on this device."
        );
        return;
      }

      if (info.egress === "none") {
        paint(
          "none",
          `Transcription engine — ${info.label}`,
          "The words are recognised on this device, and the prosody is read here too. No audio " +
            "is sent to anyone for recognition."
        );
        return;
      }

      if (info.egress !== "vendor") {
        paint(
          "unknown",
          `Transcription engine — ${info.label}`,
          "The words come from a command you configured. Whether it sends your audio anywhere " +
            "depends entirely on that command; the prosody analysis runs on this device either way."
        );
        return;
      }

      const active = info.id === "webspeech" ? ENGINES.webspeech : info;
      paint(
        "vendor",
        `Transcription engine — ${active.label}`,
        `Your audio is sent to ${active.vendor} for recognition. Only transcription leaves this ` +
          "device: the prosody analysis runs here, in this page. To send nothing at all, switch " +
          "the engine to none in Settings and type the transcript instead."
      );
    },

    blocked() {
      paint(
        "blocked",
        "Transcription engine — Web Speech blocked by this browser",
        `Live recognition was refused, so no audio reached ${ENGINES.webspeech.vendor}. Type what ` +
          "you said; the prosody is still read from your recording on this device."
      );
    }
  };
}
