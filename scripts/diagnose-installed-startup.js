"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

const executablePath = process.argv[2];
if (!executablePath || !fs.existsSync(executablePath)) throw new Error("未找到待诊断主程序");

function findPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const port = await findPort();
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  let exit = null;
  child.once("exit", (code, signal) => { exit = { code, signal }; });

  let pages = [];
  const deadline = Date.now() + 15000;
  while (!exit && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        pages = await response.json();
        if (pages.some((page) => String(page.url || "").includes("renderer/index.html"))) break;
      }
    } catch {}
    await delay(250);
  }

  process.stdout.write(`${JSON.stringify({
    executablePath: path.resolve(executablePath),
    pid: child.pid,
    exit,
    running: !exit,
    pages: pages.map((page) => ({ type: page.type, title: page.title, url: page.url })),
    stdout: stdout.slice(-2000),
    stderr: stderr.slice(-4000)
  }, null, 2)}\n`);

  if (!exit && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
