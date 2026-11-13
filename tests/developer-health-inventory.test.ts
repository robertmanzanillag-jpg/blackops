import assert from "node:assert/strict";
import test from "node:test";
import type { AppProject, InsertAppProject } from "@shared/schema";
import { knownDeveloperHealthApps, upsertKnownDeveloperHealthInventory } from "../server/developer-health-inventory";
import { resolveDeveloperHealthInventoryUserId } from "../script/import-developer-health-inventory";

function appProject(input: InsertAppProject, overrides: Partial<AppProject> = {}): AppProject {
  return {
    id: overrides.id || `app-${input.slug}`,
    userId: overrides.userId || "user-1",
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    environment: input.environment || "production",
    publicUrl: input.publicUrl || null,
    healthUrl: input.healthUrl || null,
    repoOwner: input.repoOwner || null,
    repoName: input.repoName || null,
    githubRepo: input.githubRepo || null,
    deploymentProvider: input.deploymentProvider || null,
    deploymentId: input.deploymentId || null,
    testCommand: input.testCommand || null,
    buildCommand: input.buildCommand || null,
    sentryProjectId: input.sentryProjectId || null,
    stripeAccountId: input.stripeAccountId || null,
    stripeWebhookEndpointId: input.stripeWebhookEndpointId || null,
    logSource: input.logSource || null,
    status: "unknown",
    priority: input.priority || "normal",
    ownerLabel: input.ownerLabel || null,
    tags: input.tags || null,
    lastSeenAt: null,
    createdAt: new Date("2026-06-20T00:00:00.000Z"),
    updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    ...overrides,
  };
}

test("known Developer Health inventory includes the four tracked app repos", () => {
  const repos = knownDeveloperHealthApps().map((app) => app.githubRepo).sort();

  assert.deepEqual(repos, [
    "robertmanzanillag-jpg/DROPKIT",
    "robertmanzanillag-jpg/blackops",
    "robertmanzanillag-jpg/br-website",
    "robertmanzanillag-jpg/kong-nightlife",
  ]);
  assert.deepEqual(
    knownDeveloperHealthApps().every((app) => app.publicUrl && app.deploymentProvider),
    true,
  );
});

test("BlackOps Reminder carries the Dialer Planner alternate Replit alias", () => {
  const blackops = knownDeveloperHealthApps().find((app) => app.githubRepo === "robertmanzanillag-jpg/blackops")!;

  assert.match(blackops.description || "", /Dialer Planner/);
  assert.equal(blackops.publicUrl, "https://robertwebsites.com");
  assert.equal(blackops.healthUrl, "https://robertwebsites.com/api/health");
  assert.equal(blackops.deploymentProvider, "replit");
  assert.match(blackops.testCommand || "", /test:revenue-engine/);
  assert.equal(blackops.buildCommand, "npm run build");
  assert.deepEqual((blackops.tags as string[]).includes("alias-dialer-planner"), true);
  assert.deepEqual((blackops.tags as string[]).includes("private-replit-deployment"), true);
  assert.deepEqual((blackops.tags as string[]).includes("liveness-health-endpoint"), true);
});

test("Br Website carries the verified Black Room public URL", () => {
  const brWebsite = knownDeveloperHealthApps().find((app) => app.githubRepo === "robertmanzanillag-jpg/br-website")!;

  assert.equal(brWebsite.publicUrl, "https://blackroomus.com");
  assert.equal(brWebsite.deploymentProvider, "custom-domain");
  assert.equal(brWebsite.healthUrl, "https://blackroomus.com/admin/tokens/health");
  assert.equal(brWebsite.testCommand, null);
  assert.equal(brWebsite.buildCommand, null);
  assert.deepEqual((brWebsite.tags as string[]).includes("verified-public-url"), true);
  assert.deepEqual((brWebsite.tags as string[]).includes("subsystem-health-endpoint"), true);
});

