import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const STARTUP_HEALTH_PATHS = new Set(["/", "/health", "/api/health"]);
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE"]);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const STARTING_PAGE = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"2\">"
  + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>BlackOps</title></head>"
  + "<body style=\"font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee;display:grid;place-items:center;height:100vh;margin:0\">"
  + "<p>Iniciando BlackOps&hellip;</p></body></html>";

function numberOption(value, fallback) {
  const parsed = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(parsed) ? fallback : parsed;
}

function sendJson(res, status, body, extraHeaders = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  res.end(JSON.stringify(body));
}

function requestHasBody(req) {
  const length = req.headers["content-length"];
  return Boolean(req.headers["transfer-encoding"]) || (length !== undefined && Number(length) > 0);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

function runNodePreflight(entry, options) {
  if (!entry) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: options.childStdio || "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`preflight exited (${signal || code || 0})`)));
  });
}

function proxyHeaders(req, upstreamHost) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  const remoteAddress = req.socket.remoteAddress || "";
  return {
    ...req.headers,
    host: req.headers.host || upstreamHost,
    "x-forwarded-for": [forwardedFor, remoteAddress].filter(Boolean).join(", "),
    "x-forwarded-host": req.headers.host || "",
    "x-forwarded-proto": String(req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")),
  };
}

