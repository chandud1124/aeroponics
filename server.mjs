import { createServer } from "node:http";
import { Readable } from "node:stream";

import app from "./dist/server/index.js";

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";

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