test("DropKit carries the verified Replit public URL", () => {
  const dropkit = knownDeveloperHealthApps().find((app) => app.githubRepo === "robertmanzanillag-jpg/DROPKIT")!;

  assert.equal(dropkit.publicUrl, "https://dropkit.replit.app");
  assert.equal(dropkit.deploymentProvider, "replit");
  assert.equal(dropkit.testCommand, "npm run check:types && npm run lint");
  assert.equal(dropkit.healthUrl, null);
  assert.equal(dropkit.buildCommand, "export NODE_OPTIONS='--max-old-space-size=4096' && EXPO_PUBLIC_DOMAIN=$REPLIT_INTERNAL_APP_DOMAIN npx expo export --platform web --output-dir static-build/web --no-bytecode --clear && EXPO_PUBLIC_DOMAIN=$REPLIT_INTERNAL_APP_DOMAIN npm run expo:static:build && npm run server:build");
  assert.deepEqual((dropkit.tags as string[]).includes("verified-public-url"), true);
  assert.deepEqual((dropkit.tags as string[]).includes("needs-health-url"), true);
});

test("KONG defaults use verified readiness, local route checks and complete deployment build", () => {
  const kong = knownDeveloperHealthApps().find(app => app.slug === "kong-nightlife")!;
  assert.equal(kong.healthUrl, "https://kongnightlife.com/api/ready");
  assert.equal(kong.testCommand, "npm run check:routes && npm run test:genre-classifier");
  assert.equal(kong.buildCommand, "npm run server:build && npm run worker:build && WEB_DEPLOY_ONLY=true node scripts/build.js && node scripts/write-deploy-info.js");
});

test("command migration repairs only exact retired defaults and preserves custom commands and valid health URLs", async () => {
  for (const mode of ["legacy", "original-legacy", "custom", "empty"] as const) {
    const known = knownDeveloperHealthApps();
    const rows = known.map(app => appProject(app, {
      testCommand: mode.endsWith("legacy") ? "npm run check" : mode === "custom" ? "node custom-check.mjs" : null,
      buildCommand: mode.endsWith("legacy") ? app.slug === "kong-nightlife" ? `EXPO_PUBLIC_DOMAIN=${mode === "original-legacy" ? "kong--app.replit.app" : "kongnightlife.com"} npm run expo:static:build` : "npm run build" : mode === "custom" ? "node custom-build.mjs" : null,
      ...(app.slug === "kong-nightlife" ? { healthUrl: "https://kongnightlife.com/api/health" } : {}),
    }));
    const deps = { getAppProjects: async () => rows,
      createAppProject: async () => { throw new Error("unexpected creation"); },
      updateAppProject: async (id: string, updates: Partial<AppProject>) => { const i = rows.findIndex(row => row.id === id); rows[i] = { ...rows[i], ...updates }; return rows[i]; },
    };
    await upsertKnownDeveloperHealthInventory("user-1", deps);
    for (const app of known.filter(app => app.slug !== "blackops-reminder")) {
      const row = rows.find(r => r.slug === app.slug)!;
      assert.equal(row.testCommand, mode === "custom" ? "node custom-check.mjs" : app.testCommand);
      assert.equal(row.buildCommand, mode === "custom" ? "node custom-build.mjs" : app.buildCommand);
    }
    assert.equal(rows.find(r => r.slug === "kong-nightlife")!.healthUrl, "https://kongnightlife.com/api/health", "valid existing liveness endpoint is preserved");
    assert.equal((await upsertKnownDeveloperHealthInventory("user-1", deps)).updated.length, 0);
  }
});

