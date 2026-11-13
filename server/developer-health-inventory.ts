import type { AppProject, InsertAppProject } from "@shared/schema";
import { storage } from "./storage";

type DeveloperHealthInventoryDeps = {
  getAppProjects(userId: string): Promise<AppProject[]>;
  createAppProject(userId: string, project: InsertAppProject): Promise<AppProject>;
  updateAppProject(id: string, updates: Partial<AppProject>): Promise<AppProject>;
};

export type DeveloperHealthInventoryResult = {
  created: AppProject[];
  updated: AppProject[];
  unchanged: AppProject[];
  totalKnownApps: number;
};

const KNOWN_DEVELOPER_HEALTH_APPS: InsertAppProject[] = [
  {
    name: "Br Website",
    slug: "br-website",
    description: "Black Room website repo. GitHub: robertmanzanillag-jpg/br-website. Health covers the token/database subsystem; no package test or build script is defined.",
    environment: "production",
    publicUrl: "https://blackroomus.com",
    healthUrl: "https://blackroomus.com/admin/tokens/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "br-website",
    githubRepo: "robertmanzanillag-jpg/br-website",
    deploymentProvider: "custom-domain",
    deploymentId: null,
    testCommand: null,
    buildCommand: null,
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "verified-public-url", "subsystem-health-endpoint", "no-package-test-script", "no-build-step"],
  },
  {
    name: "Blackops Reminder",
    slug: "blackops-reminder",
    description: "BlackOps Reminder full-stack TypeScript PWA, also referred to as Dialer Planner when running from its alternate Replit deployment. GitHub: robertmanzanillag-jpg/blackops.",
    environment: "production",
    publicUrl: "https://robertwebsites.com",
    healthUrl: "https://robertwebsites.com/api/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "blackops",
    githubRepo: "robertmanzanillag-jpg/blackops",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run test:ceo-assistant && npm run test:revenue-engine && npm run test:developer-autopilot && npm run test:app-qa-agent",
    buildCommand: "npm run build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "alias-dialer-planner", "private-replit-deployment", "liveness-health-endpoint"],
  },
  {
    name: "DROPKIT",
    slug: "dropkit",
    description: "Dropkit app repo. GitHub: robertmanzanillag-jpg/DROPKIT. Validation uses TypeScript and lint; no unit-test script or health endpoint is verified.",
    environment: "production",
    publicUrl: "https://dropkit.replit.app",
    healthUrl: null,
    repoOwner: "robertmanzanillag-jpg",
    repoName: "DROPKIT",
    githubRepo: "robertmanzanillag-jpg/DROPKIT",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run check:types && npm run lint",
    buildCommand: "export NODE_OPTIONS='--max-old-space-size=4096' && EXPO_PUBLIC_DOMAIN=$REPLIT_INTERNAL_APP_DOMAIN npx expo export --platform web --output-dir static-build/web --no-bytecode --clear && EXPO_PUBLIC_DOMAIN=$REPLIT_INTERNAL_APP_DOMAIN npm run expo:static:build && npm run server:build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "verified-public-url", "needs-health-url"],
  },
  {
    name: "Kong Nightlife",
    slug: "kong-nightlife",
    description: "Kong Nightlife app repo. GitHub: robertmanzanillag-jpg/kong-nightlife.",
    environment: "production",
    publicUrl: "https://kongnightlife.com",
    healthUrl: "https://kongnightlife.com/api/ready",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "kong-nightlife",
    githubRepo: "robertmanzanillag-jpg/kong-nightlife",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run check:routes && npm run test:genre-classifier",
    buildCommand: "npm run server:build && npm run worker:build && WEB_DEPLOY_ONLY=true node scripts/build.js && node scripts/write-deploy-info.js",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "health-verified", "startup-database-readiness"],
  },
];

function normalizeRepo(repo: string | null | undefined): string {
  return (repo || "").trim().toLowerCase();
}

function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [];
}

function mergeTags(existing: unknown, incoming: unknown): string[] {
  return Array.from(new Set([...tags(existing), ...tags(incoming)]));
}

