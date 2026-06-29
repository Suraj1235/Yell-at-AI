import { buildAdapterBundles } from "../src/harness/bundles.js";

const index = await buildAdapterBundles();
process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
