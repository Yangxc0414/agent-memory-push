import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ROOT } from "./lib.mjs";

const build = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs")], {
  cwd: ROOT,
  encoding: "utf8"
});
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}

const requests = [];
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    requests.push({ url: request.url, body, headers: request.headers });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ code: 0, msg: "success" }));
  });
});

await new Promise((resolve) => server.listen(8788, "127.0.0.1", resolve));
const stateFile = path.join(os.tmpdir(), `agent-memory-push-notify-${Date.now()}.json`);

function run(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "notify.mjs"), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        FEISHU_WEBHOOK: "http://127.0.0.1:8788/hook",
        NOTIFY_STATE: stateFile,
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_CHAT_ID: ""
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${stdout}\n${stderr}`));
    });
  });
}

try {
  await run(["--force"]);
  assert.equal(requests.length, 1, "force should send one webhook");
  const payload = JSON.parse(requests[0].body);
  assert.equal(payload.msg_type, "interactive");
  assert.equal(payload.card.header.title.tag, "plain_text");
  assert.match(payload.card.header.title.content, /Agent Memory/);
  assert.ok(payload.card.elements.some((element) => String(element.text?.content || "").includes("本期")));
  const joined = JSON.stringify(payload);
  assert.ok(joined.includes("为什么") || joined.includes("原文"), "card should link to sources");

  const second = await run();
  assert.equal(requests.length, 1, "dedupe should skip the second send");
  assert.match(second, /already sent/, "second run should log dedupe");

  assert.ok(fs.existsSync(stateFile), "state file should be written");
  console.log("notify test passed: payload shape + date dedupe");
} finally {
  server.close();
  fs.rmSync(stateFile, { force: true });
}