function normalizeKnownAppTags(existing: AppProject, known: InsertAppProject, mergedTags: string[]): string[] {
  const hasPublicUrl = Boolean(known.publicUrl || existing.publicUrl);
  const hasDeploymentProvider = Boolean(known.deploymentProvider || existing.deploymentProvider);
  const hasHealthUrl = Boolean(known.healthUrl || existing.healthUrl);
  const hasTestCommand = Boolean(known.testCommand || existing.testCommand);
  const hasBuildCommand = Boolean(known.buildCommand || existing.buildCommand);
  return mergedTags.filter((tag) => {
    if (hasPublicUrl && tag === "needs-public-url") return false;
    if (hasDeploymentProvider && tag === "needs-deploy-provider") return false;
    if (hasHealthUrl && tag === "needs-health-url") return false;
    if (hasTestCommand && tag === "needs-test-command") return false;
    if (hasBuildCommand && tag === "needs-build-command") return false;
    return true;
  });
}

function mergeKnownApp(existing: AppProject, known: InsertAppProject): Partial<AppProject> {
  const updates: Partial<AppProject> = {};

  const fields: Array<keyof InsertAppProject> = [
    "name",
    "slug",
    "description",
    "environment",
    "publicUrl",
    "healthUrl",
    "repoOwner",
    "repoName",
    "githubRepo",
    "deploymentProvider",
    "testCommand",
    "buildCommand",
    "priority",
    "ownerLabel",
  ];

  for (const field of fields) {
    const nextValue = known[field];
    if (field === "testCommand" || field === "buildCommand") {
      const previous = existing[field];
      const retired = known.slug === "br-website" || known.slug === "dropkit"
        ? [field === "testCommand" ? "npm run check" : "npm run build"]
        : known.slug === "kong-nightlife" ? field === "testCommand" ? ["npm run check"] : ["EXPO_PUBLIC_DOMAIN=kongnightlife.com npm run expo:static:build", "EXPO_PUBLIC_DOMAIN=kong--app.replit.app npm run expo:static:build"] : [];
      // Only exact old bootstrap defaults may be replaced or cleared. Preserve custom commands.
      if (previous && !retired.includes(previous)) continue;
      if (previous !== nextValue) updates[field] = known[field] || null;
      continue;
    }
    if (nextValue === null || nextValue === undefined || nextValue === "") continue;
    if (field === "deploymentProvider" && existing.deploymentProvider === "github-homepage") {
      updates.deploymentProvider = String(nextValue);
      continue;
    }
    if (["publicUrl", "healthUrl", "deploymentProvider"].includes(field) && (existing as any)[field]) {
      // Replace only the exact retired defaults confirmed against deployment
      // metadata. User-managed custom destinations remain untouched.
      const retired = known.slug === "kong-nightlife" ? "https://kong--app.replit.app" : known.slug === "blackops-reminder" ? "https://robplanner.replit.app" : undefined;
      const oldValue = retired && (field === "publicUrl" ? retired : field === "healthUrl" ? `${retired}/api/health` : undefined);
      if (!oldValue || (existing as any)[field] !== oldValue) continue;
    }
    if ((existing as any)[field] !== nextValue) {
      (updates as any)[field] = nextValue;
    }
  }

  const mergedTags = normalizeKnownAppTags({ ...existing, ...updates }, known, mergeTags(existing.tags, known.tags));
  if (JSON.stringify(tags(existing.tags).sort()) !== JSON.stringify(mergedTags.slice().sort())) {
    updates.tags = mergedTags;
  }

  return updates;
}

export function knownDeveloperHealthApps(): InsertAppProject[] {
  return KNOWN_DEVELOPER_HEALTH_APPS.map((app) => ({
    ...app,
    tags: tags(app.tags),
  }));
}

export async function upsertKnownDeveloperHealthInventory(
  userId: string,
  deps: DeveloperHealthInventoryDeps = storage,
): Promise<DeveloperHealthInventoryResult> {
  const existingApps = await deps.getAppProjects(userId);
  const byRepo = new Map(existingApps.map((app) => [normalizeRepo(app.githubRepo), app]));
  const result: DeveloperHealthInventoryResult = {
    created: [],
    updated: [],
    unchanged: [],
    totalKnownApps: KNOWN_DEVELOPER_HEALTH_APPS.length,
  };

  for (const known of KNOWN_DEVELOPER_HEALTH_APPS) {
    const repoKey = normalizeRepo(known.githubRepo);
    const existing = byRepo.get(repoKey);
    if (!existing) {
      result.created.push(await deps.createAppProject(userId, known));
      continue;
    }

    const updates = mergeKnownApp(existing, known);
    if (Object.keys(updates).length === 0) {
      result.unchanged.push(existing);
      continue;
    }

    result.updated.push(await deps.updateAppProject(existing.id, updates));
  }

  return result;
}
