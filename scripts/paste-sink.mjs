import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const out = process.argv[2];
if (!out) {
  process.stderr.write("paste-sink requires an output path\n");
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, "pasted\n");
