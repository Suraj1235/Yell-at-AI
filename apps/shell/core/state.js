// The dictation state machine.
//
//   idle ──▶ listening ──▶ thinking ──▶ inserted ──▶ idle
//              │              │
//              ├──▶ idle      └──▶ error ──▶ idle
//              └──▶ error
//
// Illegal transitions throw rather than half-apply, because gate 4 of the plan
// ("never capture silently") depends on the pill's state and the microphone's
// state being the same fact. A silent no-op here would let them diverge.

export const STATES = Object.freeze(["idle", "listening", "thinking", "inserted", "error"]);

const ALLOWED = Object.freeze({
  idle: ["listening", "error"],
  listening: ["thinking", "idle", "error"],
  thinking: ["inserted", "idle", "error"],
  inserted: ["idle", "listening"],
  error: ["idle", "listening"]
});

export function createMachine(initial = "idle") {
  let current = initial;
  let detail = null;
  const listeners = new Set();

  return {
    get state() {
      return current;
    },
    get detail() {
      return detail;
    },
    can(next) {
      return ALLOWED[current]?.includes(next) ?? false;
    },
    to(next, payload = null) {
      if (next === current) {
        detail = payload;
        emit();
        return current;
      }
      if (!ALLOWED[current]?.includes(next)) {
        throw new Error(`Illegal dictation transition: ${current} -> ${next}`);
      }
      const from = current;
      current = next;
      detail = payload;
      emit(from);
      return current;
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  function emit(from = current) {
    for (const listener of listeners) listener({ state: current, from, detail });
  }
}