export async function startReplitFastStart(options = {}) {
  const publicHost = options.publicHost || process.env.HOST || "0.0.0.0";
  const publicPort = Number(options.publicPort ?? process.env.PORT ?? 5000);
  const upstreamHost = options.upstreamHost || "127.0.0.1";
  const upstreamPort = Number(options.upstreamPort ?? process.env.REPLIT_UPSTREAM_PORT ?? 5001);
  const childEntry = options.childEntry || process.env.REPLIT_CHILD_ENTRY || "dist/index.cjs";
  const preflightEntry = options.preflightEntry === false ? null : options.preflightEntry || process.env.REPLIT_PREFLIGHT_ENTRY || "dist/compact-local-news-state.cjs";
  const env = process.env;
  // Once ready: one probe per second, each allowed 3 s, and only N consecutive
  // failures (or the child exiting) take the application out of rotation.
  const readinessIntervalMs = numberOption(options.readinessIntervalMs ?? env.REPLIT_READINESS_INTERVAL_MS, 1_000);
  // Before the first success probe faster so cold starts are released quickly.
  const startupIntervalMs = numberOption(options.startupIntervalMs ?? env.REPLIT_STARTUP_INTERVAL_MS, Math.min(250, readinessIntervalMs));
  const readinessTimeoutMs = numberOption(options.readinessTimeoutMs ?? env.REPLIT_READINESS_TIMEOUT_MS, 3_000);
  const readinessFailureThreshold = Math.max(1, numberOption(options.readinessFailureThreshold ?? env.REPLIT_READINESS_FAILURE_THRESHOLD, 5));
  const proxyTimeoutMs = numberOption(options.proxyTimeoutMs ?? env.REPLIT_PROXY_TIMEOUT_MS, 30_000);
  // Application requests that arrive while the app is not ready wait this long
  // for readiness before receiving 503 + Retry-After (0 = answer immediately).
  const startupHoldMs = Math.max(0, numberOption(options.startupHoldMs ?? env.REPLIT_STARTUP_HOLD_MS, 15_000));
  const retryDelayMs = Math.max(0, numberOption(options.retryDelayMs, 150));
  const log = options.log || ((message) => console.log(message));
  const logError = options.logError || ((message) => console.error(message));
  const startupStartedAt = Date.now();
  let upstreamReady = false;
  let everReady = false;
  const readyWaiters = new Set();
  let stopping = false;
  let child;
  let childEnded = false;
  let readinessTimer;
  let activeProbe;
  let failedProbes = 0;

  const notReadyBody = () => ({ status: everReady ? "unavailable" : "starting" });

  const waitForReady = (req, timeoutMs) => new Promise((resolve) => {
    if (upstreamReady) return resolve(true);
    if (timeoutMs <= 0 || stopping || childEnded) return resolve(false);
    let timer;
    const done = (ready) => {
      clearTimeout(timer);
      readyWaiters.delete(done);
      req.off("close", onClose);
      resolve(ready);
    };
    const onClose = () => done(false);
    timer = setTimeout(() => done(false), timeoutMs);
    timer.unref();
    readyWaiters.add(done);
    req.once("close", onClose);
  });

  const releaseWaiters = (ready) => {
    for (const waiter of [...readyWaiters]) waiter(ready);
  };

  // Per-request failures never change global readiness: only the health probe
  // and the child process lifecycle do. A failed request gets 502/504 for that
  // request alone; idempotent requests without a body are retried once when the
  // connection failed before any response arrived.
  const forward = (req, res, attempt = 0) => {
    let responded = false;
    const upstream = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: proxyHeaders(req, `${upstreamHost}:${upstreamPort}`),
    }, (upstreamResponse) => {
      responded = true;
      if (res.destroyed) return upstreamResponse.destroy();
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
      upstreamResponse.on("aborted", () => res.destroy());
    });
    const clientGone = () => !res.writableFinished && (res.destroyed || Boolean(req.socket?.destroyed));
    const onClientClose = () => {
      if (!res.writableFinished) upstream.destroy();
    };
    res.once("close", onClientClose);
    upstream.setTimeout(proxyTimeoutMs, () => upstream.destroy(Object.assign(new Error("upstream timeout"), { code: "UPSTREAM_TIMEOUT" })));
    upstream.on("error", (error) => {
      res.off("close", onClientClose);
      // A client that went away is not an upstream failure.
      if (clientGone()) return;
      if (res.headersSent) return res.destroy();
      const oneTimePath = /^\/(api\/auth|auth|oauth|callback)(\/|$)|callback/i.test(new URL(req.url || "/", "http://replit.local").pathname);
      const retryable = attempt === 0 && !responded && !oneTimePath && RETRYABLE_METHODS.has(req.method || "GET")
        && !requestHasBody(req) && RETRYABLE_ERROR_CODES.has(error?.code);
      if (retryable) {
        const timer = setTimeout(() => {
          if (!clientGone()) forward(req, res, 1);
        }, retryDelayMs);
        timer.unref();
        return;
      }
      if (error?.code === "UPSTREAM_TIMEOUT") return sendJson(res, 504, { status: "upstream_timeout" });
      sendJson(res, 502, { status: "upstream_error" });
    });
    if (attempt === 0 && requestHasBody(req)) req.pipe(upstream);
    else upstream.end();
  };

  const proxyRequest = async (req, res) => {
    const path = new URL(req.url || "/", "http://replit.local").pathname;
    if (!upstreamReady) {
      // Before first readiness the platform must get an instant 200; once the app has been ready
      // and later fails, health paths report 503 so the platform can see the instance is unhealthy.
      if (STARTUP_HEALTH_PATHS.has(path) && everReady) {
        sendJson(res, 503, notReadyBody(), { "retry-after": "2" });
        return;
      }
      if (STARTUP_HEALTH_PATHS.has(path) && !everReady) {
        // Platform health checks must be answered instantly; a browser asking
        // for "/" gets a self-refreshing page instead of raw JSON.
        if (path === "/" && String(req.headers.accept || "").includes("text/html")) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "2" });
          res.end(STARTING_PAGE);
          return;
        }
        sendJson(res, 200, { status: "starting", uptimeMs: Date.now() - startupStartedAt });
        return;
      }
      const ready = await waitForReady(req, startupHoldMs);
      if (!ready) {
        sendJson(res, 503, notReadyBody(), { "retry-after": "2" });
        return;
      }
    }
    forward(req, res);
  };

  const server = http.createServer(proxyRequest);
  server.on("upgrade", (req, socket, head) => {
    if (!upstreamReady) return socket.destroy();
    const upstreamSocket = net.connect(upstreamPort, upstreamHost, () => {
      const headers = Object.entries(proxyHeaders(req, `${upstreamHost}:${upstreamPort}`))
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\r\n");
      upstreamSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstreamSocket.on("error", () => socket.destroy());
  });

  await listen(server, publicPort, publicHost);
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : publicPort;
  log(`[replit-fast-start] listening on ${publicHost}:${boundPort}; booting application on ${upstreamHost}:${upstreamPort}`);

  await runNodePreflight(preflightEntry, options);

  child = spawn(process.execPath, [childEntry], {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: upstreamHost,
      PORT: String(upstreamPort),
    },
    stdio: options.childStdio || "inherit",
  });

  // Schedule the next probe only after completion: slow health responses must
  // never accumulate overlapping requests or let an older result undo a new one.
  const pollReadiness = () => {
    if (stopping || childEnded) return;
    let settled = false;
    let deadline;
    const settle = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      activeProbe = undefined;
      if (stopping || childEnded) return;
      if (healthy) {
        failedProbes = 0;
        if (!upstreamReady) {
          upstreamReady = true;
          log(everReady
            ? `[replit-fast-start] application recovered on ${upstreamHost}:${upstreamPort}`
            : `[replit-fast-start] application ready on ${upstreamHost}:${upstreamPort} after ${Date.now() - startupStartedAt}ms`);
          everReady = true;
          releaseWaiters(true);
        }
      } else {
        failedProbes += 1;
        if (upstreamReady && failedProbes >= readinessFailureThreshold) {
          upstreamReady = false;
          logError(`[replit-fast-start] application unhealthy after ${failedProbes} consecutive failed health probes`);
        } else if (upstreamReady && failedProbes === 1) {
          log("[replit-fast-start] health probe failed; still serving traffic");
        }
      }
      readinessTimer = setTimeout(pollReadiness, everReady ? readinessIntervalMs : startupIntervalMs);
      readinessTimer.unref();
    };
    const request = http.get({ host: upstreamHost, port: upstreamPort, path: "/api/health" }, (response) => {
      response.on("end", () => settle(response.statusCode >= 200 && response.statusCode < 300));
      response.on("error", () => settle(false));
      response.on("aborted", () => settle(false));
      response.resume();
    });
    activeProbe = request;
    // Absolute deadline also bounds responses that send headers then hang/drip.
    deadline = setTimeout(() => {
      request.destroy();
      settle(false);
    }, readinessTimeoutMs);
    deadline.unref();
    request.on("error", () => settle(false));
    request.on("close", () => {
      // Destruction during stop/child exit must release the deadline as well.
      if (stopping || childEnded) settle(false);
    });
  };
  const stopReadiness = () => {
    upstreamReady = false;
    releaseWaiters(false);
    clearTimeout(readinessTimer);
    activeProbe?.destroy();
  };
  pollReadiness();

  child.once("exit", async (code, signal) => {
    childEnded = true;
    stopReadiness();
    if (stopping) return;
    logError(`[replit-fast-start] application exited (${signal || code || 0})`);
    await closeServer(server);
    process.exitCode = code || (signal ? 1 : 0);
  });
  child.once("error", async (error) => {
    childEnded = true;
    stopReadiness();
    if (stopping) return;
    logError(`[replit-fast-start] failed to launch application: ${error.message}`);
    await closeServer(server);
    process.exitCode = 1;
  });

  const stop = async (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    stopReadiness();
    if (child && child.exitCode == null && child.signalCode == null) child.kill(signal);
    await closeServer(server);
  };

  return {
    child,
    port: boundPort,
    server,
    stop,
    isUpstreamReady: () => upstreamReady,
    failedProbeCount: () => failedProbes,
    config: { readinessIntervalMs, startupIntervalMs, readinessTimeoutMs, readinessFailureThreshold, proxyTimeoutMs, startupHoldMs },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startReplitFastStart();
  const shutdown = async (signal) => {
    await runtime.stop(signal);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
