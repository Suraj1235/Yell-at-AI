import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecorderCommand } from "../src/capture/recorder.js";

test(
  "buildRecorderCommand explains the --record-command escape hatch with real placeholder syntax when there is no built-in recorder",
  { skip: process.platform === "darwin" },
  () => {
    assert.throws(
      () => buildRecorderCommand({ audioPath: "out.wav", durationSec: 5, sampleRate: 16000 }),
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
