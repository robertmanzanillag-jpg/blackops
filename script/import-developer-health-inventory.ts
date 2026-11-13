import "../server/env-loader";
import { resolveDatabaseConnectionString } from "../server/database-url";
import { hasRealValue } from "../server/ceo-doctor-cli";
import { knownDeveloperHealthApps, upsertKnownDeveloperHealthInventory } from "../server/developer-health-inventory";
import { getSystemUserId } from "../server/user-context";

function readArg(name: string, argv = process.argv): string | undefined {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`${name} requires a value.`);
    }
    return value;
  }
  return undefined;
}

export function resolveDeveloperHealthInventoryUserId(env: NodeJS.ProcessEnv = process.env, argv = process.argv): string {
  const explicitUserId = readArg("--user-id", argv);
  if (explicitUserId) {
    if (!hasRealValue(explicitUserId)) {
      throw new Error("--user-id must be a real user id, not a placeholder.");
    }
    return explicitUserId;
  }

  const realUserId = env.REAL_USER_ID;
  if (realUserId && hasRealValue(realUserId)) return realUserId;

  const defaultUserId = env.DEFAULT_USER_ID;
  if (defaultUserId) {
    if (!hasRealValue(defaultUserId)) {
      throw new Error("DEFAULT_USER_ID must be a real user id, not a placeholder.");
    }
    return defaultUserId;
  }

  return getSystemUserId();
}

async function main() {
  const execute = process.argv.includes("--execute");
  const userId = resolveDeveloperHealthInventoryUserId();
  const knownApps = knownDeveloperHealthApps();

  if (!execute) {
    console.log(JSON.stringify({
      status: "dry_run",
      userId,
      totalKnownApps: knownApps.length,
      apps: knownApps.map((app) => ({
        name: app.name,
        githubRepo: app.githubRepo,
        publicUrl: app.publicUrl,
        healthUrl: app.healthUrl,
        deploymentProvider: app.deploymentProvider,
        priority: app.priority,
        tags: app.tags,
      })),
      nextCommand: `npm run developer-health:import-known -- --user-id="${userId}" --execute`,
    }, null, 2));
    return;
  }

  if (!resolveDatabaseConnectionString()) {
    throw new Error("DATABASE_URL is required before importing Developer Health inventory.");
  }

  const result = await upsertKnownDeveloperHealthInventory(userId);
  console.log(JSON.stringify({
    status: "imported",
    userId,
    totalKnownApps: result.totalKnownApps,
    created: result.created.map((app) => ({ name: app.name, githubRepo: app.githubRepo })),
    updated: result.updated.map((app) => ({ name: app.name, githubRepo: app.githubRepo })),
    unchanged: result.unchanged.map((app) => ({ name: app.name, githubRepo: app.githubRepo })),
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
