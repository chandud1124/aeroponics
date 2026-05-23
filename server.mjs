import { createServer } from "node:http";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import app from "./dist/server/index.js";

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";
const appRoot = path.dirname(fileURLToPath(import.meta.url));

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);

    // Serve static client assets directly from dist to avoid hitting the SSR handler
    // This ensures /assets/* and /favicon.svg are resolved reliably in the container.
    const pathname = requestUrl.pathname;
    if (pathname.startsWith("/assets/") || pathname === "/favicon.svg") {
      const relPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      const filePath = path.join(appRoot, "dist", "client", relPath);
      console.log(`[static] request ${pathname} -> ${filePath}`);
      try {
        const candidates = [
          filePath,
          path.join(appRoot, relPath),
          path.join("/", relPath),
          path.join(appRoot, "dist", "client", "assets", path.basename(relPath))
        ];
        let found = null;
        for (const cand of candidates) {
          try {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { found = cand; break; }
          } catch (e) {
            // ignore
          }
        }
        if (found) {
          const ext = path.extname(found).toLowerCase();
          const mime = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : ext === ".svg" ? "image/svg+xml" : "application/octet-stream";
          console.log(`[static] serving ${found} as ${mime}`);
          res.statusCode = 200;
          res.setHeader("content-type", mime + "; charset=utf-8");
          const stream = fs.createReadStream(found);
          stream.pipe(res);
          return;
        }
        console.log(`[static] not found candidates: ${candidates.join(', ')}`);
      } catch (e) {
        console.error("Static file serve error:", e);
        // fallthrough to SSR handler
      }
    }
    const requestBody = await readRequestBody(req);
    const request = new Request(requestUrl, {
      method: req.method,
      headers: toHeaders(req.headers),
      body: requestBody && requestBody.length > 0 ? requestBody : undefined,
    });

    const response = await app.fetch(request, process.env, undefined);

    res.statusCode = response.status;
    res.statusMessage = response.statusText;

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});