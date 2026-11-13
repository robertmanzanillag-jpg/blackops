#!/usr/bin/env node
// Post-publish watch: turns read-only observations into a short list of regression CODES.
// Pure function + tiny CLI. Inputs are files written by the workflow:
//   --status <office-status.json>   one JSON line from script/office-status.ts (may be missing/invalid)
//   --runs   <runs.json>            GitHub API "workflow runs" for office-worker-cloud.yml
// Env: OFFICE_CLOUD_ENABLED=true|false, WEB_SOURCES_ENABLED=true|false, NOW (ISO, tests only)
// Output: JSON {codes:[{code, detail}], ok} on stdout. Only fixed codes, counts, ages and the
// fixed web-source role names ever appear (the inputs are already public-log safe).

const HOUR = 3600;

export function evaluate({ status, runs, officeCloudEnabled, webSourcesEnabled, now = Date.now() }) {
  const codes = [];
  const add = (code, detail) => codes.push({ code, detail });

  // 1. Office cloud workflow: three or more consecutive failed runs (newest first).
  const completed = (Array.isArray(runs) ? runs : [])
    .filter((run) => run && run.status === "completed" && !["cancelled", "skipped", "neutral"].includes(run.conclusion))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let streak = 0;
  for (const run of completed) { if (run.conclusion === "success") break; streak += 1; }
  if (officeCloudEnabled && streak >= 3) add("OFFICE_RUNS_FAILING", `${streak} ejecuciones seguidas del worker de oficina fallaron`);

  // 2. Office state (read-only diagnostic).
  if (!status || typeof status !== "object" || status.readOnly !== true) {
    add("OFFICE_STATUS_UNAVAILABLE", "el diagnostico de solo lectura no respondio");
    return { ok: codes.length === 0, codes };
  }
  // office-status only reports councilStateFound when the table exists; a missing table is worse.
  if (status.tables?.agent_council_state === false) add("COUNCIL_STATE_MISSING", "no existe la tabla del estado del consejo");
  else if (status.councilStateFound === false) add("COUNCIL_STATE_MISSING", "no existe el estado del consejo para el propietario");
  if (status.roleWork?.present && status.roleWork.valid === false) add("ROLE_WORK_INVALID", "el diario roleWork no pasa la validacion");
  if (status.capabilityTraining?.present && status.capabilityTraining.valid === false) add("CAPABILITY_TRAINING_INVALID", "el diario de entrenamiento no pasa la validacion");

  if (officeCloudEnabled) {
    const cloud = (Array.isArray(status.workers) ? status.workers : [])
      .filter((worker) => worker?.kind === "cloud" && worker.lastSeenAt)
      .map((worker) => Date.parse(worker.lastSeenAt))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    const age = cloud ? Math.round((now - cloud) / 1000) : null;
    if (age === null || age > HOUR) add("OFFICE_WORKER_SILENT", age === null ? "ningun worker de nube visto en 3 dias" : `ultimo worker de nube hace ${Math.round(age / 60)} min`);
  }

  if (webSourcesEnabled) {
    const sources = status.webSources && typeof status.webSources === "object" ? status.webSources : {};
    const missing = Object.entries(sources).filter(([, value]) => !value?.stored).map(([role]) => role);
    const stale = Object.entries(sources).filter(([, value]) => value?.stored && (value.ageSeconds === null || value.ageSeconds > HOUR));
    if (!Object.keys(sources).length || missing.length) add("WEB_EXPORT_MISSING", `sin export de la web para: ${missing.join(", ") || "todos los roles"}`);
    if (stale.length) {
      const worst = Math.max(...stale.map(([, value]) => value.ageSeconds ?? Infinity));
      add("WEB_EXPORT_STALE", `${stale.length} rol(es) con export de la web de mas de 1 h (peor: ${Number.isFinite(worst) ? `${Math.round(worst / 60)} min` : "sin fecha"})`);
    }
  }
  return { ok: codes.length === 0, codes };
}

if (process.argv[1] && /post-publish-evaluate\.mjs$/.test(process.argv[1])) {
  const { readFileSync } = await import("node:fs");
  const args = process.argv.slice(2);
  const read = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    try {
      const text = readFileSync(args[index + 1], "utf8").trim();
      return text ? JSON.parse(text.split("\n").filter(Boolean).at(-1)) : undefined;
    } catch { return undefined; }
  };
  const runsFile = read("--runs");
  const result = evaluate({
    status: read("--status"),
    runs: runsFile?.workflow_runs ?? runsFile,
    officeCloudEnabled: process.env.OFFICE_CLOUD_ENABLED === "true",
    webSourcesEnabled: process.env.WEB_SOURCES_ENABLED === "true",
    now: process.env.NOW ? Date.parse(process.env.NOW) : Date.now(),
  });
  console.log(JSON.stringify(result));
}
