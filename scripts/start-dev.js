#!/usr/bin/env node
import { spawnSync, spawn } from "child_process";
import os from "os";

const ports = [1420, 1421];
const stalePids = new Set();

function killStalePortListeners() {
  if (os.platform() !== "win32") {
    return;
  }

  const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  if (netstat.error || typeof netstat.stdout !== "string") {
    return;
  }

  for (const line of netstat.stdout.split(/\r?\n/)) {
    for (const port of ports) {
      const regex = new RegExp(`^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
      const match = line.match(regex);
      if (match && match[1]) {
        stalePids.add(match[1]);
      }
    }
  }

  for (const pid of stalePids) {
    if (parseInt(pid, 10) === process.pid) {
      continue;
    }
    spawnSync("taskkill", ["/F", "/PID", pid], { stdio: "inherit" });
  }
}

killStalePortListeners();

const vite = spawn("vite", ["--host", "127.0.0.1"], {
  stdio: "inherit",
  shell: true,
});

vite.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code);
  }
});

vite.on("error", (error) => {
  console.error("Failed to start Vite:", error);
  process.exit(1);
});
