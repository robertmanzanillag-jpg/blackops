import { spawnSync } from "node:child_process";

const steps = [
  ["check", ["run", "check"]],
  ["test:ceo-assistant", ["run", "test:ceo-assistant"]],
  ["build", ["run", "build"]],
  ["ceo:handoff", ["run", "ceo:handoff"]],
  [
    "ceo:go-live runtime-flag gate",
    [
      "run",
      "ceo:go-live",
      "--",
      "--user-id=user-1",
      "--chat-id=123",
      "--smoke-ready",
      "--backup-executed",
      "--restore-verified",
      "--brief-verified",
      "--telegram-commands-verified",
      "--conversation-history-verified",
      "--json",
    ],
  ],
];

for (const [label, args] of steps) {
  console.error(`\n[ceo:verify-local] ${label}`);
  const result = spawnSync("npm", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`[ceo:verify-local] Failed to start ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[ceo:verify-local] ${label} failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
}

console.error("\n[ceo:verify-local] Local CEO Assistant verification passed.");