test("upsertKnownDeveloperHealthInventory creates missing apps and is idempotent", async () => {
  const rows: AppProject[] = [];
  const deps = {
    getAppProjects: async () => rows,
    createAppProject: async (userId: string, project: InsertAppProject) => {
      const created = appProject(project, { id: `created-${rows.length}`, userId });
      rows.push(created);
      return created;
    },
    updateAppProject: async (id: string, updates: Partial<AppProject>) => {
      const index = rows.findIndex((row) => row.id === id);
      assert.notEqual(index, -1);
      rows[index] = { ...rows[index], ...updates, updatedAt: new Date("2026-06-20T01:00:00.000Z") };
      return rows[index];
    },
  };

  const first = await upsertKnownDeveloperHealthInventory("user-1", deps);
  assert.equal(first.created.length, 4);
  assert.equal(first.updated.length, 0);

  const second = await upsertKnownDeveloperHealthInventory("user-1", deps);
  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 0);
  assert.equal(second.unchanged.length, 4);
});

test("upsertKnownDeveloperHealthInventory adds verified fields without erasing existing URLs", async () => {
  const known = knownDeveloperHealthApps();
  const brWebsite = known.find((app) => app.githubRepo === "robertmanzanillag-jpg/br-website")!;
  const kong = known.find((app) => app.githubRepo === "robertmanzanillag-jpg/kong-nightlife")!;
  const rows: AppProject[] = [
    appProject(brWebsite, {
      id: "br-existing",
      publicUrl: "https://blackroom.example",
      healthUrl: "https://blackroom.example/health",
      deploymentProvider: "custom-domain",
      tags: ["manual", "needs-public-url", "needs-deploy-provider"],
    }),
    appProject(kong, {
      id: "kong-existing",
      publicUrl: null,
      healthUrl: null,
      deploymentProvider: null,
      tags: ["manual"],
    }),
  ];
  const deps = {
    getAppProjects: async () => rows,
    createAppProject: async (userId: string, project: InsertAppProject) => {
      const created = appProject(project, { id: `created-${rows.length}`, userId });
      rows.push(created);
      return created;
    },
    updateAppProject: async (id: string, updates: Partial<AppProject>) => {
      const index = rows.findIndex((row) => row.id === id);
      assert.notEqual(index, -1);
      rows[index] = { ...rows[index], ...updates, updatedAt: new Date("2026-06-20T01:00:00.000Z") };
      return rows[index];
    },
  };

  const result = await upsertKnownDeveloperHealthInventory("user-1", deps);
  const updatedBr = rows.find((row) => row.id === "br-existing")!;
  const updatedKong = rows.find((row) => row.id === "kong-existing")!;

  assert.equal(result.created.length, 2);
  assert.equal(updatedBr.publicUrl, "https://blackroom.example");
  assert.equal(updatedBr.healthUrl, "https://blackroom.example/health");
  assert.equal(updatedBr.deploymentProvider, "custom-domain");
  assert.deepEqual((updatedBr.tags as string[]).includes("manual"), true);
  assert.deepEqual((updatedBr.tags as string[]).includes("needs-public-url"), false);
  assert.deepEqual((updatedBr.tags as string[]).includes("needs-deploy-provider"), false);
  assert.deepEqual((updatedBr.tags as string[]).includes("verified-public-url"), true);
  assert.equal(updatedKong.publicUrl, "https://kongnightlife.com");
  assert.equal(updatedKong.healthUrl, "https://kongnightlife.com/api/ready");
  assert.equal(updatedKong.deploymentProvider, "replit");
});

