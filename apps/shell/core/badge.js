// The engine badge.
//
// A persistent, non-dismissible statement of which transcription engine is
// active and who — if anyone — receives the audio. It is painted before any
// capture is possible and there is no code path that hides or removes it.
//
// The rule it has to satisfy is that the sentence is literally true in EVERY
// state the shell can be in, including the states where nothing is sent:
//
//   vendor   a recognizer is active and uploads audio; name the vendor
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

// The sentence onboarding uses to say what you are not signing up for.
//
// It is derived here, from the same registry the badge reads, rather than
// written into onboarding as a fixed string — because the strongest true
// version of it depends on which engine is active, and a welcome screen is
// exactly where an over-claim would do the most damage. The shape stays the
// same in every state: no account, no word limit, and then precisely what does
// and does not leave this device.
export function privacyLine({ canCapture, engine }) {
  if (!canCapture || engine !== "webspeech") {
    return (
      "No account, no word limit, nothing to subscribe to. No audio is sent to anyone for " +
      "recognition: you type the words, and the prosody is read here, on this device."
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
    render({ canCapture, engine }) {
      if (!canCapture) {
        paint(
          "none",
          "Transcription engine — unavailable in this browser",
          "This browser can't record audio, so nothing is captured and no audio is sent to anyone " +
            "for recognition. Prosody analysis needs a recording, and it would run on this device."
        );
        return;
      }

      if (engine !== "webspeech") {
        paint(
          "none",
          "Transcription engine — none, you type the transcript",
          "No audio is sent to anyone for recognition. Type what you said; the prosody is read " +
            "from your recording on this device."
        );
        return;
      }

      const active = ENGINES.webspeech;
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
