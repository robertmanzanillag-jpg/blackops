import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Hosting mode is an operator acknowledgement, not proof of cloud uptime.
// This entrypoint never changes hosting, installs software, or starts a DB.
export function createOfficeCloudLauncher(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const executable = options.executable ?? process.execPath;
  const spawnImpl = options.spawnImpl ?? spawn;
  const signals = options.signals ?? process;
  const killGroup = options.killGroup ?? ((pgid, signal) => process.kill(-pgid, signal));
  const setTimer = options.setTimeoutImpl ?? setTimeout;
  const clearTimer = options.clearTimeoutImpl ?? clearTimeout;
  const graceMs = options.graceMs ?? 10_000;
  if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 30_000) throw new Error("INVALID_OFFICE_SHUTDOWN_GRACE");
  const children = [];
  let promise;
  let resolveRun;
  let stopping = false;
  let finished = false;
  let resultCode = 0;
  let timer;
  const onTerm = () => stop("SIGTERM");
  const onInt = () => stop("SIGINT");

  function finish() {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearTimer(timer);
    signals.removeListener("SIGTERM", onTerm);
    signals.removeListener("SIGINT", onInt);
    resolveRun?.(resultCode);
  }
  function signalChildren(signal) {
    for (const record of children) {
      // A detached Linux child's positive PID is its new process-group ID.
      // Signal only groups created by this launcher, even if the direct wrapper
      // already exited and left a web/CLI descendant in its group.
      if (!Number.isSafeInteger(record.pid) || record.pid <= 0) continue;
      try { killGroup(record.pid, signal); }
      catch (error) {
        if (error?.code === "ESRCH") continue;
        resultCode = 1;
        // Still terminate the direct child if group signalling was denied.
        try { record.child.kill(signal); } catch { /* exit remains nonzero */ }
      }
    }
  }
  function shutdown(failed, signal = "SIGTERM") {
    if (failed) resultCode = 1;
    if (stopping || finished) return;
    stopping = true;
    signalChildren(signal);
    if (!children.some(record => Number.isSafeInteger(record.pid) && record.pid > 0)) { finish(); return; }
    // Keep the grace period even when both direct children exit promptly: the
    // existing web wrapper forwards TERM but need not wait for its descendants.
    timer = setTimer(() => {
      signalChildren("SIGKILL");
      finish();
    }, graceMs);
  }
  function stop(signal = "SIGTERM") {
    shutdown(false, signal === "SIGINT" ? "SIGINT" : "SIGTERM");
  }
  function launch(args) {
    const child = spawnImpl(executable, args, {
      cwd, env: { ...env, NODE_ENV: "production" }, shell: false, stdio: "inherit", detached: true,
    });
    const record = { child, pid: child.pid };
    children.push(record);
    child.once("error", () => shutdown(true));
    child.once("exit", () => { if (!stopping) shutdown(true); });
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0) shutdown(true);
  }
  return {
    run() {
      if (promise) return promise;
      promise = new Promise(resolve => { resolveRun = resolve; });
      if (finished || stopping) { finish(); resolveRun(resultCode); return promise; }
      if (platform !== "linux" || env.OFFICE_WORKER_ENABLED !== "true" || env.OFFICE_HOSTING_MODE !== "reserved-vm") {
        resultCode = 1; finish(); return promise;
      }
      signals.once("SIGTERM", onTerm);
      signals.once("SIGINT", onInt);
      try {
        launch(["script/replit-fast-start.mjs"]);
        if (!stopping) launch(["dist/office-worker.cjs"]);
      } catch { shutdown(true); }
      return promise;
    },
    stop,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void createOfficeCloudLauncher().run().then(code => {
    if (code !== 0) console.error("Office cloud supervisor stopped: hosting configuration or a child process is unavailable.");
    process.exitCode = code;
  }).catch(() => {
    console.error("Office cloud supervisor could not start safely.");
    process.exitCode = 1;
  });
}
