import { spawn } from "node:child_process";
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
for (const script of ["backend:dev", "frontend:dev"]) {
  const child = spawn(process.execPath, [npmCli, "run", script], { stdio: "inherit", detached: process.platform !== "win32" });
  children.push(child);
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
