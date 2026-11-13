#!/usr/bin/env node
// Release gate: "diff hygiene" for the change between --base <rev> and HEAD.
// Prints only file paths, line numbers and rule names, NEVER the matched text, because CI logs of
// this public repository are public.
//
// Hard failures (no label can override):
//   - secrets-like content in added lines (private keys, provider tokens, URLs with passwords)
//   - .env files, keys/certificates, credentials/, secrets/, node_modules/, macOS "._*" files
//   - merge-conflict markers, test.only/describe.only, files that grow past 2 MB
//   - any change to .github/workflows/factory-candidate-checks.yml (its SHA is pinned by the
//     factory operator configuration)
// Needs the PR label `gate-justified` (owner decision, explained in the PR body):
//   - changes to .replit, replit.nix, package.json, package-lock.json
//   - modifying or deleting existing release-gate files (script/release-gate/**, sandbox-gate.yml,
//     .github/CODEOWNERS)
//   - NEW or CHANGED entries in script/release-gate/known-failures.json (flaky, statuses, reason,
//     timeouts, added failing names...). Removing an entry or removing names from its "failing"
//     list (a test was fixed) never needs it.
//
// Usage: node script/release-gate/diff-hygiene.mjs --base <rev>
// Env:   GATE_PR_LABELS="a,b"; GATE_REQUIRE_LABELS=false outside pull requests
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const base = args[args.indexOf("--base") + 1];
if (!base || args.indexOf("--base") < 0) throw new Error("--base <rev> is required");
const labels = new Set((process.env.GATE_PR_LABELS || "").split(",").map((label) => label.trim()).filter(Boolean));
// Labels exist only on pull requests. On a push to the production branch (already gated as a PR)
// or a manual run, label-gated changes are reported as notices; hard failures still fail.
const LABELS_ENFORCED = process.env.GATE_REQUIRE_LABELS !== "false";
const JUSTIFIED = labels.has("gate-justified") || !LABELS_ENFORCED;
const git = (...gitArgs) => execFileSync("git", gitArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

const changes = git("diff", "--name-status", "--no-renames", base, "HEAD").split("\n").filter(Boolean).map((line) => {
  const [status, ...rest] = line.split("\t");
  return { status: status[0], file: rest.join("\t") };
});

const errors = [];
const needsLabel = [];
const fail = (file, rule, line) => errors.push({ file, rule, line });

const FORBIDDEN_PATH = [
  [/(^|\/)\.env(\.[^/]*)?$/, "env file"],
  [/\.(pem|key|p12|pfx|keystore|jks)$/i, "key or certificate file"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, "ssh key"],
  [/^(credentials|secrets)\//, "credentials/secrets directory"],
  [/(^|\/)node_modules\//, "node_modules"],
  [/(^|\/)\._[^/]+$/, "macOS AppleDouble metadata file"],
];
const ALLOWED_ENV_EXAMPLES = /(^|\/)\.env\.(example|sample|template)$/;
const LABEL_PATHS = [/^\.replit$/, /^replit\.nix$/, /^package\.json$/, /^package-lock\.json$/];
const GATE_PATHS = [/^script\/release-gate\//, /^\.github\/workflows\/sandbox-gate\.yml$/, /^\.github\/CODEOWNERS$/];
const PINNED = ".github/workflows/factory-candidate-checks.yml";

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "GitHub fine-grained token"],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/, "provider API key (sk-...)"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/, "Stripe live key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, "Telegram bot token"],
  [/\bnpm_[A-Za-z0-9]{36}\b/, "npm token"],
  // A connection URL with an inline password that is not an obvious local/dummy sandbox value.
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/'"]+:(?!\$\{|<|password@|pass@|postgres@|sandbox)[^\s@/'"]{6,}@(?!localhost|127\.0\.0\.1|postgres[:/]|db[:/])[^\s'"]+/i, "database URL with inline password"],
];

