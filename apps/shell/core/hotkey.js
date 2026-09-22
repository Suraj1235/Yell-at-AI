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
// Press-and-hold is primary. A press shorter than TAP_MS latches instead, for
// long dictation, and the next press ends it.

export const BINDINGS = Object.freeze([
  { id: "ctrl-alt-y", label: "Ctrl + Alt + Y", keys: ["Control", "Alt", "y"], code: "KeyY", ctrl: true, alt: true },
  { id: "ctrl-alt-space", label: "Ctrl + Alt + Space", keys: ["Control", "Alt", " "], code: "Space", ctrl: true, alt: true },
  { id: "f9", label: "F9", keys: ["F9"], code: "F9", ctrl: false, alt: false },
  { id: "f4", label: "F4", keys: ["F4"], code: "F4", ctrl: false, alt: false }
]);

const TAP_MS = 350;

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
      if (down || latched) {
        down = false;
        latched = false;
        onCancel();
      }
      return;
    }
    if (isEditable(event.target)) return;
    if (event.repeat) return;

    if (latched && matches(event)) {
      event.preventDefault();
      latched = false;
      onRelease();
      return;
    }
    if (!matches(event)) return;

    event.preventDefault();
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
      latched = true;
      onLatch?.();
      return;
    }
    onRelease();
  }

  function blur() {
    // A held key that is released while the window is in the background never
    // produces a keyup. Ending the turn beats recording until the tab closes.
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
    clearLatch() {
      latched = false;
      down = false;
    },
    destroy() {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    }
  };
}

// The pill doubles as the press-and-hold target, which is the only way this
// works on a phone. Pointer events cover mouse, pen and touch in one path.
export function bindPointerHold(element, { onPress, onRelease }) {
  let active = false;

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    active = true;
    element.setPointerCapture?.(event.pointerId);
    onPress();
  });

  const end = () => {
    if (!active) return;
    active = false;
    onRelease();
  };

  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  return { destroy() { /* element lives for the page's lifetime */ } };
}
