#!/usr/bin/env node
/**
 * Minimal static file server for local development (zero dependencies).
 * Serves the repo root with correct MIME types and byte-range support for audio.
 *   node scripts/serve.mjs   ->   http://localhost:8080
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = path.join(ROOT, path.normalize(pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }

    const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;

    if (range && /^bytes=/.test(range)) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = s ? parseInt(s, 10) : 0;
      const end = e ? parseInt(e, 10) : info.size - 1;
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { "Content-Type": type, "Content-Length": info.size, "Accept-Ranges": "bytes" });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT}\n  http://localhost:${PORT}`);
});
