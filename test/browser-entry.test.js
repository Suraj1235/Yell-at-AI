import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeSamples, renderVocalContext } from "../src/index.browser.js";

function synthesizeSine({ frequency, sampleRate, length }) {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
}

test("browser entry analyzes synthesized samples into a vocalcontext/v1 contract", () => {
  const sampleRate = 16000;
  const samples = synthesizeSine({ frequency: 150, sampleRate, length: sampleRate });
  const result = analyzeSamples({
    samples,
    sampleRate,
    text: "hello world this is a test"
  });
  assert.equal(result.schema, "vocalcontext/v1");

  const rendered = renderVocalContext(result);
  assert.equal(typeof rendered, "string");
  assert.ok(rendered.length > 0);
  assert.ok(rendered.includes("vocal-context"));
});

test("browser entry and its transitive deps contain no static node: imports", async () => {
  const nodeImport = /from "node:/;
  const fixedFiles = [
    "../src/index.browser.js",
    "../src/contract/analyzer.js",
    "../src/render/text.js",
    "../src/transcript/envelope.js",
    "../src/calibration/baseline.js"
  ];
  const globbedDirs = ["../src/dsp", "../src/alignment", "../src/text"];

  const files = [...fixedFiles];
  for (const dir of globbedDirs) {
    const dirPath = fileURLToPath(new URL(dir, import.meta.url));
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      if (entry.endsWith(".js")) files.push(`${dir}/${entry}`);
    }
  }

  for (const relativePath of files) {
    const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
    const source = await readFile(filePath, "utf8");
    assert.equal(
      nodeImport.test(source),
      false,
      `${relativePath} must not statically import a node: module to stay browser-safe`
    );
  }
});
