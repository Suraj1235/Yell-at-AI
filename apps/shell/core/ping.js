// The recording-start cue.
//
// A short, quiet two-tone rise, synthesised here rather than shipped as an
// audio file: no asset to fetch, nothing for a strict CSP to refuse, and it
// stays a few lines instead of a few kilobytes.
//
// It exists because the pill is not always where you are looking. Dictation
// happens while you are reading something else, and a cue you can hear is the
// difference between speaking into an open microphone and speaking into
// nothing. It is deliberately below the level of a notification sound: this is
// a confirmation, not an alert.
//
// It is silent when the setting is off and when the system asks for reduced
// motion — someone who has turned the animation down has said something about
// how much this software should announce itself, and a chime is louder than a
// transition.

const ATTACK = 0.006;
const HOLD = 0.052;
const RELEASE = 0.09;
const GAIN = 0.05;

export function createPing({ enabled = true } = {}) {
  let context = null;
  let on = enabled;

  function reduced() {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  return {
    get audible() {
      return on && !reduced();
    },
    setEnabled(next) {
      on = next;
    },
    // Called from the same gesture that starts the turn, so the audio context
    // is always created inside a user activation and never blocked.
    play() {
      if (!on || reduced()) return false;
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return false;
      try {
        if (!context) context = new Ctx();
        if (context.state === "suspended") context.resume().catch(() => {});
        const at = context.currentTime;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(GAIN, at + ATTACK);
        gain.gain.setValueAtTime(GAIN, at + ATTACK + HOLD);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ATTACK + HOLD + RELEASE);
        gain.connect(context.destination);

        const tone = context.createOscillator();
        tone.type = "sine";
        tone.frequency.setValueAtTime(660, at);
        tone.frequency.exponentialRampToValueAtTime(990, at + ATTACK + HOLD);
        tone.connect(gain);
        tone.start(at);
        tone.stop(at + ATTACK + HOLD + RELEASE + 0.02);
        tone.onended = () => {
          try { gain.disconnect(); } catch { /* already gone */ }
        };
        return true;
      } catch {
        return false; // an audio cue is never worth failing a turn over
      }
    }
  };
}
