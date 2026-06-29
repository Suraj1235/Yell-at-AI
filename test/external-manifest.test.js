import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const cases = JSON.parse(await readFile(new URL("../eval/external/emotion-cases.json", import.meta.url), "utf8"));
const wildCases = JSON.parse(await readFile(new URL("../eval/wild/youtube-cases.json", import.meta.url), "utf8"));

test("external emotion manifest covers at least ten web audio cases across multiple sources", () => {
  assert.ok(cases.length >= 10);
  assert.ok(new Set(cases.map((item) => item.source)).size >= 3);
  assert.ok(new Set(cases.map((item) => item.emotion)).size >= 5);

  for (const item of cases) {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.source, "string");
    assert.equal(typeof item.emotion, "string");
    assert.equal(typeof item.transcript, "string");
    assert.ok(item.url || (item.archiveUrl && item.archiveEntry));
    assert.ok((item.expectAny?.length ?? 0) + (item.expectAll?.length ?? 0) > 0);
  }
});

test("wild YouTube manifest covers at least ten natural speech cases across settings", () => {
  assert.ok(wildCases.length >= 14);
  assert.ok(new Set(wildCases.map((item) => item.source)).size >= 10);
  assert.ok(new Set(wildCases.map((item) => item.genre)).size >= 9);

  for (const item of wildCases) {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.source, "string");
    assert.equal(typeof item.sourceUrl, "string");
    assert.equal(typeof item.genre, "string");
    assert.equal(typeof item.startSec, "number");
    assert.equal(typeof item.endSec, "number");
    assert.ok(item.endSec > item.startSec);
    assert.ok((item.expectAny?.length ?? 0) + (item.expectAll?.length ?? 0) + (item.forbid?.length ?? 0) > 0);
  }
});
