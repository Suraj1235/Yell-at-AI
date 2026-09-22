#!/usr/bin/env node
// Static dev server for apps/shell.
//
// The shell has no build step, so this only has to hand files back with the
// right media type. It does two things a generic static server would not, and
// both of them are the point:
//
//   1. It sends the SAME Content-Security-Policy the production site sends
//      (apps/web/vercel.json), so a module, worklet or service worker that
//      would be refused in production is refused here too, on the first run
//      rather than after a deploy.
//   2. It serves from the repository root, because the shell imports the
//      engine that is vendored beside the landing page (apps/web/vendor) —
//      one copy of the engine, shared by both surfaces.
//
//   node scripts/serve-shell.mjs [--port 8123] [--host 127.0.0.1]

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "/apps/shell/index.html";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".map": "application/json; charset=utf-8"
};

function parseArgs(argv) {
  const args = { port: 8123, host: "127.0.0.1" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") args.port = Number(argv[++i]);
    else if (argv[i] === "--host") args.host = argv[++i];
  }
  return args;
}

const { port, host } = parseArgs(process.argv.slice(2));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? ENTRY : decodeURIComponent(url.pathname);

  // Contain every request inside the repository root.
  const target = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(ROOT + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }

  const file = info.isDirectory() ? join(target, "index.html") : target;
  try {
    await stat(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }

  res.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "permissions-policy": "microphone=(self), camera=()",
    "cache-control": "no-store",
    // A service worker registered at ./ may only control ./ and below; this
    // header is not needed for that, but it keeps the scope explicit.
    "service-worker-allowed": "/apps/shell/"
  });
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  process.stdout.write(`shell: http://${host}:${port}${ENTRY}\n`);
});