for (const { status, file } of changes) {
  if (file === PINNED) fail(file, "pinned workflow must not change (factory operator config pins its SHA)");
  if (status !== "D") {
    for (const [pattern, rule] of FORBIDDEN_PATH) if (pattern.test(file) && !ALLOWED_ENV_EXAMPLES.test(file)) fail(file, rule);
  }
  if (LABEL_PATHS.some((pattern) => pattern.test(file))) needsLabel.push({ file, rule: "protected runtime/dependency file" });
  if (GATE_PATHS.some((pattern) => pattern.test(file)) && status !== "A" && file !== "script/release-gate/known-failures.json") {
    needsLabel.push({ file, rule: "release-gate machinery changed" });
  }
  if (status !== "D") {
    const size = Number(git("cat-file", "-s", `HEAD:${file}`).trim());
    // Only a change that makes a file cross the limit fails: an already-large file that is
    // edited or carried over by a merge was accepted before and is not new weight.
    const LIMIT = 2 * 1024 * 1024;
    let baseSize = 0;
    if (status !== "A") { try { baseSize = Number(git("cat-file", "-s", `${base}:${file}`).trim()); } catch { baseSize = 0; } }
    if (size > LIMIT && !(baseSize > LIMIT)) fail(file, `${status === "A" ? "added" : "changed"} file larger than 2 MB (${Math.round(size / 1024)} KB)`);
  }
}

// Added lines only (no context), per file, with new-file line numbers.
const diff = git("diff", "--unified=0", "--no-color", "--no-renames", base, "HEAD");
let current = "";
let lineNo = 0;
let binary = false;
for (const raw of diff.split("\n")) {
  if (raw.startsWith("diff --git ")) { current = ""; binary = false; continue; }
  if (raw.startsWith("+++ ")) { current = raw.startsWith("+++ b/") ? raw.slice(6) : ""; continue; }
  if (raw.startsWith("Binary files")) { binary = true; continue; }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
  if (hunk) { lineNo = Number(hunk[1]); continue; }
  if (!current || binary || !raw.startsWith("+") || raw.startsWith("+++")) continue;
  const text = raw.slice(1);
  for (const [pattern, rule] of SECRET_PATTERNS) if (pattern.test(text)) fail(current, `possible secret: ${rule}`, lineNo);
  if (/^(<{7}|>{7}) /.test(text) || /^={7}$/.test(text)) fail(current, "merge conflict marker", lineNo);
  if (/^tests\//.test(current) && /\b(test|it|describe)\.only\s*\(/.test(text)) fail(current, ".only() would silently skip the rest of the suite", lineNo);
  lineNo += 1;
}

// The allowlist may shrink freely; growing it is an owner decision.
const readAllowlist = (rev) => {
  try { return JSON.parse(git("show", `${rev}:script/release-gate/known-failures.json`)); } catch { return null; }
};
const before = readAllowlist(base);
const after = readAllowlist("HEAD");
if (after) {
  for (const section of ["knownFailures", "sandboxIntegrationRoutes"]) {
    for (const [key, entry] of Object.entries(after[section] || {})) {
      if (!entry || typeof entry.reason !== "string" || entry.reason.trim().length < 10) fail("script/release-gate/known-failures.json", `${section}["${key}"] needs a real reason`);
      if (!before) continue;
      const previous = (before[section] || {})[key];
      if (previous === undefined) { needsLabel.push({ file: "script/release-gate/known-failures.json", rule: `new allowlist entry ${section}["${key}"]` }); continue; }
      if (JSON.stringify(previous) === JSON.stringify(entry)) continue;
      // The only change that never needs a label: removing names from "failing" (a test was fixed).
      const { failing: oldFailing, ...oldRest } = previous || {};
      const { failing: newFailing, ...newRest } = entry || {};
      const shrinkOnly = JSON.stringify(oldRest) === JSON.stringify(newRest) && Array.isArray(oldFailing) && Array.isArray(newFailing)
        && newFailing.every((name) => oldFailing.includes(name));
      if (!shrinkOnly) needsLabel.push({ file: "script/release-gate/known-failures.json", rule: `changed allowlist entry ${section}["${key}"]` });
    }
  }
}

for (const error of errors) console.log(`::error file=${error.file}${error.line ? `,line=${error.line}` : ""}::diff hygiene: ${error.rule}`);
for (const item of needsLabel) {
  const level = JUSTIFIED ? "notice" : "error";
  console.log(`::${level} file=${item.file}::diff hygiene: ${item.rule} ${JUSTIFIED ? (LABELS_ENFORCED ? "(justified by label gate-justified)" : "(not a pull request: enforced on the PR)") : "requires the PR label gate-justified and a justification in the PR body"}`);
}
const blocking = errors.length + (JUSTIFIED ? 0 : needsLabel.length);
console.log(`diff hygiene: ${changes.length} changed files, ${errors.length} hard failures, ${needsLabel.length} label-gated changes (${JUSTIFIED ? "label present" : "no label"})`);
process.exitCode = blocking ? 1 : 0;
