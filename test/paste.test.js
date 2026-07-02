import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPasteCommand } from "../src/handoff/paste.js";

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

function withWaylandDisplay(value, fn) {
  const hadValue = Object.prototype.hasOwnProperty.call(process.env, "WAYLAND_DISPLAY");
  const original = process.env.WAYLAND_DISPLAY;
  if (value === undefined) delete process.env.WAYLAND_DISPLAY;
  else process.env.WAYLAND_DISPLAY = value;
  try {
    return fn();
  } finally {
    if (hadValue) process.env.WAYLAND_DISPLAY = original;
    else delete process.env.WAYLAND_DISPLAY;
  }
}

test("defaultPasteCommand picks wtype on Wayland and xdotool otherwise on Linux", () => {
  withPlatform("linux", () => {
    withWaylandDisplay("wayland-0", () => {
      assert.equal(defaultPasteCommand()[0], "wtype");
    });
    withWaylandDisplay(undefined, () => {
      assert.equal(defaultPasteCommand()[0], "xdotool");
    });
  });
});
