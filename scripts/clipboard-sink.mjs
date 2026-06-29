import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const target = process.argv[2];
if (!target) {
  process.stderr.write("usage: clipboard-sink.mjs <file>\n");
  process.exit(2);
}

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.concat(chunks));
});
