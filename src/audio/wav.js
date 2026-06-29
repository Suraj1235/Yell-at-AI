import { readFile } from "node:fs/promises";

const PCM = 1;
const IEEE_FLOAT = 3;

export async function readWavFile(filePath) {
  const buffer = await readFile(filePath);
  return parseWav(buffer);
}

export function parseWav(bufferLike) {
  const buffer = Buffer.from(bufferLike);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file.");
  }

  let offset = 12;
  let format = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      format = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = chunkSize;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!format || !channels || !sampleRate || !bitsPerSample || dataOffset == null || dataSize == null) {
    throw new Error("WAV file is missing fmt or data chunks.");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const sampleOffset = dataOffset + (frame * channels + channel) * bytesPerSample;
      mixed += readSample(buffer, sampleOffset, format, bitsPerSample);
    }
    samples[frame] = mixed / channels;
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    samples,
    durationSec: samples.length / sampleRate
  };
}

function readSample(buffer, offset, format, bitsPerSample) {
  if (format === IEEE_FLOAT && bitsPerSample === 32) {
    return clampSample(buffer.readFloatLE(offset));
  }

  if (format !== PCM) {
    throw new Error(`Unsupported WAV format ${format}; expected PCM or IEEE float.`);
  }

  if (bitsPerSample === 8) {
    return (buffer.readUInt8(offset) - 128) / 128;
  }
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32768;
  }
  if (bitsPerSample === 24) {
    const value = buffer.readIntLE(offset, 3);
    return value / 8388608;
  }
  if (bitsPerSample === 32) {
    return buffer.readInt32LE(offset) / 2147483648;
  }

  throw new Error(`Unsupported PCM bit depth ${bitsPerSample}.`);
}

export function encodeWav({ samples, sampleRate = 16000 }) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(PCM, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }

  return buffer;
}

function clampSample(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}
