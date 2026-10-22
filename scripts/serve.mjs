import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DIST } from "./lib.mjs";

const BASE = "/agent-memory-push";
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/") {
    response.writeHead(302, { Location: `${BASE}/` });
    response.end();
    return;
  }
  if (!url.pathname.startsWith(`${BASE}/`)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const relative = decodeURIComponent(url.pathname.slice(BASE.length + 1)) || "index.html";
  const file = path.resolve(DIST, relative);
  if (!file.startsWith(path.resolve(DIST))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  let target = file;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!fs.existsSync(target)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const body = fs.readFileSync(target);
  response.writeHead(200, {
    "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Agent Memory 推送: http://127.0.0.1:${PORT}${BASE}/`);
});
