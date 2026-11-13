// Resolves the non-secret workflow configuration for one run and writes it to $GITHUB_OUTPUT.
// No dependencies; runs on the runner's preinstalled Node before any npm install.
//
// Inputs (environment):
//   VARS_JSON              ${{ toJSON(vars) }} - repository variables (non-secret)
//   SECRET_<NAME>          'true' | 'false'    - presence of a secret, never its value
//   GROUP_<name>           "<flag> <SECRET names...>" - a job group; <flag> is KEY (must be 'true'),
//                          KEY!=false (anything but 'false') or '-' (no flag)
// Outputs:
//   env                    KEY=VALUE lines for $GITHUB_ENV (every key of office-config.env)
//   <KEY>                  each resolved value
//   ready_<name>           'true' when the group's flag allows it and all its secrets exist
//
// Precedence: a non-empty repository variable wins over .github/office-config.env.
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = /^[A-Z][A-Z0-9_]{0,99}$/;
// Conservative value charset: refs, model names, numbers, booleans, https origins, hex revisions.
const VALUE = /^[A-Za-z0-9._:/@+-]{0,200}$/;
const FORBIDDEN = /^(PATH|NODE_OPTIONS|LD_|GITHUB_|RUNNER_|ACTIONS_|BASH_ENV|ENV$|HOME$)/;

const fail = (message) => { console.error(`::error::${message}`); process.exit(1); };
const file = join(dirname(fileURLToPath(import.meta.url)), "office-config.env");
const defaults = new Map();
for (const [index, raw] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const at = line.indexOf("=");
  const key = at > 0 ? line.slice(0, at) : "";
  const value = at > 0 ? line.slice(at + 1) : "";
  if (!KEY.test(key) || FORBIDDEN.test(key)) fail(`office-config.env line ${index + 1}: invalid key`);
  if (!VALUE.test(value)) fail(`office-config.env ${key}: invalid value`);
  if (defaults.has(key)) fail(`office-config.env ${key}: duplicated`);
  defaults.set(key, value);
}

let vars = {};
try { vars = JSON.parse(process.env.VARS_JSON || "{}") || {}; } catch { fail("VARS_JSON is not JSON"); }

const resolved = new Map();
for (const [key, fallback] of defaults) {
  const fromVar = typeof vars[key] === "string" ? vars[key].trim() : "";
  if (fromVar && !VALUE.test(fromVar)) fail(`repository variable ${key}: invalid value`);
  resolved.set(key, fromVar || fallback);
}

const outputs = [];
const delimiter = `EOF_${randomBytes(12).toString("hex")}`;
outputs.push(`env<<${delimiter}`, ...[...resolved].map(([k, v]) => `${k}=${v}`), delimiter);
for (const [k, v] of resolved) outputs.push(`${k}=${v}`);

for (const [name, spec] of Object.entries(process.env)) {
  if (!name.startsWith("GROUP_")) continue;
  const group = name.slice(6).toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(group)) fail(`invalid group ${group}`);
  const [flag, ...secrets] = spec.trim().split(/\s+/);
  let enabled = true;
  if (flag !== "-") {
    const negated = flag.endsWith("!=false");
    const flagKey = negated ? flag.slice(0, -7) : flag;
    if (!resolved.has(flagKey)) fail(`group ${group}: unknown flag ${flagKey}`);
    enabled = negated ? resolved.get(flagKey) !== "false" : resolved.get(flagKey) === "true";
    if (!enabled) console.log(`${group}: paused (${flagKey}=${resolved.get(flagKey) || "<empty>"})`);
  }
  const missing = secrets.filter((s) => process.env[`SECRET_${s}`] !== "true");
  if (enabled && missing.length) {
    // Names only, never values. Not an error: the job is simply skipped until the owner adds them.
    console.log(`::notice title=${group} skipped::missing repository secrets: ${missing.join(", ")}`);
  }
  const ready = enabled && missing.length === 0;
  if (ready) console.log(`${group}: ready`);
  outputs.push(`ready_${group}=${ready}`);
}

if (!process.env.GITHUB_OUTPUT) { console.log(outputs.join("\n")); process.exit(0); }
appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