test("upsertKnownDeveloperHealthInventory upgrades generic GitHub imported known apps", async () => {
  const known = knownDeveloperHealthApps();
  const blackops = known.find((app) => app.githubRepo === "robertmanzanillag-jpg/blackops")!;
  const rows: AppProject[] = [
    appProject(blackops, {
      id: "blackops-imported",
      publicUrl: "https://robplanner.replit.app",
      healthUrl: null,
      deploymentProvider: "github-homepage",
      testCommand: null,
      buildCommand: null,
      tags: ["github-import", "needs-health-url", "needs-test-command", "needs-build-command"],
    }),
  ];
  const deps = {
    getAppProjects: async () => rows,
    createAppProject: async (userId: string, project: InsertAppProject) => {
      const created = appProject(project, { id: `created-${rows.length}`, userId });
      rows.push(created);
      return created;
    },
    updateAppProject: async (id: string, updates: Partial<AppProject>) => {
      const index = rows.findIndex((row) => row.id === id);
      assert.notEqual(index, -1);
      rows[index] = { ...rows[index], ...updates, updatedAt: new Date("2026-06-20T01:00:00.000Z") };
      return rows[index];
    },
  };

  const result = await upsertKnownDeveloperHealthInventory("user-1", deps);
  const upgraded = rows.find((row) => row.id === "blackops-imported")!;

  assert.equal(result.updated.length, 1);
  assert.equal(upgraded.deploymentProvider, "replit");
  assert.equal(upgraded.publicUrl, "https://robertwebsites.com");
  assert.equal(upgraded.healthUrl, "https://robertwebsites.com/api/health");
  assert.match(upgraded.testCommand || "", /test:revenue-engine/);
  assert.equal(upgraded.buildCommand, "npm run build");
  assert.deepEqual((upgraded.tags as string[]).includes("github-import"), true);
  assert.deepEqual((upgraded.tags as string[]).includes("needs-health-url"), false);
  assert.deepEqual((upgraded.tags as string[]).includes("needs-test-command"), false);
  assert.deepEqual((upgraded.tags as string[]).includes("needs-build-command"), false);
});

test("Developer Health inventory CLI rejects placeholder user ids", () => {
  assert.throws(
    () => resolveDeveloperHealthInventoryUserId(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "production-session-secret",
        DEFAULT_USER_ID: "replace-after-auth-create-user",
      } as NodeJS.ProcessEnv,
      ["node", "script/import-developer-health-inventory.ts"],
    ),
    /DEFAULT_USER_ID is required|placeholder/,
  );

  assert.throws(
    () => resolveDeveloperHealthInventoryUserId(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "production-session-secret",
        DEFAULT_USER_ID: "real-user-id",
      } as NodeJS.ProcessEnv,
      ["node", "script/import-developer-health-inventory.ts", "--user-id=replace-with-user-id"],
    ),
    /--user-id must be a real user id/,
  );

  assert.throws(
    () => resolveDeveloperHealthInventoryUserId(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "production-session-secret",
        DEFAULT_USER_ID: "real-user-id",
      } as NodeJS.ProcessEnv,
      ["node", "script/import-developer-health-inventory.ts", "--user-id", "--execute"],
    ),
    /--user-id requires a value/,
  );

  assert.equal(
    resolveDeveloperHealthInventoryUserId(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "production-session-secret",
        DEFAULT_USER_ID: "real-user-id",
      } as NodeJS.ProcessEnv,
      ["node", "script/import-developer-health-inventory.ts"],
    ),
    "real-user-id",
  );
});

test("only exact retired KONG destinations migrate; custom near-matches remain", async () => {
  const known = knownDeveloperHealthApps();
  for (const oldUrl of ["https://kong--app.replit.app", "https://kong--app.replit.app/custom"]) {
    const rows = known.map(app => appProject(app, app.slug === "kong-nightlife" ? { publicUrl: oldUrl, healthUrl: `${oldUrl}/api/health` } : {}));
    await upsertKnownDeveloperHealthInventory("user-1", {
      getAppProjects: async () => rows,
      createAppProject: async () => { throw new Error("unexpected creation"); },
      updateAppProject: async (id, updates) => {
        const index = rows.findIndex(row => row.id === id); rows[index] = { ...rows[index], ...updates }; return rows[index];
      },
    });
    const kong = rows.find(row => row.slug === "kong-nightlife")!;
    const expected = oldUrl.endsWith("/custom") ? oldUrl : "https://kongnightlife.com";
    assert.equal(kong.publicUrl, expected); assert.equal(kong.healthUrl, oldUrl.endsWith("/custom") ? `${expected}/api/health` : `${expected}/api/ready`);
  }
});
