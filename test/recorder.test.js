import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname } from "node:path";
import { buildRecorderCommand, findRecorderOnPath } from "../src/capture/recorder.js";

test(
  "buildRecorderCommand explains the --record-command escape hatch with real placeholder syntax when there is no built-in recorder",
  { skip: process.platform === "darwin" },
  () => {
    assert.throws(
      // detect: () => null pins this to the "nothing found" path regardless of
      // whether the runner happens to have ffmpeg/sox on PATH.
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

// A directory guaranteed to exist, used as a fake PATH entry. The executables we
// claim to find are never spawned in these tests.
const REAL_DIR = dirname(process.execPath);

test("findRecorderOnPath returns null when no recorder is installed", () => {
  const found = findRecorderOnPath({ PATH: "/no/such/dir/zzzqx" }, "linux");
  assert.equal(found, null);
});

test("buildRecorderCommand builds an ffmpeg dshow line on Windows when ffmpeg is found", () => {
  const command = buildRecorderCommand({
    audioPath: "C:\\tmp\\turn.wav",
    durationSec: 4,
    sampleRate: 16000,
    device: null,
    command: null,
    env: { PATH: REAL_DIR, PATHEXT: ".EXE" },
    platform: "win32",
    // Injected so the test does not depend on ffmpeg actually being installed.
    detect: () => ({ name: "ffmpeg", executable: "ffmpeg" })
  });

  assert.equal(command.name, "ffmpeg");
  assert.ok(command.args.includes("dshow"), "Windows capture goes through the dshow input device");
  assert.ok(command.args.includes("-t"), "duration must be bounded");
  assert.equal(command.args.at(-1), "C:\\tmp\\turn.wav", "output path is the final argument");
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
