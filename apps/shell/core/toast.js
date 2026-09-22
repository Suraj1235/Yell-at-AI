// The toast.
//
// One line of what just happened, and up to two things you can do about it.
// It lives directly above the pill and is made of the same material, because
// it is the pill talking — not a notification from somewhere else in the app.
//
// The rules it follows:
//   - it only ever appears in response to something the user did, or to the
//     app stopping a recording by itself, which is the same thing seen from
//     the other side;
//   - it never carries the only copy of anything. Undo is a convenience; the
//     words are already safe wherever the toast says they are;
//   - it does not time out while your focus is inside it, because a toast that
//     vanishes mid-Tab is a button that moves away from you.

const LIFETIME_MS = 9000;

export function createToast(root, { announce } = {}) {
  const node = root.querySelector("#toast");
  const text = root.querySelector("#toast-text");
  const actions = root.querySelector("#toast-actions");
  let timer = 0;
  let onDismiss = null;

  function clear() {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  function hide({ run = true } = {}) {
    clear();
    node.hidden = true;
    actions.replaceChildren();
    text.textContent = "";
    const after = onDismiss;
    onDismiss = null;
    if (run) after?.();
  }

  function arm() {
    clear();
    timer = window.setTimeout(() => {
      if (node.contains(document.activeElement)) {
        arm();
        return;
      }
      hide();
    }, LIFETIME_MS);
  }

  return {
    element: node,

    show({ message, actions: items = [], onDismiss: dismissed = null }) {
      hide({ run: true });
      onDismiss = dismissed;
      text.textContent = message;
      actions.replaceChildren(
        ...items.map((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "toast-action";
          button.textContent = item.label;
          button.addEventListener("click", () => {
            // The action consumes the toast: whatever it does, the sentence
            // that offered it is no longer true.
            hide({ run: false });
            onDismiss = null;
            item.run();
          });
          return button;
        })
      );
      node.hidden = false;
      announce?.(message);
      arm();
    },

    hide
  };
}
