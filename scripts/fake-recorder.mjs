import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2];

if (!out) {
  process.stderr.write("fake-recorder requires an output path\n");
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await copyFile(join(root, "eval", "fixtures", "emphasis.wav"), out);
