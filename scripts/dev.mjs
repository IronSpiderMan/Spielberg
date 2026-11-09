import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("请通过 npm run dev 启动");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) {
    if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    else spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
  process.exitCode = code;
}
function start(script, options = {}) {
  const child = spawn(process.execPath, [npmCli, "run", script], { stdio: "inherit", detached: process.platform !== "win32", ...options });
  children.push(child);
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => stop(code || 0));
  return child;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

const backend = start("backend:dev", { stdio: ["inherit", "pipe", "inherit"] });
backend.stdout.pipe(process.stdout);
const lines = createInterface({ input: backend.stdout });
lines.on("line", line => {
  const address = line.match(/^Spielberg listening at (http:\/\/\S+)$/)?.[1];
  if (!address || stopping) return;
  lines.close();
  const target = new URL(address);
  if (target.hostname === "0.0.0.0") target.hostname = "127.0.0.1";
  if (target.hostname === "[::]") target.hostname = "[::1]";
  start("frontend:dev", { env: { ...process.env, SPIELBERG_DEV_PROXY_TARGET: target.origin } });
});
