import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecorderCommand, findRecorderOnPath, resolveWindowsAudioDevice } from "../src/capture/recorder.js";

test(
  "buildRecorderCommand explains the --record-command escape hatch with real placeholder syntax when there is no built-in recorder",
  () => {
    assert.throws(
      // detect: () => null pins this to the "nothing found" path regardless of
      // whether the runner happens to have ffmpeg/sox on PATH (this now also
      // passes on darwin, so the old darwin skip is stale and removed).
      () => buildRecorderCommand({ audioPath: "out.wav", durationSec: 5, sampleRate: 16000, detect: () => null }),
      (error) => {
        assert.match(error.message, /--record-command/);
        assert.match(error.message, /SUBTEXT_RECORD_COMMAND/);
        assert.match(error.message, /\{out\}/);
        assert.match(error.message, /\{duration\}/);
        return true;
      }
    );
  }
);

test("findRecorderOnPath returns null when no recorder is installed", () => {
  const found = findRecorderOnPath({ PATH: "/no/such/dir/zzzqx" }, "linux");
  assert.equal(found, null);
});

test("buildRecorderCommand builds an ffmpeg dshow line on Windows when ffmpeg is found", () => {
  const command = buildRecorderCommand({
    audioPath: "C:\\tmp\\turn.wav",
    durationSec: 4,
    sampleRate: 16000,
    device: "Microphone (Realtek Audio)",
    command: null,
    platform: "win32",
    // Injected so the test does not depend on ffmpeg actually being installed.
    // No env/PATH override here: detect is injected, so buildRecorderCommand
    // never consults PATH — passing one would be dead code.
    detect: () => ({ name: "ffmpeg", executable: "ffmpeg" })
  });

  assert.equal(command.name, "ffmpeg");
  assert.ok(command.args.includes("dshow"), "Windows capture goes through the dshow input device");
  assert.ok(command.args.includes("audio=Microphone (Realtek Audio)"), "device name is passed to the dshow input");
  assert.ok(command.args.includes("-t"), "duration must be bounded");
  assert.equal(command.args.at(-1), "C:\\tmp\\turn.wav", "output path is the final argument");
});

test("buildRecorderCommand throws an actionable error on Windows when ffmpeg is found but no device is given", () => {
  assert.throws(
    () => buildRecorderCommand({
      audioPath: "C:\\tmp\\turn.wav",
      durationSec: 4,
      sampleRate: 16000,
      device: null,
      command: null,
      platform: "win32",
      detect: () => ({ name: "ffmpeg", executable: "ffmpeg" })
    }),
    /list_devices/,
    "ffmpeg's dshow demuxer has no default-device alias; the caller must be told to enumerate devices"
  );
});

test("resolveWindowsAudioDevice parses the first audio device out of a realistic ffmpeg dshow stderr block", async () => {
  const stderr = [
    "ffmpeg version 6.1 Copyright (c) 2000-2023 the FFmpeg developers",
    "[dshow @ 000001d2a1234560] DirectShow video devices (some may be both video and audio devices)",
    '[dshow @ 000001d2a1234560]  "Integrated Webcam"',
    '[dshow @ 000001d2a1234560]     Alternative name "@device_pnp_\\\\?\\usb#vid_0000&pid_0000&mi_00"',
    "[dshow @ 000001d2a1234560] DirectShow audio devices",
    '[dshow @ 000001d2a1234560]  "Microphone (Realtek(R) Audio)"',
    '[dshow @ 000001d2a1234560]     Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{AAAA}"',
    '[dshow @ 000001d2a1234560]  "Stereo Mix (Realtek(R) Audio)"',
    '[dshow @ 000001d2a1234560]     Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{BBBB}"',
    "dummy: Immediate exit requested"
  ].join("\n");

  const device = await resolveWindowsAudioDevice({
    executable: "ffmpeg",
    runner: async () => stderr
  });

  assert.equal(device, "Microphone (Realtek(R) Audio)");
});

test("resolveWindowsAudioDevice returns null when the block lists only video devices", async () => {
  const stderr = [
    "ffmpeg version 6.1 Copyright (c) 2000-2023 the FFmpeg developers",
    "[dshow @ 000001d2a1234560] DirectShow video devices (some may be both video and audio devices)",
    '[dshow @ 000001d2a1234560]  "Integrated Webcam"',
    '[dshow @ 000001d2a1234560]     Alternative name "@device_pnp_\\\\?\\usb#vid_0000&pid_0000&mi_00"',
    "dummy: Immediate exit requested"
  ].join("\n");

  const device = await resolveWindowsAudioDevice({
    executable: "ffmpeg",
    runner: async () => stderr
  });

  assert.equal(device, null);
});

test("buildRecorderCommand builds an arecord line on Linux when arecord is found", () => {
  const command = buildRecorderCommand({
    audioPath: "/tmp/turn.wav",
    durationSec: 3,
    sampleRate: 16000,
    device: null,
    command: null,
    platform: "linux",
    detect: () => ({ name: "arecord", executable: "arecord" })
  });

  assert.equal(command.name, "arecord");
  assert.ok(command.args.includes("-d"));
  assert.equal(command.args.at(-1), "/tmp/turn.wav");
});

test("an explicit --record-command still wins over auto-detection", () => {
  const command = buildRecorderCommand({
    audioPath: "/tmp/turn.wav",
    durationSec: 2,
    sampleRate: 16000,
    command: "my-recorder --secs {duration} {out}",
    platform: "linux",
    detect: () => ({ name: "arecord", executable: "arecord" })
  });

  assert.equal(command.name, "custom");
  assert.deepEqual(command.args, ["--secs", "2", "/tmp/turn.wav"]);
});

test("the no-recorder error names the platform and the tools it looked for", () => {
  assert.throws(
    () => buildRecorderCommand({
      audioPath: "/tmp/turn.wav",
      durationSec: 2,
      sampleRate: 16000,
      platform: "linux",
      detect: () => null
    }),
    /linux[\s\S]*ffmpeg[\s\S]*--record-command/
  );
});
