import { runHarnessConformance } from "../src/harness/conformance.js";

const report = await runHarnessConformance();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
