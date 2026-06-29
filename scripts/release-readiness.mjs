import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const cueCases = [
  {
    id: "yelling",
    audio: "eval/fixtures/yelling.wav",
    text: "stop rewriting the whole auth module",
    flag: "yelling",
    priority: "de_escalate",
    responseStyle: "calm",
    directive: "respond_calmly",
    promptGuidance: /Guidance: de_escalate\/calm/
  },
  {
    id: "emphasis",
    audio: "eval/fixtures/emphasis.wav",
    text: "can we just refactor the whole auth module",
    flag: "emphasis",
    priority: "preserve_emphasis",
    responseStyle: "focused",
    directive: "preserve_emphasis",
    promptGuidance: /Guidance: preserve_emphasis\/focused/
  },
  {
    id: "confusion",
    audio: "eval/fixtures/confusion.wav",
    text: "wait um i am not sure which auth flow broke?",
    flag: "confusion",
    priority: "clarify",
    responseStyle: "patient",
    directive: "ask_clarifying_question",
    promptGuidance: /Guidance: clarify\/patient/
  }
];
const checks = [];

await step("project check", async () => {
  await run("npm", ["run", "check"]);
  return { evidence: "npm run check" };
});

await step("desktop scaffold", async () => {
  const report = JSON.parse((await run("npm", ["run", "desktop:check", "--silent"])).stdout);
  assert.equal(report.ok, true);
  return {
    schema: report.schema,
    productName: report.productName,
    identifier: report.identifier
  };
});

await step("harness doctor", async () => {
  const report = JSON.parse((await run("node", ["bin/subtext.js", "doctor", "--format", "json"])).stdout);
  assert.equal(report.ok, true);
  assert.equal(report.summary.notReady, 0);
  return {
    schema: report.schema,
    harnesses: report.summary.harnesses,
    ready: report.summary.ready
  };
});

await step("adapter bundles", async () => {
  const report = JSON.parse((await run("npm", ["run", "package:adapters", "--silent"])).stdout);
  assert.equal(report.ready, report.harnesses);
  return {
    schema: report.schema,
    harnesses: report.harnesses,
    ready: report.ready
  };
});

await step("harness conformance", async () => {
  const report = JSON.parse((await run("npm", ["run", "harness:conformance", "--silent"])).stdout);
  assert.equal(report.ok, true);
  return {
    schema: report.schema,
    cues: report.cues.length,
    harnesses: report.harnesses.length,
    preservedFields: report.requirements.preservedFields
  };
});

await step("core cue guidance json", async () => {
  const results = [];
  for (const item of cueCases) {
    const contract = JSON.parse((await run("node", [
      "bin/subtext.js",
      "analyze",
      "--audio",
      item.audio,
      "--text",
      item.text
    ])).stdout);

    assert.ok(contract.flags.some((flag) => flag.type === item.flag), `${item.id} missing ${item.flag} flag`);
    assert.ok(contract.affect.meaning_cues.includes(item.flag), `${item.id} missing ${item.flag} meaning cue`);
    assert.equal(contract.assistant_guidance.priority, item.priority);
    assert.equal(contract.assistant_guidance.response_style, item.responseStyle);
    assert.ok(
      contract.assistant_guidance.directives.some((directive) => directive.type === item.directive),
      `${item.id} missing ${item.directive} directive`
    );
    results.push({
      id: item.id,
      flag: item.flag,
      priority: contract.assistant_guidance.priority,
      response_style: contract.assistant_guidance.response_style,
      directive: item.directive
    });
  }

  return {
    cases: results
  };
});

await step("core cue guidance rendered prompts", async () => {
  const results = [];
  for (const item of cueCases) {
    const prompt = (await run("node", [
      "bin/subtext.js",
      "handoff",
      "--audio",
      item.audio,
      "--text",
      item.text,
      "--target",
      "stdout",
      "--verbosity",
      "full"
    ])).stdout;
    assert.match(prompt, /<vocal-context schema="vocalcontext\/v1">/);
    assert.match(prompt, item.promptGuidance);
    results.push({ id: item.id, guidance: `${item.priority}/${item.responseStyle}` });
  }
  return { cases: results };
});

process.stdout.write(`${JSON.stringify({
  schema: "subtext/release-readiness/v1",
  ok: checks.every((check) => check.ok),
  generatedAt: new Date().toISOString(),
  checks
}, null, 2)}\n`);

async function step(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true, ...result });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
    throw error;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited ${code}`));
    });
  });
}
