// The live scope inside the pill.
//
// On this waveform hue is not decoration and it is not age: it is the emphasis
// reading. A bar is drawn at the moment its audio arrives, and it is painted
// with the tint the live reader had for that moment — cool where you were
// unremarkable, hot where you leaned on a word. Scroll back through a phrase
// and the shape of what you stressed is still there.
//
// Amplitude comes from the same Float32 PCM the engine analyses, so a tall bar
// and a high energy z-score are the same measurement drawn twice.

const COOL = [54, 214, 195];
const MID = [255, 179, 71];
const HOT = [255, 122, 24];

// How fast the display's reference peak falls back when you go quiet. One
// frame is ~2.7ms of audio, so this is a couple of seconds of memory.
const PEAK_DECAY = 0.9995;

export function createWaveform(canvas) {
  const context = canvas.getContext("2d");
  const bars = [];
  let tint = 0;
  let peak = 0;
  let raf = 0;
  let width = 0;
  let height = 0;
  let maxBars = 48;

  function resize() {
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const cssWidth = canvas.clientWidth || 240;
    const cssHeight = canvas.clientHeight || 24;
    width = Math.round(cssWidth * ratio);
    height = Math.round(cssHeight * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    maxBars = Math.max(12, Math.floor(width / (3 * ratio + 2 * ratio)));
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!width || !height) resize();
    context.clearRect(0, 0, width, height);

    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const barWidth = 3 * ratio;
    const gap = 2 * ratio;
    const mid = height / 2;
    const start = Math.max(0, bars.length - maxBars);

    for (let i = start; i < bars.length; i += 1) {
      const bar = bars[i];
      const barHeight = Math.max(2 * ratio, bar.amp * height * 0.92);
      const x = width - (bars.length - i) * (barWidth + gap);
      if (x + barWidth < 0) continue;
      const [r, g, b] = mixTint(bar.tint);
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.45 + 0.5 * bar.tint})`;
      context.fillRect(x, mid - barHeight / 2, barWidth, barHeight);
    }
  }

  return {
    // Amplitude of one arriving audio frame, painted with the tint in force.
    //
    // The bar HEIGHT is auto-scaled against a slowly decaying running peak, so
    // a quiet microphone still fills the scope and a loud one does not clip to
    // a solid block. This is a drawing decision and only a drawing decision —
    // the numbers on the chips come from the untouched samples, and scaling
    // the picture never scales the evidence. Colour, which is the evidence,
    // is not auto-scaled.
    push(amp) {
      peak = Math.max(amp, peak * PEAK_DECAY);
      const gain = 1 / Math.max(0.02, Math.min(0.5, peak));
      bars.push({ amp: Math.min(1, amp * gain * 0.85), tint });
      if (bars.length > maxBars * 3) bars.splice(0, bars.length - maxBars * 3);
    },
    // 0 = nothing notable, 1 = strongly emphasised. Set by the live reader.
    setTint(value) {
      tint = Math.max(0, Math.min(1, value));
    },
    get tint() {
      return tint;
    },
    clear() {
      bars.length = 0;
      tint = 0;
      peak = 0;
      if (width && height) context.clearRect(0, 0, width, height);
    },
    start() {
      if (raf) return;
      resize();
      draw();
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    resize
  };
}

function mixTint(t) {
  const [from, to, local] = t < 0.5 ? [COOL, MID, t * 2] : [MID, HOT, (t - 0.5) * 2];
  return [
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local)
  ];
}
