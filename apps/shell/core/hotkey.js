// Hold-to-talk binding.
//
// Choosing the key: Ctrl+Alt+Y is the default because it is the accelerator
// the Tauri shell already registers, so the muscle memory is the same on every
// surface, and because the alternatives are all taken — Cmd+Space is
// Spotlight, Ctrl+Space is the IME switcher on Windows and completion in most
// editors, and a bare modifier tap is indistinguishable from someone reaching
// for a shortcut. F9 and F4 are offered for anyone whose keyboard layout turns
// Ctrl+Alt into AltGr.
//
// Two rules that are not negotiable:
//   - the binding NEVER fires while focus is in a text field, a textarea or
//     anything contenteditable, so dictating into this page's own settings can
//     never start a recording;
//   - Escape always cancels, inserts nothing, and is not rebindable.
//
// Press-and-hold is primary. Hands-free — dictation that keeps running after
// you let go — is entered by DOUBLE-TAPPING the key inside DOUBLE_TAP_MS, and
// left by pressing it once more, by clicking the pill, or with Escape.
//
// Why double-tap rather than the single short tap this used to latch on: a
// single tap is what a slip of the hand produces, and latching on a slip meant
// the microphone stayed open with nothing on screen explaining why. A double
// tap is a deliberate gesture nobody performs by accident, and it is the
// gesture the category has already taught people. A single short tap is now
// what it looks like — a very short turn — and the words from it still land.
//
// The cost is honest and bounded: after a short press the turn stays open for
// DOUBLE_TAP_MS waiting to see whether a second tap arrives. That window is
// recording, not dead time, so nothing said inside it is lost either way.

export const BINDINGS = Object.freeze([
  { id: "ctrl-alt-y", label: "Ctrl + Alt + Y", keys: ["Control", "Alt", "y"], code: "KeyY", ctrl: true, alt: true },
  { id: "ctrl-alt-space", label: "Ctrl + Alt + Space", keys: ["Control", "Alt", " "], code: "Space", ctrl: true, alt: true },
  { id: "f9", label: "F9", keys: ["F9"], code: "F9", ctrl: false, alt: false },
  { id: "f4", label: "F4", keys: ["F4"], code: "F4", ctrl: false, alt: false }
]);

const TAP_MS = 350;
const DOUBLE_TAP_MS = 500;

export function getBinding(id) {
  return BINDINGS.find((binding) => binding.id === id) || BINDINGS[0];
}

export function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable === true
  );
}

export function createHotkey({ binding, onPress, onRelease, onCancel, onLatch }) {
  let current = binding;
  let down = false;
  let pressedAt = 0;
  let latched = false;
  // Set while a short press is waiting to find out whether it was the first
  // half of a double tap. The turn is still running the whole time.
  let deciding = 0;

  function matches(event) {
    if (event.code !== current.code) return false;
    if (current.ctrl && !(event.ctrlKey || event.metaKey)) return false;
    if (current.alt && !event.altKey) return false;
    if (!current.ctrl && (event.ctrlKey || event.metaKey)) return false;
    if (!current.alt && event.altKey) return false;
    return true;
  }

  function keydown(event) {
    if (event.key === "Escape") {
      if (down || latched || deciding) {
        stopDeciding();
        down = false;
        latched = false;
        onCancel();
      }
      return;
    }
    if (isEditable(event.target)) return;
    if (event.repeat) return;
    if (!matches(event)) return;
    event.preventDefault();

    // Already hands-free: this press ends the turn.
    if (latched) {
      latched = false;
      onRelease();
      return;
    }

    // The second tap of a double tap, arriving while the first tap's turn is
    // still open. Keep it open and hand it over to hands-free.
    if (deciding) {
      stopDeciding();
      down = false;
      latched = true;
      onLatch?.();
      return;
    }

    down = true;
    pressedAt = performance.now();
    onPress();
  }

  function keyup(event) {
    if (!down) return;
    // Releasing any key in the chord ends the hold — letting go of Ctrl before
    // the letter is the same gesture to the person making it.
    const isChordKey = event.code === current.code || current.keys.includes(event.key);
    if (!isChordKey) return;

    down = false;
    if (performance.now() - pressedAt < TAP_MS) {
      deciding = window.setTimeout(() => {
        deciding = 0;
        onRelease();
      }, DOUBLE_TAP_MS);
      return;
    }
    onRelease();
  }

  function stopDeciding() {
    if (deciding) window.clearTimeout(deciding);
    deciding = 0;
  }

  function blur() {
    // A held key that is released while the window is in the background never
    // produces a keyup. Ending the turn beats recording until the tab closes.
    // Hands-free is deliberate and survives a focus change; a hold does not.
    if (deciding) {
      stopDeciding();
      onRelease();
      return;
    }
    if (down) {
      down = false;
      onRelease();
    }
  }

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);

  return {
    get binding() {
      return current;
    },
    get latched() {
      return latched;
    },
    setBinding(next) {
      current = next;
    },
    // The pill's own gestures can put the app into hands-free too, and the key
    // has to agree about it or the next press would start a second turn.
    latch() {
      stopDeciding();
      down = false;
      latched = true;
    },
    clearLatch() {
      stopDeciding();
      latched = false;
      down = false;
    },
    destroy() {
      stopDeciding();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    }
  };
}

// The pill is a target as well as an indicator — on a phone it is the only
// target. One pointer path covers mouse, pen and touch, and it carries both
// gestures:
//
//   press and hold        → dictate while held, exactly like the key
//   click (under TAP_MS)  → start hands-free, or stop it if it is running
//
// The click case is why this is not a plain press-and-hold binding any more.
// A quick click used to call start and stop so close together that stop ran
// while start was still awaiting the microphone, and the turn never ended:
// the pill sat listening until Escape. A click is now a deliberate gesture
// with a defined meaning instead of a race.
export function bindPillGesture(element, { isActive, onStart, onStop, onHandsFree }) {
  let active = false;
  let startedAt = 0;
  let wasRunning = false;

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    active = true;
    startedAt = performance.now();
    wasRunning = isActive();
    try { element.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointers have nothing to capture */ }
    if (!wasRunning) onStart();
  });

  const end = () => {
    if (!active) return;
    active = false;
    const quick = performance.now() - startedAt < TAP_MS;
    if (wasRunning) onStop();
    else if (quick) onHandsFree();
    else onStop();
  };

  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  return { destroy() { /* element lives for the page's lifetime */ } };
}
