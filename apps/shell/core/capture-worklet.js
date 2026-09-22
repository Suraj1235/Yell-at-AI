// Taps raw mono PCM off the microphone graph and posts it to the main thread.
//
// The live reader and the final contract then see byte-identical audio, which
// is what lets the chips shown while you speak be checked against the block
// written when you release.

class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length) {
      // The render quantum buffer is reused by the engine; copy before posting.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}

registerProcessor("pcm-tap", PcmTap);
